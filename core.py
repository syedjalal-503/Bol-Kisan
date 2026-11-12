import os
import re
import sys
import sqlite3
import tempfile
import subprocess
from pathlib import Path
from io import BytesIO
from functools import lru_cache

import fitz
import pandas as pdsss
from dotenv import load_dotenv
from groq import Groq
from faster_whisper import WhisperModel
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


# --------------------------------------------------
# 1. CONFIGURATION
# --------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

KB_DIR = BASE_DIR / "knowledge_base"
CACHE_DIR = BASE_DIR / "cache"
DB_PATH = CACHE_DIR / "answers.db"
MANDI_FILE = BASE_DIR / "data" / "mandi_prices.csv"
PIPER_MODEL = BASE_DIR / "models" / "piper" / "hi_IN-pratham-medium.onnx"

CACHE_DIR.mkdir(exist_ok=True)

API_KEY = os.getenv("GROQ_API_KEY")
MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")

client = None

if API_KEY:
    try:
        client = Groq(
            api_key=API_KEY,
            timeout=15.0,
            max_retries=0
        )
    except Exception as error:
        print("Groq setup error:", error)

print("Bol Kisan: Groq configured =", client is not None)


# --------------------------------------------------
# 2. READ FARMING DOCUMENTS
# --------------------------------------------------

def load_documents():

    documents = []

    if not KB_DIR.exists():
        return documents

    for path in KB_DIR.iterdir():

        if path.suffix.lower() == ".pdf":

            try:
                with fitz.open(path) as pdf:

                    for page_number, page in enumerate(pdf, start=1):

                        text = page.get_text().strip()

                        if text:
                            documents.append({
                                "text": text,
                                "source": path.name,
                                "page": page_number
                            })

            except Exception as error:
                print("PDF error:", error)

        elif path.suffix.lower() == ".txt":

            try:
                text = path.read_text(
                    encoding="utf-8"
                ).strip()

                if text:
                    documents.append({
                        "text": text,
                        "source": path.name,
                        "page": 1
                    })

            except Exception as error:
                print("Text file error:", error)

    return documents


# --------------------------------------------------
# 3. CREATE SEARCHABLE CHUNKS
# --------------------------------------------------

def create_chunks(documents, size=1200):

    chunks = []

    for document in documents:

        text = document["text"]

        # Keep Hindi question-and-answer pairs together.
        if re.search(r"प्रश्न\s*[:：]", text):

            parts = re.split(
                r"(?=प्रश्न\s*[:：])",
                text
            )

            for part in parts:

                if part.strip():
                    chunks.append({
                        "text": part.strip(),
                        "source": document["source"],
                        "page": document["page"]
                    })

        else:

            for start in range(0, len(text), size):

                chunk = text[start:start + size]

                if chunk.strip():
                    chunks.append({
                        "text": chunk.strip(),
                        "source": document["source"],
                        "page": document["page"]
                    })

    return chunks


# --------------------------------------------------
# 4. SEARCH FARMING KNOWLEDGE
# --------------------------------------------------

class KnowledgeBase:

    def __init__(self):

        documents = load_documents()
        self.chunks = create_chunks(documents)

        self.vectorizer = None
        self.matrix = None

        if self.chunks:

            self.vectorizer = TfidfVectorizer(
                analyzer="char",
                ngram_range=(2, 5),
                max_features=30000
            )

            self.matrix = self.vectorizer.fit_transform(
                [chunk["text"] for chunk in self.chunks]
            )

    def search(self, question, top_k=3):

        if self.matrix is None:
            return []

        query = self.vectorizer.transform([question])

        scores = cosine_similarity(
            query,
            self.matrix
        )[0]

        indices = scores.argsort()[::-1][:top_k]

        results = []

        for index in indices:

            if scores[index] >= 0.04:

                result = self.chunks[index].copy()
                result["score"] = float(scores[index])

                results.append(result)

        return results


# --------------------------------------------------
# 5. CHEMICAL SAFETY
# --------------------------------------------------

CHEMICAL_REQUEST_TERMS = [

    "dosage",
    "dose",
    "how much pesticide",
    "how much insecticide",
    "which pesticide",
    "which insecticide",
    "chemical combination",
    "mixing pesticides",
    "ml per litre",
    "ml per liter",

    "कितनी मात्रा",
    "दवा की मात्रा",
    "कितना डालें",
    "कितनी दवा",
    "कौन सी दवा",
    "कौन सा कीटनाशक",
    "कितना स्प्रे",
    "मिलीलीटर",

    "ఎంత మోతాదు",
    "ఎంత మందు",
    "ఏ పురుగుమందు"
]


def is_sensitive(question):

    question = question.lower()

    return any(
        term in question
        for term in CHEMICAL_REQUEST_TERMS
    )


def safety_response(language):

    if language == "Hindi":

        return (
            "किसान भाई, बिना फसल और कीट की सही पहचान के "
            "किसी दवा का नाम या मात्रा बताना सुरक्षित नहीं है। "
            "पहले कीट की पहचान करें और दवा के असली लेबल "
            "की जानकारी जांचें।"
        )

    if language == "Telugu":

        return (
            "పంట మరియు పురుగును సరిగ్గా గుర్తించకుండా "
            "మందు పేరు లేదా మోతాదు చెప్పడం సురక్షితం కాదు. "
            "మందు అసలు లేబుల్‌ను పరిశీలించండి."
        )

    return (
        "It is not safe to recommend a chemical or dose "
        "without identifying the crop and pest. Check the "
        "exact product label before applying any chemical."
    )


# --------------------------------------------------
# 6. OFFLINE ANSWER CACHE
# --------------------------------------------------

def init_cache():

    with sqlite3.connect(DB_PATH) as connection:

        connection.execute("""
            CREATE TABLE IF NOT EXISTS answers (
                question TEXT PRIMARY KEY,
                answer TEXT,
                language TEXT
            )
        """)


def cache_key(question, language):

    return (
        language.lower()
        + ":"
        + question.lower().strip()
    )


def get_cached_answer(question, language):

    init_cache()

    key = cache_key(question, language)

    with sqlite3.connect(DB_PATH) as connection:

        row = connection.execute(
            "SELECT answer FROM answers WHERE question = ?",
            (key,)
        ).fetchone()

    return row[0] if row else None


def save_answer(question, answer, language):

    init_cache()

    key = cache_key(question, language)

    with sqlite3.connect(DB_PATH) as connection:

        connection.execute(
            """
            INSERT OR REPLACE INTO answers
            (question, answer, language)
            VALUES (?, ?, ?)
            """,
            (key, answer, language)
        )


# --------------------------------------------------
# 7. SHORT LOCAL ANSWER
# --------------------------------------------------

def extract_local_answer(source_text):

    match = re.search(
        r"उत्तर\s*[:：]\s*(.*)",
        source_text,
        flags=re.DOTALL
    )

    if match:

        answer = match.group(1).strip()

        answer = re.split(
            r"प्रश्न\s*[:：]",
            answer
        )[0].strip()

        return answer

    return source_text[:500].strip()


def offline_answer(question, language, knowledge_base):

    sources = knowledge_base.search(question)

    if not sources:

        cached = get_cached_answer(
            question,
            language
        )

        if cached:
            return cached, []

        if language == "Hindi":

            return (
                "माफ कीजिए किसान भाई, मेरी स्थानीय जानकारी में "
                "इस सवाल का सही जवाब नहीं मिला।"
            ), []

        return (
            "I could not find a reliable answer in the "
            "offline farming documents."
        ), []

    answer = extract_local_answer(
        sources[0]["text"]
    )

    return answer, sources


# --------------------------------------------------
# 8. HYBRID ANSWER: GROQ ONLINE + LOCAL OFFLINE
# --------------------------------------------------

def generate_answer(question, language, knowledge_base):

    question = question.strip()

    if not question:
        return "Please enter or speak a question.", []

    # Chemical safety check.
    if is_sensitive(question):
        return safety_response(language), []

    sources = knowledge_base.search(question)

    cached = get_cached_answer(
        question,
        language
    )

    # If no relevant documents are found.
    if not sources:

        if cached:
            return cached, []

        if language == "Hindi":

            return (
                "किसान भाई, मेरी दी गई खेती की जानकारी में "
                "इस सवाल का सही जवाब नहीं मिला।"
            ), []

        return (
            "I could not find reliable information in the "
            "provided farming documents."
        ), []

    # Prepare document context.
    context = "\n\n".join(
        f"Source: {source['source']}, "
        f"page: {source['page']}\n{source['text']}"
        for source in sources
    )

    # Try Groq when internet is available.
    if client is not None:

        system_prompt = f"""
You are Bol Kisan, a careful agricultural assistant.

Answer in simple {language}.

Use ONLY the supplied farming document context.
Do not invent facts or recommendations.
If the documents do not answer the question, say so.
Never invent pesticide doses, chemical combinations,
harvest intervals, or product-specific instructions.
For exact chemical doses, follow the actual product label.
Keep the answer short, direct, and easy for a farmer to understand.
"""

        try:

            response = client.chat.completions.create(

                model=MODEL,

                messages=[
                    {
                        "role": "system",
                        "content": system_prompt
                    },
                    {
                        "role": "user",
                        "content": (
                            f"Farming document context:\n{context}\n\n"
                            f"Farmer's question: {question}"
                        )
                    }
                ],

                temperature=0.1,
                max_tokens=250
            )

            answer = (
                response.choices[0]
                .message.content.strip()
            )

            if answer:

                save_answer(
                    question,
                    answer,
                    language
                )

                return answer, sources

        except Exception as error:

            print(
                "Groq unavailable; switching to offline mode:",
                error
            )

    # Offline fallback.
    if cached:
        return cached, sources

    return offline_answer(
        question,
        language,
        knowledge_base
    )


# --------------------------------------------------
# 9. OFFLINE SPEECH-TO-TEXT
# --------------------------------------------------

@lru_cache(maxsize=1)
def get_whisper_model():

    os.environ["HF_HUB_OFFLINE"] = "1"

    return WhisperModel(
        "base",
        device="cpu",
        compute_type="int8"
    )


def transcribe_audio(audio_bytes, language):

    language_codes = {
        "Hindi": "hi",
        "Telugu": "te",
        "English": "en"
    }

    language_code = language_codes.get(
        language,
        "hi"
    )

    temp_path = None

    try:

        with tempfile.NamedTemporaryFile(
            suffix=".wav",
            delete=False
        ) as temp_file:

            temp_file.write(audio_bytes)
            temp_path = temp_file.name

        model = get_whisper_model()

        segments, info = model.transcribe(

            temp_path,

            language=language_code,

            beam_size=3,

            vad_filter=False,

            condition_on_previous_text=False,

            no_speech_threshold=0.6,

            initial_prompt=(
                "किसान, खेती, फसल, पत्तियां, पत्ते, "
                "पीले पत्ते, पानी, मिट्टी, खाद और मौसम।"
            )
        )

        text = " ".join(
            segment.text.strip()
            for segment in segments
        ).strip()

        print("Selected language:", language)
        print("Detected language:", info.language)
        print("Recognized question:", text)

        return text if text else None

    except Exception as error:

        print(
            "Offline transcription error:",
            error
        )

        return None

    finally:

        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)


# --------------------------------------------------
# 10. OFFLINE HINDI TEXT-TO-SPEECH
# --------------------------------------------------

def text_to_speech(text, language):

    # Hindi Piper voice is currently installed.
    if language != "Hindi":
        return None

    if not PIPER_MODEL.exists():

        print("Hindi Piper model not found.")

        return None

    temp_path = None

    try:

        with tempfile.NamedTemporaryFile(
            suffix=".wav",
            delete=False
        ) as temp_file:

            temp_path = temp_file.name

        # Enable UTF-8 for Hindi text on Windows.
        piper_env = os.environ.copy()
        piper_env["PYTHONUTF8"] = "1"

        subprocess.run(

            [
                sys.executable,
                "-m",
                "piper",
                "--model",
                str(PIPER_MODEL),
                "--output_file",
                temp_path
            ],

            input=text.encode("utf-8"),

            capture_output=True,

            check=True,

            env=piper_env
        )

        with open(temp_path, "rb") as audio_file:

            audio = BytesIO(
                audio_file.read()
            )

        audio.seek(0)

        return audio

    except Exception as error:

        print(
            "Offline speech error:",
            error
        )

        return None

    finally:

        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)


# --------------------------------------------------
# 11. MOCK MANDI PRICES
# --------------------------------------------------

def load_mandi_prices():

    if not MANDI_FILE.exists():

        return pd.DataFrame(
            columns=[
                "crop",
                "mandi",
                "date",
                "price",
                "previous_price"
            ]
        )

    try:

        return pd.read_csv(MANDI_FILE)

    except Exception as error:

        print("Mandi data error:", error)

        return pd.DataFrame(
            columns=[
                "crop",
                "mandi",
                "date",
                "price",
                "previous_price"
            ]
        )

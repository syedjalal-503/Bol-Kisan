import os
import re
import sys
import time
import sqlite3
import tempfile
import subprocess

from pathlib import Path
from faster_whisper import WhisperModel
from io import BytesIO
from functools import lru_cache

import fitz
import pandas as pd

from dotenv import load_dotenv
from groq import Groq
from faster_whisper import WhisperModel

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


# ==================================================
# 1. CONFIGURATION
# ==================================================

BASE_DIR = Path(__file__).resolve().parent

load_dotenv(BASE_DIR / ".env")

KB_DIR = BASE_DIR / "knowledge_base"
CACHE_DIR = BASE_DIR / "cache"

DB_PATH = CACHE_DIR / "answers.db"

MANDI_FILE = BASE_DIR / "data" / "mandi_prices.csv"

PIPER_MODEL = (
    BASE_DIR
    / "models"
    / "piper"
    / "hi_IN-pratham-medium.onnx"
)

CACHE_DIR.mkdir(exist_ok=True)

API_KEY = os.getenv("GROQ_API_KEY")

MODEL = os.getenv(
    "GROQ_MODEL",
    "llama-3.3-70b-versatile"
)

client = None

if API_KEY:
    try:
        client = Groq(
            api_key=API_KEY,
            timeout=8.0,
            max_retries=0
        )
    except Exception as error:
        print("Groq setup error:", error)

print(
    "Bol Kisan: Groq configured =",
    client is not None
)


# ==================================================
# 2. READ FARMING DOCUMENTS
# ==================================================

def load_documents():

    documents = []

    if not KB_DIR.exists():
        return documents

    for path in KB_DIR.iterdir():

        if path.suffix.lower() == ".pdf":

            try:
                with fitz.open(path) as pdf:

                    for page_number, page in enumerate(
                        pdf,
                        start=1
                    ):

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


# ==================================================
# 3. CREATE SEARCHABLE CHUNKS
# ==================================================

def create_chunks(documents, size=1200):

    chunks = []

    for document in documents:

        text = document["text"]

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


# ==================================================
# 4. SEARCH FARMING KNOWLEDGE
# ==================================================

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
                max_features=20000,
                dtype="float64"
            )

            self.matrix = self.vectorizer.fit_transform(
                [
                    chunk["text"]
                    for chunk in self.chunks
                ]
            )

        print(
            "Knowledge base loaded:",
            len(self.chunks),
            "chunks"
        )

    def search(self, question, top_k=3):

        if self.matrix is None:
            return []

        try:

            query = self.vectorizer.transform(
                [question]
            )

            scores = cosine_similarity(
                query,
                self.matrix
            )[0]

            indices = scores.argsort()[::-1][:top_k]

            results = []

            for index in indices:

                if scores[index] >= 0.04:

                    result = self.chunks[index].copy()

                    result["score"] = float(
                        scores[index]
                    )

                    results.append(result)

            return results

        except Exception as error:
            print("Knowledge search error:", error)
            return []


# ==================================================
# 5. CHEMICAL SAFETY
# ==================================================

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
            "दवा का नाम या मात्रा बताना सुरक्षित नहीं है। "
            "दवा के असली लेबल की जानकारी जांचें और "
            "कृषि विशेषज्ञ से सलाह लें।"
        )

    if language == "Telugu":

        return (
            "పంట మరియు పురుగును సరిగ్గా గుర్తించకుండా "
            "మందు పేరు లేదా మోతాదు చెప్పడం సురక్షితం కాదు. "
            "మందు లేబుల్‌ను పరిశీలించి వ్యవసాయ నిపుణుడిని సంప్రదించండి."
        )

    return (
        "It is not safe to recommend a chemical or dose "
        "without identifying the crop and pest. Check the "
        "product label and consult an agricultural expert."
    )


# ==================================================
# 6. ANSWER CACHE
# ==================================================

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
            """
            SELECT answer
            FROM answers
            WHERE question = ?
            """,
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
            (
                key,
                answer,
                language
            )
        )


# ==================================================
# 7. CONVERSATION CONTEXT
# ==================================================

def build_retrieval_query(
    question,
    conversation_context=""
):

    question = question.strip()

    if not conversation_context:
        return question

    previous_questions = re.findall(
        r"Farmer:\s*(.+)",
        conversation_context
    )

    if not previous_questions:
        return question

    previous_question = (
        previous_questions[-1].strip()
    )

    follow_up_terms = [

        "it", "this", "that", "they", "them",
        "same", "why", "how", "what about",

        "और", "यह", "ये", "इसका", "इसकी",
        "उसका", "उसकी", "फिर", "क्या यह",
        "क्या ये", "ऐसा", "ऐसी",

        "iska", "iski", "uska", "uski",
        "yeh", "ye", "woh", "phir", "aur"

    ]

    question_lower = question.lower()

    is_follow_up = (

        len(question) <= 90

        or any(
            term in question_lower
            for term in follow_up_terms
        )

    )

    if is_follow_up:

        return (
            previous_question
            + " "
            + question
        )

    return question


# ==================================================
# 8. EXTRACT LOCAL ANSWER
# ==================================================

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


# ==================================================
# 9. OFFLINE ANSWER
# ==================================================

def offline_answer(
    question,
    language,
    knowledge_base,
    conversation_context=""
):

    search_query = build_retrieval_query(
        question,
        conversation_context
    )

    sources = knowledge_base.search(
        search_query
    )

    if not sources:

        cached = get_cached_answer(
            question,
            language
        )

        if cached:
            return cached, []

        if language == "Hindi":

            return (
                "माफ कीजिए किसान भाई, मेरी स्थानीय जानकारी "
                "में इस सवाल का सही जवाब नहीं मिला।"
            ), []

        return (
            "I could not find a reliable answer in the "
            "offline farming documents."
        ), []

    answer = extract_local_answer(
        sources[0]["text"]
    )

    return answer, sources


# ==================================================
# 10. HYBRID ANSWER GENERATION
# ==================================================

def generate_answer(
    question,
    language,
    knowledge_base,
    conversation_context=""
):

    start_time = time.perf_counter()

    question = question.strip()

    if not question:
        return "कृपया अपना सवाल बताइए।", []

    # CHEMICAL SAFETY

    if is_sensitive(question):
        return safety_response(language), []

    # ANSWER CACHE

    cached = None

    if not conversation_context:

        cached = get_cached_answer(
            question,
            language
        )

        if cached:

            print(
                "Answer cache hit:",
                round(time.perf_counter() - start_time, 2),
                "seconds"
            )

            return cached, []

    # SEARCH LOCAL KNOWLEDGE

    search_query = build_retrieval_query(
        question,
        conversation_context
    )

    sources = knowledge_base.search(
        search_query
    )

    if sources:

        document_context = "\n\n".join(

            (
                f"Source: {source['source']}, "
                f"page: {source['page']}\n"
                f"{source['text']}"
            )

            for source in sources

        )

    else:

        document_context = (
            "No relevant local farming documents were found. "
            "Do not pretend that documents support your answer."
        )

    history_context = (
        conversation_context
        if conversation_context
        else "No previous conversation."
    )

    # GROQ ANSWER GENERATION

    if client is not None:

        system_prompt = f"""
You are Bol Kisan, a careful agricultural assistant.

Speak in simple, natural {language}.

Your answers are for farmers who need quick help.

ANSWER STYLE:
- Use simple everyday language.
- Keep answers between 25 and 45 words.
- Use 2 or 3 short sentences.
- Give the most useful advice first.
- Avoid unnecessary introductions.
- Do not use tables or long lists.
- Make the answer natural for voice playback.
- Finish the answer completely.

FARMING SAFETY:
- Never guess a crop disease or pest diagnosis.
- If symptoms are unclear, ask only one useful question.
- Never invent pesticide doses or chemical combinations.
- Never invent harvest intervals or product instructions.
- Recommend following registered product labels.
- Recommend local agricultural experts when needed.

DOCUMENT RULES:
- Use local documents when relevant.
- Never claim that unsupported documents verify an answer.
- If no relevant document exists, give cautious general advice.
- Clearly distinguish general advice from verified local information.

CONVERSATION:
- Use conversation history to understand follow-up questions.
- Do not treat previous assistant answers as verified facts.

Do not sacrifice safety for speed.
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
                            f"Previous conversation:\n"
                            f"{history_context}\n\n"
                            f"Farming document context:\n"
                            f"{document_context}\n\n"
                            f"Farmer's current question:\n"
                            f"{question}"
                        )
                    }
                ],

                temperature=0.1,
                max_tokens=120

            )

            answer = (
                response.choices[0].message.content or ""
            ).strip()

            if answer:

                if sources and not conversation_context:

                    save_answer(
                        question,
                        answer,
                        language
                    )

                elapsed = (
                    time.perf_counter() - start_time
                )

                print(
                    "Answer generation time:",
                    round(elapsed, 2),
                    "seconds"
                )

                return answer, sources

        except Exception as error:

            print(
                "Groq unavailable; using offline answer:",
                error
            )

    # OFFLINE FALLBACK

    if cached:
        return cached, []

    if not sources:

        if language == "Hindi":

            return (
                "किसान भाई, अभी इस सवाल के लिए "
                "विश्वसनीय जानकारी उपलब्ध नहीं है। "
                "कृपया अपनी फसल और समस्या बताइए।"
            ), []

        return (
            "I could not find reliable information for "
            "this question. Please provide more details "
            "about your crop and its symptoms."
        ), []

    answer, offline_sources = offline_answer(
        question,
        language,
        knowledge_base,
        conversation_context
    )

    elapsed = (
        time.perf_counter() - start_time
    )

    print(
        "Offline answer time:",
        round(elapsed, 2),
        "seconds"
    )

    return answer, offline_sources


# ==================================================
# 11. FASTER WHISPER SPEECH RECOGNITION
# ==================================================

@lru_cache(maxsize=1)
def get_whisper_model():

    os.environ["HF_HUB_OFFLINE"] = "1"

    print("Loading Whisper Tiny model...")

    start_time = time.perf_counter()

    model = WhisperModel(
        "tiny",
        device="cpu",
        compute_type="int8",
        cpu_threads=4,
        num_workers=1
    )

    print(
        "Whisper loaded in",
        round(time.perf_counter() - start_time, 2),
        "seconds"
    )

    return model


def transcribe_audio(audio_bytes, language):

    start_time = time.perf_counter()

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

            beam_size=1,
            best_of=1,

            vad_filter=False,

            condition_on_previous_text=False,

            no_speech_threshold=0.6,

            initial_prompt=(
                "खेती, किसान, पौधे, पौधों, पत्ते, पत्तों, "
                "पत्तियां, पत्तियों, काले धब्बे, पीले पत्ते, "
                "बीमारी, कीड़े, पानी, मिट्टी, खाद और फसल।"
            )

        )

        text = " ".join(
            segment.text.strip()
            for segment in segments
        ).strip()

        print("Selected language:", language)
        print("Detected language:", info.language)
        print("Recognized question:", text)

        print(
            "Speech recognition time:",
            round(time.perf_counter() - start_time, 2),
            "seconds"
        )

        return text if text else None

    except Exception as error:

        print("Offline transcription error:", error)
        return None

    finally:

        if temp_path and os.path.exists(temp_path):

            try:
                os.remove(temp_path)
            except OSError:
                pass


# ==================================================
# 12. PIPER HINDI TEXT-TO-SPEECH
# UTF-8 FILE INPUT FIX FOR WINDOWS
# ==================================================

def text_to_speech(text, language):

    if language != "Hindi":
        return None

    if not text or not text.strip():
        return None

    if not PIPER_MODEL.exists():

        print(
            "Hindi Piper model not found:",
            PIPER_MODEL
        )

        return None

    start_time = time.perf_counter()

    text_path = None
    audio_path = None

    try:

        # Write Hindi text using UTF-8 encoding

        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            suffix=".txt",
            delete=False
        ) as text_file:

            text_file.write(text)
            text_path = text_file.name

        # Create temporary WAV destination

        with tempfile.NamedTemporaryFile(
            suffix=".wav",
            delete=False
        ) as audio_file:

            audio_path = audio_file.name

        # Windows UTF-8 environment

        piper_env = os.environ.copy()

        piper_env["PYTHONUTF8"] = "1"
        piper_env["PYTHONIOENCODING"] = "utf-8"

        # Run Piper with UTF-8 input file

        result = subprocess.run(

            [
                sys.executable,
                "-m",
                "piper",

                "--model",
                str(PIPER_MODEL),

                "--input_file",
                text_path,

                "--output_file",
                audio_path
            ],

            capture_output=True,

            check=True,

            timeout=20,

            env=piper_env

        )

        # Verify WAV output

        if not os.path.exists(audio_path):
            raise RuntimeError(
                "Piper did not create an audio file"
            )

        if os.path.getsize(audio_path) == 0:
            raise RuntimeError(
                "Piper generated an empty WAV file"
            )

        # Load generated audio into memory

        with open(audio_path, "rb") as audio_file:

            audio = BytesIO(
                audio_file.read()
            )

        audio.seek(0)

        elapsed = (
            time.perf_counter() - start_time
        )

        print(
            "Speech generation time:",
            round(elapsed, 2),
            "seconds"
        )

        print(
            "Generated audio size:",
            round(len(audio.getvalue()) / 1024, 1),
            "KB"
        )

        return audio

    except subprocess.TimeoutExpired:

        print(
            "Offline speech error: "
            "Piper timed out after 20 seconds"
        )

        return None

    except subprocess.CalledProcessError as error:

        print("Offline speech error: Piper failed")

        if error.stderr:

            print(
                error.stderr.decode(
                    "utf-8",
                    errors="replace"
                )
            )

        return None

    except Exception as error:

        print(
            "Offline speech error:",
            error
        )

        return None

    finally:

        # Clean up temporary files

        for path in (text_path, audio_path):

            if path and os.path.exists(path):

                try:
                    os.remove(path)
                except OSError:
                    pass


# ==================================================
# 13. MOCK MANDI PRICES
# ==================================================

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

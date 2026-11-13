import os
import re
import sqlite3
from pathlib import Path
from io import BytesIO

import fitz
import pandas as pd
from dotenv import load_dotenv
from groq import Groq
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from gtts import gTTS

# Configuration
BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

KB_DIR = BASE_DIR / "knowledge_base"
CACHE_DIR = BASE_DIR / "cache"
DB_PATH = CACHE_DIR / "answers.db"
MANDI_FILE = BASE_DIR / "data" / "mandi_prices.csv"

CACHE_DIR.mkdir(exist_ok=True)

API_KEY = os.getenv("GROQ_API_KEY")
MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
client = Groq(api_key=API_KEY) if API_KEY else None
print("GROQ API KEY LOADED:", bool(API_KEY))
print("GROQ CLIENT CONNECTED:", client is not None)


# 1. Read farming documents
def load_documents():
    documents = []

    for path in KB_DIR.iterdir():
        if path.suffix.lower() == ".pdf":
            try:
                pdf = fitz.open(path)
                for page_number, page in enumerate(pdf, start=1):
                    text = page.get_text().strip()
                    if text:
                        documents.append({
                            "text": text,
                            "source": path.name,
                            "page": page_number
                        })
            except Exception as error:
                print(f"PDF error: {error}")

        elif path.suffix.lower() == ".txt":
            text = path.read_text(encoding="utf-8").strip()
            if text:
                documents.append({
                    "text": text,
                    "source": path.name,
                    "page": 1
                })

    return documents


# 2. Divide documents into searchable chunks
def create_chunks(documents, size=1200):
    chunks = []

    for document in documents:
        text = document["text"]

        for start in range(0, len(text), size):
            chunk = text[start:start + size]
            if chunk.strip():
                chunks.append({
                    "text": chunk,
                    "source": document["source"],
                    "page": document["page"]
                })

    return chunks


# 3. Search farming knowledge
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
        scores = cosine_similarity(query, self.matrix)[0]
        indices = scores.argsort()[::-1][:top_k]

        results = []
        for index in indices:
            if scores[index] >= 0.04:
                result = self.chunks[index].copy()
                result["score"] = float(scores[index])
                results.append(result)

        return results


# 4. Basic safety screening
SENSITIVE_TERMS = [
    "pesticide", "insecticide", "herbicide", "fungicide",
    "dosage", "dose", "chemical spray", "spray quantity",
    "कितनी मात्रा", "कीटनाशक", "दवा की मात्रा",
    "పురుగుమందు", "మోతాదు", "ఎంత మందు"
]


def is_sensitive(question):
    question = question.lower()
    return any(term in question for term in SENSITIVE_TERMS)


def safety_response(language):
    if language == "Telugu":
        return (
            "ఈ ప్రశ్న రసాయన మందుల వాడకానికి సంబంధించినది. "
            "తప్పు మోతాదు ప్రమాదకరం. ఉత్పత్తి లేబుల్‌ను "
            "చూడండి లేదా వ్యవసాయ అధికారిని సంప్రదించండి."
        )

    if language == "Hindi":
        return (
            "यह सवाल रासायनिक दवा के उपयोग से संबंधित है। "
            "गलत मात्रा खतरनाक हो सकती है। उत्पाद का लेबल "
            "देखें या कृषि अधिकारी से संपर्क करें।"
        )

    return (
        "This question involves agricultural chemicals. "
        "Do not guess a dose. Check the exact product label "
        "or consult an agricultural officer."
    )


# 5. Offline answer cache
def init_cache():
    with sqlite3.connect(DB_PATH) as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS answers (
                question TEXT PRIMARY KEY,
                answer TEXT,
                language TEXT
            )
        """)


def get_cached_answer(question):
    init_cache()

    with sqlite3.connect(DB_PATH) as connection:
        row = connection.execute(
            "SELECT answer FROM answers WHERE question = ?",
            (question.lower().strip(),)
        ).fetchone()

    return row[0] if row else None


def save_answer(question, answer, language):
    init_cache()

    with sqlite3.connect(DB_PATH) as connection:
        connection.execute(
            """
            INSERT OR REPLACE INTO answers
            (question, answer, language)
            VALUES (?, ?, ?)
            """,
            (question.lower().strip(), answer, language)
        )


# 6. Generate farming answer
def generate_answer(question, language, knowledge_base):
    if is_sensitive(question):
        return safety_response(language), []

    cached = get_cached_answer(question)
    if not client:
        if cached:
            return cached, []
        return "Internet AI service unavailable. No cached answer found.", []

    sources = knowledge_base.search(question)

    if not sources:
        return (
            "I could not find reliable information in the provided "
            "farming documents. Please contact an agricultural officer."
        ), []

    context = "\n\n".join(
        f"Source: {s['source']}, page: {s['page']}\n{s['text']}"
        for s in sources
    )

    system_prompt = f"""
You are Bol Kisan, a cautious agricultural assistant.

Answer in simple {language}.
Use ONLY the supplied farming document context.
If the context does not answer the question, say so.
Never invent pesticide doses, chemical combinations,
harvest intervals, or safety instructions.
For chemical questions, do not guess. Refer the farmer
to the exact product label or an agricultural officer.
Keep answers short and understandable.
"""

    try:
        response = client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": f"Document context:\n{context}\n\nQuestion: {question}"
                }
            ],
            temperature=0.1,
            max_tokens=500
        )

        answer = response.choices[0].message.content.strip()
        save_answer(question, answer, language)
        return answer, sources

    except Exception as error:
        print(f"AI error: {error}")

        if cached:
            return cached, []

        return "Unable to generate an answer right now.", []


# 7. Convert speech to text
def transcribe_audio(audio_bytes, language):
    if not client:
        return None

    language_codes = {
        "Telugu": "te",
        "Hindi": "hi"
    }

    try:
        result = client.audio.transcriptions.create(
            file=("farmer_audio.wav", audio_bytes),
            model="whisper-large-v3-turbo",
            language=language_codes.get(language, "te")
        )
        return result.text
    except Exception as error:
        print(f"Transcription error: {error}")
        return None


# 8. Convert answer to speech
def text_to_speech(text, language):
    language_codes = {
        "Telugu": "te",
        "Hindi": "hi"
    }

    try:
        audio = BytesIO()
        tts = gTTS(
            text=text,
            lang=language_codes.get(language, "te")
        )
        tts.write_to_fp(audio)
        audio.seek(0)
        return audio
    except Exception as error:
        print(f"Speech error: {error}")
        return None


# 9. Load mock mandi prices
def load_mandi_prices():
    if not MANDI_FILE.exists():
        return pd.DataFrame(
            columns=["crop", "mandi", "date", "price", "previous_price"]
        )

    return pd.read_csv(MANDI_FILE)

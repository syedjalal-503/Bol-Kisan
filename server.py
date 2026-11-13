"""Bol Kisan – real-time voice + leaf scan server.
Run:  uvicorn server:app --reload
Needs: pip install fastapi uvicorn python-multipart edge-tts
"""
import base64
import json
import os
import re
from pathlib import Path

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel

import core

app = FastAPI(title="Bol Kisan")
STATIC = Path(__file__).parent / "static"
kb = core.KnowledgeBase()

# Groq vision model. Names change often: override in .env with GROQ_VISION_MODEL
VISION_MODEL = os.getenv("GROQ_VISION_MODEL", "qwen/qwen3.8-27b")
# Natural Microsoft neural voices (much clearer Telugu/Hindi than gTTS). gTTS stays as fallback.
VOICES = {"Telugu": "te-IN-ShrutiNeural", "Hindi": "hi-IN-SwaraNeural"}
# Telugu speech recognition is more accurate with whisper-large-v3 (a bit slower than turbo)
STT_MODEL = os.getenv("STT_MODEL", "whisper-large-v3-turbo")
VISION_FALLBACKS = ["qwen/qwen3.6-27b", "meta-llama/llama-4-scout-17b-16e-instruct"]


class Ask(BaseModel):
    question: str
    language: str = "Telugu"


class Speak(BaseModel):
    text: str
    language: str = "Telugu"


def ev(**kw) -> str:
    return json.dumps(kw, ensure_ascii=False) + "\n"


def pack(sources):
    seen, out = set(), []
    for s in sources:                              # one card per page, only clearly relevant ones
        key = (s["source"], s["page"])
        if key not in seen and s.get("score", 0) >= 0.12:
            seen.add(key)
            out.append({"source": s["source"], "page": s["page"], "text": s["text"][:600]})
    return out


def system_prompt(language: str) -> str:
    lang = "simple Telugu" if language == "Telugu" else "simple Hindi"
    return f"""You are Bol Kisan, an expert Indian agronomist who advises small farmers.
Rules:
1. Answer in {lang}, written only in the native script (no English letters, no transliteration, no markdown, no bullets). Use natural spoken words.
2. Always give a confident, complete, practical answer. NEVER say you do not know, and never say the documents lack information. Use the DOCUMENTS when they are relevant; otherwise answer from your own agricultural expertise.
3. Crop selection questions (for example "what to grow on 2 acres"): suggest 3 to 4 suitable crops for each main season (kharif, rabi, summer), with one line on why, water need and approximate profit potential. Mention that soil and water type can change the choice.
4. Pest, disease or fertilizer questions: give the problem name, the cause, organic or cultural control first, then chemical options with the active ingredient and the standard dose per litre of water or per acre, as in standard package-of-practices. Add the safety line: read the product label and wear protection.
5. Be specific: numbers, months, spacing, quantities. Do not invent citations or document names.
6. At most 6 short sentences. Each sentence must end with a full stop."""


def stream_answer(question: str, language: str, emit_q: bool = False):
    """Yields NDJSON events as the answer is written, so the page can speak sentence by sentence."""
    if emit_q:
        yield ev(type="q", text=question)
    sources = kb.search(question)
    cache_lang = language + "-v2"                  # separate from old cached refusals
    cached = core.get_cached_answer(question, cache_lang)
    if cached:                                     # instant repeat answers
        yield ev(type="delta", text=cached)
        yield ev(type="done", sources=pack(sources))
        return
    if not core.client:
        yield ev(type="delta", text="AI service is unavailable. Please check the internet connection.")
        yield ev(type="done", sources=[])
        return
    good = [x for x in sources if x.get("score", 0) >= 0.12]
    context = "\n\n".join(f"Source: {x['source']}, Page: {x['page']}\n{x['text']}" for x in good) or "(no relevant document found)"
    full = ""
    try:
        stream = core.client.chat.completions.create(
            model=core.MODEL,
            messages=[
                {"role": "system", "content": system_prompt(language)},
                {"role": "user", "content": f"DOCUMENTS:\n{context}\n\nFARMER QUESTION:\n{question}"},
            ],
            temperature=0.3,
            max_tokens=500,
            stream=True,
        )
        for chunk in stream:
            piece = chunk.choices[0].delta.content or ""
            if piece:
                full += piece
                yield ev(type="delta", text=piece)
        core.save_answer(question, cache_lang, full)
        yield ev(type="done", sources=pack(sources))
    except Exception:
        if not full:
            yield ev(type="delta", text="The AI service is temporarily unavailable. Please try again.")
        yield ev(type="done", sources=[])


def ndjson(gen):
    return StreamingResponse(gen, media_type="application/x-ndjson", headers={"X-Accel-Buffering": "no"})


@app.get("/")
def home():
    return FileResponse(STATIC / "index.html")


@app.post("/api/voice")
def voice(audio: UploadFile = File(...), language: str = Form("Telugu")):
    if not core.client:
        return {"question": "", "answer": "", "error": "GROQ_API_KEY is missing."}
    code = {"Telugu": "te", "Hindi": "hi"}.get(language, "en")
    data = audio.file.read()
    ext = "mp4" if "mp4" in (audio.content_type or "") else "webm"
    try:
        result = core.client.audio.transcriptions.create(
            file=(f"farmer.{ext}", data),
            model=STT_MODEL,
            language=code,
            temperature=0,
        )
    except Exception as e:
        return {"question": "", "answer": "", "error": f"Speech recognition failed: {e}"}
    text = (result.text or "").strip()
    if len(text) < 2:
        return {"question": "", "answer": ""}
    return ndjson(stream_answer(text, language, emit_q=True))


@app.post("/api/ask")
def ask(body: Ask):
    return ndjson(stream_answer(body.question.strip(), body.language))


@app.post("/api/tts")
async def tts(body: Speak):
    """One short sentence -> mp3. The page calls this per sentence so speech starts fast."""
    text = body.text[:400]
    try:
        import edge_tts
        comm = edge_tts.Communicate(text, VOICES.get(body.language, VOICES["Hindi"]), rate="+5%")
        audio = b""
        async for chunk in comm.stream():
            if chunk["type"] == "audio":
                audio += chunk["data"]
        if audio:
            return Response(audio, media_type="audio/mpeg")
    except Exception:
        pass
    try:                                           # fallback: gTTS
        speech = await run_in_threadpool(core.text_to_speech, text, body.language)
        return Response(speech.getvalue(), media_type="audio/mpeg")
    except Exception:
        return Response(status_code=503)


@app.post("/api/leaf")
def leaf(image: UploadFile = File(...), language: str = Form("Telugu")):
    if not core.client:
        return {"answer": "", "error": "GROQ_API_KEY is missing."}
    b64 = base64.b64encode(image.file.read()).decode()
    lang = "simple Telugu" if language == "Telugu" else "simple Hindi"
    prompt = f"""You are Bol Kisan, an expert Indian plant pathologist. Look at this photo of a plant leaf.
Reply in {lang}, in the native script only (no English letters, no markdown, no bullets), in short spoken sentences ending with a full stop.
Give a confident, specific diagnosis. Cover, in this order:
1. The crop and the disease, pest or deficiency name (use the common local name). Never answer "not sure": name the most likely one.
2. The cause and the visible symptoms that show it.
3. How to cure it: first organic and cultural steps (remove affected leaves, drainage, neem oil, spacing).
4. Chemical control: name 1 or 2 commonly used pesticides or fungicides by active ingredient (for example mancozeb, carbendazim, imidacloprid), with the standard dose per litre of water (or per acre) and the repeat interval in days, as in standard package-of-practices.
5. Safety: read the product label, wear gloves and mask, and respect the waiting period before harvest.
6. One line on how to prevent it next season.
Only if the image is clearly not a plant, say so and ask for a clearer photo."""
    content = [
        {"type": "text", "text": prompt},
        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
    ]
    last_error = ""
    for model in [VISION_MODEL] + VISION_FALLBACKS:
        try:
            res = core.client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": content}],
                temperature=0.2,
                max_tokens=900,
            )
            text = res.choices[0].message.content or ""
            text = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()
            return {"answer": text, "sources": None}
        except Exception as e:
            last_error = str(e)
    return {"answer": "", "error": f"Leaf analysis failed. Set GROQ_VISION_MODEL in .env to a current Groq vision model. ({last_error[:160]})"}


@app.get("/api/prices")
def prices():
    df = core.load_mandi_prices()
    return df.astype(object).where(df.notna(), None).to_dict("records")


@app.post("/api/refresh")
def refresh():
    global kb
    kb = core.KnowledgeBase()
    return {"chunks": len(kb.chunks)}
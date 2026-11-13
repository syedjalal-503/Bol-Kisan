import html
import io
import queue
import threading
import wave

import av
import numpy as np
import streamlit as st
from streamlit_webrtc import WebRtcMode, webrtc_streamer

from core import (
    KnowledgeBase,
    generate_answer,
    transcribe_audio,
    text_to_speech,
    load_mandi_prices,
)


# ==================================================
# BACKGROUND VOICE WORKER
# ==================================================

class VoiceWorker:

    def __init__(self, knowledge_base, initial_history=None):

        self.knowledge_base = knowledge_base

        self.tasks = queue.Queue(maxsize=5)
        self.results = queue.Queue()

        self.history_lock = threading.Lock()

        self.history = list(initial_history or [])[-10:]

        self.thread = threading.Thread(
            target=self._run,
            name="bol-kisan-voice-worker",
            daemon=True,
        )

        self.thread.start()

    def submit_audio(self, wav_bytes, selected_language):

        task = {
            "kind": "audio",
            "wav_bytes": wav_bytes,
            "language": selected_language,
        }

        try:
            self.tasks.put_nowait(task)
            return True

        except queue.Full:
            return False

    def submit_text(self, question, selected_language):

        task = {
            "kind": "text",
            "question": question,
            "language": selected_language,
        }

        try:
            self.tasks.put_nowait(task)
            return True

        except queue.Full:
            return False

    def clear_history(self):

        with self.history_lock:
            self.history.clear()

    def _get_context(self):

        with self.history_lock:

            recent = self.history[-10:]

            return "\n\n".join(
                f"Farmer: {item['question']}\n"
                f"Bol Kisan: {item['answer']}"
                for item in recent
            )

    def _remember(self, question, answer):

        with self.history_lock:

            self.history.append({
                "question": question,
                "answer": str(answer),
            })

            self.history = self.history[-10:]

    def _run(self):

        while True:

            task = self.tasks.get()

            try:

                selected_language = task["language"]

                # ----------------------------------
                # SPEECH RECOGNITION
                # ----------------------------------

                if task["kind"] == "audio":

                    question = transcribe_audio(
                        task["wav_bytes"],
                        selected_language,
                    )

                    if not question or not str(question).strip():

                        self.results.put({
                            "kind": "error",
                            "message": (
                                "I could not understand that question. "
                                "Please speak clearly and try again."
                            ),
                        })

                        continue

                    question = str(question).strip()

                else:

                    question = str(task["question"]).strip()

                if not question:

                    self.results.put({
                        "kind": "error",
                        "message": "Please ask a question.",
                    })

                    continue

                # ----------------------------------
                # GENERATE FARMING ANSWER
                # ----------------------------------

                answer, sources = generate_answer(
                    question,
                    selected_language,
                    self.knowledge_base,
                    conversation_context=self._get_context(),
                )

                # ----------------------------------
                # GENERATE SPOKEN ANSWER
                # ----------------------------------

                speech = text_to_speech(
                    answer,
                    selected_language,
                )

                # ----------------------------------
                # SAVE CONVERSATION
                # ----------------------------------

                self._remember(question, answer)

                self.results.put({
                    "kind": "answer",
                    "question": question,
                    "answer": str(answer),
                    "sources": sources or [],
                    "speech": speech,
                })

            except Exception as error:

                self.results.put({
                    "kind": "error",
                    "message": f"Voice processing failed: {error}",
                })

            finally:

                self.tasks.task_done()


# ==================================================
# PAGE SETTINGS
# ==================================================

st.set_page_config(
    page_title="Bol Kisan | Smart Farming Assistant",
    page_icon="🌾",
    layout="wide",
    initial_sidebar_state="expanded",
)


# ==================================================
# SESSION STATE
# ==================================================

DEFAULTS = {

    "conversation": [],

    "last_answer": None,
    "last_question": None,

    "bk_audio_samples": [],

    "bk_speech_started": False,
    "bk_silence_seconds": 0.0,
    "bk_total_audio_seconds": 0.0,

    "bk_audio_resampler": None,

    "bk_last_error": None,
    "bk_last_speech": None,
    "bk_last_sources": [],

    "bk_was_playing": False,

    "bk_pending_jobs": 0,
}

for state_key, default_value in DEFAULTS.items():

    if state_key not in st.session_state:

        st.session_state[state_key] = default_value


# ==================================================
# LOAD KNOWLEDGE BASE
# ==================================================

@st.cache_resource
def get_knowledge_base():

    return KnowledgeBase()


kb = get_knowledge_base()


# ==================================================
# CREATE BACKGROUND WORKER
# ==================================================

if (
    "bk_voice_worker" not in st.session_state
    or not st.session_state.bk_voice_worker.thread.is_alive()
):

    st.session_state.bk_voice_worker = VoiceWorker(
        kb,
        initial_history=st.session_state.conversation,
    )


voice_worker = st.session_state.bk_voice_worker


# ==================================================
# SAVE ANSWER
# ==================================================

def save_answer(
    question_text,
    answer_text,
    sources=None,
    speech=None,
):

    st.session_state.conversation.append({

        "question": question_text,

        "answer": str(answer_text),

    })

    st.session_state.conversation = (
        st.session_state.conversation[-10:]
    )

    st.session_state.last_question = question_text

    st.session_state.last_answer = str(answer_text)

    st.session_state.bk_last_sources = sources or []

    st.session_state.bk_last_speech = speech

    st.session_state.bk_last_error = None


# ==================================================
# PROCESS WORKER RESULT
# ==================================================

def accept_worker_result(result):

    if result.get("kind") == "answer":

        save_answer(
            result.get("question", ""),
            result.get("answer", ""),
            result.get("sources", []),
            result.get("speech"),
        )

    else:

        st.session_state.bk_last_error = result.get(
            "message",
            "Something went wrong while processing your question.",
        )


# ==================================================
# FORMAT SOURCES SAFELY
# ==================================================

def format_source(source):

    if isinstance(source, dict):

        source_name = (
            source.get("source")
            or source.get("title")
            or "Unknown source"
        )

        page_number = source.get("page")

        if page_number is None or page_number == "":

            return str(source_name)

        return f"{source_name} — Page {page_number}"

    if isinstance(source, str):

        return source

    return str(source)


# ==================================================
# DESIGN
# ==================================================

st.markdown(
    """
    <style>

        .stApp {
            background-color: #F5F8F3;
        }

        .main-title {
            font-size: 40px;
            font-weight: 800;
            color: #174B32;
            margin-bottom: 0;
        }

        .subtitle {
            color: #64806C;
            font-size: 16px;
            margin-bottom: 15px;
        }

        .hero {
            background: linear-gradient(120deg, #174B32, #28784B);
            padding: 30px;
            border-radius: 18px;
            color: white;
            margin: 18px 0 25px 0;
        }

        .hero h2 {
            color: white;
            font-size: 30px;
            margin-bottom: 8px;
        }

        .hero p {
            color: #E0F1E5;
            font-size: 16px;
        }

        .answer-card {
            background: #EAF5EC;
            border-left: 5px solid #28784B;
            padding: 22px;
            border-radius: 12px;
            color: #174B32;
            font-size: 18px;
            line-height: 1.8;
        }

        .status {
            background: #E4F4E7;
            color: #176339;
            padding: 8px 13px;
            border-radius: 20px;
            font-weight: 600;
            display: inline-block;
        }

        div.stButton > button {
            background: #247347;
            color: white;
            border: none;
            border-radius: 10px;
            min-height: 45px;
            font-weight: 600;
            width: 100%;
        }

        div.stButton > button:hover {
            background: #174B32;
            color: white;
            border: none;
        }

        [data-testid="stSidebar"] {
            background-color: #EDF4EA;
        }

        #MainMenu, footer {
            visibility: hidden;
        }

    </style>
    """,
    unsafe_allow_html=True,
)


# ==================================================
# LANGUAGE SETTINGS
# ==================================================

LANGUAGES = {

    "English": "coming_soon",

    "Hindi": "available",

    "Telugu": "coming_soon",

}


# ==================================================
# SIDEBAR
# ==================================================

with st.sidebar:

    st.markdown("## 🌾 Bol Kisan")

    st.caption("Smart Farming Assistant")

    st.divider()

    st.markdown("### 🌐 Language Settings")

    selected_language = st.selectbox(
        "Choose your language",
        list(LANGUAGES.keys()),
        index=1,
    )

    if LANGUAGES[selected_language] == "available":

        language = selected_language

        st.success("Hindi offline voice is available.")

    else:

        language = "Hindi"

        st.info(
            f"{selected_language} voice support is coming soon. "
            "Hindi is currently enabled for offline voice."
        )

    st.divider()

    st.markdown("### ⚙️ Assistant Status")

    st.success("Assistant ready")

    st.write("🎙️ Continuous voice questions")

    st.write("⌨️ Text questions")

    st.write("🔊 Hindi voice answers")

    st.write("📈 Demonstration mandi prices")

    st.divider()

    st.markdown("### 🧠 Conversation Memory")

    st.write(
        f"Remembered conversations: "
        f"{len(st.session_state.conversation)}"
    )

    if st.button("🗑️ Clear Conversation"):

        st.session_state.conversation = []

        st.session_state.last_answer = None

        st.session_state.last_question = None

        st.session_state.bk_last_speech = None

        st.session_state.bk_last_sources = []

        st.session_state.bk_last_error = None

        st.session_state.bk_pending_jobs = 0

        voice_worker.clear_history()

        st.rerun()

    st.divider()

    st.caption("Built for farmers ❤️")


# ==================================================
# HEADER
# ==================================================

st.markdown(
    '<div class="main-title">🌾 Bol Kisan</div>',
    unsafe_allow_html=True,
)

st.markdown(
    '<div class="subtitle">'
    'Your intelligent farming companion'
    '</div>',
    unsafe_allow_html=True,
)

st.markdown(
    '<div class="status">● Assistant Ready</div>',
    unsafe_allow_html=True,
)


# ==================================================
# NAVIGATION
# ==================================================

tab1, tab2, tab3 = st.tabs(
    [
        "🎙️ Ask Bol Kisan",
        "📈 Mandi Prices",
        "ℹ️ About",
    ]
)


# ==================================================
# AUDIO HELPERS
# ==================================================

def reset_current_audio_segment():

    st.session_state.bk_audio_samples = []

    st.session_state.bk_speech_started = False

    st.session_state.bk_silence_seconds = 0.0

    st.session_state.bk_total_audio_seconds = 0.0


def audio_to_wav_bytes(samples):

    wav_buffer = io.BytesIO()

    with wave.open(wav_buffer, "wb") as wav_file:

        wav_file.setnchannels(1)

        wav_file.setsampwidth(2)

        wav_file.setframerate(16000)

        wav_file.writeframes(
            np.asarray(
                samples,
                dtype=np.int16,
            ).tobytes()
        )

    return wav_buffer.getvalue()


# ==================================================
# COLLECT BACKGROUND WORKER RESULTS
# ==================================================

def collect_worker_result():

    try:

        result = voice_worker.results.get_nowait()

    except queue.Empty:

        return False

    st.session_state.bk_pending_jobs = max(
        0,
        st.session_state.bk_pending_jobs - 1,
    )

    accept_worker_result(result)

    return True


# ==================================================
# CONTINUOUS MICROPHONE
# ==================================================

def continuous_microphone():

    ctx = webrtc_streamer(

        key="bol_kisan_continuous_microphone_v3",

        mode=WebRtcMode.SENDONLY,

        audio_receiver_size=512,

        media_stream_constraints={

            "audio": {

                "echoCancellation": True,

                "noiseSuppression": True,

                "autoGainControl": True,

            },

            "video": False,

        },

    )

    # ----------------------------------------------
    # CHECK ANSWER RESULTS
    # ----------------------------------------------

    if collect_worker_result():

        st.rerun()

    # ----------------------------------------------
    # MICROPHONE STOPPED
    # ----------------------------------------------

    if not ctx.state.playing:

        if st.session_state.bk_was_playing:

            reset_current_audio_segment()

            st.session_state.bk_audio_resampler = None

        st.session_state.bk_was_playing = False

        st.info(
            "Press START once to turn on the microphone. "
            "It will keep listening until you press STOP."
        )

        if st.session_state.bk_pending_jobs:

            st.info(
                f"{st.session_state.bk_pending_jobs} question(s) "
                "are still being processed."
            )

        return

    # ----------------------------------------------
    # MICROPHONE ACTIVE
    # ----------------------------------------------

    st.session_state.bk_was_playing = True

    st.success(
        "🎙️ Microphone is ON. Ask a question and pause briefly. "
        "Bol Kisan will answer and continue listening."
    )

    if st.session_state.bk_pending_jobs:

        st.info(
            f"Processing {st.session_state.bk_pending_jobs} question(s). "
            "The microphone remains active."
        )

    audio_receiver = getattr(
        ctx,
        "audio_receiver",
        None,
    )

    if audio_receiver is None:

        st.warning(
            "Microphone is connecting. Please wait a moment."
        )

        return

    # ----------------------------------------------
    # AUDIO RESAMPLER
    # ----------------------------------------------

    if st.session_state.bk_audio_resampler is None:

        st.session_state.bk_audio_resampler = av.AudioResampler(

            format="s16",

            layout="mono",

            rate=16000,

        )

    # ----------------------------------------------
    # READ MICROPHONE FRAMES
    # ----------------------------------------------

    try:

        frames = audio_receiver.get_frames(
            timeout=0.01
        )

    except queue.Empty:

        frames = []

    except Exception as error:

        st.warning(
            f"Audio input issue: {error}"
        )

        frames = []

    # ----------------------------------------------
    # PROCESS AUDIO FRAMES
    # ----------------------------------------------

    for frame in frames or []:

        try:

            converted_frames = (
                st.session_state.bk_audio_resampler.resample(frame)
            )

        except Exception:

            continue

        if converted_frames is None:

            continue

        if not isinstance(
            converted_frames,
            (list, tuple),
        ):

            converted_frames = [converted_frames]

        for converted_frame in converted_frames:

            samples = converted_frame.to_ndarray().reshape(-1)

            if samples.size == 0:

                continue

            samples = samples.astype(
                np.int16,
                copy=False,
            )

            frame_duration = samples.size / 16000.0

            rms = float(
                np.sqrt(
                    np.mean(
                        samples.astype(np.float32) ** 2
                    )
                )
            )

            # ----------------------------------
            # VOICE DETECTION
            # ----------------------------------

            if rms >= 400:

                st.session_state.bk_speech_started = True

                st.session_state.bk_silence_seconds = 0.0

                st.session_state.bk_audio_samples.append(
                    samples.copy()
                )

                st.session_state.bk_total_audio_seconds += (
                    frame_duration
                )

            # ----------------------------------
            # SILENCE DETECTION
            # ----------------------------------

            elif st.session_state.bk_speech_started:

                st.session_state.bk_audio_samples.append(
                    samples.copy()
                )

                st.session_state.bk_silence_seconds += (
                    frame_duration
                )

                st.session_state.bk_total_audio_seconds += (
                    frame_duration
                )

            # ----------------------------------
            # QUESTION COMPLETED
            # ----------------------------------

            question_finished = (
                st.session_state.bk_speech_started
                and (
                    st.session_state.bk_silence_seconds >= 1.2
                    or st.session_state.bk_total_audio_seconds >= 40.0
                )
            )

            if question_finished:

                if st.session_state.bk_audio_samples:

                    completed_audio = np.concatenate(
                        st.session_state.bk_audio_samples
                    )

                else:

                    completed_audio = np.array(
                        [],
                        dtype=np.int16,
                    )

                reset_current_audio_segment()

                # Ignore short sounds such as clicks.
                if completed_audio.size >= 6400:

                    wav_bytes = audio_to_wav_bytes(
                        completed_audio
                    )

                    accepted = voice_worker.submit_audio(
                        wav_bytes,
                        language,
                    )

                    if accepted:

                        st.session_state.bk_pending_jobs += 1

                        st.session_state.bk_last_error = None

                    else:

                        st.session_state.bk_last_error = (
                            "Bol Kisan is busy with earlier questions. "
                            "Please wait a moment and ask again."
                        )

    # ----------------------------------------------
    # CHECK FOR COMPLETED ANSWERS AGAIN
    # ----------------------------------------------

    if collect_worker_result():

        st.rerun()


# ==================================================
# TAB 1: ASK BOL KISAN
# ==================================================

with tab1:

    st.markdown(
        """
        <div class="hero">

            <h2>Hello, Farmer! 👋</h2>

            <p>
                Ask your farming questions using your voice or by typing.
            </p>

            <p>
                Your farming companion remembers your conversation.
            </p>

        </div>
        """,
        unsafe_allow_html=True,
    )

    # ----------------------------------------------
    # CONTINUOUS VOICE LISTENING
    # ----------------------------------------------

    st.markdown("### 🎤 Continuous Voice Listening")

    st.caption(
        "Press START once. Ask your question and pause briefly. "
        "Bol Kisan will answer, then keep listening for your next question. "
        "Press STOP only when you are finished."
    )

    @st.fragment(run_every="300ms")
    def microphone_fragment():

        continuous_microphone()

    microphone_fragment()

    st.divider()

    # ----------------------------------------------
    # TEXT QUESTION
    # ----------------------------------------------

    st.markdown("### ⌨️ Or Type Your Question")

    question = st.text_area(

        "Enter your question",

        placeholder=(
            "Example: Mere paudhe ki pattiyan peeli ho rahi hain."
        ),

        height=110,

        label_visibility="collapsed",

    )

    if st.button(
        "🌱 Get Farming Advice",
        use_container_width=True,
    ):

        if question.strip():

            accepted = voice_worker.submit_text(
                question.strip(),
                language,
            )

            if accepted:

                st.session_state.bk_pending_jobs += 1

                st.session_state.bk_last_error = None

                st.rerun()

            else:

                st.warning(
                    "Bol Kisan is busy with earlier questions. "
                    "Please wait and try again."
                )

        else:

            st.warning(
                "Please type a question or start the microphone."
            )

    # ----------------------------------------------
    # ERROR MESSAGE
    # ----------------------------------------------

    if st.session_state.bk_last_error:

        st.warning(
            st.session_state.bk_last_error
        )

    # ----------------------------------------------
    # DISPLAY LATEST ANSWER
    # ----------------------------------------------

    if st.session_state.last_question:

        st.markdown("### 💡 Bol Kisan's Answer")

        st.caption(
            f"Farmer's question: "
            f"{st.session_state.last_question}"
        )

        safe_answer = html.escape(
            str(st.session_state.last_answer or "")
        ).replace("\n", "<br>")

        st.markdown(
            f'<div class="answer-card">{safe_answer}</div>',
            unsafe_allow_html=True,
        )

 
# ----------------------------------------------
# DISPLAY INFORMATION SOURCES
# ----------------------------------------------

valid_sources = []

for source in (st.session_state.bk_last_sources or []):

    formatted = format_source(source)

    if formatted and formatted.strip() not in ("-", "*"):
        valid_sources.append(formatted)

if valid_sources:

    with st.expander("📚 View Information Sources"):

        for source in valid_sources:
            st.write(f"- {source}")

        # ------------------------------------------
        # PLAY SPOKEN ANSWER
        # ------------------------------------------

        if st.session_state.bk_last_speech:

            st.markdown("### 🔊 Listen to the Answer")

            st.audio(
                st.session_state.bk_last_speech,
                 format="audio/wav",
                autoplay=True,
            )

    # ----------------------------------------------
    # CONVERSATION HISTORY
    # ----------------------------------------------

    st.divider()

    st.markdown("## 🧠 Previous Questions & Answers")

    st.caption(
        "Your recent conversation history is shown below."
    )

    if st.session_state.conversation:

        for index, item in enumerate(
            reversed(st.session_state.conversation),
            start=1,
        ):

            with st.expander(
                f"Conversation {index}: {item['question']}",
                expanded=(index == 1),
            ):

                st.markdown("**👨‍🌾 Your Question:**")

                st.write(
                    item["question"]
                )

                st.markdown("**🌾 Bol Kisan's Answer:**")

                st.write(
                    item["answer"]
                )

    else:

        st.info(
            "No previous conversations yet. "
            "Ask your first farming question!"
        )


# ==================================================
# TAB 2: MANDI PRICES
# ==================================================

with tab2:

    st.markdown("## 📈 Mandi Market Prices")

    st.caption(
        "Explore the demonstration crop price database."
    )

    prices = load_mandi_prices()

    if not prices.empty:

        st.warning(
            "⚠️ Demonstration data only. "
            "These are not live market prices."
        )

        search = st.text_input(
            "🔎 Search for a crop",
            placeholder="Search wheat, rice, maize...",
        )

        if search:

            filtered = prices[
                prices.astype(str).apply(
                    lambda column: column.str.contains(
                        search,
                        case=False,
                        na=False,
                    )
                ).any(axis=1)
            ]

        else:

            filtered = prices

        st.dataframe(
            filtered,
            use_container_width=True,
            hide_index=True,
        )

        st.caption(
            f"Total records: {len(filtered)}"
        )

    else:

        st.info(
            "No mandi data available."
        )


# ==================================================
# TAB 3: ABOUT
# ==================================================

with tab3:

    st.markdown("## 🌾 About Bol Kisan")

    st.write(
        "Bol Kisan is a voice-first farming assistant designed "
        "to help farmers access agricultural information."
    )

    st.markdown("### Key Features")

    st.write("🎙️ Continuous voice-based farming questions")

    st.write("⌨️ Text-based questions")

    st.write("🔊 Hindi voice answers")

    st.write("🧠 Conversation memory for follow-up questions")

    st.write("📚 Search through local farming documents")

    st.write("📈 Demonstration mandi price database")

    st.markdown("### 🛡️ Farmer Safety")

    st.info(
        "Never guess pesticide names or application quantities. "
        "Use verified product-label instructions or consult an "
        "agricultural officer."
    )

    st.markdown("### Technology")

    st.write("- Python and Streamlit")

    st.write("- Faster-Whisper speech recognition")

    st.write("- Piper Hindi text-to-speech")

    st.write("- Local agricultural knowledge base")

    st.write("- Background voice-processing worker")

    st.success(
        "Bol Kisan — Technology for Farmers 🌱"
    )


# ==================================================
# FOOTER
# ==================================================

st.divider()

st.caption(
    "🌾 Bol Kisan | Smart Farming Assistant | Hackathon Prototype"
)
import streamlit as st
import html

from core import (
    KnowledgeBase,
    generate_answer,
    transcribe_audio,
    text_to_speech,
    load_mandi_prices
)

# ---------------- PAGE SETTINGS ----------------

st.set_page_config(
    page_title="Bol Kisan | Smart Farming Assistant",
    page_icon="🌾",
    layout="wide",
    initial_sidebar_state="expanded"
)


# ---------------- CONVERSATION MEMORY ----------------

if "conversation" not in st.session_state:
    st.session_state.conversation = []

if "last_answer" not in st.session_state:
    st.session_state.last_answer = None

if "last_question" not in st.session_state:
    st.session_state.last_question = None


def get_conversation_context():

    history = st.session_state.conversation[-10:]

    if not history:
        return ""

    context = []

    for item in history:

        context.append(
            f"Farmer: {item['question']}\n"
            f"Bol Kisan: {item['answer']}"
        )

    return "\n\n".join(context)


# ---------------- CUSTOM DESIGN ----------------

st.markdown("""
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
""", unsafe_allow_html=True)


# ---------------- LANGUAGE SETTINGS ----------------

LANGUAGES = {
    "English": "coming_soon",
    "Hindi": "available",
    "Telugu": "coming_soon"
}


# ---------------- SIDEBAR ----------------

with st.sidebar:

    st.markdown("## 🌾 Bol Kisan")
    st.caption("Smart Farming Assistant")

    st.divider()

    st.markdown("### 🌐 Language Settings")

    selected_language = st.selectbox(
        "Choose your language",
        list(LANGUAGES.keys()),
        index=1
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
    st.write("🎙️ Voice questions")
    st.write("⌨️ Text questions")
    st.write("🔊 Hindi voice answers")
    st.write("📈 Mock mandi prices")

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

        st.rerun()

    st.divider()

    st.caption("Built for farmers ❤️")


# ---------------- KNOWLEDGE BASE ----------------

@st.cache_resource
def get_knowledge_base():
    return KnowledgeBase()


kb = get_knowledge_base()


# ---------------- HEADER ----------------

st.markdown(
    '<div class="main-title">🌾 Bol Kisan</div>',
    unsafe_allow_html=True
)

st.markdown(
    '<div class="subtitle">Your intelligent farming companion</div>',
    unsafe_allow_html=True
)

st.markdown(
    '<div class="status">● Assistant Ready</div>',
    unsafe_allow_html=True
)


# ---------------- NAVIGATION ----------------

tab1, tab2, tab3 = st.tabs(
    ["🎙️ Ask Bol Kisan", "📈 Mandi Prices", "ℹ️ About"]
)


# ==================================================
# TAB 1: ASK BOL KISAN
# ==================================================

with tab1:

    st.markdown("""
    <div class="hero">
        <h2>Hello, Farmer! 👋</h2>
        <p>Ask your farming questions using your voice or by typing.</p>
        <p>Your farming companion remembers your conversation.</p>
    </div>
    """, unsafe_allow_html=True)

    st.markdown("### 🎤 Ask Your Farming Question")

    st.caption(
        "Example: Mere ped ke patte kaale ho rahe hain."
    )

    audio = st.audio_input("Record your question")

    st.markdown("### ⌨️ Or Type Your Question")

    question = st.text_area(
        "Enter your question",
        placeholder="Example: Mere paudhe ki pattiyan peeli ho rahi hain.",
        height=110,
        label_visibility="collapsed"
    )

    if st.button(
        "🌱 Get Farming Advice",
        use_container_width=True
    ):

        final_question = question.strip()

        # Use voice input when a recording is provided.
        if audio:

            with st.spinner("🎧 Understanding your voice..."):

                try:

                    recognized_question = transcribe_audio(
                        audio.getvalue(),
                        language
                    )

                    if recognized_question:

                        final_question = recognized_question

                        st.info(
                            f"Recognized question: {final_question}"
                        )

                    elif not final_question:

                        st.warning(
                            "I could not understand the recording. "
                            "Please try again or type your question."
                        )

                except Exception as error:

                    st.error(
                        f"Voice recognition error: {error}"
                    )

                    if not final_question:
                        final_question = ""

        if final_question:

            # Get previous conversation before adding the new question.
            previous_context = get_conversation_context()

            with st.spinner(
                "🌿 Understanding your question and conversation..."
            ):

                try:

                    answer, sources = generate_answer(
                        final_question,
                        language,
                        kb,
                        conversation_context=previous_context
                    )

                    st.markdown("### 💡 Bol Kisan's Answer")

                    safe_answer = html.escape(
                        str(answer)
                    ).replace("\n", "<br>")

                    st.markdown(
                        f'<div class="answer-card">{safe_answer}</div>',
                        unsafe_allow_html=True
                    )

                    # Save conversation.
                    st.session_state.conversation.append({
                        "question": final_question,
                        "answer": str(answer)
                    })

                    # Keep the latest 10 exchanges.
                    st.session_state.conversation = (
                        st.session_state.conversation[-10:]
                    )

                    st.session_state.last_question = final_question
                    st.session_state.last_answer = str(answer)

                    if sources:

                        with st.expander(
                            "📚 View Information Sources"
                        ):

                            for source in sources:

                                st.write(
                                    f"- {source['source']} "
                                    f"— Page {source['page']}"
                                )

                    # Generate Hindi audio answer.
                    with st.spinner(
                        "🔊 Preparing voice answer..."
                    ):

                        speech = text_to_speech(
                            answer,
                            language
                        )

                    if speech:

                        st.markdown(
                            "### 🔊 Listen to the Answer"
                        )

                        st.audio(
                            speech,
                            format="audio/wav"
                        )

                except TypeError as error:

                    st.error(
                        "There is a problem connecting conversation "
                        "memory. Please check the updated core.py."
                    )

                    print("Memory integration error:", error)

                except Exception as error:

                    st.error(
                        f"Unable to generate answer: {error}"
                    )

        else:

            st.warning(
                "Please type or record a question."
            )

    # ----------------------------------------------
    # PREVIOUS QUESTIONS AND ANSWERS AT THE BOTTOM
    # ----------------------------------------------

    st.divider()

    st.markdown("## 🧠 Previous Questions & Answers")

    st.caption(
        "Your recent conversation history is shown below."
    )

    if st.session_state.conversation:

        for index, item in enumerate(
            reversed(st.session_state.conversation),
            start=1
        ):

            with st.expander(
                f"Conversation {index}: {item['question']}",
                expanded=(index == 1)
            ):

                st.markdown("**👨‍🌾 Your Question:**")

                st.write(item["question"])

                st.markdown("**🌾 Bol Kisan's Answer:**")

                st.write(item["answer"])

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
            placeholder="Search wheat, rice, maize..."
        )

        if search:

            filtered = prices[
                prices.astype(str).apply(
                    lambda column: column.str.contains(
                        search,
                        case=False,
                        na=False
                    )
                ).any(axis=1)
            ]

        else:

            filtered = prices

        st.dataframe(
            filtered,
            use_container_width=True,
            hide_index=True
        )

        st.caption(
            f"Total records: {len(filtered)}"
        )

    else:

        st.info("No mandi data available.")


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

    st.write("🎙️ Voice-based farming questions")
    st.write("⌨️ Text-based questions")
    st.write("🔊 Offline Hindi voice answers")
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
    st.write("- Session-based conversation memory")

    st.success(
        "Bol Kisan — Technology for Farmers 🌱"
    )


# ---------------- FOOTER ----------------

st.divider()

st.caption(
    "🌾 Bol Kisan | Smart Farming Assistant | Hackathon Prototype"
)

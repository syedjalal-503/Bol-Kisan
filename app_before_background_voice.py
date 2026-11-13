                    st.write(f"- {source['source']} — Page {source['page']}")

        if st.session_state.bk_last_speech:
            st.markdown("### 🔊 Listen to the Answer")
            st.audio(
                st.session_state.bk_last_speech,
                format="audio/wav",
                autoplay=True,
            )

    st.divider()
    st.markdown("## 🧠 Previous Questions & Answers")
    st.caption("Your recent conversation history is shown below.")

    if st.session_state.conversation:
        for index, item in enumerate(reversed(st.session_state.conversation), start=1):
            with st.expander(
                f"Conversation {index}: {item['question']}",
                expanded=(index == 1),
            ):
                st.markdown("**👨‍🌾 Your Question:**")
                st.write(item["question"])
                st.markdown("**🌾 Bol Kisan's Answer:**")
                st.write(item["answer"])
    else:
        st.info("No previous conversations yet. Ask your first farming question!")


# ==================================================
# TAB 2: MANDI PRICES
# ==================================================

with tab2:
    st.markdown("## 📈 Mandi Market Prices")
    st.caption("Explore the demonstration crop price database.")

    prices = load_mandi_prices()
    if not prices.empty:
        st.warning(
            "⚠️ Demonstration data only. These are not live market prices."
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

        st.dataframe(filtered, use_container_width=True, hide_index=True)
        st.caption(f"Total records: {len(filtered)}")
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

    st.success("Bol Kisan — Technology for Farmers 🌱")


# ==================================================
# FOOTER
# ==================================================

st.divider()
st.caption("🌾 Bol Kisan | Smart Farming Assistant | Hackathon Prototype")

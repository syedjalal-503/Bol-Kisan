
const Groq = require("groq-sdk");

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

async function getAIResponse(message, language) {
  const languageNames = {
    en: "English",
    hi: "Hindi",
    te: "Telugu",
  };
  const responseLanguage = languageNames[language] || "the same language as the farmer";

  const completion = await groq.chat.completions.create({
    model: "openai/gpt-oss-20b",
    reasoning_effort: "low",
    max_completion_tokens: 600,
    messages: [
      {
        role: "system",
        content: `You are Bol Kisan, a friendly AI farming assistant.
Help farmers with crops, soil, irrigation, pests, diseases and farming practices.
Reply in ${responseLanguage}.
Use simple words and practical advice.
If you are unsure, say so. Do not invent government schemes or weather data.`,
      },
      {
        role: "user",
        content: message,
      },
    ],
  });

  return completion.choices[0].message.content;
}

module.exports = getAIResponse;

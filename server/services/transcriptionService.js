const Groq = require("groq-sdk");
const { toFile } = require("groq-sdk");

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

async function transcribeAudio(buffer, filename, language) {
  const audioFile = await toFile(buffer, filename);

  const result = await groq.audio.transcriptions.create({
    file: audioFile,
    model: "whisper-large-v3-turbo",
    language,
    response_format: "json",
    temperature: 0,
  });

  return result.text;
}

module.exports = transcribeAudio;

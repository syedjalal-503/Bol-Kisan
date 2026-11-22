
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");

const getAIResponse = require("./services/aiService");
const transcribeAudio = require("./services/transcriptionService");
const {
  getAgricultureNews,
  getAgricultureSchemes,
  getWeatherForecast,
  searchWeatherLocations,
} = require("./services/liveDataService");

const app = express();
const supportedLanguages = ["en", "hi", "te"];

app.use(cors());
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
  },
});

app.get("/", (req, res) => {
  res.json({
    message: "Bol Kisan AI Server is running!",
  });
});

app.get("/api/weather/locations", async (req, res) => {
  const query = typeof req.query.query === "string" ? req.query.query.trim() : "";
  const language =
    typeof req.query.language === "string" ? req.query.language : "en";

  if (query.length < 2 || query.length > 80) {
    return res.status(400).json({
      success: false,
      error: "Enter a location name between 2 and 80 characters.",
    });
  }

  if (!supportedLanguages.includes(language)) {
    return res.status(400).json({
      success: false,
      error: "Unsupported language.",
    });
  }

  try {
    const locations = await searchWeatherLocations(query, language);
    res.json({
      success: true,
      locations,
    });
  } catch (error) {
    console.error("Weather location error:", error.message);
    res.status(502).json({
      success: false,
      error: "Unable to search locations. Please try again.",
    });
  }
});

app.get("/api/weather/forecast", async (req, res) => {
  const latitude =
    typeof req.query.latitude === "string" ? Number(req.query.latitude) : NaN;
  const longitude =
    typeof req.query.longitude === "string" ? Number(req.query.longitude) : NaN;

  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return res.status(400).json({
      success: false,
      error: "A valid latitude and longitude are required.",
    });
  }

  try {
    const forecast = await getWeatherForecast(latitude, longitude);
    res.json({
      success: true,
      forecast,
    });
  } catch (error) {
    console.error("Weather forecast error:", error.message);
    res.status(502).json({
      success: false,
      error: "Unable to load the weather forecast. Please try again.",
    });
  }
});

app.get("/api/news", async (req, res) => {
  const language =
    typeof req.query.language === "string" ? req.query.language : "en";

  if (!supportedLanguages.includes(language)) {
    return res.status(400).json({
      success: false,
      error: "Unsupported language.",
    });
  }

  try {
    const items = await getAgricultureNews(language);
    res.json({
      success: true,
      items,
    });
  } catch (error) {
    console.error("Agriculture news error:", error.message);
    res.status(502).json({
      success: false,
      error: "Unable to load official agriculture updates. Please try again.",
    });
  }
});

app.get("/api/schemes", async (req, res) => {
  try {
    const schemes = await getAgricultureSchemes();
    res.json({
      success: true,
      schemes,
    });
  } catch (error) {
    console.error("Agriculture schemes error:", error.message);
    res.status(502).json({
      success: false,
      error: "Unable to load official schemes. Please try again.",
    });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const { message, language } = req.body;

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        success: false,
        error: "Please enter a farming question.",
      });
    }

    if (language !== undefined && !supportedLanguages.includes(language)) {
      return res.status(400).json({
        success: false,
        error: "Unsupported language.",
      });
    }

    const reply = await getAIResponse(message.trim(), language);

    res.json({
      success: true,
      reply,
    });
  } catch (error) {
    console.error("AI Error:", error.message);

    res.status(500).json({
      success: false,
      error: "Unable to get an AI response. Please try again.",
    });
  }
});

app.post("/api/voice", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "No audio file received.",
      });
    }

    const language = req.body.language;

    if (!supportedLanguages.includes(language)) {
      return res.status(400).json({
        success: false,
        error: "Unsupported language.",
      });
    }

    const transcript = await transcribeAudio(
      req.file.buffer,
      req.file.originalname || "farmer-question.m4a",
      language
    );

    if (!transcript || !transcript.trim()) {
      return res.status(400).json({
        success: false,
        error: "I could not understand the audio. Please try again.",
      });
    }

    const reply = await getAIResponse(transcript.trim(), language);

    res.json({
      success: true,
      transcript: transcript.trim(),
      reply,
    });
  } catch (error) {
    console.error("Voice Error:", error);

    res.status(500).json({
      success: false,
      error: "Unable to process your voice. Please try again.",
    });
  }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Bol Kisan server running on port ${PORT}`);
});

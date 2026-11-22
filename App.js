import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Linking,
} from 'react-native';

import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';

import * as Speech from 'expo-speech';

const API_URL = (
  process.env.EXPO_PUBLIC_API_URL || 'http://192.168.1.5:5000/api'
).replace(/\/+$/, '');

// ---- Continuous listening tuning -------------------------------------------
const SILENCE_THRESHOLD_DB = -42; // louder than this = someone is talking
const SILENCE_DURATION_MS = 2000; // pause after speech before sending
const MIN_SPEECH_FRAMES = 2; // ignore tiny noises / coughs
const MAX_UTTERANCE_MS = 60000; // force-send very long questions
const IDLE_RESTART_MS = 40000; // restart recorder if nobody speaks for a while
const METERING_INTERVAL_MS = 150;
const MAX_CONSECUTIVE_ERRORS = 3;

const COLORS = {
  green: '#246B45',
  darkGreen: '#174B32',
  deepGreen: '#0F3321',
  lightGreen: '#EAF4EC',
  cream: '#F8F8F1',
  white: '#FFFFFF',
  text: '#243329',
  muted: '#718075',
  border: '#E3E9E2',
  orange: '#F2A541',
};

const ORB_COLORS = {
  paused: '#5F7A68',
  listening: '#2F8A59',
  hearing: '#4CBF7F',
  processing: '#7C9A86',
  speaking: '#F2A541',
};

const WEATHER_CODES = {
  0: { icon: '☀️', en: 'Clear sky', hi: 'साफ आसमान', te: 'స్పష్టమైన ఆకాశం' },
  1: { icon: '🌤️', en: 'Mostly clear', hi: 'मुख्यतः साफ', te: 'చాలా వరకు స్పష్టం' },
  2: { icon: '⛅', en: 'Partly cloudy', hi: 'आंशिक बादल', te: 'పాక్షికంగా మేఘావృతం' },
  3: { icon: '☁️', en: 'Overcast', hi: 'बादल छाए हैं', te: 'మేఘావృతం' },
  45: { icon: '🌫️', en: 'Fog', hi: 'कोहरा', te: 'పొగమంచు' },
  48: { icon: '🌫️', en: 'Fog', hi: 'कोहरा', te: 'పొగమంచు' },
  51: { icon: '🌦️', en: 'Light drizzle', hi: 'हल्की बूंदाबांदी', te: 'తేలికపాటి చిరుజల్లు' },
  53: { icon: '🌦️', en: 'Drizzle', hi: 'बूंदाबांदी', te: 'చిరుజల్లు' },
  55: { icon: '🌧️', en: 'Heavy drizzle', hi: 'तेज़ बूंदाबांदी', te: 'భారీ చిరుజల్లు' },
  61: { icon: '🌧️', en: 'Light rain', hi: 'हल्की बारिश', te: 'తేలికపాటి వర్షం' },
  63: { icon: '🌧️', en: 'Rain', hi: 'बारिश', te: 'వర్షం' },
  65: { icon: '🌧️', en: 'Heavy rain', hi: 'तेज़ बारिश', te: 'భారీ వర్షం' },
  71: { icon: '🌨️', en: 'Light snow', hi: 'हल्की बर्फबारी', te: 'తేలికపాటి మంచు' },
  73: { icon: '🌨️', en: 'Snow', hi: 'बर्फबारी', te: 'మంచు' },
  75: { icon: '❄️', en: 'Heavy snow', hi: 'तेज़ बर्फबारी', te: 'భారీ మంచు' },
  80: { icon: '🌦️', en: 'Rain showers', hi: 'बारिश की बौछारें', te: 'వర్షపు జల్లులు' },
  81: { icon: '🌧️', en: 'Rain showers', hi: 'बारिश की बौछारें', te: 'వర్షపు జల్లులు' },
  82: { icon: '🌧️', en: 'Heavy showers', hi: 'तेज़ बौछारें', te: 'భారీ వర్షపు జల్లులు' },
  95: { icon: '⛈️', en: 'Thunderstorm', hi: 'आंधी-तूफान', te: 'ఉరుములతో కూడిన వర్షం' },
  96: { icon: '⛈️', en: 'Thunderstorm', hi: 'आंधी-तूफान', te: 'ఉరుములతో కూడిన వర్షం' },
  99: { icon: '⛈️', en: 'Thunderstorm', hi: 'आंधी-तूफान', te: 'ఉరుములతో కూడిన వర్షం' },
};

const translations = {
  English: {
    greeting: 'Namaste, Farmer! 👋',
    subtitle: 'Your farming companion is ready.',
    ask: 'What would you like help with today?',
    weather: 'Weather',
    schemes: 'Government Schemes',
    crop: 'Crop Care',
    calendar: 'Farm Calendar',
    news: 'Agriculture News',
    chat: 'Ask Bol Kisan',
    chatHint: 'Ask anything about farming...',
    send: 'Send',
    home: 'Home',
    assistant: 'Assistant',
    more: 'More',
    voice: 'Talk to Bol Kisan',
    voiceHint: 'Hands-free. Just speak and listen.',
    voiceTitle: 'Talk to Bol Kisan',
    voiceSubtitle: 'Your personal farming assistant',
    tapMic: 'Tap the microphone to start',
    listening: 'Listening...',
    hearing: 'I can hear you...',
    processing: 'Thinking about your question...',
    speaking: 'Bol Kisan is speaking...',
    paused: 'Paused',
    start: 'Start Speaking',
    stop: 'Stop Recording',
    autoListen: 'Just speak. When you pause for 2 seconds, I will answer.',
    tapToSend: 'Tap to send now',
    tapToInterrupt: 'Tap to interrupt and speak',
    notUnderstood: 'Could not catch that. Please speak again.',
    endVoice: 'End conversation',
    stopReply: 'Stop voice reply',
    conversation: 'Conversation',
    back: '‹  Back',
    cancel: 'Cancel',
    empty: 'Your conversation will appear here.',
    weatherTitle: 'Local Weather',
    weatherPrompt: 'Search for an Indian city or town',
    search: 'Search',
    chooseLocation: 'Choose a location',
    forecast: '5-day forecast',
    currentConditions: 'Current conditions',
    feelsLike: 'Feels like',
    humidity: 'Humidity',
    wind: 'Wind',
    rainChance: 'Rain chance',
    weatherSource: 'Forecast by Open-Meteo',
    newsTitle: 'Official Agriculture Updates',
    newsSource: 'Department of Agriculture & Farmers Welfare',
    schemesTitle: 'Central Agriculture Schemes',
    schemeSearch: 'Search schemes...',
    openOfficial: 'Open official details',
    officialSources: 'Official sources',
    cropTitle: 'Crop Care',
    cropName: 'Crop name',
    cropConcern: 'Describe the crop problem',
    cropHelp: 'Ask Bol Kisan',
    calendarTitle: 'Farm Calendar',
    calendarMonth: 'Month',
    calendarLocation: 'District or state (optional)',
    calendarHelp: 'Build my calendar',
    historyTitle: 'Conversation History',
    settingsTitle: 'Settings',
    clearHistory: 'Clear conversation',
    noResults: 'No matching results.',
    noNews: 'No official updates are available right now.',
    enterCity: 'Enter at least 2 characters to search.',
    loading: 'Loading...',
    retry: 'Try again',
    source: 'Source',
    cropHelpHint: 'Share symptoms, when they started, and recent care.',
    calendarHint: 'Ask for a crop-specific monthly plan. Confirm local advice with an extension officer.',
  },
  తెలుగు: {
    greeting: 'నమస్కారం రైతు గారూ! 👋',
    subtitle: 'మీ వ్యవసాయ సహాయకుడు సిద్ధంగా ఉన్నాడు.',
    ask: 'ఈ రోజు మీకు ఏ విషయంలో సహాయం కావాలి?',
    weather: 'వాతావరణం',
    schemes: 'ప్రభుత్వ పథకాలు',
    crop: 'పంట సంరక్షణ',
    calendar: 'వ్యవసాయ క్యాలెండర్',
    news: 'వ్యవసాయ వార్తలు',
    chat: 'బోల్ కిసాన్‌ను అడగండి',
    chatHint: 'వ్యవసాయం గురించి అడగండి...',
    send: 'పంపండి',
    home: 'హోమ్',
    assistant: 'సహాయకుడు',
    more: 'మరిన్ని',
    voice: 'బోల్ కిసాన్‌తో మాట్లాడండి',
    voiceHint: 'చేతులు ఖాళీగా. మాట్లాడండి, వినండి.',
    voiceTitle: 'బోల్ కిసాన్‌తో మాట్లాడండి',
    voiceSubtitle: 'మీ వ్యక్తిగత వ్యవసాయ సహాయకుడు',
    tapMic: 'ప్రారంభించడానికి మైక్రోఫోన్‌ను నొక్కండి',
    listening: 'వింటున్నాను...',
    hearing: 'మీ మాట వినిపిస్తోంది...',
    processing: 'మీ ప్రశ్నను ఆలోచిస్తున్నాను...',
    speaking: 'బోల్ కిసాన్ మాట్లాడుతోంది...',
    paused: 'ఆగి ఉంది',
    start: 'మాట్లాడటం ప్రారంభించండి',
    stop: 'రికార్డింగ్ ఆపండి',
    autoListen: 'మాట్లాడండి. 2 సెకన్లు ఆగితే నేను సమాధానం చెబుతాను.',
    tapToSend: 'ఇప్పుడే పంపడానికి నొక్కండి',
    tapToInterrupt: 'మధ్యలో మాట్లాడటానికి నొక్కండి',
    notUnderstood: 'అర్థం కాలేదు. దయచేసి మళ్లీ మాట్లాడండి.',
    endVoice: 'సంభాషణ ముగించండి',
    stopReply: 'సమాధానం వినడం ఆపండి',
    conversation: 'సంభాషణ',
    back: '‹  వెనక్కి',
    cancel: 'రద్దు చేయండి',
    empty: 'మీ సంభాషణ ఇక్కడ కనిపిస్తుంది.',
    weatherTitle: 'స్థానిక వాతావరణం',
    weatherPrompt: 'భారతదేశంలోని నగరం లేదా పట్టణాన్ని వెతకండి',
    search: 'వెతకండి',
    chooseLocation: 'ప్రాంతాన్ని ఎంచుకోండి',
    forecast: '5 రోజుల వాతావరణ సూచన',
    currentConditions: 'ప్రస్తుత పరిస్థితులు',
    feelsLike: 'అనుభూతి ఉష్ణోగ్రత',
    humidity: 'తేమ',
    wind: 'గాలి',
    rainChance: 'వర్ష సూచన',
    weatherSource: 'Open-Meteo వాతావరణ సూచన',
    newsTitle: 'అధికారిక వ్యవసాయ సమాచారం',
    newsSource: 'వ్యవసాయం మరియు రైతుల సంక్షేమ శాఖ',
    schemesTitle: 'కేంద్ర వ్యవసాయ పథకాలు',
    schemeSearch: 'పథకాలను వెతకండి...',
    openOfficial: 'అధికారిక వివరాలు తెరవండి',
    officialSources: 'అధికారిక వనరులు',
    cropTitle: 'పంట సంరక్షణ',
    cropName: 'పంట పేరు',
    cropConcern: 'పంట సమస్యను వివరించండి',
    cropHelp: 'బోల్ కిసాన్‌ను అడగండి',
    calendarTitle: 'వ్యవసాయ క్యాలెండర్',
    calendarMonth: 'నెల',
    calendarLocation: 'జిల్లా లేదా రాష్ట్రం (ఐచ్ఛికం)',
    calendarHelp: 'నా క్యాలెండర్ రూపొందించండి',
    historyTitle: 'సంభాషణ చరిత్ర',
    settingsTitle: 'సెట్టింగులు',
    clearHistory: 'సంభాషణను తొలగించండి',
    noResults: 'సరిపోలిన వివరాలు లేవు.',
    noNews: 'ప్రస్తుతం అధికారిక సమాచారం అందుబాటులో లేదు.',
    enterCity: 'వెతకడానికి కనీసం 2 అక్షరాలు నమోదు చేయండి.',
    loading: 'లోడ్ అవుతోంది...',
    retry: 'మళ్లీ ప్రయత్నించండి',
    source: 'వనరు',
    cropHelpHint: 'లక్షణాలు, ఎప్పుడు మొదలయ్యాయి, ఇటీవలి సంరక్షణ వివరించండి.',
    calendarHint: 'పంటకు అనుగుణమైన నెలవారీ ప్రణాళిక అడగండి. స్థానిక వ్యవసాయ అధికారితో నిర్ధారించండి.',
  },
  हिन्दी: {
    greeting: 'नमस्ते किसान भाई! 👋',
    subtitle: 'आपका खेती सहायक तैयार है।',
    ask: 'आज आपको किस बारे में मदद चाहिए?',
    weather: 'मौसम',
    schemes: 'सरकारी योजनाएँ',
    crop: 'फसल की देखभाल',
    calendar: 'खेती कैलेंडर',
    news: 'कृषि समाचार',
    chat: 'बोल किसान से पूछें',
    chatHint: 'खेती के बारे में पूछें...',
    send: 'भेजें',
    home: 'होम',
    assistant: 'सहायक',
    more: 'और',
    voice: 'बोल किसान से बात करें',
    voiceHint: 'हाथ खाली रखें। बस बोलें और सुनें।',
    voiceTitle: 'बोल किसान से बात करें',
    voiceSubtitle: 'आपका व्यक्तिगत खेती सहायक',
    tapMic: 'शुरू करने के लिए माइक्रोफोन दबाएँ',
    listening: 'सुन रहा हूँ...',
    hearing: 'आपकी आवाज़ सुनाई दे रही है...',
    processing: 'आपके सवाल पर सोच रहा हूँ...',
    speaking: 'बोल किसान जवाब दे रहा है...',
    paused: 'रुका हुआ है',
    start: 'बोलना शुरू करें',
    stop: 'रिकॉर्डिंग बंद करें',
    autoListen: 'बस बोलिए। 2 सेकंड रुकने पर मैं जवाब दूँगा।',
    tapToSend: 'अभी भेजने के लिए दबाएँ',
    tapToInterrupt: 'बीच में बोलने के लिए दबाएँ',
    notUnderstood: 'समझ नहीं आया। कृपया फिर बोलें।',
    endVoice: 'बातचीत समाप्त करें',
    stopReply: 'जवाब सुनना बंद करें',
    conversation: 'बातचीत',
    back: '‹  वापस',
    cancel: 'रद्द करें',
    empty: 'आपकी बातचीत यहाँ दिखाई देगी।',
    weatherTitle: 'स्थानीय मौसम',
    weatherPrompt: 'भारत का शहर या कस्बा खोजें',
    search: 'खोजें',
    chooseLocation: 'स्थान चुनें',
    forecast: '5-दिन का पूर्वानुमान',
    currentConditions: 'अभी का मौसम',
    feelsLike: 'महसूस तापमान',
    humidity: 'नमी',
    wind: 'हवा',
    rainChance: 'बारिश की संभावना',
    weatherSource: 'Open-Meteo का पूर्वानुमान',
    newsTitle: 'आधिकारिक कृषि अपडेट',
    newsSource: 'कृषि एवं किसान कल्याण विभाग',
    schemesTitle: 'केंद्र सरकार की कृषि योजनाएँ',
    schemeSearch: 'योजनाएँ खोजें...',
    openOfficial: 'आधिकारिक जानकारी खोलें',
    officialSources: 'आधिकारिक स्रोत',
    cropTitle: 'फसल की देखभाल',
    cropName: 'फसल का नाम',
    cropConcern: 'फसल की समस्या बताएँ',
    cropHelp: 'बोल किसान से पूछें',
    calendarTitle: 'खेती कैलेंडर',
    calendarMonth: 'महीना',
    calendarLocation: 'ज़िला या राज्य (वैकल्पिक)',
    calendarHelp: 'मेरा कैलेंडर बनाएँ',
    historyTitle: 'बातचीत का इतिहास',
    settingsTitle: 'सेटिंग्स',
    clearHistory: 'बातचीत मिटाएँ',
    noResults: 'कोई मिलान परिणाम नहीं।',
    noNews: 'अभी कोई आधिकारिक अपडेट उपलब्ध नहीं है।',
    enterCity: 'खोजने के लिए कम से कम 2 अक्षर लिखें।',
    loading: 'लोड हो रहा है...',
    retry: 'फिर कोशिश करें',
    source: 'स्रोत',
    cropHelpHint: 'लक्षण, कब शुरू हुए और हाल की देखभाल बताएँ।',
    calendarHint: 'फसल के लिए मासिक योजना पूछें। स्थानीय कृषि अधिकारी से सलाह की पुष्टि करें।',
  },
};

const languageCode = {
  English: 'en',
  తెలుగు: 'te',
  हिन्दी: 'hi',
};

const speechLanguage = {
  English: 'en-IN',
  తెలుగు: 'te-IN',
  हिन्दी: 'hi-IN',
};

// Remove markdown so the voice does not read "asterisk asterisk".
function cleanForSpeech(text) {
  const cleaned = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s*[-•*]\s+/gm, '')
    .replace(/[*_#`>~|]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const limit = (Speech.maxSpeechInputLength || 4000) - 1;
  return cleaned.slice(0, limit);
}

export default function App() {
  const [language, setLanguage] = useState('English');
  const [screen, setScreen] = useState('Home');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([
    {
      id: '1',
      sender: 'bot',
      text: 'Namaste! I am Bol Kisan. Ask me about crops, farming advice and government schemes.',
    },
  ]);

  const [isRecording, setIsRecording] = useState(false);
  const [isHearing, setIsHearing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [continuousListening, setContinuousListening] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState('');
  const [weatherQuery, setWeatherQuery] = useState('');
  const [weatherLocations, setWeatherLocations] = useState([]);
  const [weatherForecast, setWeatherForecast] = useState(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState('');
  const [newsItems, setNewsItems] = useState([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState('');
  const [schemes, setSchemes] = useState([]);
  const [schemeQuery, setSchemeQuery] = useState('');
  const [schemesLoading, setSchemesLoading] = useState(false);
  const [schemesError, setSchemesError] = useState('');
  const [cropName, setCropName] = useState('');
  const [cropConcern, setCropConcern] = useState('');
  const [calendarCrop, setCalendarCrop] = useState('');
  const [calendarMonth, setCalendarMonth] = useState('');
  const [calendarLocation, setCalendarLocation] = useState('');

  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  });
  const recorderState = useAudioRecorderState(recorder, METERING_INTERVAL_MS);

  const continuousListeningRef = useRef(false);
  const recordingActiveRef = useRef(false);
  const recordingStartInProgressRef = useRef(false);
  const recordingStopInProgressRef = useRef(false);
  const hasDetectedSpeechRef = useRef(false);
  const speechFramesRef = useRef(0);
  const lastVoiceActivityAtRef = useRef(0);
  const silenceStopStartedRef = useRef(false);
  const errorCountRef = useRef(0);
  const restartTimerRef = useRef(null);
  const chatScrollRef = useRef(null);
  const voiceScrollRef = useRef(null);

  const levelAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0)).current;

  const t = translations[language];

  // Orb pulses gently while the app is thinking or speaking.
  useEffect(() => {
    if (!isSpeaking && !isProcessing) {
      pulseAnim.setValue(0);
      return undefined;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 700,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();

    return () => loop.stop();
  }, [isSpeaking, isProcessing, pulseAnim]);

  // Reset the level ring whenever recording is not active.
  useEffect(() => {
    if (!isRecording) {
      Animated.timing(levelAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [isRecording, levelAnim]);

  // Clean up when the app closes.
  useEffect(() => {
    return () => {
      continuousListeningRef.current = false;
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      void Speech.stop();
    };
  }, []);

  function addMessage(sender, text) {
    setMessages(previous => [
      ...previous,
      {
        id: `${Date.now()}-${Math.random()}`,
        sender,
        text,
      },
    ]);
  }

  // ---------------------------------------------------------------------------
  // Voice session
  // ---------------------------------------------------------------------------
  function openVoiceScreen() {
    continuousListeningRef.current = true;
    errorCountRef.current = 0;
    setContinuousListening(true);
    setVoiceNotice('');
    setScreen('Voice');
    void startRecording();
  }

  async function endVoiceSession() {
    continuousListeningRef.current = false;
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    setContinuousListening(false);
    setVoiceNotice('');

    try {
      await Speech.stop();
      setIsSpeaking(false);

      if (recordingActiveRef.current) {
        recordingStopInProgressRef.current = true;
        recordingActiveRef.current = false;
        setIsRecording(false);
        setIsHearing(false);
        await recorder.stop();
        await setAudioModeAsync({
          playsInSilentMode: true,
          allowsRecording: false,
        });
        recordingStopInProgressRef.current = false;
      }

      setScreen('Home');
    } catch (error) {
      recordingStopInProgressRef.current = false;
      setScreen('Home');
      Alert.alert('Unable to end voice assistant', error.message);
    }
  }

  function scheduleListeningRestart(delay = 300) {
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    restartTimerRef.current = setTimeout(() => {
      if (continuousListeningRef.current) {
        void startRecording();
      }
    }, delay);
  }

  async function startRecording() {
    if (
      recordingActiveRef.current ||
      recordingStartInProgressRef.current ||
      recordingStopInProgressRef.current
    ) {
      return;
    }

    recordingStartInProgressRef.current = true;

    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(
          'Microphone permission',
          'Please allow Bol Kisan to use your microphone.'
        );
        continuousListeningRef.current = false;
        setContinuousListening(false);
        return;
      }

      if (!continuousListeningRef.current) return;

      await Speech.stop();

      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
      });

      await recorder.prepareToRecordAsync();

      if (!continuousListeningRef.current) {
        await setAudioModeAsync({
          playsInSilentMode: true,
          allowsRecording: false,
        });
        return;
      }

      recorder.record();

      recordingActiveRef.current = true;
      hasDetectedSpeechRef.current = false;
      speechFramesRef.current = 0;
      lastVoiceActivityAtRef.current = 0;
      silenceStopStartedRef.current = false;
      setIsHearing(false);
      setIsRecording(true);
    } catch (error) {
      setVoiceNotice(error.message);
      continuousListeningRef.current = false;
      setContinuousListening(false);
    } finally {
      recordingStartInProgressRef.current = false;
    }
  }

  async function sendVoice(audioUri) {
    const formData = new FormData();

    formData.append('audio', {
      uri: audioUri,
      name: 'farmer-question.m4a',
      type: 'audio/m4a',
    });
    formData.append('language', languageCode[language]);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);

    try {
      let response;

      try {
        response = await fetch(`${API_URL}/voice`, {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        });
      } catch {
        throw new Error(
          'Could not reach the Bol Kisan server. Check its URL and connection.'
        );
      }

      let data;

      try {
        data = await response.json();
      } catch {
        throw new Error('The server returned an invalid response.');
      }

      if (!response.ok || !data.success) {
        const error = new Error(data.error || 'Voice processing failed.');
        error.status = response.status;
        throw error;
      }

      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  // discard: throw the audio away. pause: do not start listening again.
  async function stopRecording({ discard = false, pause = false } = {}) {
    if (recordingStopInProgressRef.current || !recordingActiveRef.current) {
      return;
    }

    recordingStopInProgressRef.current = true;
    recordingActiveRef.current = false;

    let nextAction = 'restart'; // 'restart' | 'none'
    let restartDelay = 300;

    try {
      setIsRecording(false);
      setIsHearing(false);

      await recorder.stop();
      const audioUri = recorder.uri;

      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: false,
      });

      if (discard) {
        nextAction = pause ? 'none' : 'restart';
        return;
      }

      if (!audioUri) {
        throw new Error('Audio recording was not saved. Please try again.');
      }

      setIsProcessing(true);

      const data = await sendVoice(audioUri);

      errorCountRef.current = 0;
      setVoiceNotice('');

      if (data.transcript) {
        addMessage('user', data.transcript);
      }

      if (data.reply) {
        addMessage('bot', data.reply);

        if (continuousListeningRef.current) {
          nextAction = 'none';
          void speakReply(data.reply);
        }
      }
    } catch (error) {
      if (error.status === 400) {
        // Silence / unclear audio: keep the conversation going quietly.
        setVoiceNotice(t.notUnderstood);
      } else {
        errorCountRef.current += 1;
        setVoiceNotice(error.message);

        if (errorCountRef.current >= MAX_CONSECUTIVE_ERRORS) {
          continuousListeningRef.current = false;
          setContinuousListening(false);
          nextAction = 'none';
          Alert.alert('Bol Kisan voice error', error.message);
        } else {
          restartDelay = 1500;
        }
      }
    } finally {
      recordingStopInProgressRef.current = false;
      setIsProcessing(false);

      if (nextAction === 'restart') {
        scheduleListeningRestart(restartDelay);
      }
    }
  }

  // Speaks a reply, picks an installed voice, and shows why if nothing plays.
  async function speakReply(text) {
    const cleaned = cleanForSpeech(text);

    if (!cleaned) {
      scheduleListeningRestart();
      return;
    }

    setIsSpeaking(true);

    let finished = false;
    let startTimer = null;

    const finish = notice => {
      if (finished) return;
      finished = true;
      if (startTimer) clearTimeout(startTimer);
      setIsSpeaking(false);
      if (notice) setVoiceNotice(notice);
      scheduleListeningRestart();
    };

    try {
      await Speech.stop();
      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: false,
      });

      // Use the closest voice that is actually installed on this phone.
      const wanted = speechLanguage[language];
      const prefix = wanted.split('-')[0].toLowerCase();
      let voiceLanguage = wanted;
      let missingVoice = false;

      try {
        const voices = await Speech.getAvailableVoicesAsync();
        const normalize = value => String(value || '').replace('_', '-').toLowerCase();
        const exact = voices.find(v => normalize(v.language) === wanted.toLowerCase());
        const sameLanguage = voices.find(v => normalize(v.language).startsWith(prefix));

        if (!exact && sameLanguage) voiceLanguage = sameLanguage.language.replace('_', '-');
        if (!exact && !sameLanguage && voices.length > 0) missingVoice = true;
      } catch {
        // Voice list unavailable: try the default language anyway.
      }

      // If speech never starts, tell the user instead of staying silent.
      startTimer = setTimeout(() => {
        void Speech.stop();
        finish(
          missingVoice
            ? `No ${language} voice found. Install it in Phone Settings > Text-to-speech.`
            : 'Voice reply could not start. Check phone volume and Text-to-speech settings.'
        );
      }, 5000);

      Speech.speak(cleaned, {
        language: voiceLanguage,
        rate: 0.92,
        pitch: 1.0,
        volume: 1.0,
        onStart: () => {
          if (startTimer) clearTimeout(startTimer);
        },
        onDone: () => finish(),
        onStopped: () => {
          finished = true;
          if (startTimer) clearTimeout(startTimer);
          setIsSpeaking(false);
        },
        onError: error =>
          finish(
            `Voice error: ${error?.message || 'text-to-speech failed'}. Install the ${language} voice in Phone Settings > Text-to-speech.`
          ),
      });
    } catch (error) {
      finish(`Voice error: ${error.message}`);
    }
  }

  async function interruptSpeech() {
    try {
      await Speech.stop();
    } catch {
      // ignore
    }
    setIsSpeaking(false);
    if (continuousListeningRef.current) {
      scheduleListeningRestart(150);
    }
  }

  async function handleOrbPress() {
    if (isProcessing) return;

    if (isSpeaking) {
      await interruptSpeech();
      return;
    }

    if (isRecording) {
      if (hasDetectedSpeechRef.current) {
        silenceStopStartedRef.current = true;
        await stopRecording();
      } else {
        // Nothing said yet: tapping pauses listening.
        continuousListeningRef.current = false;
        setContinuousListening(false);
        await stopRecording({ discard: true, pause: true });
      }
      return;
    }

    continuousListeningRef.current = true;
    errorCountRef.current = 0;
    setContinuousListening(true);
    setVoiceNotice('');
    await startRecording();
  }

  // Voice activity detection: send automatically after a pause.
  useEffect(() => {
    if (!isRecording || typeof recorderState.metering !== 'number') return;

    const now = Date.now();
    const metering = recorderState.metering;
    const duration = recorderState.durationMillis || 0;
    const level = Math.min(1, Math.max(0, (metering + 60) / 60));

    Animated.timing(levelAnim, {
      toValue: level,
      duration: 120,
      useNativeDriver: true,
    }).start();

    if (metering > SILENCE_THRESHOLD_DB) {
      speechFramesRef.current += 1;
      lastVoiceActivityAtRef.current = now;

      if (
        !hasDetectedSpeechRef.current &&
        speechFramesRef.current >= MIN_SPEECH_FRAMES
      ) {
        hasDetectedSpeechRef.current = true;
        setIsHearing(true);
        setVoiceNotice('');
      }
    } else if (!hasDetectedSpeechRef.current) {
      speechFramesRef.current = 0;
    }

    if (silenceStopStartedRef.current) return;

    if (hasDetectedSpeechRef.current) {
      if (
        now - lastVoiceActivityAtRef.current >= SILENCE_DURATION_MS ||
        duration >= MAX_UTTERANCE_MS
      ) {
        silenceStopStartedRef.current = true;
        void stopRecording();
      }
    } else if (duration >= IDLE_RESTART_MS) {
      silenceStopStartedRef.current = true;
      void stopRecording({ discard: true });
    }
  }, [isRecording, recorderState.durationMillis, recorderState.metering]);

  // ---------------------------------------------------------------------------
  // Text chat + API helpers
  // ---------------------------------------------------------------------------
  async function requestApi(path, options) {
    let response;

    try {
      response = await fetch(`${API_URL}${path}`, options);
    } catch {
      throw new Error('Could not reach the Bol Kisan server. Check its URL and connection.');
    }

    let data;

    try {
      data = await response.json();
    } catch {
      throw new Error('The server returned an invalid response.');
    }

    if (!response.ok || !data.success) {
      throw new Error(data.error || 'The request could not be completed.');
    }

    return data;
  }

  async function askAI(question) {
    const data = await requestApi('/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: question,
        language: languageCode[language],
      }),
    });

    return data.reply;
  }

  async function submitQuestion(question) {
    const trimmed = question.trim();
    if (!trimmed || isProcessing) return;

    addMessage('user', trimmed);
    setIsProcessing(true);

    try {
      const reply = await askAI(trimmed);
      addMessage('bot', reply);
    } catch (error) {
      Alert.alert('Bol Kisan', error.message);
    } finally {
      setIsProcessing(false);
    }
  }

  async function sendMessage() {
    const trimmed = message.trim();
    if (!trimmed || isProcessing) return;

    setMessage('');
    await submitQuestion(trimmed);
  }

  async function speakMessage(text) {
    try {
      await Speech.stop();
      Speech.speak(cleanForSpeech(text), {
        language: speechLanguage[language],
        rate: 0.92,
      });
    } catch (error) {
      Alert.alert('Speech error', error.message);
    }
  }

  async function searchWeatherLocations() {
    const query = weatherQuery.trim();

    if (query.length < 2) {
      setWeatherError(t.enterCity);
      setWeatherLocations([]);
      return;
    }

    setWeatherLoading(true);
    setWeatherError('');

    try {
      const data = await requestApi(
        `/weather/locations?query=${encodeURIComponent(query)}&language=${languageCode[language]}`
      );
      setWeatherLocations(data.locations);
      if (data.locations.length === 0) setWeatherError(t.noResults);
    } catch (error) {
      setWeatherError(error.message);
    } finally {
      setWeatherLoading(false);
    }
  }

  async function loadWeatherForecast(location) {
    setWeatherLoading(true);
    setWeatherError('');

    try {
      const data = await requestApi(
        `/weather/forecast?latitude=${encodeURIComponent(location.latitude)}&longitude=${encodeURIComponent(location.longitude)}`
      );
      setWeatherForecast({
        ...data.forecast,
        location,
      });
      setWeatherLocations([]);
    } catch (error) {
      setWeatherError(error.message);
    } finally {
      setWeatherLoading(false);
    }
  }

  async function loadNews() {
    setNewsLoading(true);
    setNewsError('');

    try {
      const data = await requestApi(`/news?language=${languageCode[language]}`);
      setNewsItems(data.items);
    } catch (error) {
      setNewsError(error.message);
    } finally {
      setNewsLoading(false);
    }
  }

  async function loadSchemes() {
    setSchemesLoading(true);
    setSchemesError('');

    try {
      const data = await requestApi('/schemes');
      setSchemes(data.schemes);
    } catch (error) {
      setSchemesError(error.message);
    } finally {
      setSchemesLoading(false);
    }
  }

  useEffect(() => {
    if (screen === 'News') void loadNews();
    if (screen === 'Schemes') void loadSchemes();
  }, [screen, language]);

  async function openExternalLink(url) {
    if (typeof url !== 'string' || !url.startsWith('https://')) {
      Alert.alert(t.officialSources, t.noResults);
      return;
    }

    try {
      await Linking.openURL(url);
    } catch (error) {
      Alert.alert(t.officialSources, error.message);
    }
  }

  async function askCropCare() {
    if (!cropName.trim() || !cropConcern.trim()) {
      Alert.alert(t.cropTitle, t.cropHelpHint);
      return;
    }

    setScreen('Chat');
    await submitQuestion(
      `I need practical crop-care advice. Crop: ${cropName.trim()}. Problem and symptoms: ${cropConcern.trim()}. Explain likely causes, safe next steps, and what local details are needed. Do not claim a diagnosis without enough information.`
    );
  }

  async function createFarmCalendar() {
    if (!calendarCrop.trim()) {
      Alert.alert(t.calendarTitle, t.cropName);
      return;
    }

    const month =
      calendarMonth.trim() ||
      new Date().toLocaleString('en-IN', { month: 'long' });
    const location = calendarLocation.trim() || 'India (location not specified)';

    setScreen('Chat');
    await submitQuestion(
      `Create a practical farming calendar for ${calendarCrop.trim()} in ${location} for ${month}. Cover field preparation, sowing or growth-stage work, irrigation, nutrition, and pest monitoring as applicable. State assumptions, avoid unsupported exact prescriptions, and ask for soil or variety details when needed.`
    );
  }

  function clearConversation() {
    Alert.alert(t.settingsTitle, t.clearHistory, [
      { text: t.cancel, style: 'cancel' },
      {
        text: t.clearHistory,
        style: 'destructive',
        onPress: () => setMessages([]),
      },
    ]);
  }

  // ---------------------------------------------------------------------------
  // UI pieces
  // ---------------------------------------------------------------------------
  function Header() {
    return (
      <View style={styles.header}>
        <View>
          <Text style={styles.logo}>🌱 Bol Kisan</Text>
          <Text style={styles.headerCaption}>YOUR SMART FARMING PARTNER</Text>
        </View>

        <View style={styles.languageBadge}>
          <Text style={styles.languageBadgeText}>{language}</Text>
        </View>
      </View>
    );
  }

  function LanguagePicker() {
    return (
      <View style={styles.languageRow}>
        {['English', 'తెలుగు', 'हिन्दी'].map(item => (
          <TouchableOpacity
            key={item}
            onPress={() => setLanguage(item)}
            style={[
              styles.languageButton,
              language === item && styles.languageButtonActive,
            ]}
          >
            <Text
              style={[
                styles.languageButtonText,
                language === item && styles.languageButtonTextActive,
              ]}
            >
              {item}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  }

  function HomeScreen() {
    const features = [
      { id: 'Weather', icon: '🌦️', title: t.weather, color: '#E9F3FA' },
      { id: 'Schemes', icon: '🏛️', title: t.schemes, color: '#F8F0E3' },
      { id: 'CropCare', icon: '🌿', title: t.crop, color: '#EAF4EC' },
      { id: 'Calendar', icon: '📅', title: t.calendar, color: '#F1ECF8' },
    ];

    return (
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.welcomeCard}>
          <Text style={styles.welcomeTitle}>{t.greeting}</Text>
          <Text style={styles.welcomeSubtitle}>{t.subtitle}</Text>

          <TouchableOpacity
            style={styles.heroVoiceButton}
            onPress={openVoiceScreen}
            activeOpacity={0.85}
          >
            <Text style={styles.heroVoiceEmoji}>🎙️</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroVoiceTitle}>{t.voice}</Text>
              <Text style={styles.heroVoiceHint}>{t.voiceHint}</Text>
            </View>
            <Text style={styles.heroVoiceArrow}>›</Text>
          </TouchableOpacity>

          <View style={styles.welcomeDecoration} pointerEvents="none">
            <Text style={styles.welcomeEmoji}>🌾</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>{t.ask}</Text>

        <View style={styles.featureGrid}>
          {features.map(feature => (
            <TouchableOpacity
              key={feature.id}
              style={styles.featureCard}
              onPress={() => setScreen(feature.id)}
            >
              <View
                style={[styles.featureIcon, { backgroundColor: feature.color }]}
              >
                <Text style={styles.featureEmoji}>{feature.icon}</Text>
              </View>

              <Text style={styles.featureTitle}>{feature.title}</Text>
              <Text style={styles.featureArrow}>›</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionTitle}>{t.news}</Text>

        <TouchableOpacity
          style={styles.newsCard}
          onPress={() => setScreen('News')}
        >
          <Text style={styles.newsEmoji}>📰</Text>

          <View style={{ flex: 1 }}>
            <Text style={styles.newsTitle}>{t.newsTitle}</Text>
            <Text style={styles.newsSubtitle}>{t.newsSource}</Text>
          </View>

          <Text style={styles.featureArrow}>›</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  function ChatScreen() {
    return (
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Text style={styles.sectionTitle}>{t.chat}</Text>

        <ScrollView
          ref={chatScrollRef}
          style={styles.chatList}
          contentContainerStyle={{ paddingBottom: 20 }}
          onContentSizeChange={() =>
            chatScrollRef.current?.scrollToEnd({ animated: true })
          }
        >
          {messages.map(item => (
            <View
              key={item.id}
              style={[
                styles.messageBubble,
                item.sender === 'user' ? styles.userBubble : styles.botBubble,
              ]}
            >
              <Text style={styles.messageText}>{item.text}</Text>
              {item.sender === 'bot' && (
                <TouchableOpacity
                  onPress={() => void speakMessage(item.text)}
                  style={styles.speakButton}
                >
                  <Text style={styles.speakButtonText}>🔊</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}

          {isProcessing && (
            <View style={styles.loadingBubble}>
              <ActivityIndicator color={COLORS.green} />
              <Text style={styles.loadingText}>Bol Kisan is thinking...</Text>
            </View>
          )}
        </ScrollView>

        <View style={styles.inputRow}>
          <TouchableOpacity style={styles.micButton} onPress={openVoiceScreen}>
            <Text style={styles.micText}>🎙️</Text>
          </TouchableOpacity>

          <TextInput
            style={styles.messageInput}
            placeholder={t.chatHint}
            placeholderTextColor={COLORS.muted}
            value={message}
            onChangeText={setMessage}
            multiline
          />

          <TouchableOpacity
            style={styles.sendButton}
            onPress={sendMessage}
            disabled={isProcessing}
          >
            <Text style={styles.sendText}>➤</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  function VoiceScreen() {
    let state = 'paused';
    if (isSpeaking) state = 'speaking';
    else if (isProcessing) state = 'processing';
    else if (isRecording && isHearing) state = 'hearing';
    else if (isRecording) state = 'listening';

    const statusText = {
      paused: t.paused,
      listening: t.listening,
      hearing: t.hearing,
      processing: t.processing,
      speaking: t.speaking,
    }[state];

    const hintText = {
      paused: t.tapMic,
      listening: t.autoListen,
      hearing: t.tapToSend,
      processing: '',
      speaking: t.tapToInterrupt,
    }[state];

    const orbIcon = {
      paused: '🎙️',
      listening: '🎙️',
      hearing: '🎙️',
      processing: '⏳',
      speaking: '🔊',
    }[state];

    const ringScale = levelAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [1, 1.45],
    });
    const orbScale = pulseAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [1, 1.1],
    });

    return (
      <View style={styles.voiceScreen}>
        <View style={styles.voiceTopRow}>
          <TouchableOpacity
            style={styles.voiceBackButton}
            onPress={() => void endVoiceSession()}
          >
            <Text style={styles.voiceBackText}>{t.back}</Text>
          </TouchableOpacity>

          <View style={styles.voiceLanguageRow}>
            {['English', 'తెలుగు', 'हिन्दी'].map(item => (
              <TouchableOpacity
                key={item}
                onPress={() => setLanguage(item)}
                style={[
                  styles.voiceLanguageChip,
                  language === item && styles.voiceLanguageChipActive,
                ]}
              >
                <Text
                  style={[
                    styles.voiceLanguageText,
                    language === item && styles.voiceLanguageTextActive,
                  ]}
                >
                  {item}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <Text style={styles.voicePageTitle}>{t.voiceTitle}</Text>
        <Text style={styles.voicePageSubtitle}>{t.voiceSubtitle}</Text>

        <View style={styles.voiceCenter}>
          <View style={styles.orbStage}>
            <Animated.View
              style={[
                styles.orbRing,
                {
                  backgroundColor: ORB_COLORS[state],
                  transform: [{ scale: ringScale }],
                },
              ]}
            />
            <Animated.View style={{ transform: [{ scale: orbScale }] }}>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => void handleOrbPress()}
                disabled={isProcessing}
                style={[styles.orb, { backgroundColor: ORB_COLORS[state] }]}
              >
                {isProcessing ? (
                  <ActivityIndicator size="large" color={COLORS.white} />
                ) : (
                  <Text style={styles.orbIcon}>{orbIcon}</Text>
                )}
              </TouchableOpacity>
            </Animated.View>
          </View>

          <Text style={styles.statusText}>{statusText}</Text>
          {!!hintText && <Text style={styles.statusHint}>{hintText}</Text>}
          {!!voiceNotice && <Text style={styles.voiceNotice}>{voiceNotice}</Text>}
        </View>

        <View style={styles.voiceTranscript}>
          <View style={styles.voiceTranscriptHeader}>
            <Text style={styles.conversationTitle}>💬 {t.conversation}</Text>
            {isSpeaking && (
              <TouchableOpacity onPress={() => void interruptSpeech()}>
                <Text style={styles.voiceInlineAction}>{t.stopReply}</Text>
              </TouchableOpacity>
            )}
          </View>

          <ScrollView
            ref={voiceScrollRef}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 10 }}
            onContentSizeChange={() =>
              voiceScrollRef.current?.scrollToEnd({ animated: true })
            }
          >
            {messages.length === 0 ? (
              <Text style={styles.emptyConversation}>{t.empty}</Text>
            ) : (
              messages.map(item => (
                <View
                  key={item.id}
                  style={[
                    styles.messageBubble,
                    item.sender === 'user' ? styles.userBubble : styles.botBubble,
                  ]}
                >
                  <Text style={styles.messageText}>{item.text}</Text>
                </View>
              ))
            )}
          </ScrollView>
        </View>

        <TouchableOpacity
          style={styles.endVoiceButton}
          onPress={() => void endVoiceSession()}
          activeOpacity={0.85}
        >
          <Text style={styles.endVoiceText}>{t.endVoice}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function MoreScreen() {
    const items = [
      { id: 'Schemes', label: t.schemes },
      { id: 'News', label: t.news },
      { id: 'Weather', label: t.weather },
      { id: 'CropCare', label: t.crop },
      { id: 'Calendar', label: t.calendar },
      { id: 'History', label: t.historyTitle },
      { id: 'Settings', label: t.settingsTitle },
    ];

    return (
      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>{t.more}</Text>

        {items.map(item => (
          <TouchableOpacity
            key={item.id}
            style={styles.moreItem}
            onPress={() => setScreen(item.id)}
          >
            <Text style={styles.moreItemText}>{item.label}</Text>
            <Text style={styles.featureArrow}>›</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    );
  }

  function PageHeader({ title }) {
    return (
      <View style={styles.pageHeader}>
        <TouchableOpacity
          onPress={() => setScreen('Home')}
          style={styles.backButton}
        >
          <Text style={styles.backText}>{t.back}</Text>
        </TouchableOpacity>
        <Text style={styles.pageTitle}>{title}</Text>
      </View>
    );
  }

  function WeatherScreen() {
    const locale = {
      English: 'en-IN',
      తెలుగు: 'te-IN',
      हिन्दी: 'hi-IN',
    }[language];
    const condition = weatherForecast
      ? WEATHER_CODES[weatherForecast.current.weatherCode] || {
          icon: '🌤️',
          en: 'Current conditions',
          hi: 'मौसम की जानकारी',
          te: 'వాతావరణ పరిస్థితులు',
        }
      : null;

    return (
      <View style={styles.detailScreen}>
        {PageHeader({ title: t.weatherTitle })}
        <View style={styles.searchRow}>
          <TextInput
            style={[styles.formInput, styles.searchInput]}
            value={weatherQuery}
            onChangeText={setWeatherQuery}
            placeholder={t.weatherPrompt}
            placeholderTextColor={COLORS.muted}
            onSubmitEditing={() => void searchWeatherLocations()}
            returnKeyType="search"
          />
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => void searchWeatherLocations()}
            disabled={weatherLoading}
          >
            <Text style={styles.primaryButtonText}>{t.search}</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.detailBody}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.detailContent}
        >
          {weatherLoading && (
            <View style={styles.loadingBubble}>
              <ActivityIndicator color={COLORS.green} />
              <Text style={styles.loadingText}>{t.loading}</Text>
            </View>
          )}

          {!!weatherError && <Text style={styles.errorText}>{weatherError}</Text>}

          {weatherLocations.length > 0 && (
            <View style={styles.sectionCard}>
              <Text style={styles.cardHeading}>{t.chooseLocation}</Text>
              {weatherLocations.map(location => (
                <TouchableOpacity
                  key={`${location.id}-${location.latitude}`}
                  style={styles.locationOption}
                  onPress={() => void loadWeatherForecast(location)}
                  disabled={weatherLoading}
                >
                  <Text style={styles.cardTitle}>
                    {[location.name, location.district, location.state]
                      .filter(Boolean)
                      .join(', ')}
                  </Text>
                  <Text style={styles.cardMeta}>{location.country}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {weatherForecast && condition && (
            <>
              <View style={styles.weatherCard}>
                <Text style={styles.cardMeta}>
                  {[weatherForecast.location.name, weatherForecast.location.state]
                    .filter(Boolean)
                    .join(', ')}
                </Text>
                <Text style={styles.weatherIcon}>{condition.icon}</Text>
                <Text style={styles.temperature}>
                  {Math.round(weatherForecast.current.temperature)}°C
                </Text>
                <Text style={styles.cardTitle}>
                  {condition[languageCode[language]]}
                </Text>
                <Text style={styles.cardMeta}>
                  {t.feelsLike} {Math.round(weatherForecast.current.feelsLike)}°C
                </Text>
                <View style={styles.weatherMetrics}>
                  <Text style={styles.metricText}>
                    {t.humidity}: {weatherForecast.current.humidity}%
                  </Text>
                  <Text style={styles.metricText}>
                    {t.wind}: {weatherForecast.current.windSpeed} km/h
                  </Text>
                </View>
              </View>

              <Text style={styles.sectionTitle}>{t.forecast}</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.forecastRow}
              >
                {weatherForecast.days.map(day => {
                  const dayCondition = WEATHER_CODES[day.weatherCode] || condition;
                  return (
                    <View key={day.date} style={styles.forecastCard}>
                      <Text style={styles.forecastDate}>
                        {new Date(`${day.date}T12:00:00`).toLocaleDateString(
                          locale,
                          { weekday: 'short', day: 'numeric' }
                        )}
                      </Text>
                      <Text style={styles.forecastIcon}>{dayCondition.icon}</Text>
                      <Text style={styles.cardMeta}>
                        {dayCondition[languageCode[language]]}
                      </Text>
                      <Text style={styles.forecastTemperature}>
                        {Math.round(day.maxTemperature)}° /{' '}
                        {Math.round(day.minTemperature)}°
                      </Text>
                      <Text style={styles.cardMeta}>
                        {t.rainChance}:{' '}
                        {day.precipitationProbability == null
                          ? '—'
                          : `${day.precipitationProbability}%`}
                      </Text>
                    </View>
                  );
                })}
              </ScrollView>
              <TouchableOpacity
                onPress={() => void openExternalLink('https://open-meteo.com/')}
                style={styles.sourceLink}
              >
                <Text style={styles.linkText}>{t.weatherSource}</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </View>
    );
  }

  function NewsScreen() {
    return (
      <View style={styles.detailScreen}>
        {PageHeader({ title: t.newsTitle })}
        <View style={styles.screenActionRow}>
          <Text style={[styles.cardMeta, { flex: 1 }]}>{t.newsSource}</Text>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => void loadNews()}
            disabled={newsLoading}
          >
            <Text style={styles.secondaryButtonText}>{t.retry}</Text>
          </TouchableOpacity>
        </View>
        <ScrollView
          style={styles.detailBody}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.detailContent}
        >
          {newsLoading && (
            <View style={styles.loadingBubble}>
              <ActivityIndicator color={COLORS.green} />
              <Text style={styles.loadingText}>{t.loading}</Text>
            </View>
          )}
          {!!newsError && <Text style={styles.errorText}>{newsError}</Text>}
          {!newsLoading && !newsError && newsItems.length === 0 && (
            <Text style={styles.cardMeta}>{t.noNews}</Text>
          )}
          {newsItems.map(item => (
            <TouchableOpacity
              key={item.id}
              style={styles.articleCard}
              onPress={() => item.url && void openExternalLink(item.url)}
              disabled={!item.url}
              activeOpacity={item.url ? 0.8 : 1}
            >
              <Text style={styles.articleCategory}>
                {item.category || t.newsSource}
              </Text>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardMeta}>
                {item.publishedAt || t.officialSources}
              </Text>
              {item.url && <Text style={styles.linkText}>{t.openOfficial} ›</Text>}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    );
  }

  function SchemesScreen() {
    const query = schemeQuery.trim().toLocaleLowerCase();
    const filteredSchemes = schemes.filter(scheme =>
      [scheme.name, scheme.summary, scheme.benefit, scheme.type]
        .join(' ')
        .toLocaleLowerCase()
        .includes(query)
    );

    return (
      <View style={styles.detailScreen}>
        {PageHeader({ title: t.schemesTitle })}
        <TextInput
          style={styles.formInput}
          value={schemeQuery}
          onChangeText={setSchemeQuery}
          placeholder={t.schemeSearch}
          placeholderTextColor={COLORS.muted}
        />
        <ScrollView
          style={styles.detailBody}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.detailContent}
        >
          {schemesLoading && (
            <View style={styles.loadingBubble}>
              <ActivityIndicator color={COLORS.green} />
              <Text style={styles.loadingText}>{t.loading}</Text>
            </View>
          )}
          {!!schemesError && (
            <View>
              <Text style={styles.errorText}>{schemesError}</Text>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => void loadSchemes()}
              >
                <Text style={styles.secondaryButtonText}>{t.retry}</Text>
              </TouchableOpacity>
            </View>
          )}
          {filteredSchemes.map(scheme => (
            <View key={scheme.id} style={styles.schemeCard}>
              {!!scheme.type && (
                <Text style={styles.articleCategory}>{scheme.type}</Text>
              )}
              <Text style={styles.cardTitle}>{scheme.name}</Text>
              {!!scheme.summary && (
                <Text style={styles.cardBody}>{scheme.summary}</Text>
              )}
              {!!scheme.benefit && (
                <Text style={styles.cardBody}>
                  <Text style={styles.cardEmphasis}>{t.officialSources}: </Text>
                  {scheme.benefit}
                </Text>
              )}
              {!!scheme.audience?.length && (
                <Text style={styles.cardMeta}>{scheme.audience.join(' · ')}</Text>
              )}
              {(scheme.url || scheme.sourceUrl) && (
                <TouchableOpacity
                  onPress={() =>
                    void openExternalLink(scheme.url || scheme.sourceUrl)
                  }
                  style={styles.sourceLink}
                >
                  <Text style={styles.linkText}>{t.openOfficial} ›</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
          {!schemesLoading && !schemesError && filteredSchemes.length === 0 && (
            <Text style={styles.cardMeta}>{t.noResults}</Text>
          )}
          <TouchableOpacity
            onPress={() => void openExternalLink('https://www.myscheme.gov.in/')}
            style={styles.sourceLink}
          >
            <Text style={styles.linkText}>
              {t.officialSources}: myScheme.gov.in ›
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  function CropCareScreen() {
    return (
      <View style={styles.detailScreen}>
        {PageHeader({ title: t.cropTitle })}
        <ScrollView
          style={styles.detailBody}
          contentContainerStyle={styles.detailContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.cardBody}>{t.cropHelpHint}</Text>
          <TextInput
            style={styles.formInput}
            value={cropName}
            onChangeText={setCropName}
            placeholder={t.cropName}
            placeholderTextColor={COLORS.muted}
          />
          <TextInput
            style={[styles.formInput, styles.multilineInput]}
            value={cropConcern}
            onChangeText={setCropConcern}
            placeholder={t.cropConcern}
            placeholderTextColor={COLORS.muted}
            multiline
            textAlignVertical="top"
          />
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => void askCropCare()}
            disabled={isProcessing}
          >
            <Text style={styles.primaryButtonText}>{t.cropHelp}</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  function CalendarScreen() {
    return (
      <View style={styles.detailScreen}>
        {PageHeader({ title: t.calendarTitle })}
        <ScrollView
          style={styles.detailBody}
          contentContainerStyle={styles.detailContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.cardBody}>{t.calendarHint}</Text>
          <TextInput
            style={styles.formInput}
            value={calendarCrop}
            onChangeText={setCalendarCrop}
            placeholder={t.cropName}
            placeholderTextColor={COLORS.muted}
          />
          <TextInput
            style={styles.formInput}
            value={calendarMonth}
            onChangeText={setCalendarMonth}
            placeholder={t.calendarMonth}
            placeholderTextColor={COLORS.muted}
          />
          <TextInput
            style={styles.formInput}
            value={calendarLocation}
            onChangeText={setCalendarLocation}
            placeholder={t.calendarLocation}
            placeholderTextColor={COLORS.muted}
          />
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => void createFarmCalendar()}
            disabled={isProcessing}
          >
            <Text style={styles.primaryButtonText}>{t.calendarHelp}</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  function HistoryScreen() {
    return (
      <View style={styles.detailScreen}>
        {PageHeader({ title: t.historyTitle })}
        <ScrollView
          style={styles.detailBody}
          contentContainerStyle={styles.detailContent}
        >
          {messages.length === 0 ? (
            <Text style={styles.cardMeta}>{t.empty}</Text>
          ) : (
            messages.map(item => (
              <View
                key={item.id}
                style={[
                  styles.messageBubble,
                  item.sender === 'user' ? styles.userBubble : styles.botBubble,
                ]}
              >
                <Text style={styles.messageText}>{item.text}</Text>
              </View>
            ))
          )}
        </ScrollView>
      </View>
    );
  }

  function SettingsScreen() {
    return (
      <View style={styles.detailScreen}>
        {PageHeader({ title: t.settingsTitle })}
        <View style={styles.sectionCard}>
          <Text style={styles.cardHeading}>{t.settingsTitle}</Text>
          <Text style={styles.cardMeta}>{language}</Text>
          <Text style={styles.cardBody}>
            Choose English, తెలుగు, or हिन्दी with the language selector above.
          </Text>
        </View>
        <TouchableOpacity style={styles.dangerButton} onPress={clearConversation}>
          <Text style={styles.dangerButtonText}>{t.clearHistory}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ---------------------------------------------------------------------------
  // Root
  // ---------------------------------------------------------------------------
  const inVoice = screen === 'Voice';

  return (
    <SafeAreaView style={[styles.safeArea, inVoice && styles.safeAreaVoice]}>
      <StatusBar
        barStyle={inVoice ? 'light-content' : 'dark-content'}
        backgroundColor={inVoice ? COLORS.deepGreen : COLORS.cream}
      />

      {inVoice ? (
        VoiceScreen()
      ) : (
        <>
          {Header()}

          <View style={styles.content}>
            {LanguagePicker()}

            {screen === 'Home' && HomeScreen()}
            {screen === 'Chat' && ChatScreen()}
            {screen === 'More' && MoreScreen()}
            {screen === 'Weather' && WeatherScreen()}
            {screen === 'News' && NewsScreen()}
            {screen === 'Schemes' && SchemesScreen()}
            {screen === 'CropCare' && CropCareScreen()}
            {screen === 'Calendar' && CalendarScreen()}
            {screen === 'History' && HistoryScreen()}
            {screen === 'Settings' && SettingsScreen()}
          </View>

          <View style={styles.bottomNav}>
            {[
              { id: 'Home', icon: '🏠', label: t.home },
              { id: 'Chat', icon: '💬', label: t.assistant },
              { id: 'More', icon: '☰', label: t.more },
            ].map(tab => (
              <TouchableOpacity
                key={tab.id}
                style={styles.navItem}
                onPress={() => setScreen(tab.id)}
              >
                <Text
                  style={[styles.navIcon, screen === tab.id && styles.navActive]}
                >
                  {tab.icon}
                </Text>

                <Text
                  style={[
                    styles.navLabel,
                    screen === tab.id && styles.navLabelActive,
                  ]}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.cream,
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0,
  },

  safeAreaVoice: {
    backgroundColor: COLORS.deepGreen,
  },

  header: {
    paddingHorizontal: 22,
    paddingVertical: 15,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  logo: {
    fontSize: 25,
    fontWeight: '800',
    color: COLORS.darkGreen,
  },

  headerCaption: {
    fontSize: 9,
    letterSpacing: 1.5,
    color: COLORS.muted,
    marginTop: 3,
  },

  languageBadge: {
    backgroundColor: COLORS.lightGreen,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },

  languageBadgeText: {
    color: COLORS.green,
    fontWeight: '700',
    fontSize: 12,
  },

  content: {
    flex: 1,
    paddingHorizontal: 20,
  },

  languageRow: {
    flexDirection: 'row',
    gap: 9,
    marginBottom: 18,
  },

  languageButton: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: COLORS.white,
  },

  languageButtonActive: {
    backgroundColor: COLORS.green,
    borderColor: COLORS.green,
  },

  languageButtonText: {
    color: COLORS.text,
    fontWeight: '600',
    fontSize: 13,
  },

  languageButtonTextActive: {
    color: COLORS.white,
  },

  welcomeCard: {
    backgroundColor: COLORS.green,
    borderRadius: 22,
    padding: 22,
    overflow: 'hidden',
  },

  welcomeTitle: {
    color: COLORS.white,
    fontSize: 22,
    fontWeight: '800',
  },

  welcomeSubtitle: {
    color: '#E1F0E5',
    fontSize: 13,
    marginTop: 8,
    marginBottom: 18,
  },

  welcomeDecoration: {
    position: 'absolute',
    right: 14,
    top: 6,
    opacity: 0.25,
  },

  welcomeEmoji: {
    fontSize: 70,
  },

  heroVoiceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.white,
    borderRadius: 18,
    padding: 14,
  },

  heroVoiceEmoji: {
    fontSize: 28,
  },

  heroVoiceTitle: {
    color: COLORS.darkGreen,
    fontWeight: '800',
    fontSize: 15,
  },

  heroVoiceHint: {
    color: COLORS.muted,
    fontSize: 11,
    marginTop: 3,
  },

  heroVoiceArrow: {
    color: COLORS.green,
    fontSize: 26,
  },

  sectionTitle: {
    color: COLORS.text,
    fontSize: 17,
    fontWeight: '800',
    marginTop: 23,
    marginBottom: 14,
  },

  featureGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },

  featureCard: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: COLORS.white,
    borderRadius: 17,
    padding: 15,
    minHeight: 125,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  featureIcon: {
    width: 43,
    height: 43,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },

  featureEmoji: {
    fontSize: 23,
  },

  featureTitle: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 12,
    paddingRight: 10,
  },

  featureArrow: {
    color: COLORS.green,
    fontSize: 23,
  },

  newsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.white,
    padding: 15,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 18,
  },

  newsEmoji: {
    fontSize: 30,
  },

  newsTitle: {
    color: COLORS.text,
    fontWeight: '700',
    fontSize: 13,
  },

  newsSubtitle: {
    color: COLORS.muted,
    fontSize: 11,
    marginTop: 5,
  },

  bottomNav: {
    flexDirection: 'row',
    backgroundColor: COLORS.white,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 8 : 12,
  },

  navItem: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },

  navIcon: {
    fontSize: 20,
    opacity: 0.55,
  },

  navActive: {
    opacity: 1,
  },

  navLabel: {
    fontSize: 11,
    color: COLORS.muted,
  },

  navLabelActive: {
    color: COLORS.green,
    fontWeight: '800',
  },

  chatList: {
    flex: 1,
  },

  messageBubble: {
    padding: 13,
    borderRadius: 16,
    marginBottom: 12,
    maxWidth: '88%',
  },

  botBubble: {
    backgroundColor: COLORS.white,
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
  },

  userBubble: {
    backgroundColor: COLORS.lightGreen,
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },

  messageText: {
    color: COLORS.text,
    fontSize: 14,
    lineHeight: 21,
  },

  speakButton: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingVertical: 2,
  },

  speakButtonText: {
    fontSize: 16,
  },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderColor: COLORS.border,
  },

  micButton: {
    width: 43,
    height: 43,
    borderRadius: 22,
    backgroundColor: COLORS.lightGreen,
    alignItems: 'center',
    justifyContent: 'center',
  },

  micText: {
    fontSize: 20,
  },

  messageInput: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 22,
    paddingHorizontal: 15,
    paddingVertical: 10,
    color: COLORS.text,
    maxHeight: 90,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  sendButton: {
    width: 43,
    height: 43,
    borderRadius: 22,
    backgroundColor: COLORS.green,
    alignItems: 'center',
    justifyContent: 'center',
  },

  sendText: {
    color: COLORS.white,
    fontSize: 20,
  },

  moreItem: {
    backgroundColor: COLORS.white,
    borderRadius: 13,
    padding: 17,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  moreItemText: {
    color: COLORS.text,
    fontWeight: '600',
  },

  loadingBubble: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.white,
    padding: 13,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginBottom: 12,
  },

  loadingText: {
    color: COLORS.muted,
    fontSize: 12,
  },

  // ---- Voice screen --------------------------------------------------------
  voiceScreen: {
    flex: 1,
    backgroundColor: COLORS.deepGreen,
    paddingHorizontal: 20,
    paddingBottom: 14,
  },

  voiceTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
  },

  voiceBackButton: {
    paddingVertical: 8,
    paddingRight: 8,
  },

  voiceBackText: {
    color: '#BFE3CB',
    fontSize: 16,
    fontWeight: '700',
  },

  voiceLanguageRow: {
    flexDirection: 'row',
    gap: 6,
  },

  voiceLanguageChip: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    borderRadius: 14,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },

  voiceLanguageChipActive: {
    backgroundColor: COLORS.white,
    borderColor: COLORS.white,
  },

  voiceLanguageText: {
    color: '#BFE3CB',
    fontSize: 12,
    fontWeight: '700',
  },

  voiceLanguageTextActive: {
    color: COLORS.deepGreen,
  },

  voicePageTitle: {
    color: COLORS.white,
    fontSize: 23,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 14,
  },

  voicePageSubtitle: {
    color: '#9CC4A9',
    textAlign: 'center',
    marginTop: 6,
    fontSize: 13,
  },

  voiceCenter: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
  },

  orbStage: {
    width: 230,
    height: 230,
    alignItems: 'center',
    justifyContent: 'center',
  },

  orbRing: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    opacity: 0.28,
  },

  orb: {
    width: 138,
    height: 138,
    borderRadius: 69,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.35)',
  },

  orbIcon: {
    fontSize: 52,
  },

  statusText: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.white,
    marginTop: 4,
    textAlign: 'center',
  },

  statusHint: {
    color: '#9CC4A9',
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
    paddingHorizontal: 20,
  },

  voiceNotice: {
    color: '#FFD9A0',
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 20,
  },

  voiceTranscript: {
    flex: 1,
    backgroundColor: COLORS.cream,
    borderRadius: 22,
    padding: 15,
  },

  voiceTranscriptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },

  conversationTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.darkGreen,
  },

  voiceInlineAction: {
    color: '#B84938',
    fontSize: 12,
    fontWeight: '800',
  },

  emptyConversation: {
    color: COLORS.muted,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 25,
  },

  endVoiceButton: {
    marginTop: 12,
    backgroundColor: '#B84938',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },

  endVoiceText: {
    color: COLORS.white,
    fontWeight: '800',
    fontSize: 14,
  },

  // ---- Detail screens ------------------------------------------------------
  backButton: {
    paddingVertical: 8,
  },

  backText: {
    color: COLORS.green,
    fontSize: 16,
    fontWeight: '700',
  },

  detailScreen: {
    flex: 1,
  },

  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },

  pageTitle: {
    flex: 1,
    color: COLORS.darkGreen,
    fontSize: 20,
    fontWeight: '800',
  },

  detailBody: {
    flex: 1,
  },

  detailContent: {
    paddingBottom: 24,
    gap: 12,
  },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },

  searchInput: {
    flex: 1,
    marginBottom: 0,
  },

  formInput: {
    backgroundColor: COLORS.white,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },

  multilineInput: {
    minHeight: 120,
    paddingTop: 14,
  },

  primaryButton: {
    backgroundColor: COLORS.green,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },

  primaryButtonText: {
    color: COLORS.white,
    fontWeight: '800',
  },

  secondaryButton: {
    borderWidth: 1,
    borderColor: COLORS.green,
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 8,
    alignItems: 'center',
  },

  secondaryButtonText: {
    color: COLORS.green,
    fontWeight: '700',
  },

  errorText: {
    color: '#A53327',
    backgroundColor: '#FFF0ED',
    borderRadius: 12,
    padding: 12,
    lineHeight: 20,
  },

  sectionCard: {
    backgroundColor: COLORS.white,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
  },

  cardHeading: {
    color: COLORS.darkGreen,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 8,
  },

  locationOption: {
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },

  cardTitle: {
    color: COLORS.text,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '800',
  },

  cardBody: {
    color: COLORS.text,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 7,
  },

  cardMeta: {
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 18,
  },

  cardEmphasis: {
    color: COLORS.darkGreen,
    fontWeight: '800',
  },

  weatherCard: {
    backgroundColor: COLORS.lightGreen,
    borderRadius: 20,
    alignItems: 'center',
    padding: 20,
  },

  weatherIcon: {
    fontSize: 44,
    marginTop: 10,
  },

  temperature: {
    color: COLORS.darkGreen,
    fontSize: 42,
    fontWeight: '800',
  },

  weatherMetrics: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 15,
  },

  metricText: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '700',
  },

  forecastRow: {
    gap: 10,
    paddingRight: 8,
  },

  forecastCard: {
    width: 142,
    minHeight: 158,
    backgroundColor: COLORS.white,
    borderRadius: 15,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  forecastDate: {
    color: COLORS.darkGreen,
    fontWeight: '800',
  },

  forecastIcon: {
    fontSize: 27,
  },

  forecastTemperature: {
    color: COLORS.text,
    fontWeight: '800',
    fontSize: 13,
  },

  sourceLink: {
    paddingVertical: 9,
  },

  linkText: {
    color: COLORS.green,
    fontSize: 13,
    fontWeight: '800',
  },

  screenActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 12,
  },

  articleCard: {
    backgroundColor: COLORS.white,
    borderRadius: 15,
    padding: 15,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 10,
  },

  articleCategory: {
    color: COLORS.green,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginBottom: 6,
  },

  schemeCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 15,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  dangerButton: {
    backgroundColor: '#FFF0ED',
    borderRadius: 14,
    padding: 14,
    marginTop: 14,
  },

  dangerButtonText: {
    color: '#A53327',
    fontWeight: '800',
    textAlign: 'center',
  },
});
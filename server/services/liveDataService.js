const AGRICULTURE_PORTAL = "https://agriwelfare.gov.in";
const OPEN_METEO_GEOCODING = "https://geocoding-api.open-meteo.com/v1/search";
const OPEN_METEO_FORECAST = "https://api.open-meteo.com/v1/forecast";

async function fetchJson(url, source) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "BolKisan/1.0",
    },
    signal: AbortSignal.timeout(12000),
  });

  if (!response.ok) {
    throw new Error(`${source} returned HTTP ${response.status}.`);
  }

  try {
    return await response.json();
  } catch {
    throw new Error(`${source} returned an invalid response.`);
  }
}

function cleanText(value) {
  return typeof value === "string"
    ? value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
    : "";
}

function officialUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;

  try {
    const url = new URL(value, AGRICULTURE_PORTAL);
    if (
      url.protocol !== "https:" ||
      (url.hostname !== "gov.in" && !url.hostname.endsWith(".gov.in"))
    ) {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

async function searchWeatherLocations(query, language) {
  const url = new URL(OPEN_METEO_GEOCODING);
  url.search = new URLSearchParams({
    name: query,
    count: "8",
    language,
    format: "json",
    countryCode: "IN",
  }).toString();

  const data = await fetchJson(url, "Open-Meteo geocoding");

  return (Array.isArray(data.results) ? data.results : []).map(location => ({
    id: location.id,
    name: cleanText(location.name),
    district: cleanText(location.admin2),
    state: cleanText(location.admin1),
    country: cleanText(location.country),
    latitude: location.latitude,
    longitude: location.longitude,
    timezone: location.timezone,
  }));
}

async function getWeatherForecast(latitude, longitude) {
  const url = new URL(OPEN_METEO_FORECAST);
  url.search = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current:
      "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m",
    daily:
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "auto",
    forecast_days: "5",
  }).toString();

  const data = await fetchJson(url, "Open-Meteo forecast");

  if (
    !data.current ||
    !data.daily ||
    !Array.isArray(data.daily.time) ||
    !Array.isArray(data.daily.weather_code)
  ) {
    throw new Error("Open-Meteo returned incomplete forecast data.");
  }

  return {
    timezone: data.timezone,
    current: {
      time: data.current.time,
      temperature: data.current.temperature_2m,
      feelsLike: data.current.apparent_temperature,
      humidity: data.current.relative_humidity_2m,
      precipitation: data.current.precipitation,
      weatherCode: data.current.weather_code,
      windSpeed: data.current.wind_speed_10m,
    },
    days: data.daily.time.map((date, index) => ({
      date,
      weatherCode: data.daily.weather_code[index],
      maxTemperature: data.daily.temperature_2m_max[index],
      minTemperature: data.daily.temperature_2m_min[index],
      precipitationProbability:
        data.daily.precipitation_probability_max?.[index] ?? null,
    })),
  };
}

async function getAgricultureNews(language) {
  const data = await fetchJson(
    `${AGRICULTURE_PORTAL}/api/documents/press-releases`,
    "Department of Agriculture press releases"
  );

  if (!Array.isArray(data.items)) {
    throw new Error("The official press-release feed has an unexpected format.");
  }

  return data.items
    .map(item => ({
      id: String(item.id ?? item.fileUrl ?? item.title ?? ""),
      title: cleanText(language === "hi" ? item.titleHi || item.title : item.title),
      category: cleanText(item.category),
      publishedAt: cleanText(item.publishDate),
      language: cleanText(item.language),
      url: officialUrl(item.fileUrl),
    }))
    .filter(item => item.id && item.title)
    .slice(0, 40);
}

async function getAgricultureSchemes() {
  const data = await fetchJson(
    `${AGRICULTURE_PORTAL}/api/schemes`,
    "Department of Agriculture schemes"
  );

  if (!Array.isArray(data.schemes)) {
    throw new Error("The official schemes service has an unexpected format.");
  }

  return data.schemes
    .map(scheme => ({
      id: String(scheme.id ?? scheme.slug ?? ""),
      name: cleanText(scheme.fullName || scheme.shortName),
      type: cleanText(scheme.schemeType),
      summary: cleanText(scheme.summary),
      benefit: cleanText(scheme.benefit),
      audience: Array.isArray(scheme.audiences)
        ? scheme.audiences.map(cleanText).filter(Boolean)
        : [],
      url: officialUrl(scheme.portalUrl),
      sourceUrl: officialUrl(
        scheme.slug
          ? `/offerings/schemes-services/${encodeURIComponent(scheme.slug)}`
          : "/offerings/schemes-services"
      ),
    }))
    .filter(scheme => scheme.id && scheme.name);
}

module.exports = {
  getAgricultureNews,
  getAgricultureSchemes,
  getWeatherForecast,
  searchWeatherLocations,
};

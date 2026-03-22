// Load environment variables from a local ".env" file into process.env.
// This lets you keep secrets (like API keys) out of source code.
require("dotenv").config();

/**
 * Day 4 — "controller + executor" pattern:
 * 1) OpenAI (router): returns strict JSON — use tool getWeather(city) or answer via llm.
 * 2) This app: parses JSON, optional fallback if the model mis-routes weather questions.
 * 3) Executor: either getWeather() (Open-Meteo, no key) or a second OpenAI call for the final answer.
 * Requires: OPENAI_API_KEY in .env for OpenAI only. Weather uses public Open-Meteo HTTPS APIs.
 */

// Express is a small web framework for Node.js. It helps us define HTTP routes like POST /ask.
const express = require("express");
// The official OpenAI Node SDK. We'll use it to call the OpenAI API.
const OpenAI = require("openai");

// Create an Express application instance (our web server).
const app = express();
// Middleware: automatically parse JSON request bodies into req.body.
// Without this, req.body would be undefined for JSON POST requests.
app.use(express.json());

// Free weather data via Open-Meteo (no API key): geocode city, then current conditions.
// Docs: https://open-meteo.com/ (Geocoding API + Weather Forecast API)
const OPEN_METEO_GEO = "https://geocoding-api.open-meteo.com/v1/search";
const OPEN_METEO_FORECAST = "https://api.open-meteo.com/v1/forecast";

/** Map Open-Meteo WMO weather_code to a short English label for the answer string. */
function wmoWeatherLabel(code) {
  if (code === undefined || code === null) return "unknown conditions";
  const c = Number(code);
  if (c === 0) return "clear sky";
  if (c <= 3) return "mainly clear to overcast";
  if (c <= 48) return "foggy";
  if (c <= 57) return "drizzle";
  if (c <= 67) return "rain";
  if (c <= 77) return "snow";
  if (c <= 82) return "rain showers";
  if (c <= 86) return "snow showers";
  if (c <= 99) return "thunderstorm";
  return "mixed conditions";
}

/** Best-effort city name for "weather in X" style questions (used if the router LLM mis-routes). */
function extractCityFromWeatherQuestion(question) {
  const q = (question || "").trim();
  const m = q.match(/\b(?:in|at|for)\s+([A-Za-z][A-Za-z\s\-'.]+?)(?:\s*[?!.,]|$)/i);
  if (m?.[1]) return m[1].trim();
  return null;
}

function looksLikeWeatherQuestion(question) {
  // Match common "current conditions" asks; avoid lone "rain/snow" without a place.
  return /\bweather\b|\btemperature\b|\bforecast\b/i.test(question);
}

/**
 * Parse router JSON from the model. Strips optional markdown ```json ... ``` fences
 * so parsing still works if the model wraps the object.
 */
function parseRoutingOutput(text) {
  let raw = (text || "").trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) raw = fence[1].trim();
  return JSON.parse(raw);
}

/**
 * Fetch current conditions for a place name using Open-Meteo (geocode + forecast).
 * Returns a human-readable one-line string (or an error message string on failure).
 */
async function getWeather(city) {
  const q = (city || "").trim();
  if (!q) {
    return "Please provide a city name for the weather.";
  }

  try {
    const geoUrl = `${OPEN_METEO_GEO}?name=${encodeURIComponent(q)}&count=1`;
    const geoRes = await fetch(geoUrl);
    if (!geoRes.ok) {
      return `Weather lookup failed (geocoding HTTP ${geoRes.status}). Try again later.`;
    }
    const geoData = await geoRes.json();
    const place = geoData.results?.[0];
    if (!place) {
      return `Could not find a location named "${q}". Try another spelling or city name.`;
    }

    const { name, country, latitude, longitude } = place;
    const wxUrl =
      `${OPEN_METEO_FORECAST}?latitude=${latitude}&longitude=${longitude}` +
      "&current=temperature_2m,weather_code,wind_speed_10m&wind_speed_unit=kmh";
    const wxRes = await fetch(wxUrl);
    if (!wxRes.ok) {
      return `Weather lookup failed (forecast HTTP ${wxRes.status}). Try again later.`;
    }
    const wxData = await wxRes.json();
    const cur = wxData.current;
    if (!cur) {
      return `No current weather data for ${name}${country ? `, ${country}` : ""}.`;
    }

    const temp = cur.temperature_2m;
    const unit = wxData.current_units?.temperature_2m ?? "C";
    const wind = cur.wind_speed_10m;
    const windUnit = wxData.current_units?.wind_speed_10m ?? "km/h";
    const desc = wmoWeatherLabel(cur.weather_code);

    return (
      `Current weather in ${name}${country ? `, ${country}` : ""}: ` +
      `${temp}${unit}, ${desc}` +
      (wind != null ? `, wind ${wind} ${windUnit}` : "") +
      "."
    );
  } catch (e) {
    return `Weather service error: ${e?.message || "network or timeout"}.`;
  }
}

// Create an OpenAI client using the API key from the environment.
// process.env is where Node stores environment variables.
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.post("/ask", async (req, res) => {
  try {
    // Defensive check: if the key isn't present, calling the API will fail anyway.
    // We return a clear error message so setup issues are easy to diagnose.
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY in environment." });
    }

    // Read "question" from the request body (JSON).
    // Example body: { "question": "Explain REST API simply" }
    const question = req.body?.question;
    // Validate the input so we don't send invalid requests to OpenAI.
    if (typeof question !== "string" || question.trim().length === 0) {
      return res.status(400).json({ error: "Body must include non-empty 'question' string." });
    }

    // Day 4 flow: LLM decides routing first, app executes that decision.
    // Step A — Router LLM: JSON only { decision, tool, input }; input = city name when tool is getWeather.
    const routingResponse = await client.responses.create({
      model: "gpt-4.1-mini",
      input:
        "You route user questions. Output NOTHING except one JSON object.\n\n" +
        "Available tool: getWeather(city) — use it whenever the user asks for current/real weather, " +
        "temperature, or forecast for a place (city/region).\n\n" +
        "Rules:\n" +
        "- If they want weather for a location: decision MUST be \"tool\", tool MUST be \"getWeather\", " +
        "input MUST be ONLY the place name (e.g. \"Pune\", \"London\"), not the full sentence.\n" +
        "- Otherwise: decision \"llm\", tool null, input empty string.\n" +
        "- Do not answer the question. Do not add markdown or text outside JSON.\n\n" +
        "JSON shape exactly:\n" +
        '{"decision":"tool"|"llm","tool":"getWeather"|null,"input":"<city or empty>"}\n\n' +
        `User question:\n${question}`,
    });

    // Step B — Parse router output; on failure, default to llm path (routingSource stays "llm").
    let routing = { decision: "llm", tool: null, input: "", routingSource: "llm" };
    try {
      const parsed = parseRoutingOutput(routingResponse.output_text || "");
      routing = {
        decision: parsed?.decision === "tool" ? "tool" : "llm",
        tool: typeof parsed?.tool === "string" ? parsed.tool : null,
        input: typeof parsed?.input === "string" && parsed.input.trim() ? parsed.input.trim() : "",
        routingSource: "llm",
      };
    } catch {
      // Invalid JSON or non-object output: fall through; may still hit weather fallback below.
    }

    // Step C — Fallback: if the question clearly asks for weather/temperature/forecast but routing
    // was not tool+getWeather, derive a city from "in/at/for <place>" and force getWeather.
    if (
      looksLikeWeatherQuestion(question) &&
      (routing.decision !== "tool" || routing.tool !== "getWeather")
    ) {
      const city =
        extractCityFromWeatherQuestion(question) || (routing.input && routing.input.trim()) || "";
      if (city) {
        routing = {
          decision: "tool",
          tool: "getWeather",
          input: city,
          routingSource: "fallback",
        };
      }
    }

    // Step D — Tool path: Open-Meteo (no API key).
    if (routing.decision === "tool" && routing.tool === "getWeather") {
      const answer = await getWeather(routing.input);
      return res.json({
        originalQuestion: question,
        answer,
        source: "tool",
        routing,
      });
    }

    // Step E — LLM answer path: second OpenAI call with the original question.
    const answerResponse = await client.responses.create({
      model: "gpt-4.1-mini",
      input: question,
    });

    // 4) Return final LLM answer.
    return res.json({
      originalQuestion: question,
      answer: answerResponse.output_text,
      source: "llm",
      routing,
    });
  } catch (err) {
    // If anything goes wrong (network issue, invalid key, model error, etc.),
    // log the full error to the server terminal for debugging.
    // eslint-disable-next-line no-console
    console.error("OpenAI error:", err);

    // Choose an HTTP status code:
    // - If the OpenAI SDK provided one (err.status), use it.
    // - Otherwise, treat common network errors as "Bad Gateway" (502).
    // - Fall back to 500 for everything else.
    const status =
      err?.status ||
      err?.response?.status ||
      (err?.code === "ENOTFOUND" || err?.code === "ECONNREFUSED" || err?.code === "ETIMEDOUT"
        ? 502
        : 500);

    // Return a structured error response to the caller.
    // This makes it easier to diagnose issues from curl/Postman/clients.
    return res.status(status).json({
      error: err?.message || "Unknown error",
      code: err?.code,
      type: err?.name,
      cause: err?.cause?.message || err?.cause,
    });
  }
});

// Choose a port:
// - Use PORT if provided (common in hosting environments)
// - Otherwise default to 3000 for local development
const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
  // When the server starts successfully, print a helpful URL.
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${port}`);
});

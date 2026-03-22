// Load environment variables from a local ".env" file into process.env.
// This lets you keep secrets (like API keys) out of source code.
require("dotenv").config();

/**
 * Day 5 — controller + executor + in-memory sessions:
 * `sessionId` maps to prior user/assistant turns; both OpenAI calls get that history as context.
 * Weather tool returns only a temperature string (e.g. 22°C) from Open-Meteo.
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

const GEO = "https://geocoding-api.open-meteo.com/v1/search";
const WX = "https://api.open-meteo.com/v1/forecast";

/** Best-effort city name for "weather in X" style questions (used if the router LLM mis-routes). */
function extractCityFromWeatherQuestion(question) {
  const q = (question || "").trim();
  const m = q.match(/\b(?:in|at|for)\s+([A-Za-z][A-Za-z\s\-'.]+?)(?:\s*[?!.,]|$)/i);
  if (m?.[1]) return m[1].trim();
  return null;
}

/**
 * Checks if the user's question relates to weather, temperature, or a forecast.
 * @param {string} question - The user's input string.
 * @returns {boolean} True if the question indicates a weather request.
 */
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

/** Geocode + forecast; on success returns only `${temp}${unit}` (e.g. 22°C). */
async function getWeather(city) {
  const q = (city || "").trim();
  if (!q) return "no city";
  try {
    const rg = await fetch(`${GEO}?name=${encodeURIComponent(q)}&count=1`);
    if (!rg.ok) return "error";
    const p = (await rg.json()).results?.[0];
    if (!p) return "not found";
    const rw = await fetch(`${WX}?latitude=${p.latitude}&longitude=${p.longitude}&current=temperature_2m`);
    if (!rw.ok) return "error";
    const { current: c, current_units: units } = await rw.json();
    if (c?.temperature_2m == null) return "n/a";
    return `${c.temperature_2m}${units?.temperature_2m ?? "°C"}`;
  } catch {
    return "error";
  }
}

// Create an OpenAI client using the API key from the environment.
// process.env is where Node stores environment variables.
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// In-memory: sessionId -> [{ role: "user" | "assistant", content: string }, ...]
const sessionStore = Object.create(null);
const MAX_SESSION_MESSAGES = 40;

/**
 * Retrieves the message history for a given session, capping at MAX_SESSION_MESSAGES.
 * @param {string} sessionId - The unique identifier for the conversational session.
 * @returns {Array<{role: string, content: string}>} Array of prior messages.
 */
function getSessionMessages(sessionId) {
  const list = sessionStore[sessionId];
  if (!list?.length) return [];
  return list.length > MAX_SESSION_MESSAGES ? list.slice(-MAX_SESSION_MESSAGES) : list;
}

/** Turn prior turns into a text block prepended to OpenAI `input`. */
function formatHistoryContext(messages) {
  if (!messages.length) return "";
  const lines = messages.map((m) =>
    m.role === "user" ? `User: ${m.content}` : `Assistant: ${m.content}`
  );
  return `Prior conversation (oldest first):\n${lines.join("\n")}\n\n`;
}

/**
 * Appends a user question and the assistant's answer to the session's message history.
 * @param {string} sessionId - The unique identifier for the conversational session.
 * @param {string} userText - The current user's question.
 * @param {string} assistantText - The final answer returned by the assistant.
 */
function recordTurn(sessionId, userText, assistantText) {
  if (!sessionStore[sessionId]) sessionStore[sessionId] = [];
  sessionStore[sessionId].push({ role: "user", content: userText });
  sessionStore[sessionId].push({ role: "assistant", content: assistantText });
}

app.post("/ask", async (req, res) => {
  try {
    // Defensive check: if the key isn't present, calling the API will fail anyway.
    // We return a clear error message so setup issues are easy to diagnose.
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY in environment." });
    }

    // Read "question" and "sessionId" from the request body (JSON).
    const question = req.body?.question;
    const sessionIdRaw = req.body?.sessionId;
    const sessionId =
      typeof sessionIdRaw === "string" && sessionIdRaw.trim() ? sessionIdRaw.trim() : "default";

    // Validate the input so we don't send invalid requests to OpenAI.
    if (typeof question !== "string" || question.trim().length === 0) {
      return res.status(400).json({ error: "Body must include non-empty 'question' string." });
    }

    const history = getSessionMessages(sessionId);
    const historyBlock = formatHistoryContext(history);

    // LLM routes first; app executes (tool = minimal getWeather, else final LLM).
    // Step A — Router LLM: JSON only { decision, tool, input }; prior messages included as context.
    const routingResponse = await client.responses.create({
      model: "gpt-4.1-mini",
      input:
        historyBlock +
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
        `Current user message:\n${question}`,
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
      recordTurn(sessionId, question, answer);
      return res.json({
        sessionId,
        originalQuestion: question,
        answer,
        source: "tool",
        routing,
      });
    }

    // Step E — LLM answer path: second OpenAI call; include session history as context.
    const answerResponse = await client.responses.create({
      model: "gpt-4.1-mini",
      input:
        historyBlock +
        "Answer the user's latest message helpfully. Use prior conversation when it clarifies intent.\n\n" +
        `Current user message:\n${question}`,
    });

    const finalAnswer = answerResponse.output_text;
    recordTurn(sessionId, question, finalAnswer);

    return res.json({
      sessionId,
      originalQuestion: question,
      answer: finalAnswer,
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

// Load environment variables from a local ".env" file into process.env.
// This lets you keep secrets (like API keys) out of source code.
require("dotenv").config();

// Express is a small web framework for Node.js. It helps us define HTTP routes like POST /ask.
const express = require("express");
// The official OpenAI Node SDK. We'll use it to call the OpenAI API.
const OpenAI = require("openai");

// Create an Express application instance (our web server).
const app = express();
// Middleware: automatically parse JSON request bodies into req.body.
// Without this, req.body would be undefined for JSON POST requests.
app.use(express.json());

// Local tool function that returns mock weather for a city.
// You can later replace this with a real weather API call.
function getWeather(city) {
  return `Weather in ${city} is 32 C (mock).`;
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
    // 1) Ask OpenAI to decide if this request needs a tool.
    const routingResponse = await client.responses.create({
      model: "gpt-4.1-mini",
      input:
       `
You are a strict decision engine.

RULES:
- If the question asks about weather → MUST use tool
- Do NOT answer yourself
- Only decide tool usage

Available tool:
- getWeather(city)

Return ONLY JSON:
{
  "decision": "tool" or "llm",
  "tool": "getWeather" or null,
  "input": "city name if tool is used"
}

Question:
${question}
`,
    });

    // Parse the model's routing JSON. If parsing fails, default to LLM.
    let routing = { decision: "llm", tool: null, input: question.trim() };
    try {
      const parsed = JSON.parse((routingResponse.output_text || "").trim());
      routing = {
        decision: parsed?.decision === "tool" ? "tool" : "llm",
        tool: typeof parsed?.tool === "string" ? parsed.tool : null,
        input: typeof parsed?.input === "string" && parsed.input.trim() ? parsed.input.trim() : question.trim(),
      };
    } catch {
      // Keep default routing on invalid JSON.
    }
    console.log("ROUTING RAW:", routingResponse.output_text);
    console.log("PARSED ROUTING:", routing);
    // 2) If decision is tool, call getWeather.
    if (routing.decision === "tool" && routing.tool === "getWeather") {
      const answer = getWeather(routing.input);
      return res.json({
        originalQuestion: question,
        answer,
        source: "tool",
        routing,
      });
    }

    // 3) Otherwise, ask OpenAI for the final answer.
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

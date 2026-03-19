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

// Local "tool" function used for routing when we detect weather-related questions.
// For now this is a lightweight placeholder; you can later wire this to a real
// weather API or data source.
function getWeather(question) {
  // This runs when the user includes the word "weather" in their question.
  return `Weather info (demo): I can't fetch real weather data here. You asked: "${question}"`;
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

    // If the question includes the word 'weather', route to the local tool.
    // Use case-insensitive matching so "Weather" also triggers the tool.
    const mentionsWeather = /\bweather\b/i.test(question);
    if (mentionsWeather) {
      const answer = getWeather(question);
      return res.json({
        originalQuestion: question,
        improvedQuestion: question,
        answer,
        // Indicates the response came from a local tool/function, not OpenAI.
        source: "tool",
      });
    }

    // 1) First call OpenAI to rewrite the user's question into clear English.
    const rewriteResponse = await client.responses.create({
      model: "gpt-4.1-mini",
      input:
        "Rewrite the following user question into clear, grammatical English. " +
        "Preserve the original meaning. Do not answer the question. " +
        "Return ONLY the rewritten question text and nothing else.\n\n" +
        `User question:\n${question}`,
    });

    const improvedQuestion = (rewriteResponse.output_text || "").trim() || question.trim();

    // 2) Then call OpenAI again using the improved question to get the final answer.
    const answerResponse = await client.responses.create({
      model: "gpt-4.1-mini",
      input: improvedQuestion,
    });

    // 3) Return original question, improved question, final answer, and `source: "llm"`.
    return res.json({
      originalQuestion: question,
      improvedQuestion,
      answer: answerResponse.output_text,
      // Indicates the response came from the LLM.
      source: "llm",
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

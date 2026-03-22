# Day 5 — Adding Memory for Conversation History to OpenAI “Ask” API

This project is a **tiny HTTP API server** built with **Node.js** and **Express**.
It exposes one endpoint:

- `POST /ask`: JSON body includes **`question`** and optional **`sessionId`** (non-empty string; if omitted, uses `"default"`). The server keeps an **in-memory** map `sessionId → [messages…]` (alternating user / assistant). **Before** each OpenAI call (router and final answer), prior turns are prepended as text context. **After** a successful response, the current question and answer are **appended** to that session.

## Key Features added in Day 5

- **Add basic memory**: Your system now remembers previous messages in the same session.
- **Same `/ask` API**: The endpoint remains the same (`POST /ask`), but now it securely uses conversation history out of the box.

## What this project does (high level)

1. Starts an Express web server on `http://localhost:3000` (or `PORT` if you set it).
2. Waits for a request to `POST /ask`.
3. Reads `question` and `sessionId` from the body; loads prior messages for that session (capped at 40 messages).
4. **Router call (OpenAI)**: same history block + asks for **only** JSON with:
   - `decision`: `"tool"` or `"llm"`
   - `tool`: `"getWeather"` or `null`
   - `input`: city name when using the tool (e.g. `"Pune"`), or empty string for `llm`
5. **Parse** that JSON; if the model wraps it in ` ```json ` fences, the server strips them first.
6. **Fallback** (optional): if the text still looks like a weather/temperature/forecast question but routing was wrong, the server tries to extract a city after `in` / `at` / `for` and calls `getWeather` anyway (`routing.routingSource` becomes `"fallback"`).
7. If routing is `tool` + `getWeather`, calls **`getWeather(input)`** — success returns **only** a temperature string (e.g. `22°C`), not a full sentence.
8. Otherwise calls OpenAI again for the **final answer** to the question.
9. Appends this turn (`user`: question, `assistant`: answer) to the session store.
10. Returns JSON including `sessionId`, `source`, `routing`, etc. (see below).

**Note:** Session data lives **only in RAM** — it is lost when the process restarts.

## API keys and external services

- **OpenAI**: required. Set **`OPENAI_API_KEY`** in `.env` (used for the router and for the final LLM answer when not using the tool).
- **Open-Meteo** (weather): **no API key**. Used only when the tool path runs. The server must reach `geocoding-api.open-meteo.com` and `api.open-meteo.com` over HTTPS.

## Response shape (`POST /ask` success)

- `sessionId`: string used for this turn (echoed back; may be `"default"` if you did not send one).
- `originalQuestion`: string you sent.
- `answer`: string — on **tool** path, almost always just **`{temp}{unit}`** (e.g. `22°C`); short tokens like `not found` / `error` on failure. On **llm** path, normal model text.
- `source`: `"tool"` | `"llm"`.
- `routing`: object returned by the router logic, typically:
  - `decision`: `"tool"` | `"llm"`
  - `tool`: `"getWeather"` or `null`
  - `input`: city string or empty
  - `routingSource`: `"llm"` (parsed from the model) or `"fallback"` (server corrected routing for a weather-style question)

## How Day 5 relates to earlier days

- **Day 1–3**: As in the series README (single LLM, rewrite+answer, keyword tool).
- **Day 4**: LLM routing JSON + executor.
- **Day 5**: **Conversation memory added**. `Day 5` also uses a minimal `getWeather` (temperature only) so you can grow other features easily. It keeps the same `/ask` API but adds session state across messages.

## Prerequisites

- Node.js installed (any modern version should work)
- An OpenAI API key (see above)

## Weather tool (`getWeather`)

When the tool path runs, the server uses **Open-Meteo** (no key): geocode, then `temperature_2m`. The **`answer`** field is **only that value + unit** on success (e.g. `18.5°C`).

## Files in this folder

- `server.js`: Express server, router + fallback + `getWeather`
- `package.json`: dependencies + scripts
- `.env`: local secrets (`OPENAI_API_KEY`), not committed
- `.gitignore`: keeps `.env` out of git

## Setup

From the `day-5` directory:

```bash
npm install
```

Create a `.env` file (same folder as `server.js`):

```bash
OPENAI_API_KEY=YOUR_KEY_HERE
```

Important:

- **Don’t add quotes** unless your key contains spaces.
- **No spaces around `=`** (example above is correct).
- `.env` is ignored by git via `.gitignore`.

## Run the server

```bash
npm start
```

You should see:

- `Server listening on http://localhost:3000`

## Test the endpoint (curl)

In a **new terminal** (keep the server running).

General question (expects `source: "llm"` after routing):

```bash
curl -sS -X POST "http://localhost:3000/ask" \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"demo-1","question":"Explain REST API simply"}'
```

Weather question (expects `source: "tool"` and a live-style line from Open-Meteo):

```bash
curl -sS -X POST "http://localhost:3000/ask" \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"demo-1","question":"What is the weather in Pune?"}'
```

What the command does:

- **`curl`**: sends an HTTP request from your terminal.
- **`-sS`**: silent but still reports errors.
- **`-X POST`**: `POST` is required for `/ask`.
- **`http://localhost:3000/ask`**: local server and route.
- **`-H "Content-Type: application/json"`**: JSON body.
- **`-d '{...}'`**: body `{"sessionId":"...","question":"..."}` (`sessionId` optional → `"default"`).

Expected shape:

- Success: `{"sessionId":"...","originalQuestion":"...","answer":"...","source":"tool"|"llm","routing":{...}}`
- Error: `{"error":"...","code":"...","type":"...","cause":"..."}`

## Workflow diagrams (Mermaid)

See **[WORKFLOW.md](./WORKFLOW.md)** for flowchart + sequence diagrams (Markdown Preview Enhanced).

## Troubleshooting

- **`Missing OPENAI_API_KEY`**: Ensure `.env` exists in `day-5/` with `OPENAI_API_KEY=...`, then restart the server.

- **`Connection error.`** (OpenAI): Network/DNS/proxy/TLS or invalid key; check the server log (`OpenAI error:`).

- **Weather fails or empty**: Confirm outbound HTTPS to Open-Meteo hosts; check `answer` text for geocoding errors (unknown city, HTTP errors).

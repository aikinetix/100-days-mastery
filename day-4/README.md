# Day 4 — OpenAI “Ask” API (LLM-Decided Tool Routing) (Node.js + Express)

This project is a **tiny HTTP API server** built with **Node.js** and **Express**.
It exposes one endpoint:

- `POST /ask`: accepts a JSON body with a `question` string. An **OpenAI router** returns JSON deciding whether to call the **`getWeather(city)`** tool (real data via Open-Meteo) or to answer with a **second OpenAI** call. Your code **executes** that decision (controller + executor).

## What this project does (high level)

1. Starts an Express web server on `http://localhost:3000` (or `PORT` if you set it).
2. Waits for a request to `POST /ask`.
3. Reads `question` from the request body.
4. **Router call (OpenAI)**: asks for **only** JSON with:
   - `decision`: `"tool"` or `"llm"`
   - `tool`: `"getWeather"` or `null`
   - `input`: city name when using the tool (e.g. `"Pune"`), or empty string for `llm`
5. **Parse** that JSON; if the model wraps it in ` ```json ` fences, the server strips them first.
6. **Fallback** (optional): if the text still looks like a weather/temperature/forecast question but routing was wrong, the server tries to extract a city after `in` / `at` / `for` and calls `getWeather` anyway (`routing.routingSource` becomes `"fallback"`).
7. If routing is `tool` + `getWeather`, calls **`getWeather(input)`** (Open-Meteo: geocode + current conditions).
8. Otherwise calls OpenAI again for the **final answer** to the question.
9. Returns JSON including `source`: `"tool"` or `"llm"` and a `routing` object (see below).

## API keys and external services

- **OpenAI**: required. Set **`OPENAI_API_KEY`** in `.env` (used for the router and for the final LLM answer when not using the tool).
- **Open-Meteo** (weather): **no API key**. Used only when the tool path runs. The server must reach `geocoding-api.open-meteo.com` and `api.open-meteo.com` over HTTPS.

## Response shape (`POST /ask` success)

- `originalQuestion`: string you sent.
- `answer`: string — either Open-Meteo summary (tool) or model text (llm).
- `source`: `"tool"` | `"llm"`.
- `routing`: object returned by the router logic, typically:
  - `decision`: `"tool"` | `"llm"`
  - `tool`: `"getWeather"` or `null`
  - `input`: city string or empty
  - `routingSource`: `"llm"` (parsed from the model) or `"fallback"` (server corrected routing for a weather-style question)

## How Day 4 differs from Day 1 to Day 3

- **Day 1**: One LLM call (`question` → `answer`).
- **Day 2**: Two LLM calls (rewrite question → answer).
- **Day 3**: **You** route with a simple rule (e.g. keyword `weather` → tool).
- **Day 4**: **LLM** emits a routing decision in JSON; **you** execute it. Optional **fallback** + **Open-Meteo** make weather answers reliable when the router JSON is imperfect.

## Prerequisites

- Node.js installed (any modern version should work)
- An OpenAI API key (see above)

## Weather tool (`getWeather`)

When the tool path runs, the server uses **Open-Meteo**: geocode the city, then read current `temperature_2m`, WMO `weather_code` (mapped to a short label), and wind. No separate weather API key.

## Files in this folder

- `server.js`: Express server, router + fallback + `getWeather`
- `package.json`: dependencies + scripts
- `.env`: local secrets (`OPENAI_API_KEY`), not committed
- `.gitignore`: keeps `.env` out of git

## Setup

From the `day-4` directory:

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
  -d '{"question":"Explain REST API simply"}'
```

Weather question (expects `source: "tool"` and a live-style line from Open-Meteo):

```bash
curl -sS -X POST "http://localhost:3000/ask" \
  -H "Content-Type: application/json" \
  -d '{"question":"What is the weather in Pune?"}'
```

What the command does:

- **`curl`**: sends an HTTP request from your terminal.
- **`-sS`**: silent but still reports errors.
- **`-X POST`**: `POST` is required for `/ask`.
- **`http://localhost:3000/ask`**: local server and route.
- **`-H "Content-Type: application/json"`**: JSON body.
- **`-d '{...}'`**: body `{"question":"..."}`.

Expected shape:

- Success: `{"originalQuestion":"...","answer":"...","source":"tool"|"llm","routing":{...}}`
- Error: `{"error":"...","code":"...","type":"...","cause":"..."}`

## Workflow diagrams (Mermaid)

See **[WORKFLOW.md](./WORKFLOW.md)** for flowchart + sequence diagrams (Markdown Preview Enhanced).

## Troubleshooting

- **`Missing OPENAI_API_KEY`**: Ensure `.env` exists in `day-4/` with `OPENAI_API_KEY=...`, then restart the server.

- **`Connection error.`** (OpenAI): Network/DNS/proxy/TLS or invalid key; check the server log (`OpenAI error:`).

- **Weather fails or empty**: Confirm outbound HTTPS to Open-Meteo hosts; check `answer` text for geocoding errors (unknown city, HTTP errors).

# Day 4 — OpenAI “Ask” API (LLM-Decided Tool Routing) (Node.js + Express)

This project is a **tiny HTTP API server** built with **Node.js** and **Express**.
It exposes one endpoint:

- `POST /ask`: accepts a JSON body with a `question` string, asks OpenAI to decide whether to use a tool (`getWeather(city)`) or answer directly, then executes that decision.

## What this project does (high level)

1. Starts an Express web server on `http://localhost:3000` (or `PORT` if you set it).
2. Waits for a request to `POST /ask`.
3. Reads `question` from the request body.
4. Calls OpenAI with a decision prompt asking for strict JSON:
   - `decision`: `"tool"` or `"llm"`
   - `tool`: tool name (for now: `"getWeather"` or `null`)
   - `input`: tool input (for weather: city)
5. Parses the returned JSON decision.
6. If decision is `tool`, calls local `getWeather(input)`.
7. Otherwise, calls OpenAI for the final answer.
8. Responds with `{ "originalQuestion": "...", "answer": "...", "source": "tool" | "llm", "routing": { ... } }`.

## How Day 4 differs from Day 1 to Day 3

- **Day 1**: Simple single LLM call (`question -> answer`).
- **Day 2**: Two LLM calls (`rewrite question -> answer rewritten question`).
- **Day 3**: App-level keyword router (`weather` keyword decides tool vs LLM).
- **Day 4**: LLM-driven router (LLM decides `tool` or `llm` in JSON, app executes that decision).

## Prerequisites

- Node.js installed (any modern version should work)
- An OpenAI API key

## Files in this folder

- `server.js`: the Express server and `/ask` endpoint
- `package.json`: dependencies + scripts
- `.env`: your local environment variables (not committed)
- `.gitignore`: ensures secrets like `.env` are ignored by git

## Setup

From the `day-4` directory:

```bash
npm install
```

Create a `.env` file (in the same folder as `server.js`):

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

In a **new terminal window/tab** (leave the server running), run:

```bash
curl -sS -X POST "http://localhost:3000/ask" \
  -H "Content-Type: application/json" \
  -d '{"question":"Explain REST API simply"}'
```

What this command does:

- **`curl`**: sends an HTTP request from your terminal.
- **`-sS`**: “silent” mode (no progress bar), but still shows errors if something goes wrong.
- **`-X POST`**: uses the HTTP `POST` method (required because `/ask` is a POST endpoint).
- **`"http://localhost:3000/ask"`**: calls your server running locally on port `3000`, route `/ask`.
- **`-H "Content-Type: application/json"`**: tells the server you’re sending JSON in the request body.
- **`-d '{...}'`**: sends the JSON request body. Here it sends `{ "question": "Explain REST API simply" }`.
- Your server reads `question`.
- OpenAI first returns a routing JSON decision (`tool` or `llm`).
- Your server executes that decision:
  - Calls local `getWeather(input)` when decision is `tool`.
  - Calls OpenAI for final answer when decision is `llm`.

Expected shape:

- Success: `{"originalQuestion":"...","answer":"...","source":"tool" | "llm","routing":{"decision":"tool" | "llm","tool":"getWeather" | null,"input":"..."}}`
- Error: `{"error":"...","code":"...","type":"...","cause":"..."}`

## Troubleshooting

- **`Missing OPENAI_API_KEY`**: Ensure `.env` exists in `day-4/` and contains `OPENAI_API_KEY=...`, then restart the server after changing `.env`.

- **`Connection error.`**: Usually means the server can’t reach OpenAI (network/DNS/proxy/TLS) or the key was revoked; look at the server terminal output after a request (it prints `OpenAI error:` with details).

# Day 2 — OpenAI “Ask” API (Improved Day 1) (Node.js + Express)

This project is a **tiny HTTP API server** built with **Node.js** and **Express**.
It exposes one endpoint:

- `POST /ask`: accepts a JSON body with a `question` string, first rewrites it into clear English, then sends the improved question to OpenAI and returns the final answer as JSON.

## What this project does (high level)

1. Starts an Express web server on `http://localhost:3000` (or `PORT` if you set it).
2. Waits for a request to `POST /ask`.
3. Reads `question` from the request body.
4. Calls OpenAI to rewrite the question into clear English.
5. Calls OpenAI again to answer the improved question.
6. Responds with `{ "originalQuestion": "...", "improvedQuestion": "...", "answer": "..." }`.

## Prerequisites

- Node.js installed (any modern version should work)
- An OpenAI API key

## Files in this folder

- `server.js`: the Express server and `/ask` endpoint
- `package.json`: dependencies + scripts
- `.env`: your local environment variables (not committed)
- `.gitignore`: ensures secrets like `.env` are ignored by git

## Setup

From the `day-2` directory:

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
  - Your server reads `question`, forwards it to OpenAI, then returns the model’s reply.

Expected shape:

- Success: `{"originalQuestion":"...","improvedQuestion":"...","answer":"..."}`
- Error: `{"error":"...","code":"...","type":"...","cause":"..."}`

## Troubleshooting

- **`Missing OPENAI_API_KEY`**:
  - Ensure `.env` exists in `day-2/` and contains `OPENAI_API_KEY=...`
  - Restart the server after changing `.env`

- **`Connection error.`**:
  - Usually means the server can’t reach OpenAI (network/DNS/proxy/TLS) or the key was revoked.
  - Look at the server terminal output after a request; it prints `OpenAI error:` with details.

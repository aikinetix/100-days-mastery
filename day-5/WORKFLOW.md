# Day 5 — Workflow diagrams (Mermaid)

Rendered by **Markdown Preview Enhanced** (and most Mermaid-capable previewers). Each diagram is in a `mermaid` fenced code block.

---

## Flow diagram (`POST /ask`)

High-level control flow matching `server.js`: load **session** history → router LLM (with history) → parse → optional weather fallback → tool or final LLM (with history) → **record** turn in memory.

```mermaid
flowchart TD
  Start([Client: POST /ask]) --> Key{OPENAI_API_KEY set?}
  Key -->|no| E500[Respond 500: missing key]
  Key -->|yes| Q{question non-empty string?}
  Q -->|no| E400[Respond 400: invalid body]
  Q -->|yes| Router[OpenAI: routing prompt<br/>JSON decision / tool / input]

  Router --> Parse[parseRoutingOutput<br/>strip markdown fences, JSON.parse]
  Parse --> ParseOK{parse OK?}
  ParseOK -->|no| RDefault[routing defaults:<br/>decision llm, routingSource llm]
  ParseOK -->|yes| RLLM[routing from model:<br/>routingSource llm]

  RDefault --> FallbackCheck
  RLLM --> FallbackCheck

  FallbackCheck{looksLikeWeatherQuestion<br/>AND not tool getWeather?}
  FallbackCheck -->|yes| City{extractCityFromWeatherQuestion<br/>or routing.input?}
  City -->|has city| RFallback[Override routing:<br/>tool getWeather, routingSource fallback]
  City -->|no city| Exec
  FallbackCheck -->|no| Exec

  RFallback --> Exec

  Exec{decision is tool<br/>AND tool is getWeather?}
  Exec -->|yes| GW[getWeather → answer is temp only e.g. 22°C]
  GW --> OKTool[Respond 200 JSON:<br/>source tool, answer, routing]

  Exec -->|no| FinalLLM[OpenAI: final answer<br/>responses.create question]
  FinalLLM --> OKLLM[Respond 200 JSON:<br/>source llm, answer, routing]

  %% Thrown errors in the route handler are caught; server responds with error JSON + HTTP status.
```

---

## Sequence diagram

Shows **who** talks to **whom**: Express as orchestrator, two OpenAI calls on the LLM path, Open-Meteo only on the tool path.

```mermaid
sequenceDiagram
  autonumber
  participant Client
  participant Express as Express server
  participant OAI_R as OpenAI router
  participant Parser as parseRoutingOutput + fallback
  participant OAI_A as OpenAI answer
  participant Geo as Open-Meteo geocoding
  participant Wx as Open-Meteo forecast

  Client->>Express: POST /ask { question }

  alt Missing OPENAI_API_KEY or bad question
    Express-->>Client: 500 / 400 JSON error
  end

  Express->>OAI_R: responses.create routing prompt
  OAI_R-->>Express: output_text JSON

  Express->>Parser: parse + optional weather fallback
  Note over Parser: May set routingSource to fallback

  alt Tool path getWeather
    Express->>Geo: GET geocode ?name=city
    Geo-->>Express: lat lon place
    Express->>Wx: GET forecast current=temperature_2m
    Wx-->>Express: temperature string only
    Express-->>Client: 200 { answer, source tool, routing }
  else LLM answer path
    Express->>OAI_A: responses.create question
    OAI_A-->>Express: output_text answer
    Express-->>Client: 200 { answer, source llm, routing }
  end
```

---

## Legend

| Piece | Meaning |
| ----- | ------- |
| **Router** | First OpenAI call; must return JSON only (`decision`, `tool`, `input`). |
| **Fallback** | If text looks like weather but routing was wrong, derive city and force `getWeather`. |
| **getWeather** | No API key; returns only `${temp}${unit}` on success. |
| **Final LLM** | Second OpenAI call; answers the user question directly. |

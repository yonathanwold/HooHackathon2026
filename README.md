# Tacitus

Tacitus is an investigative research OS that maps contradictions across sources and helps teams verify claims faster. It combines a narrative home experience with a dedicated fact‑checking desk for author reliability, consistency, and political leaning analysis.

## What Tacitus Does

- Presents a modern editorial homepage and product narrative.
- Offers workflow, claims, threads, and ask pages for investigative context.
- Provides a fact‑check desk that verifies authors against current sources and highlights contradictions.
- Supports secure sign‑in with email/password and passkey flows.

## Key Features

- Author fact‑checking with sources, reliability score (0–100), and leaning analysis.
- A clean, branded login experience aligned with the Tacitus theme.
- Cache‑busted assets for fast local iteration.

## Tech Stack

- Node.js + Express
- MongoDB + Mongoose
- Pug templates
- Sass
- Passport (local auth + optional OAuth providers)

## Local Development

### 1) Install dependencies

```bash
npm install
```

### 2) Create `.env`

Use the `.env.example` as a starting point and add your own values:

```env
BASE_URL=http://localhost:8080
MONGODB_URI=mongodb://localhost:27017/test
SESSION_SECRET=your-secret

GEMINI_API_KEY=your-gemini-key
GEMINI_MODEL=gemini-2.5-flash
```

### 3) Start MongoDB

```bash
"$HOME/.local/opt/mongodb/bin/mongod" --dbpath "$HOME/.local/var/mongodb" --bind_ip 127.0.0.1 --port 27017
```

### 4) Run the app

```bash
npm start
```

Open:

- http://localhost:8080
- http://localhost:8080/fact-check

## Fact Check Desk

The fact‑check tool searches the web for recent sources, summarizes the author’s record, and labels contradictions or consistency with citations. It also reports political leaning (left/center/right) with a color‑coded indicator and explicit freshness notes.

## License

MIT

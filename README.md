# Nexus AI — Duolingo/Sideme-style AI Course Generator (Multi-Provider + Offline Pack)

This project generates **interactive learning modules** (cards, quizzes, challenges, videos) and enforces a **locked progression**: the next module unlocks only when the learner **passes the final quiz** of the current module.

## What’s included

- **Multi-provider model router** (Blackbox-style selection):
  - Provider: **Auto / Gemini / OpenAI / Claude / OpenRouter**
  - Model: Auto or pick a specific model
  - Server does **fallback + backoff + caching** to reduce rate-limit failures
- **Module tracking & locking**
  - Modules unlock only after passing the **final module quiz (>=70%)**
- **Per-step Tutor + Edit box**
  - Ask questions about the current step
  - Refine/edit the step (extend explanation, add examples, generate harder quiz, etc.)
- **Outline mode (no assessment)**
  - Paste a course outline → immediate modules + steps (Duolingo flow)
- **Offline friendly**
  - Export/Import a **Course Pack** (JSON) so learners can reopen course/progress without needing regeneration

> Note about “YouTube offline download”:
> - This app embeds YouTube videos and can work offline for your generated text/quizzes via **Course Pack export/import**.
> - It does **not** download YouTube videos directly (copyright/ToS). If you need offline video, use YouTube’s official offline feature or host your own videos.

---

## Run locally

### 1) Install dependencies
```bash
npm install
```

### 2) Configure environment
Create `.env.local` based on `.env.example`.

You can set **one provider** or multiple. Auto mode will pick the best available and fail over.

### 3) Start the server (Terminal 1)
```bash
npm run dev:server
```
Server runs on `http://localhost:8787`.

### 4) Start the frontend (Terminal 2)
```bash
npm run dev
```
Frontend runs on `http://localhost:3000` and proxies `/api/*` to the server.

---

## Production build (single server)

```bash
npm run start:prod
```
This builds the frontend and serves `dist/` from the same server process.

---

## Deploy notes (Render / VPS)

- Set env vars in your host (same keys as `.env.example`).
- Run command: `npm run start:prod`
- Expose port: `PORT` (default 8787)

---

## Using Outline Mode

On the landing screen:
1. Click **“Have a course outline? Paste it”**
2. Paste something like:

```
Course Outline: Data Structures and Algorithms in Java
Prerequisites...
Module 1: Introduction to DSA
- What are DSAs?
- Why DSAs matter
Module 2: Arrays, Stacks, Queues
...
```

This immediately creates modules + steps and enforces locked progression.

---

## Export / Import (Offline Pack)

- **Export**: downloads a JSON “Course Pack” containing course + progress + router config.
- **Import**: restores everything from a saved pack.


---

## Vercel-only deployment

This repo now supports frontend + backend in one Vercel project:

- Frontend: Vite static output (`dist`)
- Backend: Vercel Functions under `api/*`

Implemented API routes:

- `api/config.js`
- `api/generate/assessment.js`
- `api/generate/course-outline.js`
- `api/generate/module-lesson-plan.js`
- `api/generate/step-content.js`
- `api/tutor/ask.js`
- `api/tutor/edit.js`

### Deploy steps

1. Push this repo to GitHub.
2. Import the repo in Vercel.
3. In Vercel project settings, set Environment Variables:
   - `GEMINI_API_KEY`
   - `OPENAI_API_KEY`
   - `ANTHROPIC_API_KEY`
   - `OPENROUTER_API_KEY`
   - Optional: `YOUTUBE_API_KEY`
   - Optional model/provider lists: `GEMINI_MODELS`, `OPENAI_MODELS`, `ANTHROPIC_MODELS`, `OPENROUTER_MODELS`, `AI_PROVIDER_CANDIDATES`
4. Deploy.

`vercel.json` is included and configured for Vite + Node.js functions.

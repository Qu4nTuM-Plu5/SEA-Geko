# SEA-Geko(Bridging the Gap from Classroom to Career)

AI-powered learning continuity prototype for low-connectivity environments.

---

## 1) Project Details

| Item | Description |
| --- | --- |
| Project name | SEA-Geko |
| Core purpose | Generate adaptive learning content, support offline continuation, and track learner impact |
| Main users | Youth, educators, displaced learners, community organizations |
| Primary value | Learning can continue even with unstable internet and limited devices |
| Built with | React + TypeScript + Vite (frontend), Node.js server (backend) |
| Project Proposal Report | [View Borneo Report](report/Borneo%20Report.pdf) |
| Demostration Video | [Watch the Demo on YouTube](https://youtu.be/mgcs1bqcuMI) |


### What this prototype does

- Generates assessments, course outlines, lesson plans, and lesson content with AI.
- Adapts generation based on profile context (`segment`, `connectivity`, `language`, `goal`, `region`).
- Supports download-and-reopen learning for offline continuity.
- Tracks impact events and KPI metrics (completion, confidence, skill gain proxies).
- Includes community publishing, reactions/comments, reporting, and cohort flows.
- Includes interview-preparation mode (questions, coaching feedback, final review).

---

## 2) System Overview

| Layer | Path | Responsibility |
| --- | --- | --- |
| Frontend app | `src/` | UI, onboarding, generation flow, learning experience, offline UX |
| Backend API | `server/server.cjs` | AI routing, validation, persistence, API endpoints |
| Dev launcher | `scripts/dev-local.cjs` | Starts API + frontend together for local development |
| Local demo data | `server/.data/app-db.json` | Demo persistence when Supabase is not configured |
| Optional production DB/Auth | Supabase | Auth, profile/course/event persistence |

---

## 3) Prerequisites

- Node.js 18+ (Node 20+ recommended)
- npm

Check versions:

```bash
node -v
npm -v
```

---

## 4) Setup Instructions

### Step 1: Install dependencies

```bash
npm install
```

### Step 2: Create environment file

PowerShell:

```powershell
Copy-Item .env.example .env
```

Bash:

```bash
cp .env.example .env
```

### Step 3: Configure at least one AI provider

Minimum requirement: one working provider key.

Example:

```env
AI_PROVIDER_CANDIDATES=openrouter,ollama,mistral
OPENROUTER_API_KEY=your_key_here
```

If you use other providers, include them in `AI_PROVIDER_CANDIDATES` and set their keys.

---

## 5) Run Instructions

### Recommended local run (frontend + backend together)

```bash
npm run dev
```

What this does:

- Starts backend server on `http://localhost:8787` (or next available port if 8787 is busy).
- Starts frontend on `http://localhost:3000`.
- Proxies `/api` from frontend to backend automatically.

### Backend only

```bash
npm run dev:server
```

### Frontend only

```bash
npm run dev:web
```

### Production-style local run

```bash
npm run build
npm run start
```

Then open:

- `http://localhost:8787`

### Type check

```bash
npm run lint
```

---

## 6) How To Interact With the Prototype

Use this exact flow to explore the prototype end-to-end.

| Phase | Action | Expected output |
| --- | --- | --- |
| Launch | Open `http://localhost:3000` | App home screen loads |
| Account/Profile | Sign in if Supabase auth is configured, then complete onboarding profile | Segment/connectivity/language/goal context saved |
| Course generation | Enter a goal/topic and generate course outline + edit the outline + content | Structured modules and mixed step types are created |
| Learning | Complete lessons and quizzes + edit the contents | Progress updates and impact events recorded |
| Community | Publish course, browse feed, react/comment/share | Visibility and moderation-related states update |
| Offline continuity | Download a course from Downloads tab, then reopen while offline | Downloaded course remains available from account snapshot |
| Interview mode | Enable interview preparation and run a session | Questions, feedback, and final review are generated |

Notes:

- If Supabase is not configured, local demo mode still works using local account IDs and JSON persistence.
- If no AI provider is available, generation endpoints will fail by design until provider setup is fixed.

---

## 7) Environment Variables

Commonly used variables:

| Variable | Required | Purpose |
| --- | --- | --- |
| `PORT` | No | Backend port (default `8787`) |
| `AI_PROVIDER_CANDIDATES` | Yes (practical) | Provider order for routing |
| `OPENROUTER_API_KEY` | Required if using OpenRouter | Enable OpenRouter requests |
| `MISTRAL_API_KEY` or `MISTRAL_API_KEYS` | Required if using Mistral | Enable Mistral requests |
| `OLLAMA_API_BASE` | Required if using Ollama | Local Ollama base URL |
| `GEMINI_API_KEY` | Required if using Gemini | Enable Gemini requests |
| `OPENAI_API_KEY` | Required if using OpenAI | Enable OpenAI requests |
| `ANTHROPIC_API_KEY` | Required if using Anthropic | Enable Anthropic requests |
| `YOUTUBE_API_KEY` | Optional | Better video lookup during content generation |
| `VITE_SUPABASE_URL` / `SUPABASE_URL` | Optional | Enable Supabase integration |
| `VITE_SUPABASE_ANON_KEY` / `SUPABASE_ANON_KEY` | Optional | Supabase client/auth |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional (backend only) | Server-side DB operations |

Reference template:

- `.env.example`

Supabase setup guide:

- `docs/supabase-setup.md`

---

## 8) API Surface (Main Endpoints)

- `GET /api/config`
- `GET /api/auth/config`
- `POST /api/generate/assessment`
- `POST /api/generate/course-outline`
- `POST /api/generate/module-lesson-plan`
- `POST /api/generate/step-content`
- `POST /api/tutor/ask`
- `POST /api/tutor/edit`
- `POST /api/profile/upsert`
- `GET /api/profile/me`
- `POST /api/impact/pretest`
- `POST /api/impact/posttest`
- `POST /api/impact/confidence`
- `POST /api/impact/event`
- `GET /api/impact/summary`
- `POST /api/courses/:id/publish`
- `GET /api/public/feed`
- `POST /api/public/:id/react`
- `POST /api/public/:id/comment`
- `POST /api/courses/:id/report`
- `POST /api/cohorts`
- `POST /api/cohorts/:id/join`
- `GET /api/cohorts/:id/dashboard`
- `POST /api/interview/session`
- `POST /api/interview/feedback`
- `POST /api/interview/final-review`

---

## 9) AI Disclosure

This project uses generative AI as a core runtime component.

### Where AI is used

- Course creation: assessment, outline, lesson planning, and step content.
- Tutor assistant: question answering and content editing.
- Career and CV workflows: CV analysis and role guidance.
- Interview preparation: session generation, answer feedback, final review.

### What users must understand

- AI outputs may be inaccurate, incomplete, or biased.
- Outputs should be reviewed by a human before formal educational deployment.
- This system is not a medical, legal, or emergency decision tool.
- Model quality, latency, and language performance vary by provider/model availability.

### Data and personalization disclosure

- The app uses user-provided profile context (segment, language, connectivity, goal, region) to adapt output.
- Learning events are collected to compute impact metrics.
- In demo mode, persistence is local JSON storage.
- In Supabase mode, auth and data are handled through configured Supabase services.

---

## 10) Safety, Privacy, and Responsible AI Docs

- `docs/responsible-ai.md`
- `docs/privacy-consent.md`
- `docs/safety-moderation.md`
- `docs/impact-metrics.md`

---
## 11) Troubleshooting

| Problem | Likely cause | Fix |
| --- | --- | --- |
| App opens but generation fails | No provider key or unavailable provider | Set at least one valid provider key in `.env` or add multiple keys in these holders MISTRAL_API_KEYS= , OPENROUTER_API_KEYS= |
| Auth modal says Supabase not configured | Missing Supabase env vars | Add Supabase keys and restart server |
| API not reachable from frontend | Backend not running or wrong port | Run `npm run dev` and confirm API logs |
| No offline course found | Course was not downloaded | Download course first from Downloads tab |
| Community actions not persisting as expected | Running in local demo mode only | Configure Supabase for production-like persistence |

---

## 12) Known Prototype Limits

- Local demo persistence (`server/.data/app-db.json`) is not production-grade storage.
- Moderation is prototype-level and not a complete safety enforcement system.
- Impact calculations are practical KPI proxies for prototype demonstration.
- Full production readiness requires hardened auth, rate limiting, and stronger moderation controls.

# SEA-Geko (Nexus AI): Education Continuity for Low-Connectivity Learners

SEA-Geko is an AI-powered course generator and learning app designed for **education access and learning continuity** in ASEAN, especially for users with unstable internet, low-bandwidth devices, and disrupted learning environments.

This repository keeps the original interactive learning functionality and adds scoring-focused features for hackathon judging:
- beneficiary-specific onboarding
- adaptive AI generation context
- impact metric tracking
- account-based offline downloaded courses
- ASEAN language support
- low-bandwidth mode
- public/private publishing with moderation signals
- cohort workflows

## 1) Hackathon Lane and SDG Mapping

### AI Singapore lane (single-scope)
- Primary lane: **Education access and learning continuity**
- Beneficiaries: youth (18-35), educators, displaced learners, community organizations

### Borneo alignment
- Problem statement and objectives are explicit and measurable
- Responsible AI and privacy docs are included
- ASEAN scalability and stakeholder plan are documented

### SDG mapping
- **SDG 4**: Quality Education
- **SDG 8**: Decent Work and Economic Growth
- **SDG 10**: Reduced Inequalities

## 2) Core Product Capabilities

### Existing functionality preserved
- AI-generated assessment, course outline, lesson plan, and step content
- Multi-provider AI routing (Gemini/OpenAI/Anthropic/OpenRouter, with fallback behavior)
- Locked progression and quiz-based completion flow
- Tutor ask/edit flows (online)
- Outline builder (auto and manual)

### New scoring-focused functionality
- Segment-aware onboarding:
  - `userSegment`: youth, educator, displaced, community_org
  - `connectivityLevel`: offline_first, low_bandwidth, normal
  - `preferredLanguage`, `learningGoal`, `region`, `deviceClass`
- Adaptive generation rules via `profileContext` in API payloads
- Impact instrumentation:
  - `course_started`, `lesson_started`, `lesson_completed`, `quiz_submitted`, `course_completed`, `daily_active`
- KPI cards:
  - skill gain, confidence gain, completion proxy, reached users
- Offline continuity:
  - account-based downloaded course snapshots in IndexedDB
  - open downloaded courses without raw import/export
  - AI generation/edit disabled while offline
- Community features:
  - publish course private/public
  - moderation status and reporting endpoints
  - cohort create/join flows

## 3) Architecture

### Frontend
- React + TypeScript + Vite
- Main app flow in `src/App.tsx`
- Offline persistence in `src/lib/offlineStore.ts`
- Localization helper in `src/lib/i18n.ts`

### Backend
- Node HTTP server in `server/server.cjs`
- AI routes + prompt builders + validation
- Lightweight app persistence in `server/.data/app-db.json` (demo-mode storage)

### Data model target
- Supabase migration included in `supabase/migrations/0001_core.sql`
- Covers profiles, courses, progress events, impact attempts, public posts, moderation, and cohorts

## 4) API Endpoints (Implemented Surface)

- `GET /api/profile/me`
- `POST /api/profile/upsert`
- `POST /api/impact/pretest`
- `POST /api/impact/posttest`
- `POST /api/impact/confidence`
- `POST /api/impact/event`
- `GET /api/impact/summary`
- `GET /api/courses/my`
- `POST /api/courses/:id/publish`
- `GET /api/public/feed`
- `POST /api/public/:id/react`
- `POST /api/public/:id/comment`
- `POST /api/courses/:id/report`
- `POST /api/cohorts`
- `POST /api/cohorts/:id/join`
- `GET /api/cohorts/:id/dashboard`
- `POST /api/progress/sync`

## 5) Local Development

## Requirements
- Node.js 18+
- npm

## Install
```bash
npm install
```

## Run backend
```bash
npm run dev:server
```
Backend runs on `http://localhost:8787`.

## Run frontend
```bash
npm run dev
```
Frontend runs on `http://localhost:3000`.

## Typecheck
```bash
npm run lint
```

## Production
```bash
npm run start:prod
```

## 6) Environment Variables

Current local setup can use `.env` in project root.

Recommended production keys:
- `PORT`
- `GEMINI_API_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `OPENROUTER_API_KEY`
- `YOUTUBE_API_KEY` (optional)
- `VITE_SUPABASE_URL` (target architecture)
- `VITE_SUPABASE_ANON_KEY` (target architecture)
- `SUPABASE_SERVICE_ROLE_KEY` (server-side only)

## 7) Responsible AI, Privacy, and Safety

See:
- `docs/responsible-ai.md`
- `docs/privacy-consent.md`
- `docs/safety-moderation.md`
- `docs/impact-metrics.md`

## 8) Judge-Facing Submission Docs

- Borneo report: `docs/borneo-report.md`
- AI Singapore brief: `docs/ai-singapore-brief.md`
- Demo script: `pitch/demo-script-3min.md`
- Slide structure: `pitch/slide-outline.md`

## 9) Known Limits (Transparent)

- Demo backend currently uses local JSON persistence, not full Supabase runtime integration.
- Moderation is heuristic and not yet backed by dedicated safety classifiers.
- Localization coverage is partial in current UI copy; core switching is in place.
- KPI formulas are live but still simplified for hackathon speed.

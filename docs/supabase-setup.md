# Supabase Full Setup (Users + Courses + Likes/Comments + Analytics)

This guide matches your current backend in `server/server.cjs`.

## 1) Create Supabase project
1. Go to Supabase dashboard and create a new project.
2. Open `Project Settings -> API`.
3. Copy:
   - `Project URL`
   - `anon public` key
   - `service_role` key

## 2) Configure app env
Update `server/.env`:

```env
SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
SUPABASE_ANON_KEY=YOUR_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
```

Important:
- Keep `SUPABASE_SERVICE_ROLE_KEY` only on backend (`server/.env`).
- Never expose service role key in frontend code.

## 3) Create DB schema
Run this file in Supabase SQL Editor:

- `docs/supabase-schema.sql`

That creates all tables used by your app:
- `profiles`
- `profile_cv`
- `courses`
- `course_snapshots`
- `course_public_posts`
- `course_reactions`
- `course_comments`
- `course_saves`
- `user_follows`
- `assessment_attempts`
- `confidence_surveys`
- `progress_events`
- `abuse_reports`

It also creates:
- indexes for performance
- `updated_at` trigger
- RLS policies

## 4) Auth settings
In Supabase:
1. Open `Authentication -> Providers`.
2. Enable `Email` provider.
3. Configure confirmation behavior as you prefer.
4. (Optional) set redirect URLs for hosted frontend.

## 5) Restart backend
Restart your backend after env changes:

```bash
npm run dev:server
```

or your production start command.

## 6) Verify integration
Quick checks:
1. Sign up from app (`/api/auth/sign-up`).
2. Save profile from onboarding (`/api/profile/upsert`).
3. Upload and validate a Europass CV during onboarding (`/api/profile/cv/analyze` + `/api/profile/cv/upsert`) -> check:
   - `profile_cv`
4. Publish a course (`/api/courses/:id/publish`) -> check:
   - `courses`
   - `course_snapshots`
   - `course_public_posts`
5. React/comment on public post -> check:
   - `course_reactions`
   - `course_comments`
6. Trigger learning events -> check:
   - `progress_events`
   - `assessment_attempts`
   - `confidence_surveys`

## 7) Course ID behavior
- When course is published, backend stores a UUID row in `courses.id`.
- That UUID is returned as `courseId` in publish response and reused for analytics/events.
- Local draft IDs are not used as Supabase primary IDs.

## 8) Troubleshooting
- `Supabase auth is not configured`:
  - check `SUPABASE_URL` + `SUPABASE_ANON_KEY`
- `Supabase DB is not configured`:
  - check `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
- 401/403 from REST:
  - wrong key, expired key, or malformed URL
- publish works locally but not Supabase:
  - ensure user ID is UUID from Supabase auth session
- no likes/comments count:
  - verify inserts are happening in `course_reactions` / `course_comments`

## 9) Optional hardening
- Rotate keys immediately if exposed.
- Add rate limiting on public endpoints.
- Add server-side validation for comment length/content and reaction spam.

-- 0001_core.sql
-- Hackathon scoring schema for beneficiary profiles, impact metrics,
-- account-based offline continuity metadata, moderation, and cohorts.

create extension if not exists "pgcrypto";

-- ----------------------------
-- Profiles and core courses
-- ----------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  user_segment text not null check (user_segment in ('youth', 'educator', 'displaced', 'community_org')),
  connectivity_level text not null check (connectivity_level in ('offline_first', 'low_bandwidth', 'normal')),
  learning_goal text not null default '',
  preferred_language text not null default 'en',
  region text not null default 'ASEAN',
  device_class text not null default 'unknown',
  low_bandwidth_mode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profile_cv (
  user_id uuid primary key references auth.users(id) on delete cascade,
  valid boolean not null default false,
  format text not null default 'unknown',
  confidence numeric(4,3) not null default 0,
  file_name text not null default '',
  mime_type text not null default '',
  issues jsonb not null default '[]'::jsonb,
  parsed jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text not null default '',
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  moderation_status text not null default 'clean' check (moderation_status in ('clean', 'under_review', 'flagged', 'hidden')),
  language text not null default 'en',
  segment text not null default 'youth',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.course_snapshots (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  snapshot_version integer not null,
  snapshot_json jsonb not null,
  created_at timestamptz not null default now(),
  unique (course_id, snapshot_version)
);

create table if not exists public.user_courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  role text not null default 'learner',
  enrolled_at timestamptz not null default now(),
  unique (user_id, course_id)
);

create table if not exists public.user_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  percent_complete numeric(5,2) not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, course_id)
);

create table if not exists public.progress_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  event_type text not null check (event_type in ('course_started', 'lesson_started', 'lesson_completed', 'quiz_submitted', 'course_completed', 'daily_active')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.user_downloads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  snapshot_version integer not null,
  size_bytes bigint not null default 0,
  downloaded_at timestamptz not null default now(),
  unique (user_id, course_id, snapshot_version)
);

-- ----------------------------
-- Impact measurement
-- ----------------------------

create table if not exists public.assessment_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  phase text not null check (phase in ('pre', 'post')),
  score_pct numeric(5,2) not null check (score_pct >= 0 and score_pct <= 100),
  created_at timestamptz not null default now()
);

create table if not exists public.confidence_surveys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  phase text not null check (phase in ('pre', 'post')),
  score smallint not null check (score between 1 and 5),
  created_at timestamptz not null default now()
);

create table if not exists public.impact_daily_aggregates (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  course_id uuid references public.courses(id) on delete cascade,
  segment text,
  language text,
  country text,
  users_reached integer not null default 0,
  skill_gain_pp numeric(6,2) not null default 0,
  confidence_gain numeric(6,2) not null default 0,
  completion_rate numeric(6,2) not null default 0,
  d7_retention numeric(6,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (day, course_id, segment, language, country)
);

-- ----------------------------
-- Public sharing + moderation
-- ----------------------------

create table if not exists public.course_public_posts (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text not null default '',
  language text not null default 'en',
  segment text not null default 'youth',
  moderation_status text not null default 'under_review' check (moderation_status in ('clean', 'under_review', 'flagged', 'hidden')),
  created_at timestamptz not null default now()
);

create table if not exists public.course_reactions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.course_public_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction text not null default 'like',
  created_at timestamptz not null default now()
);

create table if not exists public.course_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.course_public_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  comment text not null,
  moderation_status text not null default 'clean' check (moderation_status in ('clean', 'under_review', 'flagged', 'hidden')),
  created_at timestamptz not null default now()
);

create table if not exists public.course_saves (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.course_public_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (post_id, user_id)
);

create table if not exists public.abuse_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('course', 'comment')),
  target_id uuid not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('post', 'comment')),
  target_id uuid not null,
  action text not null check (action in ('approve', 'flag', 'hide', 'restore')),
  actor_id uuid references auth.users(id) on delete set null,
  note text not null default '',
  created_at timestamptz not null default now()
);

-- ----------------------------
-- Cohorts
-- ----------------------------

create table if not exists public.cohorts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.cohort_members (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references public.cohorts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  unique (cohort_id, user_id)
);

-- ----------------------------
-- RLS baseline policies
-- ----------------------------

alter table public.profiles enable row level security;
alter table public.profile_cv enable row level security;
alter table public.courses enable row level security;
alter table public.course_snapshots enable row level security;
alter table public.user_courses enable row level security;
alter table public.user_progress enable row level security;
alter table public.progress_events enable row level security;
alter table public.user_downloads enable row level security;
alter table public.assessment_attempts enable row level security;
alter table public.confidence_surveys enable row level security;
alter table public.impact_daily_aggregates enable row level security;
alter table public.course_public_posts enable row level security;
alter table public.course_reactions enable row level security;
alter table public.course_comments enable row level security;
alter table public.course_saves enable row level security;
alter table public.abuse_reports enable row level security;
alter table public.cohorts enable row level security;
alter table public.cohort_members enable row level security;
alter table public.moderation_actions enable row level security;

create policy if not exists "profiles_owner_rw" on public.profiles
for all using (auth.uid() = id) with check (auth.uid() = id);

create policy if not exists "profile_cv_owner_rw" on public.profile_cv
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy if not exists "courses_owner_rw" on public.courses
for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy if not exists "course_snapshots_owner_rw" on public.course_snapshots
for all using (
  exists (
    select 1 from public.courses c
    where c.id = course_snapshots.course_id and c.owner_id = auth.uid()
  )
) with check (
  exists (
    select 1 from public.courses c
    where c.id = course_snapshots.course_id and c.owner_id = auth.uid()
  )
);

create policy if not exists "user_courses_owner_rw" on public.user_courses
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy if not exists "user_progress_owner_rw" on public.user_progress
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy if not exists "progress_events_owner_rw" on public.progress_events
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy if not exists "user_downloads_owner_rw" on public.user_downloads
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy if not exists "assessment_owner_rw" on public.assessment_attempts
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy if not exists "confidence_owner_rw" on public.confidence_surveys
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy if not exists "impact_read_all_authenticated" on public.impact_daily_aggregates
for select using (auth.role() = 'authenticated');

create policy if not exists "public_posts_read_clean_public" on public.course_public_posts
for select using (moderation_status <> 'hidden');

create policy if not exists "public_posts_owner_rw" on public.course_public_posts
for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy if not exists "reactions_owner_rw" on public.course_reactions
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy if not exists "comments_owner_rw" on public.course_comments
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy if not exists "saves_owner_rw" on public.course_saves
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy if not exists "reports_owner_insert" on public.abuse_reports
for insert with check (auth.uid() = reporter_id);

create policy if not exists "cohorts_owner_rw" on public.cohorts
for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy if not exists "cohort_members_rw" on public.cohort_members
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

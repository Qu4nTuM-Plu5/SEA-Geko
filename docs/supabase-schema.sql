-- Aura / SEA-Geko Supabase schema
-- Run in Supabase SQL Editor.

create extension if not exists pgcrypto;

-- Shared enums
do $$
begin
  if not exists (select 1 from pg_type where typname = 'visibility_t') then
    create type visibility_t as enum ('private', 'public');
  end if;
  if not exists (select 1 from pg_type where typname = 'moderation_t') then
    create type moderation_t as enum ('clean', 'under_review', 'flagged', 'hidden');
  end if;
end$$;

-- Updated-at trigger helper
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 1) Profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text default '',
  user_segment text not null default 'youth',
  connectivity_level text not null default 'normal',
  learning_goal text not null default '',
  preferred_language text not null default 'en',
  region text not null default 'ASEAN',
  device_class text not null default 'unknown',
  low_bandwidth_mode boolean not null default false,
  professional_visibility text not null default 'private' check (professional_visibility in ('public', 'private')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- 1b) Structured CV profile (Europass validation + parsed dashboard data)
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

drop trigger if exists trg_profile_cv_updated_at on public.profile_cv;
create trigger trg_profile_cv_updated_at
before update on public.profile_cv
for each row execute function public.set_updated_at();

-- 2) Courses + snapshots + public post feed
create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text not null default '',
  visibility visibility_t not null default 'private',
  moderation_status moderation_t not null default 'under_review',
  language text not null default 'en',
  segment text not null default 'youth',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_courses_owner_created on public.courses(owner_id, created_at desc);
create index if not exists idx_courses_owner_title on public.courses(owner_id, title);

drop trigger if exists trg_courses_updated_at on public.courses;
create trigger trg_courses_updated_at
before update on public.courses
for each row execute function public.set_updated_at();

create table if not exists public.course_snapshots (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  snapshot_version int not null,
  snapshot_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (course_id, snapshot_version)
);

create index if not exists idx_course_snapshots_course_ver on public.course_snapshots(course_id, snapshot_version desc);

create table if not exists public.course_public_posts (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text not null default '',
  language text not null default 'en',
  segment text not null default 'youth',
  moderation_status moderation_t not null default 'under_review',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_public_posts_course on public.course_public_posts(course_id);
create index if not exists idx_public_posts_owner_created on public.course_public_posts(owner_id, created_at desc);
create index if not exists idx_public_posts_moderation_created on public.course_public_posts(moderation_status, created_at desc);
create unique index if not exists uq_public_posts_course_owner on public.course_public_posts(course_id, owner_id);

drop trigger if exists trg_course_public_posts_updated_at on public.course_public_posts;
create trigger trg_course_public_posts_updated_at
before update on public.course_public_posts
for each row execute function public.set_updated_at();

-- 3) Social interactions
create table if not exists public.course_reactions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.course_public_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction text not null default 'like',
  created_at timestamptz not null default now()
);

create index if not exists idx_course_reactions_post on public.course_reactions(post_id);
create index if not exists idx_course_reactions_user on public.course_reactions(user_id);

create table if not exists public.course_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.course_public_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  comment text not null,
  moderation_status moderation_t not null default 'clean',
  created_at timestamptz not null default now()
);

create index if not exists idx_course_comments_post_created on public.course_comments(post_id, created_at desc);
create index if not exists idx_course_comments_post_mod on public.course_comments(post_id, moderation_status);

create table if not exists public.course_saves (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.course_public_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (post_id, user_id)
);

create index if not exists idx_course_saves_post on public.course_saves(post_id);

create table if not exists public.user_follows (
  id uuid primary key default gen_random_uuid(),
  follower_id uuid not null references auth.users(id) on delete cascade,
  following_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (follower_id, following_id),
  check (follower_id <> following_id)
);

create index if not exists idx_user_follows_following on public.user_follows(following_id, created_at desc);
create index if not exists idx_user_follows_follower on public.user_follows(follower_id, created_at desc);

-- 4) Learning analytics
create table if not exists public.assessment_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  phase text not null check (phase in ('pre', 'post')),
  score_pct numeric(5,2) not null check (score_pct >= 0 and score_pct <= 100),
  created_at timestamptz not null default now()
);

create index if not exists idx_assessment_attempts_user_course_phase on public.assessment_attempts(user_id, course_id, phase);

create table if not exists public.confidence_surveys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  phase text not null check (phase in ('pre', 'post')),
  score int not null check (score >= 1 and score <= 5),
  created_at timestamptz not null default now()
);

create index if not exists idx_confidence_surveys_user_course_phase on public.confidence_surveys(user_id, course_id, phase);

create table if not exists public.progress_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  event_type text not null check (
    event_type in ('course_started', 'lesson_started', 'lesson_completed', 'quiz_submitted', 'course_completed', 'daily_active')
  ),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_progress_events_user_course_type on public.progress_events(user_id, course_id, event_type);
create index if not exists idx_progress_events_created on public.progress_events(created_at desc);

-- 5) Moderation
create table if not exists public.abuse_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('course', 'post', 'comment', 'user')),
  target_id uuid not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_abuse_reports_target on public.abuse_reports(target_type, target_id);
create index if not exists idx_abuse_reports_reporter on public.abuse_reports(reporter_id, created_at desc);

-- -------------------------
-- Row Level Security (RLS)
-- -------------------------

alter table public.profiles enable row level security;
alter table public.profile_cv enable row level security;
alter table public.courses enable row level security;
alter table public.course_snapshots enable row level security;
alter table public.course_public_posts enable row level security;
alter table public.course_reactions enable row level security;
alter table public.course_comments enable row level security;
alter table public.course_saves enable row level security;
alter table public.user_follows enable row level security;
alter table public.assessment_attempts enable row level security;
alter table public.confidence_surveys enable row level security;
alter table public.progress_events enable row level security;
alter table public.abuse_reports enable row level security;

-- Profiles
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
for select to authenticated
using (auth.uid() = id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
for insert to authenticated
with check (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
for update to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- CV profile
drop policy if exists profile_cv_select_own on public.profile_cv;
create policy profile_cv_select_own on public.profile_cv
for select to authenticated
using (auth.uid() = user_id);

drop policy if exists profile_cv_insert_own on public.profile_cv;
create policy profile_cv_insert_own on public.profile_cv
for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists profile_cv_update_own on public.profile_cv;
create policy profile_cv_update_own on public.profile_cv
for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Courses
drop policy if exists courses_select_owner_or_public on public.courses;
create policy courses_select_owner_or_public on public.courses
for select to authenticated
using (owner_id = auth.uid() or visibility = 'public');

drop policy if exists courses_insert_own on public.courses;
create policy courses_insert_own on public.courses
for insert to authenticated
with check (owner_id = auth.uid());

drop policy if exists courses_update_own on public.courses;
create policy courses_update_own on public.courses
for update to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

-- Public posts
drop policy if exists posts_select_visible on public.course_public_posts;
create policy posts_select_visible on public.course_public_posts
for select to authenticated
using (moderation_status <> 'hidden');

drop policy if exists posts_insert_own on public.course_public_posts;
create policy posts_insert_own on public.course_public_posts
for insert to authenticated
with check (owner_id = auth.uid());

drop policy if exists posts_update_own on public.course_public_posts;
create policy posts_update_own on public.course_public_posts
for update to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

-- Snapshots (allow owner read/write via joined course)
drop policy if exists snapshots_select_owner on public.course_snapshots;
create policy snapshots_select_owner on public.course_snapshots
for select to authenticated
using (
  exists (
    select 1 from public.courses c
    where c.id = course_id and c.owner_id = auth.uid()
  )
);

drop policy if exists snapshots_insert_owner on public.course_snapshots;
create policy snapshots_insert_owner on public.course_snapshots
for insert to authenticated
with check (
  exists (
    select 1 from public.courses c
    where c.id = course_id and c.owner_id = auth.uid()
  )
);

-- Reactions / comments / saves
drop policy if exists reactions_select_all on public.course_reactions;
create policy reactions_select_all on public.course_reactions
for select to authenticated
using (true);

drop policy if exists reactions_insert_self on public.course_reactions;
create policy reactions_insert_self on public.course_reactions
for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists comments_select_all on public.course_comments;
create policy comments_select_all on public.course_comments
for select to authenticated
using (moderation_status <> 'hidden');

drop policy if exists comments_insert_self on public.course_comments;
create policy comments_insert_self on public.course_comments
for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists saves_select_all on public.course_saves;
create policy saves_select_all on public.course_saves
for select to authenticated
using (true);

drop policy if exists saves_insert_self on public.course_saves;
create policy saves_insert_self on public.course_saves
for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists user_follows_select_all on public.user_follows;
create policy user_follows_select_all on public.user_follows
for select to authenticated
using (true);

drop policy if exists user_follows_insert_self on public.user_follows;
create policy user_follows_insert_self on public.user_follows
for insert to authenticated
with check (follower_id = auth.uid());

drop policy if exists user_follows_delete_self on public.user_follows;
create policy user_follows_delete_self on public.user_follows
for delete to authenticated
using (follower_id = auth.uid());

-- Analytics
drop policy if exists assessment_select_own on public.assessment_attempts;
create policy assessment_select_own on public.assessment_attempts
for select to authenticated
using (user_id = auth.uid());

drop policy if exists assessment_insert_own on public.assessment_attempts;
create policy assessment_insert_own on public.assessment_attempts
for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists confidence_select_own on public.confidence_surveys;
create policy confidence_select_own on public.confidence_surveys
for select to authenticated
using (user_id = auth.uid());

drop policy if exists confidence_insert_own on public.confidence_surveys;
create policy confidence_insert_own on public.confidence_surveys
for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists progress_select_own on public.progress_events;
create policy progress_select_own on public.progress_events
for select to authenticated
using (user_id = auth.uid());

drop policy if exists progress_insert_own on public.progress_events;
create policy progress_insert_own on public.progress_events
for insert to authenticated
with check (user_id = auth.uid());

-- Abuse reports
drop policy if exists reports_select_own on public.abuse_reports;
create policy reports_select_own on public.abuse_reports
for select to authenticated
using (reporter_id = auth.uid());

drop policy if exists reports_insert_self on public.abuse_reports;
create policy reports_insert_self on public.abuse_reports
for insert to authenticated
with check (reporter_id = auth.uid());

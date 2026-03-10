-- 0002_creator_profile_follows.sql
-- Public creator profile visibility + follow graph for cross-user persistence.

alter table public.profiles
  add column if not exists professional_visibility text not null default 'private'
  check (professional_visibility in ('public', 'private'));

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

alter table public.user_follows enable row level security;

drop policy if exists "user_follows_select_all_authenticated" on public.user_follows;
create policy "user_follows_select_all_authenticated" on public.user_follows
for select to authenticated
using (true);

drop policy if exists "user_follows_insert_self" on public.user_follows;
create policy "user_follows_insert_self" on public.user_follows
for insert to authenticated
with check (auth.uid() = follower_id);

drop policy if exists "user_follows_delete_self" on public.user_follows;
create policy "user_follows_delete_self" on public.user_follows
for delete to authenticated
using (auth.uid() = follower_id);

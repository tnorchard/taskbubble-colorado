-- Profiles + workspace member visibility

create extension if not exists "pgcrypto";

-- Basic user profile table for displaying workspace members.
-- NOTE: do not store secrets; keep it minimal.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Auto-update updated_at
drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- Create profile row on new user
create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.handle_new_user_profile();

-- Backfill profiles for existing users
insert into public.profiles (id, email)
select u.id, u.email
from auth.users u
on conflict (id) do nothing;

-- RLS
alter table public.profiles enable row level security;

-- A user can see profiles of people in any of the same workspaces
drop policy if exists "profiles_select_workspace_peer" on public.profiles;
create policy "profiles_select_workspace_peer"
on public.profiles for select
to authenticated
using (
  exists (
    select 1
    from public.workspace_members a
    join public.workspace_members b
      on a.workspace_id = b.workspace_id
    where a.user_id = auth.uid()
      and b.user_id = profiles.id
  )
);

-- A user can update their own profile
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- Allow workspace members to list other members in the same workspace
drop policy if exists "workspace_members_select_self" on public.workspace_members;
drop policy if exists "workspace_members_select_in_workspace" on public.workspace_members;
create policy "workspace_members_select_in_workspace"
on public.workspace_members for select
to authenticated
using (
  exists (
    select 1
    from public.workspace_members me
    where me.workspace_id = workspace_members.workspace_id
      and me.user_id = auth.uid()
  )
);



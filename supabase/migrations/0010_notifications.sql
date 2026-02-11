-- Notifications table for real-time alerts

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('task_assigned','task_completed','mention','member_joined','task_created')),
  title text not null,
  body text,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notif_user_idx on public.notifications(user_id, created_at desc);
create index if not exists notif_read_idx on public.notifications(user_id, read) where not read;

alter table public.notifications enable row level security;

-- Users can only see their own notifications
drop policy if exists "notif_select_own" on public.notifications;
create policy "notif_select_own"
on public.notifications for select to authenticated
using (auth.uid() = user_id);

-- Users can update (mark read) their own notifications
drop policy if exists "notif_update_own" on public.notifications;
create policy "notif_update_own"
on public.notifications for update to authenticated
using (auth.uid() = user_id);

-- Anyone authenticated can insert (system triggers will do this)
drop policy if exists "notif_insert" on public.notifications;
create policy "notif_insert"
on public.notifications for insert to authenticated
with check (true);

-- Enable realtime
alter publication supabase_realtime add table public.notifications;

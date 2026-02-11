-- Task comments / threads

create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) > 0 and char_length(body) <= 4000),
  created_at timestamptz not null default now()
);

create index if not exists task_comments_task_idx on public.task_comments(task_id, created_at);
create index if not exists task_comments_user_idx on public.task_comments(user_id);

alter table public.task_comments enable row level security;

-- Members of the workspace that owns the task can read comments
drop policy if exists "comments_select_member" on public.task_comments;
create policy "comments_select_member"
on public.task_comments for select to authenticated
using (
  exists (
    select 1 from public.tasks t
    join public.workspace_members wm on wm.workspace_id = t.workspace_id
    where t.id = task_comments.task_id
      and wm.user_id = auth.uid()
  )
);

-- Members can insert comments on tasks in their workspace
drop policy if exists "comments_insert_member" on public.task_comments;
create policy "comments_insert_member"
on public.task_comments for insert to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.tasks t
    join public.workspace_members wm on wm.workspace_id = t.workspace_id
    where t.id = task_comments.task_id
      and wm.user_id = auth.uid()
  )
);

-- Users can delete their own comments
drop policy if exists "comments_delete_own" on public.task_comments;
create policy "comments_delete_own"
on public.task_comments for delete to authenticated
using (auth.uid() = user_id);

-- Enable realtime
alter publication supabase_realtime add table public.task_comments;

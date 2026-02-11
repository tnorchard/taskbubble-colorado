-- Audit log for tracking changes

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in (
    'task_created','task_updated','task_deleted','task_completed','task_reopened',
    'task_assigned','task_unassigned',
    'member_joined','member_removed',
    'workspace_created','workspace_deleted',
    'comment_added'
  )),
  details jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_ws_idx on public.audit_log(workspace_id, created_at desc);
create index if not exists audit_log_task_idx on public.audit_log(task_id, created_at desc);
create index if not exists audit_log_actor_idx on public.audit_log(actor_id, created_at desc);

alter table public.audit_log enable row level security;

-- Workspace members can read audit log for their workspaces
drop policy if exists "audit_select_member" on public.audit_log;
create policy "audit_select_member"
on public.audit_log for select to authenticated
using (
  workspace_id is null
  or exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = audit_log.workspace_id
      and wm.user_id = auth.uid()
  )
);

-- Anyone authed can insert (frontend will log actions)
drop policy if exists "audit_insert" on public.audit_log;
create policy "audit_insert"
on public.audit_log for insert to authenticated
with check (true);

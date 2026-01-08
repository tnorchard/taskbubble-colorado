-- Workspaces + membership + workspace-scoped tasks
+
+create extension if not exists "pgcrypto";
+
+-- Workspaces
+create table if not exists public.workspaces (
+  id uuid primary key default gen_random_uuid(),
+  name text not null,
+  join_code text not null unique,
+  created_by uuid references auth.users(id) on delete set null,
+  created_at timestamptz not null default now()
+);
+
+-- Workspace membership
+create table if not exists public.workspace_members (
+  workspace_id uuid not null references public.workspaces(id) on delete cascade,
+  user_id uuid not null references auth.users(id) on delete cascade,
+  role text not null default 'member' check (role in ('owner','admin','member')),
+  created_at timestamptz not null default now(),
+  primary key (workspace_id, user_id)
+);
+
+create index if not exists workspace_members_user_id_idx on public.workspace_members(user_id);
+
+-- Ensure a single shared "Home" workspace exists
+create or replace function public.ensure_home_workspace()
+returns uuid
+language plpgsql
+security definer
+as $$
+declare
+  ws_id uuid;
+begin
+  select id into ws_id
+  from public.workspaces
+  where name = 'Home'
+  limit 1;
+
+  if ws_id is null then
+    insert into public.workspaces (name, join_code, created_by)
+    values ('Home', substring(replace(gen_random_uuid()::text, '-', ''), 1, 10), null)
+    returning id into ws_id;
+  end if;
+
+  return ws_id;
+end;
+$$;
+
+-- Auto-enroll new users into Home
+create or replace function public.handle_new_user_enroll_home()
+returns trigger
+language plpgsql
+security definer
+set search_path = public
+as $$
+declare
+  home_id uuid;
+begin
+  home_id := public.ensure_home_workspace();
+
+  insert into public.workspace_members (workspace_id, user_id, role)
+  values (home_id, new.id, 'member')
+  on conflict do nothing;
+
+  return new;
+end;
+$$;
+
+drop trigger if exists on_auth_user_created_enroll_home on auth.users;
+create trigger on_auth_user_created_enroll_home
+after insert on auth.users
+for each row execute function public.handle_new_user_enroll_home();
+
+-- Update tasks to be workspace-scoped
+alter table public.tasks
+  add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
+
+create index if not exists tasks_workspace_id_idx on public.tasks(workspace_id);
+
+-- Backfill existing tasks into Home (for local/dev environments)
+do $$
+declare
+  home_id uuid;
+begin
+  home_id := public.ensure_home_workspace();
+  update public.tasks set workspace_id = home_id where workspace_id is null;
+end $$;
+
+alter table public.tasks
+  alter column workspace_id set not null;
+
+-- RLS
+alter table public.workspaces enable row level security;
+alter table public.workspace_members enable row level security;
+
+-- Workspaces: a user can see workspaces they belong to
+drop policy if exists "workspaces_select_member" on public.workspaces;
+create policy "workspaces_select_member"
+on public.workspaces for select
+to authenticated
+using (
+  exists (
+    select 1
+    from public.workspace_members wm
+    where wm.workspace_id = workspaces.id
+      and wm.user_id = auth.uid()
+  )
+);
+
+-- Workspaces: any authed user can create a workspace
+drop policy if exists "workspaces_insert_authed" on public.workspaces;
+create policy "workspaces_insert_authed"
+on public.workspaces for insert
+to authenticated
+with check (true);
+
+-- Workspace members: user can see their memberships
+drop policy if exists "workspace_members_select_self" on public.workspace_members;
+create policy "workspace_members_select_self"
+on public.workspace_members for select
+to authenticated
+using (user_id = auth.uid());
+
+-- Workspace members: user can join a workspace (insert self)
+drop policy if exists "workspace_members_insert_self" on public.workspace_members;
+create policy "workspace_members_insert_self"
+on public.workspace_members for insert
+to authenticated
+with check (user_id = auth.uid());
+
+-- Tasks RLS (replace prior read policy to scope by workspace membership)
+drop policy if exists "tasks_read_all_authed" on public.tasks;
+drop policy if exists "tasks_read_workspace_member" on public.tasks;
+create policy "tasks_read_workspace_member"
+on public.tasks for select
+to authenticated
+using (
+  deleted_at is null
+  and exists (
+    select 1
+    from public.workspace_members wm
+    where wm.workspace_id = tasks.workspace_id
+      and wm.user_id = auth.uid()
+  )
+);
+
+-- Tasks insert: must be member of workspace and creator matches
+drop policy if exists "tasks_insert_own" on public.tasks;
+drop policy if exists "tasks_insert_member" on public.tasks;
+create policy "tasks_insert_member"
+on public.tasks for insert
+to authenticated
+with check (
+  auth.uid() = created_by
+  and exists (
+    select 1
+    from public.workspace_members wm
+    where wm.workspace_id = tasks.workspace_id
+      and wm.user_id = auth.uid()
+  )
+);
+
+-- Tasks update/delete: creator only (and still must be member)
+drop policy if exists "tasks_update_own" on public.tasks;
+create policy "tasks_update_own"
+on public.tasks for update
+to authenticated
+using (
+  auth.uid() = created_by
+  and exists (
+    select 1
+    from public.workspace_members wm
+    where wm.workspace_id = tasks.workspace_id
+      and wm.user_id = auth.uid()
+  )
+)
+with check (
+  auth.uid() = created_by
+  and exists (
+    select 1
+    from public.workspace_members wm
+    where wm.workspace_id = tasks.workspace_id
+      and wm.user_id = auth.uid()
+  )
+);
+
+drop policy if exists "tasks_delete_own" on public.tasks;
+create policy "tasks_delete_own"
+on public.tasks for delete
+to authenticated
+using (
+  auth.uid() = created_by
+  and exists (
+    select 1
+    from public.workspace_members wm
+    where wm.workspace_id = tasks.workspace_id
+      and wm.user_id = auth.uid()
+  )
+);
+
+-- Update the computed view to include workspace_id filtering via base table RLS
+create or replace view public.tasks_with_age as
+select
+  t.*,
+  extract(epoch from (now() - t.created_at)) / 3600.0 as age_hours
+from public.tasks t
+where t.deleted_at is null;
+
+-- Helper RPC: create a workspace and add the current user as owner
+create or replace function public.create_workspace(p_name text)
+returns public.workspaces
+language plpgsql
+security definer
+set search_path = public
+as $$
+declare
+  ws public.workspaces;
+begin
+  insert into public.workspaces (name, join_code, created_by)
+  values (p_name, substring(replace(gen_random_uuid()::text, '-', ''), 1, 10), auth.uid())
+  returning * into ws;
+
+  insert into public.workspace_members (workspace_id, user_id, role)
+  values (ws.id, auth.uid(), 'owner')
+  on conflict do nothing;
+
+  return ws;
+end;
+$$;
+
+-- Helper RPC: join a workspace by join code
+create or replace function public.join_workspace_by_code(p_join_code text)
+returns public.workspaces
+language plpgsql
+security definer
+set search_path = public
+as $$
+declare
+  ws public.workspaces;
+begin
+  select * into ws
+  from public.workspaces
+  where join_code = p_join_code
+  limit 1;
+
+  if ws.id is null then
+    raise exception 'Workspace not found';
+  end if;
+
+  insert into public.workspace_members (workspace_id, user_id, role)
+  values (ws.id, auth.uid(), 'member')
+  on conflict do nothing;
+
+  return ws;
+end;
+$$;
+
+-- RLS for helper RPCs: allow authenticated users to execute
+revoke all on function public.create_workspace(text) from public;
+grant execute on function public.create_workspace(text) to authenticated;
+
+revoke all on function public.join_workspace_by_code(text) from public;
+grant execute on function public.join_workspace_by_code(text) to authenticated;
+
+-- Avoid direct inserts into workspaces without membership; keep insert policy but rely on RPC in the app.
+-- (You can tighten later by removing workspaces_insert_authed if desired.)
+

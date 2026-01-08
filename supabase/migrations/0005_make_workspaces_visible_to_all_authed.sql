-- Allow all authenticated users to view all workspaces and their members (as requested).
-- WARNING: This exposes workspace existence and membership across the app.

-- Workspaces: readable by any authenticated user
drop policy if exists "workspaces_select_member" on public.workspaces;
drop policy if exists "workspaces_select_all_authed" on public.workspaces;
create policy "workspaces_select_all_authed"
on public.workspaces for select
to authenticated
using (true);

-- Workspace members: readable by any authenticated user
drop policy if exists "workspace_members_select_in_workspace" on public.workspace_members;
drop policy if exists "workspace_members_select_all_authed" on public.workspace_members;
create policy "workspace_members_select_all_authed"
on public.workspace_members for select
to authenticated
using (true);

-- Profiles: readable by any authenticated user (so names can be shown)
drop policy if exists "profiles_select_workspace_peer" on public.profiles;
drop policy if exists "profiles_select_all_authed" on public.profiles;
create policy "profiles_select_all_authed"
on public.profiles for select
to authenticated
using (true);



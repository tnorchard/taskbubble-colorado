-- Fix RLS recursion on workspace_members by using a SECURITY DEFINER helper.

create or replace function public.is_workspace_member(p_workspace_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = p_user_id
  );
$$;

revoke all on function public.is_workspace_member(uuid, uuid) from public;
grant execute on function public.is_workspace_member(uuid, uuid) to authenticated;

-- workspace_members: allow selecting members within a workspace you belong to
drop policy if exists "workspace_members_select_in_workspace" on public.workspace_members;
drop policy if exists "workspace_members_select_self" on public.workspace_members;
create policy "workspace_members_select_in_workspace"
on public.workspace_members for select
to authenticated
using (public.is_workspace_member(workspace_members.workspace_id, auth.uid()));

-- workspaces: simplify to avoid nested subqueries that touch workspace_members
drop policy if exists "workspaces_select_member" on public.workspaces;
create policy "workspaces_select_member"
on public.workspaces for select
to authenticated
using (public.is_workspace_member(workspaces.id, auth.uid()));

-- tasks: use helper for membership checks (avoids reliance on workspace_members RLS in subqueries)
drop policy if exists "tasks_read_workspace_member" on public.tasks;
create policy "tasks_read_workspace_member"
on public.tasks for select
to authenticated
using (deleted_at is null and public.is_workspace_member(tasks.workspace_id, auth.uid()));

drop policy if exists "tasks_insert_member" on public.tasks;
create policy "tasks_insert_member"
on public.tasks for insert
to authenticated
with check (auth.uid() = created_by and public.is_workspace_member(tasks.workspace_id, auth.uid()));

drop policy if exists "tasks_update_own" on public.tasks;
create policy "tasks_update_own"
on public.tasks for update
to authenticated
using (auth.uid() = created_by and public.is_workspace_member(tasks.workspace_id, auth.uid()))
with check (auth.uid() = created_by and public.is_workspace_member(tasks.workspace_id, auth.uid()));

drop policy if exists "tasks_delete_own" on public.tasks;
create policy "tasks_delete_own"
on public.tasks for delete
to authenticated
using (auth.uid() = created_by and public.is_workspace_member(tasks.workspace_id, auth.uid()));



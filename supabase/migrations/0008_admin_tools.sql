-- Admin tools (hard-coded admin email)
-- Provides admin-only RPCs to list/delete users and delete workspaces.

create extension if not exists "pgcrypto";

-- Helper: treat one email as the admin account.
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select
    lower(
      coalesce(
        auth.jwt() ->> 'email',
        (select email from public.profiles where id = auth.uid())
      )
    ) = 'dexter.norales@gmail.com';
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- List users (admin-only). Pulls from auth.users and profiles.
create or replace function public.admin_list_users()
returns table (
  id uuid,
  email text,
  display_name text,
  created_at timestamptz,
  last_sign_in_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  return query
  select
    u.id::uuid as id,
    u.email::text as email,
    p.display_name::text as display_name,
    u.created_at::timestamptz as created_at,
    u.last_sign_in_at::timestamptz as last_sign_in_at
  from auth.users u
  left join public.profiles p on p.id = u.id
  order by u.created_at desc;
end;
$$;

revoke all on function public.admin_list_users() from public;
grant execute on function public.admin_list_users() to authenticated;

-- List workspaces (admin-only) with member counts.
create or replace function public.admin_list_workspaces()
returns table (
  id uuid,
  name text,
  join_code text,
  created_by uuid,
  created_at timestamptz,
  member_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  return query
  select
    w.id,
    w.name,
    w.join_code,
    w.created_by,
    w.created_at,
    (select count(*) from public.workspace_members wm where wm.workspace_id = w.id) as member_count
  from public.workspaces w
  order by w.created_at desc;
end;
$$;

revoke all on function public.admin_list_workspaces() from public;
grant execute on function public.admin_list_workspaces() to authenticated;

-- Delete a workspace (admin-only). Protects the system "Home" workspace.
create or replace function public.admin_delete_workspace(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ws_name text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  select name into ws_name from public.workspaces where id = p_workspace_id;
  if ws_name is null then
    raise exception 'Workspace not found';
  end if;

  if ws_name = 'Home' then
    raise exception 'Refusing to delete Home workspace';
  end if;

  delete from public.workspaces where id = p_workspace_id;
end;
$$;

revoke all on function public.admin_delete_workspace(uuid) from public;
grant execute on function public.admin_delete_workspace(uuid) to authenticated;

-- Delete a user (admin-only). Deletes the auth user, cascading to public tables.
create or replace function public.admin_delete_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'Refusing to delete current admin session';
  end if;

  -- Deleting auth.users cascades to:
  -- - public.profiles (id -> auth.users)
  -- - public.workspace_members (user_id -> auth.users)
  -- - public.tasks (created_by -> auth.users)
  delete from auth.users where id = p_user_id;

  if not found then
    raise exception 'User not found';
  end if;
end;
$$;

revoke all on function public.admin_delete_user(uuid) from public;
grant execute on function public.admin_delete_user(uuid) to authenticated;


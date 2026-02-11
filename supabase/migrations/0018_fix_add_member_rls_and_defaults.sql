-- 1. RPC to add a member to a workspace (admins/owners only)
--    Uses SECURITY DEFINER to bypass RLS, but checks role internally.
create or replace function public.add_workspace_member(
  p_workspace_id uuid,
  p_user_id uuid,
  p_role text default 'member'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
begin
  -- Check the caller is an owner or admin of the workspace
  select role into caller_role
  from public.workspace_members
  where workspace_id = p_workspace_id
    and user_id = auth.uid();

  if caller_role is null then
    raise exception 'You are not a member of this workspace';
  end if;

  if caller_role not in ('owner', 'admin') then
    raise exception 'Only owners and admins can add members';
  end if;

  -- Validate role
  if p_role not in ('owner', 'admin', 'member') then
    raise exception 'Invalid role: %', p_role;
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (p_workspace_id, p_user_id, p_role)
  on conflict (workspace_id, user_id) do nothing;
end;
$$;

revoke all on function public.add_workspace_member(uuid, uuid, text) from public;
grant execute on function public.add_workspace_member(uuid, uuid, text) to authenticated;

-- 2. Assign unique default colors to users who don't have one.
--    Uses a deterministic palette based on the user's position in the table.
do $$
declare
  palette text[] := array[
    '#64b5ff', '#a885ff', '#ff85a1', '#ffb385',
    '#85ff9e', '#85fff3', '#ffeb85', '#ff85f3',
    '#ef4444', '#f97316', '#eab308', '#22c55e',
    '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
    '#f43f5e', '#d946ef', '#14b8a6', '#84cc16',
    '#6366f1', '#0ea5e9', '#f59e0b', '#10b981'
  ];
  r record;
  idx int := 0;
begin
  for r in
    select id from public.profiles
    where user_color is null or user_color = '#64b5ff'
    order by created_at
  loop
    update public.profiles
    set user_color = palette[(idx % array_length(palette, 1)) + 1]
    where id = r.id;
    idx := idx + 1;
  end loop;
end $$;

-- 3. Update the trigger that creates profiles for new users to assign a unique color
create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  palette text[] := array[
    '#64b5ff', '#a885ff', '#ff85a1', '#ffb385',
    '#85ff9e', '#85fff3', '#ffeb85', '#ff85f3',
    '#ef4444', '#f97316', '#eab308', '#22c55e',
    '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
    '#f43f5e', '#d946ef', '#14b8a6', '#84cc16',
    '#6366f1', '#0ea5e9', '#f59e0b', '#10b981'
  ];
  user_count int;
  chosen_color text;
begin
  select count(*) into user_count from public.profiles;
  chosen_color := palette[(user_count % array_length(palette, 1)) + 1];

  insert into public.profiles (id, email, display_name, user_color)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'full_name', null),
    chosen_color
  )
  on conflict (id) do update set
    email = excluded.email,
    display_name = coalesce(excluded.display_name, profiles.display_name);
  return new;
end;
$$;

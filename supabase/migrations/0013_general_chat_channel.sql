-- Allow general chat messages (workspace_id = NULL)

-- Make workspace_id nullable
alter table public.chat_messages alter column workspace_id drop not null;

-- Drop the foreign key constraint and re-add it to allow NULL
-- (NULL values are allowed by foreign keys by default when column is nullable)

-- Update RLS policies to allow general chat (workspace_id IS NULL = visible to all authenticated)
drop policy if exists "chat_select_member" on public.chat_messages;
create policy "chat_select_member"
on public.chat_messages for select
to authenticated
using (
  workspace_id is null  -- General channel: visible to all
  or exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = chat_messages.workspace_id
      and wm.user_id = auth.uid()
  )
);

drop policy if exists "chat_insert_member" on public.chat_messages;
create policy "chat_insert_member"
on public.chat_messages for insert
to authenticated
with check (
  auth.uid() = user_id
  and (
    workspace_id is null  -- General channel: any authenticated user
    or exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = chat_messages.workspace_id
        and wm.user_id = auth.uid()
    )
  )
);

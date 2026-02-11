-- Chat messages table for team communication

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) > 0 and char_length(body) <= 4000),
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_workspace_idx on public.chat_messages(workspace_id, created_at desc);
create index if not exists chat_messages_user_idx on public.chat_messages(user_id);

-- RLS
alter table public.chat_messages enable row level security;

-- Read: workspace members can read messages in their workspace
drop policy if exists "chat_select_member" on public.chat_messages;
create policy "chat_select_member"
on public.chat_messages for select
to authenticated
using (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = chat_messages.workspace_id
      and wm.user_id = auth.uid()
  )
);

-- Insert: workspace members can send messages
drop policy if exists "chat_insert_member" on public.chat_messages;
create policy "chat_insert_member"
on public.chat_messages for insert
to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = chat_messages.workspace_id
      and wm.user_id = auth.uid()
  )
);

-- Delete: only the message author can delete their own message
drop policy if exists "chat_delete_own" on public.chat_messages;
create policy "chat_delete_own"
on public.chat_messages for delete
to authenticated
using (auth.uid() = user_id);

-- Enable realtime for chat_messages
alter publication supabase_realtime add table public.chat_messages;

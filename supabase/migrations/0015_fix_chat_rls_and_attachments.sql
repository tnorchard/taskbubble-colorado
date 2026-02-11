-- Fix chat RLS to use the SECURITY DEFINER helper (avoids recursion)
-- AND add attachment support columns

-- 1. Fix RLS policies using is_workspace_member helper
drop policy if exists "chat_select_member" on public.chat_messages;
create policy "chat_select_member"
on public.chat_messages for select
to authenticated
using (
  workspace_id is null
  or public.is_workspace_member(chat_messages.workspace_id, auth.uid())
);

drop policy if exists "chat_insert_member" on public.chat_messages;
create policy "chat_insert_member"
on public.chat_messages for insert
to authenticated
with check (
  auth.uid() = user_id
  and (
    workspace_id is null
    or public.is_workspace_member(chat_messages.workspace_id, auth.uid())
  )
);

drop policy if exists "chat_delete_own" on public.chat_messages;
create policy "chat_delete_own"
on public.chat_messages for delete
to authenticated
using (auth.uid() = user_id);

-- 2. Add attachment columns
alter table public.chat_messages
  add column if not exists attachment_url text,
  add column if not exists attachment_name text,
  add column if not exists attachment_type text;

-- 3. Create storage bucket for chat attachments
insert into storage.buckets (id, name, public)
values ('chat-attachments', 'chat-attachments', true)
on conflict (id) do nothing;

-- 4. Storage policies: anyone authenticated can upload; public read
drop policy if exists "chat_attachments_upload" on storage.objects;
create policy "chat_attachments_upload"
on storage.objects for insert
to authenticated
with check (bucket_id = 'chat-attachments');

drop policy if exists "chat_attachments_read" on storage.objects;
create policy "chat_attachments_read"
on storage.objects for select
to public
using (bucket_id = 'chat-attachments');

drop policy if exists "chat_attachments_delete_own" on storage.objects;
create policy "chat_attachments_delete_own"
on storage.objects for delete
to authenticated
using (bucket_id = 'chat-attachments' and (storage.foldername(name))[1] = auth.uid()::text);

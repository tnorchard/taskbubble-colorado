-- 1. Add public/private visibility to calendar notes
alter table public.calendar_notes
  add column if not exists is_public boolean not null default false;

-- Update RLS: users can see their own notes + any public notes
drop policy if exists "cal_notes_select_own" on public.calendar_notes;
create policy "cal_notes_select_own_and_public"
on public.calendar_notes for select
to authenticated
using (auth.uid() = user_id or is_public = true);

-- Insert/update/delete stay own-only (unchanged names, recreate to be safe)
drop policy if exists "cal_notes_insert_own" on public.calendar_notes;
create policy "cal_notes_insert_own"
on public.calendar_notes for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "cal_notes_update_own" on public.calendar_notes;
create policy "cal_notes_update_own"
on public.calendar_notes for update
to authenticated
using (auth.uid() = user_id);

drop policy if exists "cal_notes_delete_own" on public.calendar_notes;
create policy "cal_notes_delete_own"
on public.calendar_notes for delete
to authenticated
using (auth.uid() = user_id);

-- 2. Add user_color column to profiles
alter table public.profiles
  add column if not exists user_color text default '#64b5ff';

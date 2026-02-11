-- Calendar notes / events per user per day

create table if not exists public.calendar_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  note_date date not null,
  title text not null check (char_length(title) > 0 and char_length(title) <= 200),
  body text default '' check (char_length(body) <= 2000),
  color text default 'blue' check (color in ('blue','green','orange','red','purple','pink')),
  created_at timestamptz not null default now()
);

create index if not exists calendar_notes_user_date_idx
  on public.calendar_notes(user_id, note_date);

-- RLS
alter table public.calendar_notes enable row level security;

-- Users can see only their own notes
drop policy if exists "cal_notes_select_own" on public.calendar_notes;
create policy "cal_notes_select_own"
on public.calendar_notes for select
to authenticated
using (auth.uid() = user_id);

-- Users can insert their own notes
drop policy if exists "cal_notes_insert_own" on public.calendar_notes;
create policy "cal_notes_insert_own"
on public.calendar_notes for insert
to authenticated
with check (auth.uid() = user_id);

-- Users can update their own notes
drop policy if exists "cal_notes_update_own" on public.calendar_notes;
create policy "cal_notes_update_own"
on public.calendar_notes for update
to authenticated
using (auth.uid() = user_id);

-- Users can delete their own notes
drop policy if exists "cal_notes_delete_own" on public.calendar_notes;
create policy "cal_notes_delete_own"
on public.calendar_notes for delete
to authenticated
using (auth.uid() = user_id);

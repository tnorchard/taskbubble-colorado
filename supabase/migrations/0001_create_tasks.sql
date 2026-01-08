-- TaskBubble initial schema
+
+create extension if not exists "pgcrypto";
+
+create table if not exists public.tasks (
+  id uuid primary key default gen_random_uuid(),
+  title text not null,
+  description text not null,
+  due_date date not null,
+
+  status text not null default 'open' check (status in ('open','in_progress','done','archived')),
+
+  created_by uuid not null references auth.users(id) on delete cascade,
+  created_at timestamptz not null default now(),
+  updated_at timestamptz not null default now(),
+  deleted_at timestamptz
+);
+
+create index if not exists tasks_due_date_idx on public.tasks(due_date);
+create index if not exists tasks_created_by_idx on public.tasks(created_by);
+create index if not exists tasks_status_idx on public.tasks(status);
+
+-- Auto-update updated_at
+create or replace function public.set_updated_at()
+returns trigger language plpgsql as $$
+begin
+  new.updated_at = now();
+  return new;
+end;
+$$;
+
+drop trigger if exists set_tasks_updated_at on public.tasks;
+create trigger set_tasks_updated_at
+before update on public.tasks
+for each row execute function public.set_updated_at();
+
+-- Enable RLS
+alter table public.tasks enable row level security;
+
+-- Policies (MVP)
+-- Read: any authenticated user can read all tasks
+drop policy if exists "tasks_read_all_authed" on public.tasks;
+create policy "tasks_read_all_authed"
+on public.tasks for select
+to authenticated
+using (deleted_at is null);
+
+-- Insert: any authenticated user can create tasks as themselves
+drop policy if exists "tasks_insert_own" on public.tasks;
+create policy "tasks_insert_own"
+on public.tasks for insert
+to authenticated
+with check (auth.uid() = created_by);
+
+-- Update/Delete: only creator can update/delete their tasks
+drop policy if exists "tasks_update_own" on public.tasks;
+create policy "tasks_update_own"
+on public.tasks for update
+to authenticated
+using (auth.uid() = created_by)
+with check (auth.uid() = created_by);
+
+drop policy if exists "tasks_delete_own" on public.tasks;
+create policy "tasks_delete_own"
+on public.tasks for delete
+to authenticated
+using (auth.uid() = created_by);
+
+-- Optional: computed view for age_hours
+create or replace view public.tasks_with_age as
+select
+  t.*,
+  extract(epoch from (now() - t.created_at)) / 3600.0 as age_hours
+from public.tasks t
+where t.deleted_at is null;
+

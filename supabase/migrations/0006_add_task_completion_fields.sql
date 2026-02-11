-- Add completion tracking fields to tasks

alter table public.tasks
add column if not exists completed_at timestamptz,
add column if not exists completed_by uuid references auth.users(id);

-- Refresh the tasks_with_age view to include the new fields
drop view if exists public.tasks_with_age;
create or replace view public.tasks_with_age as
select
  t.*,
  extract(epoch from (now() - t.created_at)) / 3600.0 as age_hours
from public.tasks t
where t.deleted_at is null;



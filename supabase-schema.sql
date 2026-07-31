-- Run once in the existing Supabase project's SQL Editor.
-- Taskroom uses a unique table name and stores one private workspace per user.

create table if not exists public.taskroom_workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{"tasks":[],"selectedId":null,"logs":[],"docs":[]}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint taskroom_workspace_data_is_object check (jsonb_typeof(data) = 'object')
);

alter table public.taskroom_workspaces enable row level security;
revoke all on table public.taskroom_workspaces from anon;
grant select, insert, update, delete on table public.taskroom_workspaces to authenticated;

drop policy if exists "taskroom_select_own" on public.taskroom_workspaces;
create policy "taskroom_select_own"
  on public.taskroom_workspaces for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "taskroom_insert_own" on public.taskroom_workspaces;
create policy "taskroom_insert_own"
  on public.taskroom_workspaces for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "taskroom_update_own" on public.taskroom_workspaces;
create policy "taskroom_update_own"
  on public.taskroom_workspaces for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "taskroom_delete_own" on public.taskroom_workspaces;
create policy "taskroom_delete_own"
  on public.taskroom_workspaces for delete to authenticated
  using ((select auth.uid()) = user_id);

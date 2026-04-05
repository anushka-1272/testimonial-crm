-- RLS + Realtime for interviews board and dispatch creation from the dashboard.

alter table public.interviews enable row level security;

drop policy if exists "interviews_select_dashboard" on public.interviews;
drop policy if exists "interviews_insert_dashboard" on public.interviews;
drop policy if exists "interviews_update_dashboard" on public.interviews;

create policy "interviews_select_dashboard"
  on public.interviews
  for select
  to anon, authenticated
  using (true);

create policy "interviews_insert_dashboard"
  on public.interviews
  for insert
  to anon, authenticated
  with check (true);

create policy "interviews_update_dashboard"
  on public.interviews
  for update
  to anon, authenticated
  using (true)
  with check (true);

alter table public.dispatch enable row level security;

drop policy if exists "dispatch_select_dashboard" on public.dispatch;
drop policy if exists "dispatch_insert_dashboard" on public.dispatch;
drop policy if exists "dispatch_update_dashboard" on public.dispatch;

create policy "dispatch_select_dashboard"
  on public.dispatch
  for select
  to anon, authenticated
  using (true);

create policy "dispatch_insert_dashboard"
  on public.dispatch
  for insert
  to anon, authenticated
  with check (true);

create policy "dispatch_update_dashboard"
  on public.dispatch
  for update
  to anon, authenticated
  using (true)
  with check (true);

do $mig$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'interviews'
  ) then
    alter publication supabase_realtime add table public.interviews;
  end if;
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'dispatch'
  ) then
    alter publication supabase_realtime add table public.dispatch;
  end if;
end;
$mig$;

-- Eligibility dashboard: congratulation call flag, realtime, and RLS for browser clients.
-- Tighten policies in production (e.g. auth.uid() checks) — open policies are for internal/demo use.

alter table public.candidates
  add column if not exists congratulation_call_pending boolean not null default false;

comment on column public.candidates.congratulation_call_pending is
  'Set when a reviewer marks the candidate eligible; signals follow-up for a congratulation call.';

-- Realtime: add table to publication only if not already present.
do $mig$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'candidates'
  ) then
    alter publication supabase_realtime add table public.candidates;
  end if;
end;
$mig$;

alter table public.candidates enable row level security;

drop policy if exists "candidates_select_dashboard" on public.candidates;
drop policy if exists "candidates_update_dashboard" on public.candidates;

create policy "candidates_select_dashboard"
  on public.candidates
  for select
  to anon, authenticated
  using (true);

create policy "candidates_update_dashboard"
  on public.candidates
  for update
  to anon, authenticated
  using (true)
  with check (true);

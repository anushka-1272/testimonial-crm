-- Point of contact for eligible candidates (interviews board) before scheduling.

alter table public.candidates
  add column if not exists poc_assigned text,
  add column if not exists poc_assigned_at timestamptz;

comment on column public.candidates.poc_assigned is
  'Team member assigned to run the congratulation / intake call (interviews pipeline).';
comment on column public.candidates.poc_assigned_at is
  'When poc_assigned was last set; used for “calls done today” counts.';

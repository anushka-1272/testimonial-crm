-- Rescheduled tab metadata and completion timestamp for interviews tables UI.

alter table public.interviews
  add column if not exists previous_scheduled_date timestamptz,
  add column if not exists reschedule_reason text,
  add column if not exists completed_at timestamptz;

comment on column public.interviews.previous_scheduled_date is
  'Last scheduled slot before the interview was marked rescheduled.';
comment on column public.interviews.reschedule_reason is
  'Why the interview was moved (rescheduled tab).';
comment on column public.interviews.completed_at is
  'When the interview was marked completed.';

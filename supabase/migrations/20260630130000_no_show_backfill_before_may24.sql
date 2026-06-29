-- Mark stale scheduled interviews (before 24 May 2026) as no_show.

UPDATE public.interviews
SET
  interview_status = 'no_show',
  no_show_at = COALESCE(no_show_at, now())
WHERE interview_status IN ('draft', 'scheduled', 'rescheduled')
  AND scheduled_date IS NOT NULL
  AND scheduled_date < timestamptz '2026-05-24 00:00:00+00';

UPDATE public.project_interviews
SET
  interview_status = 'no_show',
  no_show_at = COALESCE(no_show_at, now())
WHERE interview_status IN ('draft', 'scheduled', 'rescheduled')
  AND scheduled_date IS NOT NULL
  AND scheduled_date < timestamptz '2026-05-24 00:00:00+00';

COMMENT ON COLUMN public.interviews.no_show_reason IS
  'Optional note when interview_status is no_show.';
COMMENT ON COLUMN public.project_interviews.no_show_reason IS
  'Optional note when interview_status is no_show.';

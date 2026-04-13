-- Eligible-tab follow-up call tracking + history log

ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS followup_status text DEFAULT 'pending';

UPDATE public.candidates
SET followup_status = 'pending'
WHERE followup_status IS NULL;

ALTER TABLE public.candidates
  ALTER COLUMN followup_status SET DEFAULT 'pending';

ALTER TABLE public.candidates
  DROP CONSTRAINT IF EXISTS candidates_followup_status_check;

ALTER TABLE public.candidates
  ADD CONSTRAINT candidates_followup_status_check
  CHECK (
    followup_status IN (
      'pending',
      'no_answer',
      'callback',
      'wrong_number',
      'not_interested',
      'scheduled',
      'interested'
    )
  );

ALTER TABLE public.candidates
  ALTER COLUMN followup_status SET NOT NULL;

ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS followup_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS callback_datetime timestamptz NULL;

ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS not_interested_reason text NULL;

ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS not_interested_at timestamptz NULL;

CREATE TABLE IF NOT EXISTS public.followup_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  candidate_id uuid NOT NULL REFERENCES public.candidates (id) ON DELETE CASCADE,
  attempt_number integer NOT NULL,
  status text NOT NULL,
  notes text,
  callback_datetime timestamptz,
  logged_by text,
  logged_by_email text
);

CREATE INDEX IF NOT EXISTS followup_log_candidate_id_idx
  ON public.followup_log (candidate_id, created_at DESC);

ALTER TABLE public.followup_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "followup_log_select_dashboard" ON public.followup_log;
DROP POLICY IF EXISTS "followup_log_insert_dashboard" ON public.followup_log;

CREATE POLICY "followup_log_select_dashboard"
  ON public.followup_log
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "followup_log_insert_dashboard"
  ON public.followup_log
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

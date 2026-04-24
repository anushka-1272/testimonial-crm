-- Project pipeline: follow-up call log + status (parity with testimonial eligible tab)

ALTER TABLE public.project_candidates
  ADD COLUMN IF NOT EXISTS followup_status text DEFAULT 'pending';

UPDATE public.project_candidates
SET followup_status = 'pending'
WHERE followup_status IS NULL;

ALTER TABLE public.project_candidates
  ALTER COLUMN followup_status SET DEFAULT 'pending';

ALTER TABLE public.project_candidates
  DROP CONSTRAINT IF EXISTS project_candidates_followup_status_check;

ALTER TABLE public.project_candidates
  ADD CONSTRAINT project_candidates_followup_status_check
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

ALTER TABLE public.project_candidates
  ALTER COLUMN followup_status SET NOT NULL;

ALTER TABLE public.project_candidates
  ADD COLUMN IF NOT EXISTS followup_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.project_candidates
  ADD COLUMN IF NOT EXISTS callback_datetime timestamptz NULL;

ALTER TABLE public.project_candidates
  ADD COLUMN IF NOT EXISTS not_interested_reason text NULL;

ALTER TABLE public.project_candidates
  ADD COLUMN IF NOT EXISTS not_interested_at timestamptz NULL;

-- followup_log: one row per attempt — either testimonial candidate or project candidate
ALTER TABLE public.followup_log
  ADD COLUMN IF NOT EXISTS project_candidate_id uuid
    REFERENCES public.project_candidates (id) ON DELETE CASCADE;

ALTER TABLE public.followup_log
  ALTER COLUMN candidate_id DROP NOT NULL;

ALTER TABLE public.followup_log
  DROP CONSTRAINT IF EXISTS followup_log_target_check;

ALTER TABLE public.followup_log
  ADD CONSTRAINT followup_log_target_check
  CHECK (
    (candidate_id IS NOT NULL AND project_candidate_id IS NULL)
    OR (candidate_id IS NULL AND project_candidate_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS followup_log_project_candidate_id_idx
  ON public.followup_log (project_candidate_id, created_at DESC);

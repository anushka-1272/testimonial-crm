-- Allow follow-up outcome / status "already_completed" (interview done; log only)

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
      'interested',
      'already_completed'
    )
  );

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
      'interested',
      'already_completed'
    )
  );

-- Physical interview track (replaces LinkedIn track on testimonial + project pipelines)

ALTER TABLE public.candidates
  RENAME COLUMN linkedin_track TO physical_interview_track;

ALTER TABLE public.candidates
  RENAME COLUMN linkedin_track_status TO physical_interview_status;

ALTER TABLE public.candidates
  DROP CONSTRAINT IF EXISTS candidates_linkedin_track_status_check;

UPDATE public.candidates
SET physical_interview_status = CASE physical_interview_status
  WHEN 'pending_post' THEN 'pending'
  WHEN 'posted' THEN 'completed'
  WHEN 'verified' THEN 'completed'
  ELSE physical_interview_status
END
WHERE physical_interview_status IN ('pending_post', 'posted', 'verified');

ALTER TABLE public.candidates
  ALTER COLUMN physical_interview_status SET DEFAULT 'pending';

ALTER TABLE public.candidates
  ADD CONSTRAINT candidates_physical_interview_status_check
  CHECK (
    physical_interview_status IN (
      'pending',
      'completed',
      'eligible',
      'not_eligible'
    )
  );

COMMENT ON COLUMN public.candidates.physical_interview_track IS
  'When true, candidate is routed to in-person interview workflow instead of Zoom scheduling.';

COMMENT ON COLUMN public.candidates.physical_interview_status IS
  'Physical interview track: pending → completed → eligible (reward dispatch) or not_eligible.';

ALTER TABLE public.project_candidates
  ADD COLUMN IF NOT EXISTS physical_interview_track boolean NOT NULL DEFAULT false;

ALTER TABLE public.project_candidates
  ADD COLUMN IF NOT EXISTS physical_interview_status text NOT NULL DEFAULT 'pending';

ALTER TABLE public.project_candidates
  DROP CONSTRAINT IF EXISTS project_candidates_physical_interview_status_check;

ALTER TABLE public.project_candidates
  ADD CONSTRAINT project_candidates_physical_interview_status_check
  CHECK (
    physical_interview_status IN (
      'pending',
      'completed',
      'eligible',
      'not_eligible'
    )
  );

COMMENT ON COLUMN public.project_candidates.physical_interview_track IS
  'When true, project candidate is routed to in-person interview workflow instead of Zoom scheduling.';

COMMENT ON COLUMN public.project_candidates.physical_interview_status IS
  'Physical interview track: pending → completed → eligible (reward dispatch) or not_eligible.';

-- LinkedIn testimonial track (parallel to interview scheduling on eligible tab)

ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS linkedin_track boolean NOT NULL DEFAULT false;

ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS linkedin_track_status text NOT NULL DEFAULT 'pending_post';

ALTER TABLE public.candidates
  DROP CONSTRAINT IF EXISTS candidates_linkedin_track_status_check;

ALTER TABLE public.candidates
  ADD CONSTRAINT candidates_linkedin_track_status_check
  CHECK (
    linkedin_track_status IN (
      'pending_post',
      'posted',
      'verified',
      'eligible',
      'not_eligible'
    )
  );

COMMENT ON COLUMN public.candidates.linkedin_track IS
  'When true, candidate is routed to LinkedIn posting workflow instead of interview scheduling.';

COMMENT ON COLUMN public.candidates.linkedin_track_status IS
  'Pipeline state for LinkedIn track: pending_post, posted, verified, eligible (JBL dispatch), not_eligible.';

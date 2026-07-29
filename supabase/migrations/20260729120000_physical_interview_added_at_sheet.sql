-- When POC moved candidate to physical interview + Google Sheet tracking flag

ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS physical_interview_added_at timestamptz;

ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS physical_interview_sheet_updated boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.candidates.physical_interview_added_at IS
  'When the candidate was moved to the physical interview track by a POC.';

COMMENT ON COLUMN public.candidates.physical_interview_sheet_updated IS
  'POC has updated this entry in the physical interview Google Sheet.';

ALTER TABLE public.project_candidates
  ADD COLUMN IF NOT EXISTS physical_interview_added_at timestamptz;

ALTER TABLE public.project_candidates
  ADD COLUMN IF NOT EXISTS physical_interview_sheet_updated boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.project_candidates.physical_interview_added_at IS
  'When the project candidate was moved to the physical interview track by a POC.';

COMMENT ON COLUMN public.project_candidates.physical_interview_sheet_updated IS
  'POC has updated this entry in the physical interview Google Sheet.';

UPDATE public.candidates
SET physical_interview_added_at = COALESCE(
  assigned_at,
  poc_assigned_at,
  created_at,
  now()
)
WHERE physical_interview_track = true
  AND physical_interview_added_at IS NULL;

UPDATE public.project_candidates
SET physical_interview_added_at = COALESCE(
  assigned_at,
  poc_assigned_at,
  created_at,
  now()
)
WHERE physical_interview_track = true
  AND physical_interview_added_at IS NULL;

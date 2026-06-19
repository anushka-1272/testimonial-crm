-- City for in-person physical interview track (Delhi or Bengaluru)

ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS physical_interview_city text;

ALTER TABLE public.candidates
  DROP CONSTRAINT IF EXISTS candidates_physical_interview_city_check;

ALTER TABLE public.candidates
  ADD CONSTRAINT candidates_physical_interview_city_check
  CHECK (
    physical_interview_city IS NULL
    OR physical_interview_city IN ('Delhi', 'Bengaluru')
  );

COMMENT ON COLUMN public.candidates.physical_interview_city IS
  'Interview city when candidate is on physical interview track (Delhi or Bengaluru).';

ALTER TABLE public.project_candidates
  ADD COLUMN IF NOT EXISTS physical_interview_city text;

ALTER TABLE public.project_candidates
  DROP CONSTRAINT IF EXISTS project_candidates_physical_interview_city_check;

ALTER TABLE public.project_candidates
  ADD CONSTRAINT project_candidates_physical_interview_city_check
  CHECK (
    physical_interview_city IS NULL
    OR physical_interview_city IN ('Delhi', 'Bengaluru')
  );

COMMENT ON COLUMN public.project_candidates.physical_interview_city IS
  'Interview city when project candidate is on physical interview track (Delhi or Bengaluru).';

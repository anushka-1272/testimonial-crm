-- GWC Testing: support project pipeline entries (Project Interviews pending → G)

ALTER TABLE public.gwc_testing
  ALTER COLUMN candidate_id DROP NOT NULL;

ALTER TABLE public.gwc_testing
  ADD COLUMN IF NOT EXISTS project_candidate_id uuid
  REFERENCES public.project_candidates (id) ON DELETE CASCADE;

ALTER TABLE public.gwc_testing
  DROP CONSTRAINT IF EXISTS gwc_testing_candidate_id_key;

ALTER TABLE public.gwc_testing
  DROP CONSTRAINT IF EXISTS gwc_testing_one_subject_check;

ALTER TABLE public.gwc_testing
  ADD CONSTRAINT gwc_testing_one_subject_check
  CHECK (
    (candidate_id IS NOT NULL AND project_candidate_id IS NULL)
    OR (candidate_id IS NULL AND project_candidate_id IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS gwc_testing_candidate_id_unique
  ON public.gwc_testing (candidate_id)
  WHERE candidate_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gwc_testing_project_candidate_id_unique
  ON public.gwc_testing (project_candidate_id)
  WHERE project_candidate_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gwc_testing_project_candidate_id_idx
  ON public.gwc_testing (project_candidate_id)
  WHERE project_candidate_id IS NOT NULL;

COMMENT ON COLUMN public.gwc_testing.project_candidate_id IS
  'Set when routed from Project Interviews pending (G); mutually exclusive with candidate_id.';

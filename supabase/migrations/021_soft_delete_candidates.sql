-- Soft delete for testimonial and project candidates (no hard delete from dashboard).

ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS is_deleted boolean DEFAULT false;
ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS deleted_by text;

UPDATE public.candidates
SET is_deleted = coalesce(is_deleted, false)
WHERE is_deleted IS NULL;

ALTER TABLE public.candidates
  ALTER COLUMN is_deleted SET DEFAULT false;

ALTER TABLE public.project_candidates
  ADD COLUMN IF NOT EXISTS is_deleted boolean DEFAULT false;
ALTER TABLE public.project_candidates
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.project_candidates
  ADD COLUMN IF NOT EXISTS deleted_by text;

UPDATE public.project_candidates
SET is_deleted = coalesce(is_deleted, false)
WHERE is_deleted IS NULL;

ALTER TABLE public.project_candidates
  ALTER COLUMN is_deleted SET DEFAULT false;

CREATE INDEX IF NOT EXISTS candidates_is_deleted_idx
  ON public.candidates (is_deleted)
  WHERE is_deleted = true;

CREATE INDEX IF NOT EXISTS project_candidates_is_deleted_idx
  ON public.project_candidates (is_deleted)
  WHERE is_deleted = true;

-- Hard delete policies are no longer used (soft delete only).
DROP POLICY IF EXISTS "candidates_delete_dashboard" ON public.candidates;
DROP POLICY IF EXISTS "project_candidates_delete" ON public.project_candidates;

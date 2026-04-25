-- Track latest POC assignment timestamp explicitly for dashboard accountability.

ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz;

ALTER TABLE public.project_candidates
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz;

-- Backfill from legacy poc_assigned_at where present.
UPDATE public.candidates
SET assigned_at = poc_assigned_at
WHERE assigned_at IS NULL
  AND poc_assigned_at IS NOT NULL;

UPDATE public.project_candidates
SET assigned_at = poc_assigned_at
WHERE assigned_at IS NULL
  AND poc_assigned_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_assigned_at_with_poc()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.poc_assigned IS DISTINCT FROM OLD.poc_assigned THEN
    NEW.assigned_at :=
      CASE
        WHEN NEW.poc_assigned IS NULL OR btrim(NEW.poc_assigned) = '' THEN NULL
        WHEN NEW.poc_assigned_at IS NOT NULL THEN NEW.poc_assigned_at
        ELSE NOW()
      END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_candidates_sync_assigned_at ON public.candidates;
CREATE TRIGGER trg_candidates_sync_assigned_at
BEFORE INSERT OR UPDATE OF poc_assigned, poc_assigned_at
ON public.candidates
FOR EACH ROW
EXECUTE FUNCTION public.sync_assigned_at_with_poc();

DROP TRIGGER IF EXISTS trg_project_candidates_sync_assigned_at ON public.project_candidates;
CREATE TRIGGER trg_project_candidates_sync_assigned_at
BEFORE INSERT OR UPDATE OF poc_assigned, poc_assigned_at
ON public.project_candidates
FOR EACH ROW
EXECUTE FUNCTION public.sync_assigned_at_with_poc();

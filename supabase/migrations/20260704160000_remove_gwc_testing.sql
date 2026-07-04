-- Remove GWC Testing: migrate entries back to testimonial/project pipelines, then drop GWC tables.

-- ---------------------------------------------------------------------------
-- 1. Incomplete testimonial-origin → eligible queue, unassigned POC
-- ---------------------------------------------------------------------------
UPDATE public.candidates c
SET
  interview_type = 'testimonial',
  poc_assigned = NULL,
  poc_assigned_at = NULL,
  assigned_at = NULL
WHERE c.id IN (
  SELECT g.candidate_id
  FROM public.gwc_testing g
  WHERE g.candidate_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.interviews i
      WHERE i.candidate_id = g.candidate_id
        AND i.interview_status = 'completed'
    )
);

-- ---------------------------------------------------------------------------
-- 2. Completed testimonial-origin → stay on completed tab; fix interview_type only
-- ---------------------------------------------------------------------------
UPDATE public.candidates c
SET interview_type = 'testimonial'
WHERE c.id IN (
  SELECT g.candidate_id
  FROM public.gwc_testing g
  WHERE g.candidate_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.interviews i
      WHERE i.candidate_id = g.candidate_id
        AND i.interview_status = 'completed'
    )
)
AND (c.interview_type IS NULL OR c.interview_type = 'gwc');

-- ---------------------------------------------------------------------------
-- 3. Incomplete project-origin → pending queue, unassigned POC
-- ---------------------------------------------------------------------------
UPDATE public.project_candidates pc
SET
  status = 'pending',
  interview_type = 'project',
  poc_assigned = NULL,
  poc_assigned_at = NULL,
  assigned_at = NULL
WHERE pc.id IN (
  SELECT g.project_candidate_id
  FROM public.gwc_testing g
  WHERE g.project_candidate_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.project_interviews pi
      WHERE pi.project_candidate_id = g.project_candidate_id
        AND pi.interview_status = 'completed'
    )
);

-- ---------------------------------------------------------------------------
-- 4. Completed project-origin → stay on completed tab; restore project track
-- ---------------------------------------------------------------------------
UPDATE public.project_candidates pc
SET
  status = 'pending',
  interview_type = 'project'
WHERE pc.id IN (
  SELECT g.project_candidate_id
  FROM public.gwc_testing g
  WHERE g.project_candidate_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.project_interviews pi
      WHERE pi.project_candidate_id = g.project_candidate_id
        AND pi.interview_status = 'completed'
    )
);

-- Remove draft/scheduled interviews created for incomplete GWC entries only
DELETE FROM public.interviews i
WHERE i.interview_status IN ('draft', 'scheduled', 'rescheduled')
  AND EXISTS (
    SELECT 1
    FROM public.gwc_testing g
    WHERE g.candidate_id = i.candidate_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.interviews i2
        WHERE i2.candidate_id = i.candidate_id
          AND i2.interview_status = 'completed'
      )
  );

DELETE FROM public.project_interviews pi
WHERE pi.interview_status IN ('draft', 'scheduled', 'rescheduled')
  AND EXISTS (
    SELECT 1
    FROM public.gwc_testing g
    WHERE g.project_candidate_id = pi.project_candidate_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.project_interviews pi2
        WHERE pi2.project_candidate_id = pi.project_candidate_id
          AND pi2.interview_status = 'completed'
      )
  );

-- Drop GWC tables
DROP TRIGGER IF EXISTS gwc_testing_set_updated_at ON public.gwc_testing;
DROP TABLE IF EXISTS public.gwc_call_log;
DROP TABLE IF EXISTS public.gwc_content_verification;
DROP TABLE IF EXISTS public.gwc_testing;
DROP FUNCTION IF EXISTS public.set_gwc_testing_updated_at();

DO $mig$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'gwc_testing'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.gwc_testing;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'gwc_content_verification'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.gwc_content_verification;
  END IF;
END;
$mig$;

-- Remove gwc from interview_type constraint
ALTER TABLE public.candidates
  DROP CONSTRAINT IF EXISTS candidates_interview_type_check;

ALTER TABLE public.candidates
  ADD CONSTRAINT candidates_interview_type_check
  CHECK (interview_type IS NULL OR interview_type IN ('testimonial', 'project'));

COMMENT ON COLUMN public.candidates.interview_type IS
  'Routing track after eligibility: testimonial (T) or project (P).';

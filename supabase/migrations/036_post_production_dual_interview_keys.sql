-- Compatibility fix: support separate testimonial/project interview keys.

ALTER TABLE public.post_production
  ADD COLUMN IF NOT EXISTS interview_id uuid,
  ADD COLUMN IF NOT EXISTS project_interview_id uuid;

ALTER TABLE public.post_production
  ALTER COLUMN interview_id DROP NOT NULL;

-- Backfill testimonial key when missing.
UPDATE public.post_production pp
SET interview_id = (
  SELECT i.id
  FROM public.interviews i
  WHERE i.candidate_id = pp.candidate_id
    AND i.interview_status = 'completed'
  ORDER BY COALESCE(i.completed_at, i.scheduled_date) DESC NULLS LAST
  LIMIT 1
)
WHERE pp.source_type IS DISTINCT FROM 'project'
  AND pp.interview_id IS NULL
  AND pp.candidate_id IS NOT NULL;

-- Backfill project key from legacy mixed `interview_id`.
UPDATE public.post_production pp
SET project_interview_id = pp.interview_id
WHERE pp.source_type = 'project'
  AND pp.project_interview_id IS NULL
  AND pp.interview_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.project_interviews pi
    WHERE pi.id = pp.interview_id
  );

-- Backfill project key by project_candidate_id when still missing.
UPDATE public.post_production pp
SET project_interview_id = (
  SELECT pi.id
  FROM public.project_interviews pi
  WHERE pi.project_candidate_id = pp.project_candidate_id
    AND pi.interview_status = 'completed'
  ORDER BY COALESCE(pi.completed_at, pi.scheduled_date, pi.created_at) DESC NULLS LAST
  LIMIT 1
)
WHERE pp.source_type = 'project'
  AND pp.project_interview_id IS NULL
  AND pp.project_candidate_id IS NOT NULL;

-- Project rows should use project_interview_id, not interview_id.
UPDATE public.post_production
SET interview_id = NULL
WHERE source_type = 'project'
  AND interview_id IS NOT NULL;

-- Remove rows with no link to either interview table.
DELETE FROM public.post_production
WHERE interview_id IS NULL
  AND project_interview_id IS NULL;

-- Keep one row per testimonial interview.
DELETE FROM public.post_production
WHERE id IN (
  SELECT victim.id
  FROM public.post_production victim
  JOIN (
    SELECT DISTINCT ON (interview_id) interview_id, id
    FROM public.post_production
    WHERE interview_id IS NOT NULL
    ORDER BY interview_id, created_at DESC
  ) keeper
    ON keeper.interview_id = victim.interview_id
  WHERE victim.interview_id IS NOT NULL
    AND victim.id <> keeper.id
);

-- Keep one row per project interview.
DELETE FROM public.post_production
WHERE id IN (
  SELECT victim.id
  FROM public.post_production victim
  JOIN (
    SELECT DISTINCT ON (project_interview_id) project_interview_id, id
    FROM public.post_production
    WHERE project_interview_id IS NOT NULL
    ORDER BY project_interview_id, created_at DESC
  ) keeper
    ON keeper.project_interview_id = victim.project_interview_id
  WHERE victim.project_interview_id IS NOT NULL
    AND victim.id <> keeper.id
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'unique_project_interview_id'
      AND conrelid = 'public.post_production'::regclass
  ) THEN
    ALTER TABLE public.post_production
      ADD CONSTRAINT unique_project_interview_id UNIQUE (project_interview_id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_testimonial_interview'
      AND conrelid = 'public.post_production'::regclass
  ) THEN
    ALTER TABLE public.post_production
      ADD CONSTRAINT fk_testimonial_interview
      FOREIGN KEY (interview_id)
      REFERENCES public.interviews(id)
      ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_project_interview'
      AND conrelid = 'public.post_production'::regclass
  ) THEN
    ALTER TABLE public.post_production
      ADD CONSTRAINT fk_project_interview
      FOREIGN KEY (project_interview_id)
      REFERENCES public.project_interviews(id)
      ON DELETE CASCADE;
  END IF;
END
$$;

-- Eligibility trigger: validate by explicit linked interview ids.
CREATE OR REPLACE FUNCTION public.enforce_post_production_interview_eligible()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  eligible boolean;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF NEW.project_interview_id IS NOT NULL THEN
    SELECT pi.post_interview_eligible INTO eligible
    FROM public.project_interviews pi
    WHERE pi.id = NEW.project_interview_id
      AND pi.interview_status = 'completed';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Project interview not found for post production'
        USING ERRCODE = '23514';
    END IF;

    IF eligible IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'Candidate is not eligible for post production'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.interview_id IS NOT NULL THEN
    SELECT i.post_interview_eligible INTO eligible
    FROM public.interviews i
    WHERE i.id = NEW.interview_id
      AND i.interview_status = 'completed';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Interview not found for post production'
        USING ERRCODE = '23514';
    END IF;

    IF eligible IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'Candidate is not eligible for post production'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.project_candidate_id IS NOT NULL THEN
    SELECT pi.post_interview_eligible INTO eligible
    FROM public.project_interviews pi
    WHERE pi.project_candidate_id = NEW.project_candidate_id
      AND pi.interview_status = 'completed'
    ORDER BY COALESCE(pi.completed_at, pi.scheduled_date, pi.created_at) DESC NULLS LAST
    LIMIT 1;

    IF eligible IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'Candidate is not eligible for post production'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.candidate_id IS NOT NULL THEN
    SELECT i.post_interview_eligible INTO eligible
    FROM public.interviews i
    WHERE i.candidate_id = NEW.candidate_id
      AND i.interview_status = 'completed'
    ORDER BY COALESCE(i.completed_at, i.scheduled_date) DESC NULLS LAST
    LIMIT 1;

    IF eligible IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'Candidate is not eligible for post production'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

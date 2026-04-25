-- One interview = one post_production row: store canonical interview id + enforce uniqueness.

ALTER TABLE public.post_production
  ADD COLUMN IF NOT EXISTS interview_id uuid;

-- Backfill testimonial rows (interviews.id)
UPDATE public.post_production pp
SET interview_id = sub.id
FROM LATERAL (
  SELECT i.id
  FROM public.interviews i
  WHERE i.candidate_id = pp.candidate_id
    AND i.interview_status = 'completed'
  ORDER BY COALESCE(i.completed_at, i.scheduled_date) DESC NULLS LAST
  LIMIT 1
) sub
WHERE pp.candidate_id IS NOT NULL
  AND (pp.source_type IS DISTINCT FROM 'project' OR pp.source_type IS NULL)
  AND pp.interview_id IS NULL;

-- Backfill project rows (project_interviews.id)
UPDATE public.post_production pp
SET interview_id = sub.id
FROM LATERAL (
  SELECT pi.id
  FROM public.project_interviews pi
  WHERE pi.project_candidate_id = pp.project_candidate_id
    AND pi.interview_status = 'completed'
  ORDER BY COALESCE(pi.completed_at, pi.scheduled_date, pi.created_at) DESC NULLS LAST
  LIMIT 1
) sub
WHERE pp.source_type = 'project'
  AND pp.project_candidate_id IS NOT NULL
  AND pp.interview_id IS NULL;

-- Drop rows we cannot tie to an interview (cannot enforce uniqueness)
DELETE FROM public.post_production
WHERE interview_id IS NULL;

-- Keep latest row per interview_id
DELETE FROM public.post_production
WHERE id NOT IN (
  SELECT DISTINCT ON (interview_id) id
  FROM public.post_production
  WHERE interview_id IS NOT NULL
  ORDER BY interview_id, created_at DESC
);

ALTER TABLE public.post_production
  ALTER COLUMN interview_id SET NOT NULL;

ALTER TABLE public.post_production
  ADD CONSTRAINT unique_interview_id UNIQUE (interview_id);

-- Eligibility trigger: prefer exact interview row when interview_id is set
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

  IF NEW.interview_id IS NOT NULL THEN
    SELECT pi.post_interview_eligible INTO eligible
    FROM public.project_interviews pi
    WHERE pi.id = NEW.interview_id
      AND pi.interview_status = 'completed';

    IF FOUND THEN
      IF eligible IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'Candidate is not eligible for post production'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;

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

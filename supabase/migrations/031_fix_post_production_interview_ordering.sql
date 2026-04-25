-- Fix post production eligibility trigger ordering when interviews.created_at is absent.
-- Use stable timestamp fallback instead of non-existent interviews.created_at.

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

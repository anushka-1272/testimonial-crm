-- Enforce post production intake only when the latest completed interview is post-interview eligible.

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
    ORDER BY pi.completed_at DESC NULLS LAST, pi.created_at DESC
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
    ORDER BY i.completed_at DESC NULLS LAST, i.created_at DESC
    LIMIT 1;

    IF eligible IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'Candidate is not eligible for post production'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS post_production_enforce_interview_eligible ON public.post_production;

CREATE TRIGGER post_production_enforce_interview_eligible
  BEFORE INSERT ON public.post_production
  FOR EACH ROW
  EXECUTE PROCEDURE public.enforce_post_production_interview_eligible();

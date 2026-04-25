-- One-time cleanup: remove post-production rows whose latest completed interview
-- is not post-interview eligible.

DELETE FROM public.post_production pp
WHERE pp.source_type = 'testimonial'
  AND pp.candidate_id IS NOT NULL
  AND (
    NOT EXISTS (
      SELECT 1
      FROM public.interviews i
      WHERE i.candidate_id = pp.candidate_id
        AND i.interview_status = 'completed'
    )
    OR EXISTS (
      SELECT 1
      FROM LATERAL (
        SELECT i.post_interview_eligible
        FROM public.interviews i
        WHERE i.candidate_id = pp.candidate_id
          AND i.interview_status = 'completed'
        ORDER BY COALESCE(i.completed_at, i.scheduled_date) DESC NULLS LAST
        LIMIT 1
      ) latest
      WHERE latest.post_interview_eligible IS DISTINCT FROM TRUE
    )
  );

DELETE FROM public.post_production pp
WHERE pp.source_type = 'project'
  AND pp.project_candidate_id IS NOT NULL
  AND (
    NOT EXISTS (
      SELECT 1
      FROM public.project_interviews pi
      WHERE pi.project_candidate_id = pp.project_candidate_id
        AND pi.interview_status = 'completed'
    )
    OR EXISTS (
      SELECT 1
      FROM LATERAL (
        SELECT pi.post_interview_eligible
        FROM public.project_interviews pi
        WHERE pi.project_candidate_id = pp.project_candidate_id
          AND pi.interview_status = 'completed'
        ORDER BY COALESCE(pi.completed_at, pi.scheduled_date, pi.created_at) DESC NULLS LAST
        LIMIT 1
      ) latest
      WHERE latest.post_interview_eligible IS DISTINCT FROM TRUE
    )
  );

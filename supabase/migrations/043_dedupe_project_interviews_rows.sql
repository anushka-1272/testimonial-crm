-- One-time cleanup: remove duplicate project_interviews rows for the same slot.
-- Keep the "best" row per duplicate set (most complete metadata, then latest timestamp).

WITH ranked AS (
  SELECT
    pi.id,
    ROW_NUMBER() OVER (
      PARTITION BY
        pi.project_candidate_id,
        pi.scheduled_date,
        COALESCE(NULLIF(BTRIM(pi.interview_type::text), ''), 'project'),
        CASE
          WHEN pi.interview_status = 'completed' OR pi.completed_at IS NOT NULL THEN 'completed'
          ELSE 'active'
        END
      ORDER BY
        CASE WHEN NULLIF(BTRIM(pi.interviewer), '') IS NOT NULL THEN 1 ELSE 0 END DESC,
        CASE WHEN pi.interviewer_assigned_at IS NOT NULL THEN 1 ELSE 0 END DESC,
        CASE
          WHEN NULLIF(BTRIM(COALESCE(pi.zoom_link, '')), '') IS NOT NULL
            OR NULLIF(BTRIM(COALESCE(pi.zoom_account, '')), '') IS NOT NULL
            THEN 1
          ELSE 0
        END DESC,
        CASE
          WHEN pi.interview_status = 'scheduled' THEN 3
          WHEN pi.interview_status = 'rescheduled' THEN 2
          WHEN pi.interview_status = 'draft' THEN 1
          ELSE 0
        END DESC,
        COALESCE(pi.interviewer_assigned_at, pi.completed_at, pi.scheduled_date) DESC NULLS LAST,
        pi.id DESC
    ) AS rn
  FROM public.project_interviews pi
)
DELETE FROM public.project_interviews pi
USING ranked r
WHERE pi.id = r.id
  AND r.rn > 1;

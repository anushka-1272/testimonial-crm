-- One-time cleanup: remove duplicate interview rows that represent the same slot.
-- Keep the "best" row per duplicate set (most complete metadata, then latest timestamp).

WITH ranked AS (
  SELECT
    i.id,
    ROW_NUMBER() OVER (
      PARTITION BY
        i.candidate_id,
        i.scheduled_date,
        COALESCE(NULLIF(BTRIM(i.interview_type::text), ''), 'testimonial'),
        CASE
          WHEN i.interview_status = 'completed' OR i.completed_at IS NOT NULL THEN 'completed'
          ELSE 'active'
        END
      ORDER BY
        CASE WHEN NULLIF(BTRIM(i.interviewer), '') IS NOT NULL THEN 1 ELSE 0 END DESC,
        CASE WHEN i.interviewer_assigned_at IS NOT NULL THEN 1 ELSE 0 END DESC,
        CASE
          WHEN NULLIF(BTRIM(COALESCE(i.zoom_link, '')), '') IS NOT NULL
            OR NULLIF(BTRIM(COALESCE(i.zoom_account, '')), '') IS NOT NULL
            THEN 1
          ELSE 0
        END DESC,
        CASE
          WHEN i.interview_status = 'scheduled' THEN 3
          WHEN i.interview_status = 'rescheduled' THEN 2
          WHEN i.interview_status = 'draft' THEN 1
          ELSE 0
        END DESC,
        COALESCE(i.interviewer_assigned_at, i.completed_at, i.scheduled_date) DESC NULLS LAST,
        i.id DESC
    ) AS rn
  FROM public.interviews i
)
DELETE FROM public.interviews i
USING ranked r
WHERE i.id = r.id
  AND r.rn > 1;

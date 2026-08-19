-- Planned post type captured when a POC schedules an interview
-- (blog, LinkedIn, or both). Used for follow-up message templates.

ALTER TABLE public.interviews
  ADD COLUMN IF NOT EXISTS planned_content_type text;

ALTER TABLE public.project_interviews
  ADD COLUMN IF NOT EXISTS planned_content_type text;

ALTER TABLE public.interviews
  DROP CONSTRAINT IF EXISTS interviews_planned_content_type_check;
ALTER TABLE public.interviews
  ADD CONSTRAINT interviews_planned_content_type_check
  CHECK (
    planned_content_type IS NULL
    OR planned_content_type IN ('blog_post', 'linkedin_post', 'both')
  );

ALTER TABLE public.project_interviews
  DROP CONSTRAINT IF EXISTS project_interviews_planned_content_type_check;
ALTER TABLE public.project_interviews
  ADD CONSTRAINT project_interviews_planned_content_type_check
  CHECK (
    planned_content_type IS NULL
    OR planned_content_type IN ('blog_post', 'linkedin_post', 'both')
  );

COMMENT ON COLUMN public.interviews.planned_content_type IS
  'Content the candidate should publish after the interview: blog_post, linkedin_post, or both.';

COMMENT ON COLUMN public.project_interviews.planned_content_type IS
  'Content the candidate should publish after the interview: blog_post, linkedin_post, or both.';

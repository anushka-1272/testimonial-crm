-- Post-interview content pipeline (LinkedIn/blog before dispatch) + no-show status.

ALTER TYPE public.interview_status ADD VALUE IF NOT EXISTS 'no_show';

CREATE TYPE public.post_content_status AS ENUM (
  'awaiting_posts',
  'posts_confirmed',
  'dispatch_ready',
  'not_applicable'
);

ALTER TABLE public.interviews
  ADD COLUMN IF NOT EXISTS post_content_status public.post_content_status,
  ADD COLUMN IF NOT EXISTS linkedin_post_url text,
  ADD COLUMN IF NOT EXISTS blog_post_url text,
  ADD COLUMN IF NOT EXISTS posts_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS skip_social_posts boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS no_show_reason text,
  ADD COLUMN IF NOT EXISTS no_show_at timestamptz;

ALTER TABLE public.project_interviews
  ADD COLUMN IF NOT EXISTS post_content_status public.post_content_status,
  ADD COLUMN IF NOT EXISTS linkedin_post_url text,
  ADD COLUMN IF NOT EXISTS blog_post_url text,
  ADD COLUMN IF NOT EXISTS posts_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS skip_social_posts boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS no_show_reason text,
  ADD COLUMN IF NOT EXISTS no_show_at timestamptz;

COMMENT ON COLUMN public.interviews.post_content_status IS
  'Social post / dispatch pipeline after interview completion.';
COMMENT ON COLUMN public.interviews.no_show_reason IS
  'Optional note when interview_status is no_show.';
COMMENT ON COLUMN public.project_interviews.post_content_status IS
  'Social post / dispatch pipeline after project interview completion.';

-- Legacy rows: never awaiting_posts — treat as dispatch_ready or not_applicable.
UPDATE public.interviews
SET post_content_status = 'not_applicable'
WHERE interview_status = 'completed'
  AND post_interview_eligible = false
  AND post_content_status IS NULL;

UPDATE public.interviews
SET post_content_status = 'dispatch_ready'
WHERE interview_status = 'completed'
  AND (post_interview_eligible IS DISTINCT FROM false)
  AND post_content_status IS NULL;

UPDATE public.project_interviews
SET post_content_status = 'not_applicable'
WHERE interview_status = 'completed'
  AND post_interview_eligible = false
  AND post_content_status IS NULL;

UPDATE public.project_interviews
SET post_content_status = 'dispatch_ready'
WHERE interview_status = 'completed'
  AND (post_interview_eligible IS DISTINCT FROM false)
  AND post_content_status IS NULL;

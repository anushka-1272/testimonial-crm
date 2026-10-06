-- Answer collected on Complete interview: yes / no / not applicable.

ALTER TABLE public.interviews
  ADD COLUMN IF NOT EXISTS written_post_status text;

ALTER TABLE public.project_interviews
  ADD COLUMN IF NOT EXISTS written_post_status text;

ALTER TABLE public.interviews
  DROP CONSTRAINT IF EXISTS interviews_written_post_status_check;

ALTER TABLE public.interviews
  ADD CONSTRAINT interviews_written_post_status_check
  CHECK (
    written_post_status IS NULL
    OR written_post_status IN ('yes', 'no', 'not_applicable')
  );

ALTER TABLE public.project_interviews
  DROP CONSTRAINT IF EXISTS project_interviews_written_post_status_check;

ALTER TABLE public.project_interviews
  ADD CONSTRAINT project_interviews_written_post_status_check
  CHECK (
    written_post_status IS NULL
    OR written_post_status IN ('yes', 'no', 'not_applicable')
  );

COMMENT ON COLUMN public.interviews.written_post_status IS
  'Whether the written LinkedIn/blog post was completed when the interview was marked complete.';

COMMENT ON COLUMN public.project_interviews.written_post_status IS
  'Whether the written LinkedIn/blog post was completed when the interview was marked complete.';

ALTER TABLE public.interviews
  ADD COLUMN IF NOT EXISTS not_eligible_recording_link text NULL;

COMMENT ON COLUMN public.interviews.not_eligible_recording_link IS
  'Recording link captured for interviews marked post_interview_eligible = false.';

ALTER TABLE public.project_interviews
  ADD COLUMN IF NOT EXISTS not_eligible_recording_link text NULL;

COMMENT ON COLUMN public.project_interviews.not_eligible_recording_link IS
  'Recording link captured for project interviews marked post_interview_eligible = false.';

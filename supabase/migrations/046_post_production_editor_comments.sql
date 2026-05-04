-- Notes from reviewers/interviewers for the assigned editor (visible to all post-production viewers).

ALTER TABLE public.post_production
ADD COLUMN IF NOT EXISTS editor_comments text;

COMMENT ON COLUMN public.post_production.editor_comments IS
  'Free-form notes for the assigned editor (reviewers, interviewers, ops).';

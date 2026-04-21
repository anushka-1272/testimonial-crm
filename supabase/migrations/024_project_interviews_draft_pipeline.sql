-- Project interviews: nullable interviewer (draft → assign → zoom), mirror interviews table.

ALTER TABLE public.project_interviews
  ALTER COLUMN interviewer DROP DEFAULT;

ALTER TABLE public.project_interviews
  ALTER COLUMN interviewer DROP NOT NULL;

ALTER TABLE public.project_interviews
  ADD COLUMN IF NOT EXISTS interviewer_assigned_at timestamptz NULL;

ALTER TABLE public.project_interviews
  ADD COLUMN IF NOT EXISTS zoom_account text NULL;

COMMENT ON COLUMN public.project_interviews.interviewer_assigned_at IS
  'When the interviewer was assigned (after draft creation).';

COMMENT ON COLUMN public.project_interviews.zoom_account IS
  'Internal Zoom host account reference (parallel to public.interviews.zoom_account).';

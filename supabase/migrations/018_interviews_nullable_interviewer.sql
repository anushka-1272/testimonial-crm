-- Allow draft interviews without an assigned interviewer; track when one is set.
ALTER TABLE public.interviews
  ALTER COLUMN interviewer DROP NOT NULL;

ALTER TABLE public.interviews
  ADD COLUMN IF NOT EXISTS interviewer_assigned_at timestamptz NULL;

COMMENT ON COLUMN public.interviews.interviewer_assigned_at IS
  'Timestamp when interviewer was assigned (after draft creation).';

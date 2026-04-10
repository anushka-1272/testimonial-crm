-- POC draft interviews (awaiting Zoom) + internal Zoom account reference

ALTER TYPE public.interview_status ADD VALUE IF NOT EXISTS 'draft';

ALTER TABLE public.interviews
  ADD COLUMN IF NOT EXISTS zoom_account text;

COMMENT ON COLUMN public.interviews.zoom_account IS
  'Internal reference for which Zoom account hosts the call (e.g. org email or label).';

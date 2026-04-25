-- Ensure both interview tables expose the same Zoom fields.

ALTER TABLE public.interviews
  ADD COLUMN IF NOT EXISTS zoom_link text,
  ADD COLUMN IF NOT EXISTS zoom_account text;

ALTER TABLE public.project_interviews
  ADD COLUMN IF NOT EXISTS zoom_link text,
  ADD COLUMN IF NOT EXISTS zoom_account text;

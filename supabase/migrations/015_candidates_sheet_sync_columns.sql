-- Sheet sync (Responses 8-4): domain, job role, achievement summary, declaration

ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS domain text,
  ADD COLUMN IF NOT EXISTS job_role text,
  ADD COLUMN IF NOT EXISTS achievement_summary text,
  ADD COLUMN IF NOT EXISTS declaration boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.candidates.domain IS 'Professional domain from intake (e.g. sheet "Select your Domain").';
COMMENT ON COLUMN public.candidates.job_role IS 'Current job role from intake form.';
COMMENT ON COLUMN public.candidates.achievement_summary IS 'Achievement summary text from intake.';
COMMENT ON COLUMN public.candidates.declaration IS 'Declaration checkbox from intake (mirrors declaration_accepted when synced from sheet).';

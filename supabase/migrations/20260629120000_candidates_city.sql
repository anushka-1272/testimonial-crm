-- Current city of residence from testimonial intake / sheet sync

ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS city text;

COMMENT ON COLUMN public.candidates.city IS
  'Current city of residence from intake form or Google Sheet sync.';

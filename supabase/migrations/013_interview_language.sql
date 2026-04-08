-- Structured interview language (testimonial flow + post production)

ALTER TABLE public.interviews
  ADD COLUMN IF NOT EXISTS interview_language text DEFAULT 'english';

ALTER TABLE public.post_production
  ADD COLUMN IF NOT EXISTS interview_language text DEFAULT 'english';

COMMENT ON COLUMN public.interviews.interview_language IS
  'Interview language key: english, hindi, kannada, telugu, marathi, bengali, or custom lowercase.';

COMMENT ON COLUMN public.post_production.interview_language IS
  'Copied from the candidate''s latest completed interview when added to post production.';

ALTER TABLE candidates
ADD COLUMN IF NOT EXISTS interview_type text
CHECK (interview_type IN ('testimonial', 'project'))
DEFAULT NULL;

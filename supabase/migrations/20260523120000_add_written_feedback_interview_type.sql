-- Allow written feedback as a testimonial-pipeline interview type.
ALTER TYPE public.interview_type ADD VALUE IF NOT EXISTS 'written_feedback';

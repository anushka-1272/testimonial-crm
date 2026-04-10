-- Project sheet sync: respondent name from column B

ALTER TABLE public.project_candidates
ADD COLUMN IF NOT EXISTS full_name text;

COMMENT ON COLUMN public.project_candidates.full_name IS 'Display name from project intake sheet (column B).';

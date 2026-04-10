-- Post production: support project pipeline entries alongside testimonial

ALTER TABLE public.post_production
ADD COLUMN IF NOT EXISTS project_candidate_id uuid
  REFERENCES public.project_candidates (id) ON DELETE SET NULL DEFAULT NULL;

ALTER TABLE public.post_production
ADD COLUMN IF NOT EXISTS source_type text DEFAULT 'testimonial'
  CHECK (source_type IN ('testimonial', 'project'));

CREATE UNIQUE INDEX IF NOT EXISTS post_production_project_candidate_id_unique
  ON public.post_production (project_candidate_id)
  WHERE project_candidate_id IS NOT NULL;

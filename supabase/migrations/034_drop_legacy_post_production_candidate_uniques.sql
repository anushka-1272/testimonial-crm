-- Enforce 1:1 post_production ↔ interview via interview_id only.
-- Legacy unique indexes on candidate_id / project_candidate_id block multiple
-- completed interviews per person from each having a post_production row.

DROP INDEX IF EXISTS public.post_production_candidate_id_unique;
DROP INDEX IF EXISTS public.post_production_project_candidate_id_unique;

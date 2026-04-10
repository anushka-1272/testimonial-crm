-- Allow dashboard clients to delete candidates / project candidates (admin-only in app UI).
-- Ensure testimonial + project pipeline FKs cascade when parent rows are removed.

-- ---------------------------------------------------------------------------
-- RLS: DELETE (matches open select/update policies on internal dashboard)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "candidates_delete_dashboard" ON public.candidates;
CREATE POLICY "candidates_delete_dashboard"
  ON public.candidates
  FOR DELETE
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "project_candidates_delete" ON public.project_candidates;
CREATE POLICY "project_candidates_delete"
  ON public.project_candidates
  FOR DELETE
  TO anon, authenticated
  USING (true);

-- ---------------------------------------------------------------------------
-- FKs: interviews + dispatch → candidates (ON DELETE CASCADE)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class tbl ON c.conrelid = tbl.oid
    JOIN pg_namespace ns ON tbl.relnamespace = ns.oid
    WHERE c.contype = 'f'
      AND ns.nspname = 'public'
      AND tbl.relname = 'interviews'
      AND c.confrelid = 'public.candidates'::regclass
  LOOP
    EXECUTE format('ALTER TABLE public.interviews DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.interviews
  ADD CONSTRAINT interviews_candidate_id_fkey
  FOREIGN KEY (candidate_id) REFERENCES public.candidates (id) ON DELETE CASCADE;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class tbl ON c.conrelid = tbl.oid
    JOIN pg_namespace ns ON tbl.relnamespace = ns.oid
    WHERE c.contype = 'f'
      AND ns.nspname = 'public'
      AND tbl.relname = 'dispatch'
      AND c.confrelid = 'public.candidates'::regclass
  LOOP
    EXECUTE format('ALTER TABLE public.dispatch DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.dispatch
  ADD CONSTRAINT dispatch_candidate_id_fkey
  FOREIGN KEY (candidate_id) REFERENCES public.candidates (id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- FKs: project_interviews + project_dispatch → project_candidates (ON DELETE CASCADE)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class tbl ON c.conrelid = tbl.oid
    JOIN pg_namespace ns ON tbl.relnamespace = ns.oid
    WHERE c.contype = 'f'
      AND ns.nspname = 'public'
      AND tbl.relname = 'project_interviews'
      AND c.confrelid = 'public.project_candidates'::regclass
  LOOP
    EXECUTE format(
      'ALTER TABLE public.project_interviews DROP CONSTRAINT %I',
      r.conname
    );
  END LOOP;
END $$;

ALTER TABLE public.project_interviews
  ADD CONSTRAINT project_interviews_project_candidate_id_fkey
  FOREIGN KEY (project_candidate_id) REFERENCES public.project_candidates (id)
  ON DELETE CASCADE;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class tbl ON c.conrelid = tbl.oid
    JOIN pg_namespace ns ON tbl.relnamespace = ns.oid
    WHERE c.contype = 'f'
      AND ns.nspname = 'public'
      AND tbl.relname = 'project_dispatch'
      AND c.confrelid = 'public.project_candidates'::regclass
  LOOP
    EXECUTE format(
      'ALTER TABLE public.project_dispatch DROP CONSTRAINT %I',
      r.conname
    );
  END LOOP;
END $$;

ALTER TABLE public.project_dispatch
  ADD CONSTRAINT project_dispatch_project_candidate_id_fkey
  FOREIGN KEY (project_candidate_id) REFERENCES public.project_candidates (id)
  ON DELETE CASCADE;

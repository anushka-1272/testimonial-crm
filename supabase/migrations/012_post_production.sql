-- Post production pipeline (video editing → YouTube → CX mail)

CREATE TABLE IF NOT EXISTS public.post_production (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  candidate_id uuid REFERENCES public.candidates (id) ON DELETE SET NULL,
  candidate_name text,
  raw_video_link text,
  edited_video_link text,
  pre_edit_review text NOT NULL DEFAULT 'not_done'
    CHECK (pre_edit_review IN ('done', 'not_done')),
  pre_edit_review_by text,
  post_edit_review text NOT NULL DEFAULT 'not_done'
    CHECK (post_edit_review IN ('done', 'not_done')),
  post_edit_review_by text,
  edited_by text,
  youtube_link text,
  youtube_status text NOT NULL DEFAULT 'private'
    CHECK (youtube_status IN ('private', 'unlisted', 'live')),
  summary text,
  cx_mail_sent boolean NOT NULL DEFAULT false,
  cx_mail_sent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS post_production_candidate_id_unique
  ON public.post_production (candidate_id)
  WHERE candidate_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS post_production_created_at_idx
  ON public.post_production (created_at DESC);

CREATE OR REPLACE FUNCTION public.set_post_production_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS post_production_set_updated_at ON public.post_production;
CREATE TRIGGER post_production_set_updated_at
  BEFORE UPDATE ON public.post_production
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_post_production_updated_at();

ALTER TABLE public.post_production ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "post_production_select" ON public.post_production;
DROP POLICY IF EXISTS "post_production_insert" ON public.post_production;
DROP POLICY IF EXISTS "post_production_update" ON public.post_production;
DROP POLICY IF EXISTS "post_production_delete" ON public.post_production;

CREATE POLICY "post_production_select"
  ON public.post_production FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "post_production_insert"
  ON public.post_production FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "post_production_update"
  ON public.post_production FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "post_production_delete"
  ON public.post_production FOR DELETE TO anon, authenticated USING (true);

DO $mig$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'post_production'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.post_production;
  END IF;
END;
$mig$;

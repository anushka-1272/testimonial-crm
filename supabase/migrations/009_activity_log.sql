-- Activity log for team audit trail

CREATE TABLE IF NOT EXISTS public.activity_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz DEFAULT now() NOT NULL,
  user_id uuid REFERENCES auth.users (id),
  user_name text,
  action_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  candidate_name text,
  description text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS activity_log_created_at_idx
  ON public.activity_log (created_at DESC);

CREATE INDEX IF NOT EXISTS activity_log_action_type_idx
  ON public.activity_log (action_type);

CREATE INDEX IF NOT EXISTS activity_log_candidate_name_idx
  ON public.activity_log (candidate_name);

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "activity_log_select_authenticated"
  ON public.activity_log
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "activity_log_insert_authenticated"
  ON public.activity_log
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DO $mig$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'activity_log'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_log;
  END IF;
END;
$mig$;

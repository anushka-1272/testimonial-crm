-- Analytics and reporting: when the dispatch row was created (intake into shipping pipeline).

ALTER TABLE public.dispatch
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

COMMENT ON COLUMN public.dispatch.created_at IS
  'When the dispatch record was created; used for dashboards and time-bucketed metrics.';

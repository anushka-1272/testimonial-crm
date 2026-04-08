-- Project intake pipeline (separate from testimonial candidates)

CREATE TABLE IF NOT EXISTS public.project_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  email text NOT NULL,
  whatsapp_number text,
  project_title text,
  problem_statement text,
  target_user text,
  ai_usage text,
  demo_link text,
  status text NOT NULL DEFAULT 'pending',
  poc_assigned text,
  poc_assigned_at timestamptz,
  interview_type text NOT NULL DEFAULT 'project',
  synced_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_candidates_email_key UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS project_candidates_created_at_idx
  ON public.project_candidates (created_at DESC);

-- Interviews for project pipeline (parallel to public.interviews)
CREATE TABLE IF NOT EXISTS public.project_interviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  project_candidate_id uuid NOT NULL REFERENCES public.project_candidates (id) ON DELETE CASCADE,
  scheduled_date timestamptz,
  previous_scheduled_date timestamptz,
  reschedule_reason text,
  completed_at timestamptz,
  interviewer public.interviewer NOT NULL DEFAULT 'Harika'::public.interviewer,
  zoom_link text,
  language text,
  invitation_sent boolean DEFAULT false,
  poc text,
  remarks text,
  reminder_count integer NOT NULL DEFAULT 0,
  interview_status public.interview_status NOT NULL DEFAULT 'scheduled',
  post_interview_eligible boolean,
  reward_item text,
  category text,
  funnel text,
  comments text,
  interview_type public.interview_type NOT NULL DEFAULT 'project'::public.interview_type
);

CREATE INDEX IF NOT EXISTS project_interviews_candidate_idx
  ON public.project_interviews (project_candidate_id);

CREATE INDEX IF NOT EXISTS project_interviews_status_idx
  ON public.project_interviews (interview_status);

-- Dispatch for project rewards (parallel to public.dispatch)
CREATE TABLE IF NOT EXISTS public.project_dispatch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  project_candidate_id uuid NOT NULL REFERENCES public.project_candidates (id) ON DELETE CASCADE,
  shipping_address text,
  dispatch_status public.dispatch_status NOT NULL DEFAULT 'pending',
  dispatch_date timestamptz,
  expected_delivery_date timestamptz,
  actual_delivery_date timestamptz,
  tracking_id text,
  special_comments text,
  reward_item text
);

CREATE INDEX IF NOT EXISTS project_dispatch_candidate_idx
  ON public.project_dispatch (project_candidate_id);

ALTER TABLE public.project_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_interviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_dispatch ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_candidates_select" ON public.project_candidates;
DROP POLICY IF EXISTS "project_candidates_insert" ON public.project_candidates;
DROP POLICY IF EXISTS "project_candidates_update" ON public.project_candidates;

CREATE POLICY "project_candidates_select"
  ON public.project_candidates FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "project_candidates_insert"
  ON public.project_candidates FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "project_candidates_update"
  ON public.project_candidates FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "project_interviews_select" ON public.project_interviews;
DROP POLICY IF EXISTS "project_interviews_insert" ON public.project_interviews;
DROP POLICY IF EXISTS "project_interviews_update" ON public.project_interviews;

CREATE POLICY "project_interviews_select"
  ON public.project_interviews FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "project_interviews_insert"
  ON public.project_interviews FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "project_interviews_update"
  ON public.project_interviews FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "project_dispatch_select" ON public.project_dispatch;
DROP POLICY IF EXISTS "project_dispatch_insert" ON public.project_dispatch;
DROP POLICY IF EXISTS "project_dispatch_update" ON public.project_dispatch;

CREATE POLICY "project_dispatch_select"
  ON public.project_dispatch FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "project_dispatch_insert"
  ON public.project_dispatch FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "project_dispatch_update"
  ON public.project_dispatch FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DO $mig$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'project_candidates'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.project_candidates;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'project_interviews'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.project_interviews;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'project_dispatch'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.project_dispatch;
  END IF;
END;
$mig$;

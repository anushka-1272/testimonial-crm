-- GWC Testing workflow: eligibility track, content verification, call logging

-- Extend interview_type to include GWC track
ALTER TABLE public.candidates
  DROP CONSTRAINT IF EXISTS candidates_interview_type_check;

ALTER TABLE public.candidates
  ADD CONSTRAINT candidates_interview_type_check
  CHECK (interview_type IS NULL OR interview_type IN ('testimonial', 'project', 'gwc'));

COMMENT ON COLUMN public.candidates.interview_type IS
  'Routing track after eligibility: testimonial (T), project (P), or gwc (GWC).';

-- Main GWC workflow record (one per candidate)
CREATE TABLE IF NOT EXISTS public.gwc_testing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL UNIQUE REFERENCES public.candidates (id) ON DELETE CASCADE,
  poc text,
  interested_in text[] NOT NULL DEFAULT '{}',
  workflow_stage text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gwc_testing_workflow_stage_check
    CHECK (workflow_stage IN ('active', 'scheduled', 'dispatch')),
  CONSTRAINT gwc_testing_interested_in_check
    CHECK (
      interested_in <@ ARRAY[
        'blog_post',
        'linkedin_post',
        'reddit_reply',
        'own_video',
        'video_interview'
      ]::text[]
    )
);

CREATE INDEX IF NOT EXISTS gwc_testing_workflow_stage_idx
  ON public.gwc_testing (workflow_stage);

CREATE INDEX IF NOT EXISTS gwc_testing_interested_in_gin_idx
  ON public.gwc_testing USING gin (interested_in);

COMMENT ON TABLE public.gwc_testing IS
  'GWC Testing pipeline entries; created when a candidate is marked GWC in eligibility.';

-- Per-channel content link and verification
CREATE TABLE IF NOT EXISTS public.gwc_content_verification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gwc_testing_id uuid NOT NULL REFERENCES public.gwc_testing (id) ON DELETE CASCADE,
  channel text NOT NULL,
  content_link text,
  verified boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  verified_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gwc_content_verification_channel_check
    CHECK (channel IN ('blog_post', 'linkedin_post', 'reddit_reply', 'own_video')),
  CONSTRAINT gwc_content_verification_unique_channel
    UNIQUE (gwc_testing_id, channel)
);

CREATE INDEX IF NOT EXISTS gwc_content_verification_gwc_testing_id_idx
  ON public.gwc_content_verification (gwc_testing_id);

-- Call log for GWC Testing
CREATE TABLE IF NOT EXISTS public.gwc_call_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gwc_testing_id uuid NOT NULL REFERENCES public.gwc_testing (id) ON DELETE CASCADE,
  outcome text NOT NULL,
  notes text,
  logged_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gwc_call_log_outcome_check
    CHECK (
      outcome IN (
        'no_answer',
        'callback',
        'interested',
        'not_interested',
        'wrong_number',
        'scheduled',
        'other'
      )
    )
);

CREATE INDEX IF NOT EXISTS gwc_call_log_gwc_testing_id_idx
  ON public.gwc_call_log (gwc_testing_id);

-- Deduplicate dispatch (must run before unique index)
CREATE OR REPLACE FUNCTION public.dedupe_dispatch_by_candidate()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  WITH keepers AS (
    SELECT DISTINCT ON (candidate_id)
      id
    FROM public.dispatch
    ORDER BY
      candidate_id,
      CASE dispatch_status::text
        WHEN 'delivered' THEN 3
        WHEN 'dispatched' THEN 2
        ELSE 1
      END DESC,
      CASE
        WHEN NULLIF(BTRIM(COALESCE(tracking_id, '')), '') IS NOT NULL THEN 1
        ELSE 0
      END DESC,
      CASE
        WHEN NULLIF(BTRIM(COALESCE(shipping_address, '')), '') IS NOT NULL THEN 1
        ELSE 0
      END DESC,
      CASE
        WHEN NULLIF(BTRIM(COALESCE(reward_item, '')), '') IS NOT NULL THEN 1
        ELSE 0
      END DESC,
      COALESCE(actual_delivery_date, dispatch_date) DESC NULLS LAST,
      id DESC
  )
  DELETE FROM public.dispatch d
  WHERE NOT EXISTS (
    SELECT 1 FROM keepers k WHERE k.id = d.id
  );

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

SELECT public.dedupe_dispatch_by_candidate();

DROP INDEX IF EXISTS public.dispatch_candidate_id_unique;

CREATE UNIQUE INDEX dispatch_candidate_id_unique
  ON public.dispatch (candidate_id);

-- updated_at trigger for gwc_testing
CREATE OR REPLACE FUNCTION public.set_gwc_testing_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS gwc_testing_set_updated_at ON public.gwc_testing;
CREATE TRIGGER gwc_testing_set_updated_at
  BEFORE UPDATE ON public.gwc_testing
  FOR EACH ROW
  EXECUTE FUNCTION public.set_gwc_testing_updated_at();

-- RLS
ALTER TABLE public.gwc_testing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gwc_content_verification ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gwc_call_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gwc_testing_select_dashboard" ON public.gwc_testing;
DROP POLICY IF EXISTS "gwc_testing_insert_dashboard" ON public.gwc_testing;
DROP POLICY IF EXISTS "gwc_testing_update_dashboard" ON public.gwc_testing;

CREATE POLICY "gwc_testing_select_dashboard"
  ON public.gwc_testing FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "gwc_testing_insert_dashboard"
  ON public.gwc_testing FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "gwc_testing_update_dashboard"
  ON public.gwc_testing FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "gwc_content_verification_select_dashboard" ON public.gwc_content_verification;
DROP POLICY IF EXISTS "gwc_content_verification_insert_dashboard" ON public.gwc_content_verification;
DROP POLICY IF EXISTS "gwc_content_verification_update_dashboard" ON public.gwc_content_verification;

CREATE POLICY "gwc_content_verification_select_dashboard"
  ON public.gwc_content_verification FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "gwc_content_verification_insert_dashboard"
  ON public.gwc_content_verification FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "gwc_content_verification_update_dashboard"
  ON public.gwc_content_verification FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "gwc_call_log_select_dashboard" ON public.gwc_call_log;
DROP POLICY IF EXISTS "gwc_call_log_insert_dashboard" ON public.gwc_call_log;

CREATE POLICY "gwc_call_log_select_dashboard"
  ON public.gwc_call_log FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "gwc_call_log_insert_dashboard"
  ON public.gwc_call_log FOR INSERT TO anon, authenticated WITH CHECK (true);

-- Realtime
DO $mig$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public' AND tablename = 'gwc_testing'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.gwc_testing;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public' AND tablename = 'gwc_content_verification'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.gwc_content_verification;
  END IF;
END;
$mig$;

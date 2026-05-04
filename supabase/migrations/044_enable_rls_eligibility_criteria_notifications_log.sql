-- Security: tables from initial schema that never had RLS enabled.
-- Supabase linter flags these as rls_disabled_in_public.
--
-- eligibility_criteria: used from the signed-in dashboard (Settings → Criteria).
-- notifications_log: not used from browser code; service role bypasses RLS for server writes.

ALTER TABLE public.eligibility_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "eligibility_criteria_select_authenticated" ON public.eligibility_criteria;
DROP POLICY IF EXISTS "eligibility_criteria_insert_authenticated" ON public.eligibility_criteria;
DROP POLICY IF EXISTS "eligibility_criteria_update_authenticated" ON public.eligibility_criteria;
DROP POLICY IF EXISTS "eligibility_criteria_delete_authenticated" ON public.eligibility_criteria;

CREATE POLICY "eligibility_criteria_select_authenticated"
  ON public.eligibility_criteria
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "eligibility_criteria_insert_authenticated"
  ON public.eligibility_criteria
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "eligibility_criteria_update_authenticated"
  ON public.eligibility_criteria
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "eligibility_criteria_delete_authenticated"
  ON public.eligibility_criteria
  FOR DELETE
  TO authenticated
  USING (true);

-- No policies on notifications_log: JWT clients cannot read/write; service role still can.

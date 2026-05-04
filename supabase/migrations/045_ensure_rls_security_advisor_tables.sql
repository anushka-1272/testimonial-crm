-- Reconcile production with Security Advisor: enable RLS + policies on core public tables.
-- Use when remote DB shows "RLS Disabled in Public" / "Policy Exists RLS Disabled" despite
-- older migrations existing in repo (migrations never applied, or RLS turned off manually).
-- Idempotent: DROP POLICY IF EXISTS then CREATE; ENABLE ROW LEVEL SECURITY is safe to repeat.

-- ---------------------------------------------------------------------------
-- activity_log
-- ---------------------------------------------------------------------------
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "activity_log_select_authenticated" ON public.activity_log;
DROP POLICY IF EXISTS "activity_log_insert_authenticated" ON public.activity_log;

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

-- ---------------------------------------------------------------------------
-- team_members
-- ---------------------------------------------------------------------------
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team_members_select_authenticated" ON public.team_members;
DROP POLICY IF EXISTS "team_members_insert_admin_only" ON public.team_members;
DROP POLICY IF EXISTS "team_members_update_admin_only" ON public.team_members;

CREATE POLICY "team_members_select_authenticated"
  ON public.team_members
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "team_members_insert_admin_only"
  ON public.team_members
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.team_members tm
      WHERE tm.user_id = auth.uid()
        AND tm.role = 'admin'
        AND tm.status = 'active'
    )
  );

CREATE POLICY "team_members_update_admin_only"
  ON public.team_members
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.team_members tm
      WHERE tm.user_id = auth.uid()
        AND tm.role = 'admin'
        AND tm.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.team_members tm
      WHERE tm.user_id = auth.uid()
        AND tm.role = 'admin'
        AND tm.status = 'active'
    )
  );

-- ---------------------------------------------------------------------------
-- followup_log
-- ---------------------------------------------------------------------------
ALTER TABLE public.followup_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "followup_log_select_dashboard" ON public.followup_log;
DROP POLICY IF EXISTS "followup_log_insert_dashboard" ON public.followup_log;

CREATE POLICY "followup_log_select_dashboard"
  ON public.followup_log
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "followup_log_insert_dashboard"
  ON public.followup_log
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- team_roster
-- ---------------------------------------------------------------------------
ALTER TABLE public.team_roster ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team_roster_select" ON public.team_roster;
DROP POLICY IF EXISTS "team_roster_insert" ON public.team_roster;
DROP POLICY IF EXISTS "team_roster_update" ON public.team_roster;
DROP POLICY IF EXISTS "team_roster_delete" ON public.team_roster;

CREATE POLICY "team_roster_select"
  ON public.team_roster FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "team_roster_insert"
  ON public.team_roster FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "team_roster_update"
  ON public.team_roster FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "team_roster_delete"
  ON public.team_roster FOR DELETE TO anon, authenticated USING (true);

-- ---------------------------------------------------------------------------
-- project pipeline
-- ---------------------------------------------------------------------------
ALTER TABLE public.project_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_interviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_dispatch ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_candidates_select" ON public.project_candidates;
DROP POLICY IF EXISTS "project_candidates_insert" ON public.project_candidates;
DROP POLICY IF EXISTS "project_candidates_update" ON public.project_candidates;
DROP POLICY IF EXISTS "project_candidates_delete" ON public.project_candidates;

CREATE POLICY "project_candidates_select"
  ON public.project_candidates FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "project_candidates_insert"
  ON public.project_candidates FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "project_candidates_update"
  ON public.project_candidates FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "project_candidates_delete"
  ON public.project_candidates FOR DELETE TO anon, authenticated USING (true);

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

-- ---------------------------------------------------------------------------
-- post_production
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- eligibility_criteria + notifications_log (see also 044)
-- ---------------------------------------------------------------------------
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

-- notifications_log: RLS on, no policies (JWT clients blocked; service role bypasses RLS).

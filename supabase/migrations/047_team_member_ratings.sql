-- Monthly / period team performance ratings (1–5) from Team report → Ratings tab
-- POC and interviewers only: callings, interviews, reminder

CREATE TABLE IF NOT EXISTS public.team_member_ratings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  member_name text NOT NULL,
  callings smallint CHECK (
    callings IS NULL OR (callings >= 1 AND callings <= 5)
  ),
  interviews smallint CHECK (
    interviews IS NULL OR (interviews >= 1 AND interviews <= 5)
  ),
  reminder smallint CHECK (
    reminder IS NULL OR (reminder >= 1 AND reminder <= 5)
  ),
  rated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT team_member_ratings_period_member_key
    UNIQUE (period_start, period_end, member_name)
);

CREATE INDEX IF NOT EXISTS team_member_ratings_period_idx
  ON public.team_member_ratings (period_start, period_end);

ALTER TABLE public.team_member_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team_member_ratings_select_authenticated" ON public.team_member_ratings;
DROP POLICY IF EXISTS "team_member_ratings_insert_admin" ON public.team_member_ratings;
DROP POLICY IF EXISTS "team_member_ratings_update_admin" ON public.team_member_ratings;
DROP POLICY IF EXISTS "team_member_ratings_delete_admin" ON public.team_member_ratings;

CREATE POLICY "team_member_ratings_select_authenticated"
  ON public.team_member_ratings
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "team_member_ratings_insert_admin"
  ON public.team_member_ratings
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

CREATE POLICY "team_member_ratings_update_admin"
  ON public.team_member_ratings
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

CREATE POLICY "team_member_ratings_delete_admin"
  ON public.team_member_ratings
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.team_members tm
      WHERE tm.user_id = auth.uid()
        AND tm.role = 'admin'
        AND tm.status = 'active'
    )
  );

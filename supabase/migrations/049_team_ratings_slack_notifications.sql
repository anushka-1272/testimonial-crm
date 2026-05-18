-- Track one Slack notification per rating period (when all POC/interviewer ratings are complete)

CREATE TABLE IF NOT EXISTS public.team_ratings_period_notifications (
  period_start date NOT NULL,
  period_end date NOT NULL,
  notified_at timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY (period_start, period_end)
);

ALTER TABLE public.team_ratings_period_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team_ratings_period_notifications_select_authenticated"
  ON public.team_ratings_period_notifications;
DROP POLICY IF EXISTS "team_ratings_period_notifications_insert_admin"
  ON public.team_ratings_period_notifications;
DROP POLICY IF EXISTS "team_ratings_period_notifications_delete_admin"
  ON public.team_ratings_period_notifications;

CREATE POLICY "team_ratings_period_notifications_select_authenticated"
  ON public.team_ratings_period_notifications
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "team_ratings_period_notifications_insert_admin"
  ON public.team_ratings_period_notifications
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

CREATE POLICY "team_ratings_period_notifications_delete_admin"
  ON public.team_ratings_period_notifications
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

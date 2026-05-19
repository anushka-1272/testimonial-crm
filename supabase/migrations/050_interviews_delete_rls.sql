-- Allow dashboard clients to delete interview rows (revert → callings).

DROP POLICY IF EXISTS "interviews_delete_dashboard" ON public.interviews;
CREATE POLICY "interviews_delete_dashboard"
  ON public.interviews
  FOR DELETE
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "project_interviews_delete" ON public.project_interviews;
CREATE POLICY "project_interviews_delete"
  ON public.project_interviews
  FOR DELETE
  TO anon, authenticated
  USING (true);

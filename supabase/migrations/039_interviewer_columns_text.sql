-- Allow any active team_members interviewer name (not only legacy enum labels).

ALTER TABLE public.interviews
  ALTER COLUMN interviewer TYPE text
  USING (interviewer::text);

ALTER TABLE public.project_interviews
  ALTER COLUMN interviewer TYPE text
  USING (interviewer::text);

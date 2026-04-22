-- Distinct interviewer identity + Slack DM email (separate from "Anushka").
-- Uses UPDATE + INSERT (no ON CONFLICT): some DBs lack UNIQUE(name, role_type).

UPDATE public.team_roster
SET
  email = 'anushka.roy.ost@houseofedtech.in',
  display_order = 5,
  is_active = true
WHERE name = 'Anushka Roy' AND role_type = 'interviewer';

INSERT INTO public.team_roster (name, email, role_type, display_order)
SELECT 'Anushka Roy', 'anushka.roy.ost@houseofedtech.in', 'interviewer', 5
WHERE NOT EXISTS (
  SELECT 1
  FROM public.team_roster
  WHERE name = 'Anushka Roy' AND role_type = 'interviewer'
);

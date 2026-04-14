-- Central team roster for role-based dropdowns and notifications

CREATE TABLE IF NOT EXISTS public.team_roster (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  name text NOT NULL,
  email text,
  role_type text NOT NULL CHECK (
    role_type IN ('poc', 'interviewer', 'post_production', 'operations')
  ),
  is_active boolean DEFAULT true,
  display_order integer DEFAULT 0
);

ALTER TABLE public.team_roster
  DROP CONSTRAINT IF EXISTS team_roster_name_role_key;

ALTER TABLE public.team_roster
  ADD CONSTRAINT team_roster_name_role_key
  UNIQUE (name, role_type);

CREATE INDEX IF NOT EXISTS team_roster_role_active_order_idx
  ON public.team_roster (role_type, is_active, display_order, created_at);

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

INSERT INTO public.team_roster (name, email, role_type, display_order) VALUES
  ('Harika', 'harika.pydi@houseofedtech.in', 'poc', 1),
  ('Anushka', 'anushka@houseofedtech.in', 'poc', 2),
  ('Gargi', 'gargi.rani.pathak@houseofedtech.in', 'poc', 3),
  ('Mudit', 'mudit.saxena@houseofedtech.in', 'poc', 4),
  ('Harika', 'harika.pydi@houseofedtech.in', 'interviewer', 1),
  ('Anushka', 'anushka@houseofedtech.in', 'interviewer', 2),
  ('Gargi', 'gargi.rani.pathak@houseofedtech.in', 'interviewer', 3),
  ('Mudit', 'mudit.saxena@houseofedtech.in', 'interviewer', 4),
  ('Prakhar V', 'prkhrvv@houseofedtech.in', 'post_production', 1),
  ('Somoshree', 'somoshree.roy.chowdhury@houseofedtech.in', 'post_production', 2),
  ('Sapna', 'sapna.kumari@houseofedtech.in', 'post_production', 3),
  ('Dishan', 'dishan.pramanik.ost@houseofedtech.in', 'operations', 1)
ON CONFLICT (name, role_type)
DO UPDATE SET
  email = EXCLUDED.email,
  display_order = EXCLUDED.display_order,
  is_active = true;

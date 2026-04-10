CREATE TABLE IF NOT EXISTS public.team_members (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  role text NOT NULL CHECK (
    role IN (
      'admin',
      'interviewer',
      'poc',
      'operations',
      'post_production',
      'viewer'
    )
  ),
  invited_by uuid REFERENCES auth.users(id),
  invited_at timestamptz DEFAULT now(),
  status text DEFAULT 'invited' CHECK (
    status IN ('invited', 'active', 'removed')
  )
);

ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team_members_select_authenticated" ON public.team_members;
CREATE POLICY "team_members_select_authenticated"
ON public.team_members
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "team_members_insert_admin_only" ON public.team_members;
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

DROP POLICY IF EXISTS "team_members_update_admin_only" ON public.team_members;
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

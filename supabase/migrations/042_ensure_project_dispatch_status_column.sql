-- Ensure project_dispatch has dispatch_status in all environments.
-- Some environments may still have a legacy `status` column instead.

ALTER TABLE public.project_dispatch
  ADD COLUMN IF NOT EXISTS dispatch_status public.dispatch_status;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'project_dispatch'
      AND column_name = 'status'
  ) THEN
    EXECUTE $sql$
      UPDATE public.project_dispatch
      SET dispatch_status = CASE
        WHEN COALESCE(NULLIF(BTRIM(status), ''), 'pending') = 'dispatched'
          THEN 'dispatched'::public.dispatch_status
        WHEN COALESCE(NULLIF(BTRIM(status), ''), 'pending') = 'delivered'
          THEN 'delivered'::public.dispatch_status
        ELSE 'pending'::public.dispatch_status
      END
      WHERE dispatch_status IS NULL
    $sql$;
  END IF;
END
$$;

UPDATE public.project_dispatch
SET dispatch_status = 'pending'::public.dispatch_status
WHERE dispatch_status IS NULL;

ALTER TABLE public.project_dispatch
  ALTER COLUMN dispatch_status SET DEFAULT 'pending'::public.dispatch_status;

ALTER TABLE public.project_dispatch
  ALTER COLUMN dispatch_status SET NOT NULL;

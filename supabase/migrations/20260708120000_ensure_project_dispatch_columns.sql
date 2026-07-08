-- project_dispatch may have been created before all shipment columns existed
-- (CREATE TABLE IF NOT EXISTS does not add columns to an existing table).

ALTER TABLE public.project_dispatch
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS shipping_address text,
  ADD COLUMN IF NOT EXISTS dispatch_status public.dispatch_status,
  ADD COLUMN IF NOT EXISTS dispatch_date timestamptz,
  ADD COLUMN IF NOT EXISTS expected_delivery_date timestamptz,
  ADD COLUMN IF NOT EXISTS actual_delivery_date timestamptz,
  ADD COLUMN IF NOT EXISTS tracking_id text,
  ADD COLUMN IF NOT EXISTS special_comments text,
  ADD COLUMN IF NOT EXISTS reward_item text;

-- Backfill dispatch_status from legacy `status` text column when present.
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

COMMENT ON TABLE public.project_dispatch IS
  'Shipment pipeline for project interview rewards; mirrors public.dispatch.';

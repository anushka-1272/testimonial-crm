-- When a POC is assigned on a GWC Testing queue row

ALTER TABLE public.gwc_testing
  ADD COLUMN IF NOT EXISTS poc_assigned_at timestamptz;

COMMENT ON COLUMN public.gwc_testing.poc_assigned_at IS
  'Timestamp when poc was last assigned on this GWC row.';

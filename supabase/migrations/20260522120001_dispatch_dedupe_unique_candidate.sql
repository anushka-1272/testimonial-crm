-- One row per candidate on public.dispatch (fixes duplicate rows before unique index).
-- Safe to re-run: dedupe function is idempotent; index uses IF NOT EXISTS.

CREATE OR REPLACE FUNCTION public.dedupe_dispatch_by_candidate()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  WITH keepers AS (
    SELECT DISTINCT ON (candidate_id)
      id
    FROM public.dispatch
    ORDER BY
      candidate_id,
      CASE dispatch_status::text
        WHEN 'delivered' THEN 3
        WHEN 'dispatched' THEN 2
        ELSE 1
      END DESC,
      CASE
        WHEN NULLIF(BTRIM(COALESCE(tracking_id, '')), '') IS NOT NULL THEN 1
        ELSE 0
      END DESC,
      CASE
        WHEN NULLIF(BTRIM(COALESCE(shipping_address, '')), '') IS NOT NULL THEN 1
        ELSE 0
      END DESC,
      CASE
        WHEN NULLIF(BTRIM(COALESCE(reward_item, '')), '') IS NOT NULL THEN 1
        ELSE 0
      END DESC,
      COALESCE(actual_delivery_date, dispatch_date) DESC NULLS LAST,
      id DESC
  )
  DELETE FROM public.dispatch d
  WHERE NOT EXISTS (
    SELECT 1 FROM keepers k WHERE k.id = d.id
  );

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

COMMENT ON FUNCTION public.dedupe_dispatch_by_candidate() IS
  'Removes duplicate dispatch rows per candidate_id, keeping the most complete / advanced row.';

SELECT public.dedupe_dispatch_by_candidate();

DROP INDEX IF EXISTS public.dispatch_candidate_id_unique;

CREATE UNIQUE INDEX IF NOT EXISTS dispatch_candidate_id_unique
  ON public.dispatch (candidate_id);

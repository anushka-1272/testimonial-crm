-- Fix PostgREST/Supabase upsert: ON CONFLICT (interview_id) requires a UNIQUE/PRIMARY KEY on interview_id.
-- Testimonial rows use non-null interview_id; project rows use NULL interview_id (multiple NULLs allowed under UNIQUE).

-- Keep a single row per non-null interview_id (latest activity wins).
DELETE FROM public.post_production
WHERE id IN (
  SELECT victim.id
  FROM public.post_production victim
  JOIN (
    SELECT DISTINCT ON (interview_id) interview_id, id
    FROM public.post_production
    WHERE interview_id IS NOT NULL
    ORDER BY
      interview_id,
      updated_at DESC NULLS LAST,
      created_at DESC
  ) keeper
    ON keeper.interview_id = victim.interview_id
  WHERE victim.interview_id IS NOT NULL
    AND victim.id <> keeper.id
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'unique_interview_id'
      AND conrelid = 'public.post_production'::regclass
  ) THEN
    ALTER TABLE public.post_production
      ADD CONSTRAINT unique_interview_id UNIQUE (interview_id);
  END IF;
END
$$;

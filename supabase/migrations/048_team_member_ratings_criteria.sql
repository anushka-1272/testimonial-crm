-- Align team_member_ratings with callings / interviews / reminder (if 047 used old columns)

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'team_member_ratings'
      AND column_name = 'consistency'
  ) THEN
    ALTER TABLE public.team_member_ratings RENAME COLUMN consistency TO callings;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'team_member_ratings'
      AND column_name = 'activeness'
  ) THEN
    ALTER TABLE public.team_member_ratings RENAME COLUMN activeness TO interviews;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'team_member_ratings'
      AND column_name = 'reminders'
  ) THEN
    ALTER TABLE public.team_member_ratings RENAME COLUMN reminders TO reminder;
  END IF;
END $$;

ALTER TABLE public.team_member_ratings DROP COLUMN IF EXISTS notes;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'team_member_ratings'
      AND column_name = 'callings'
  ) THEN
    ALTER TABLE public.team_member_ratings
      DROP CONSTRAINT IF EXISTS team_member_ratings_callings_check;
    ALTER TABLE public.team_member_ratings
      ADD CONSTRAINT team_member_ratings_callings_check CHECK (
        callings IS NULL OR (callings >= 1 AND callings <= 5)
      );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'team_member_ratings'
      AND column_name = 'interviews'
  ) THEN
    ALTER TABLE public.team_member_ratings
      DROP CONSTRAINT IF EXISTS team_member_ratings_interviews_check;
    ALTER TABLE public.team_member_ratings
      ADD CONSTRAINT team_member_ratings_interviews_check CHECK (
        interviews IS NULL OR (interviews >= 1 AND interviews <= 5)
      );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'team_member_ratings'
      AND column_name = 'reminder'
  ) THEN
    ALTER TABLE public.team_member_ratings
      DROP CONSTRAINT IF EXISTS team_member_ratings_reminder_check;
    ALTER TABLE public.team_member_ratings
      ADD CONSTRAINT team_member_ratings_reminder_check CHECK (
        reminder IS NULL OR (reminder >= 1 AND reminder <= 5)
      );
  END IF;
END $$;

-- POC pointers / notes per Interested In option on GWC Testing queue rows

ALTER TABLE public.gwc_testing
  ADD COLUMN IF NOT EXISTS interested_in_pointers jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.gwc_testing.interested_in_pointers IS
  'POC notes keyed by interested_in value (blog_post, linkedin_post, reddit_reply, own_video, video_interview).';

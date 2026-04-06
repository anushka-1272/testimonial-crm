-- Optional consent / notes from Google Form sync (sheet columns 19–20).

alter table public.candidates
  add column if not exists poc text,
  add column if not exists remarks text;

comment on column public.candidates.poc is
  'e.g. comfortable sharing success story (from intake / sheet sync).';
comment on column public.candidates.remarks is
  'e.g. comfortable with short call (from intake / sheet sync).';

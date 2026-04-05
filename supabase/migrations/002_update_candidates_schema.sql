-- Align `candidates` with testimonial intake form fields.
-- Replaces legacy columns: phone → whatsapp_number, proof_link → proof_document_url;
-- drops industry and achievement_summary (superseded by structured form fields).

alter table public.candidates
  add column whatsapp_number text,
  add column role_before_program text,
  add column salary_before_program text,
  add column primary_goal text,
  add column achievement_type text,
  add column achievement_title text,
  add column achieved_on_date date,
  add column program_joined_date date,
  add column quantified_result text,
  add column skills_modules_helped text,
  add column how_program_helped text,
  add column proof_document_url text,
  add column proof_description text,
  add column instagram_url text,
  add column declaration_accepted boolean not null default false;

update public.candidates
set
  whatsapp_number = coalesce(whatsapp_number, phone),
  proof_document_url = coalesce(proof_document_url, proof_link),
  how_program_helped = coalesce(how_program_helped, achievement_summary)
where true;

alter table public.candidates
  drop column phone,
  drop column industry,
  drop column proof_link,
  drop column achievement_summary;

comment on column public.candidates.whatsapp_number is 'WhatsApp contact from intake form.';
comment on column public.candidates.proof_document_url is 'URL to uploaded proof document.';
comment on column public.candidates.declaration_accepted is 'Whether the applicant accepted the declaration on the form.';

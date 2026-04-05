-- Testimonial Management CRM — initial schema
-- Requires: pgcrypto (gen_random_uuid) — enabled by default on Supabase

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.eligibility_status as enum (
  'pending_review',
  'eligible',
  'not_eligible'
);

create type public.interviewer as enum (
  'Harika',
  'Gargi',
  'Mudit',
  'Anushka'
);

create type public.interview_status as enum (
  'scheduled',
  'rescheduled',
  'completed',
  'cancelled'
);

create type public.interview_type as enum (
  'testimonial',
  'project'
);

create type public.dispatch_status as enum (
  'pending',
  'dispatched',
  'delivered'
);

create type public.notification_type as enum (
  'eligibility_reject',
  'interview_confirmation',
  'interview_reminder',
  'interview_thankyou',
  'dispatch_confirmation'
);

create type public.notification_log_status as enum (
  'sent',
  'failed'
);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  form_filled_date timestamptz,
  email text not null unique,
  full_name text,
  phone text,
  industry text,
  linkedin_url text,
  proof_link text,
  achievement_summary text,
  ai_eligibility_score integer,
  ai_eligibility_reason text,
  eligibility_status public.eligibility_status not null default 'pending_review',
  human_reviewed_by text,
  human_reviewed_at timestamptz,
  constraint candidates_ai_score_range check (
    ai_eligibility_score is null
    or (ai_eligibility_score >= 0 and ai_eligibility_score <= 100)
  )
);

create table public.interviews (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  scheduled_date timestamptz,
  interviewer public.interviewer not null,
  zoom_link text,
  language text,
  invitation_sent boolean,
  poc text,
  remarks text,
  reminder_count integer not null default 0,
  interview_status public.interview_status not null default 'scheduled',
  post_interview_eligible boolean,
  category text,
  funnel text,
  comments text,
  interview_type public.interview_type not null default 'testimonial'
);

create table public.dispatch (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  shipping_address text,
  dispatch_status public.dispatch_status not null default 'pending',
  dispatch_date timestamptz,
  expected_delivery_date timestamptz,
  actual_delivery_date timestamptz,
  tracking_id text,
  special_comments text
);

create table public.eligibility_criteria (
  id uuid primary key default gen_random_uuid(),
  criteria_name text not null,
  criteria_description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_eligibility_criteria_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger eligibility_criteria_set_updated_at
before update on public.eligibility_criteria
for each row
execute procedure public.set_eligibility_criteria_updated_at();

create table public.notifications_log (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  notification_type public.notification_type not null,
  sent_at timestamptz not null default now(),
  email_to text,
  status public.notification_log_status not null
);

-- ---------------------------------------------------------------------------
-- Indexes (foreign keys & common filters)
-- ---------------------------------------------------------------------------

create index interviews_candidate_id_idx on public.interviews (candidate_id);
create index dispatch_candidate_id_idx on public.dispatch (candidate_id);
create index notifications_log_candidate_id_idx on public.notifications_log (candidate_id);
create index notifications_log_sent_at_idx on public.notifications_log (sent_at desc);
create index candidates_eligibility_status_idx on public.candidates (eligibility_status);
create index eligibility_criteria_is_active_idx on public.eligibility_criteria (is_active)
  where is_active = true;

comment on table public.candidates is 'Leads and applicants from intake forms and reviews.';
comment on table public.interviews is 'Scheduled and completed interviews linked to candidates.';
comment on table public.dispatch is 'Physical gifts or materials shipped to eligible candidates.';
comment on table public.eligibility_criteria is 'Configurable rules used for eligibility evaluation.';
comment on table public.notifications_log is 'Audit log of outbound notifications.';

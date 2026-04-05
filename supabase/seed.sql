-- Seed data for local development (run after migrations via `supabase db reset`)

-- ---------------------------------------------------------------------------
-- Default eligibility criteria (examples)
-- ---------------------------------------------------------------------------

insert into public.eligibility_criteria (criteria_name, criteria_description, is_active)
values
  (
    'Course completion proof',
    'Candidate must provide verifiable proof of completing the program (certificate, portal screenshot, or official email).',
    true
  ),
  (
    'Minimum project or outcome',
    'Candidate should describe at least one concrete outcome, project, or measurable result tied to the program.',
    true
  ),
  (
    'Professional presentation',
    'Public-facing profile or submission is appropriate for testimonial use (no confidential or offensive content).',
    true
  );

-- ---------------------------------------------------------------------------
-- Demo candidates + one interview each — exercises all four interviewer enum values
-- ---------------------------------------------------------------------------

insert into public.candidates (
  id,
  email,
  full_name,
  eligibility_status,
  declaration_accepted,
  role_before_program
)
values
  (
    'a0000001-0000-4000-8000-000000000001',
    'seed.harika@example.com',
    'Seed Candidate — Harika slot',
    'eligible',
    true,
    'Software Engineer'
  ),
  (
    'a0000001-0000-4000-8000-000000000002',
    'seed.gargi@example.com',
    'Seed Candidate — Gargi slot',
    'eligible',
    true,
    'Teacher'
  ),
  (
    'a0000001-0000-4000-8000-000000000003',
    'seed.mudit@example.com',
    'Seed Candidate — Mudit slot',
    'eligible',
    true,
    'Analyst'
  ),
  (
    'a0000001-0000-4000-8000-000000000004',
    'seed.anushka@example.com',
    'Seed Candidate — Anushka slot',
    'eligible',
    true,
    'Associate'
  );

insert into public.interviews (
  candidate_id,
  scheduled_date,
  interviewer,
  language,
  invitation_sent,
  interview_status,
  interview_type
)
values
  (
    'a0000001-0000-4000-8000-000000000001',
    now() + interval '3 days',
    'Harika',
    'English',
    true,
    'scheduled',
    'testimonial'
  ),
  (
    'a0000001-0000-4000-8000-000000000002',
    now() + interval '4 days',
    'Gargi',
    'English',
    true,
    'scheduled',
    'testimonial'
  ),
  (
    'a0000001-0000-4000-8000-000000000003',
    now() + interval '5 days',
    'Mudit',
    'English',
    false,
    'scheduled',
    'project'
  ),
  (
    'a0000001-0000-4000-8000-000000000004',
    now() + interval '6 days',
    'Anushka',
    'English',
    true,
    'scheduled',
    'testimonial'
  );

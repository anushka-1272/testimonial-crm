-- Allow roster display names that differ from legacy first-name-only enum labels.
-- team_roster can use "Anushka Roy" while DB enum previously only had "Anushka".

ALTER TYPE public.interviewer ADD VALUE IF NOT EXISTS 'Anushka Roy';

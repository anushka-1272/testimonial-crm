export type InterviewColumnStatus =
  | "scheduled"
  | "rescheduled"
  | "completed"
  | "cancelled";

export type InterviewWithCandidate = {
  id: string;
  candidate_id: string;
  scheduled_date: string | null;
  interviewer: string;
  zoom_link: string | null;
  language: string | null;
  invitation_sent: boolean | null;
  poc: string | null;
  remarks: string | null;
  reminder_count: number;
  interview_status: InterviewColumnStatus;
  post_interview_eligible: boolean | null;
  category: string | null;
  funnel: string | null;
  comments: string | null;
  interview_type: "testimonial" | "project";
  candidates: {
    id: string;
    full_name: string | null;
    email: string;
  } | null;
};

export type EligibleCandidate = {
  id: string;
  full_name: string | null;
  email: string;
};

import type { TestimonialInterviewType } from "@/lib/testimonial-interview-type";

export type InterviewColumnStatus =
  | "draft"
  | "scheduled"
  | "rescheduled"
  | "completed"
  | "cancelled"
  | "no_show";

export type PostContentStatus =
  | "awaiting_posts"
  | "posts_confirmed"
  | "dispatch_ready"
  | "not_applicable";

export type InterviewWithCandidate = {
  id: string;
  candidate_id: string;
  scheduled_date: string | null;
  previous_scheduled_date: string | null;
  reschedule_reason: string | null;
  completed_at: string | null;
  interviewer: string | null;
  interviewer_assigned_at: string | null;
  zoom_link: string | null;
  zoom_account: string | null;
  not_eligible_recording_link: string | null;
  language: string | null;
  interview_language: string | null;
  invitation_sent: boolean | null;
  poc: string | null;
  remarks: string | null;
  reminder_count: number;
  interview_status: InterviewColumnStatus;
  post_interview_eligible: boolean | null;
  reward_item: string | null;
  category: string | null;
  funnel: string | null;
  comments: string | null;
  interview_type: TestimonialInterviewType;
  post_content_status: PostContentStatus | null;
  linkedin_post_url: string | null;
  blog_post_url: string | null;
  posts_confirmed_at: string | null;
  skip_social_posts: boolean;
  no_show_reason: string | null;
  no_show_at: string | null;
  candidates: {
    id: string;
    created_at?: string;
    full_name: string | null;
    email: string;
    whatsapp_number?: string | null;
    poc_assigned?: string | null;
    is_deleted?: boolean | null;
  } | null;
};

/** Physical interview track pipeline (`physical_interview_status`). */
export type PhysicalInterviewStatus =
  | "pending"
  | "completed"
  | "eligible"
  | "not_eligible";

/** @deprecated Use PhysicalInterviewStatus */
export type LinkedInTrackStatus = PhysicalInterviewStatus;

/** Matches `candidates.followup_status` + log outcome values. */
export type FollowupStatus =
  | "pending"
  | "no_answer"
  | "callback"
  | "wrong_number"
  | "not_interested"
  | "scheduled"
  | "interested"
  | "already_completed"
  | "not_eligible";

export type FollowupCallOutcome =
  | "no_answer"
  | "callback"
  | "interested"
  | "already_completed"
  | "not_eligible"
  | "not_interested"
  | "wrong_number";

export type FollowupLogRow = {
  id: string;
  created_at: string;
  candidate_id: string | null;
  project_candidate_id?: string | null;
  attempt_number: number;
  status: string;
  notes: string | null;
  callback_datetime: string | null;
  logged_by: string | null;
  logged_by_email: string | null;
};

export type EligibleCandidate = {
  id: string;
  created_at?: string;
  full_name: string | null;
  email: string;
  whatsapp_number?: string | null;
  interview_type: "testimonial" | "project" | null;
  poc_assigned: string | null;
  poc_assigned_at: string | null;
  assigned_at?: string | null;
  physical_interview_track: boolean;
  physical_interview_status: PhysicalInterviewStatus | null;
  physical_interview_city: string | null;
  followup_status: FollowupStatus;
  followup_count: number;
  callback_datetime: string | null;
  not_interested_reason: string | null;
  not_interested_at: string | null;
};

export type ProjectCandidateRow = {
  id: string;
  created_at?: string;
  email: string;
  full_name: string | null;
  whatsapp_number: string | null;
  project_title: string | null;
  problem_statement: string | null;
  target_user: string | null;
  ai_usage: string | null;
  demo_link: string | null;
  status: string;
  poc_assigned: string | null;
  poc_assigned_at: string | null;
  assigned_at?: string | null;
  interview_type: string | null;
  is_deleted?: boolean | null;
  /** Follow-up calling (pending pipeline); mirrors `candidates` follow-up fields */
  followup_status?: FollowupStatus;
  followup_count?: number;
  callback_datetime?: string | null;
  not_interested_reason?: string | null;
  not_interested_at?: string | null;
  physical_interview_track?: boolean;
  physical_interview_status?: PhysicalInterviewStatus | null;
  physical_interview_city?: string | null;
};

/** Row passed into `LogFollowupCallModal` for project pending tab */
export type ProjectLogFollowupRow = {
  id: string;
  full_name: string | null;
  email: string;
  whatsapp_number: string | null;
  poc_assigned: string | null;
  followup_status: FollowupStatus;
  followup_count: number;
  callback_datetime: string | null;
  not_interested_reason: string | null;
  not_interested_at: string | null;
};

/** Project pipeline interview row (joined with project_candidates). */
export type ProjectInterviewWithProjectCandidate = {
  id: string;
  created_at?: string;
  project_candidate_id: string;
  scheduled_date: string | null;
  previous_scheduled_date: string | null;
  reschedule_reason: string | null;
  completed_at: string | null;
  interviewer: string | null;
  interviewer_assigned_at: string | null;
  zoom_link: string | null;
  zoom_account: string | null;
  not_eligible_recording_link: string | null;
  language: string | null;
  invitation_sent: boolean | null;
  poc: string | null;
  remarks: string | null;
  reminder_count: number;
  interview_status: InterviewColumnStatus;
  post_interview_eligible: boolean | null;
  reward_item: string | null;
  category: string | null;
  funnel: string | null;
  comments: string | null;
  interview_type: "project";
  post_content_status: PostContentStatus | null;
  linkedin_post_url: string | null;
  blog_post_url: string | null;
  posts_confirmed_at: string | null;
  skip_social_posts: boolean;
  no_show_reason: string | null;
  no_show_at: string | null;
  project_candidates: ProjectCandidateRow | null;
};

export function isProjectInterviewRow(
  row: InterviewWithCandidate | ProjectInterviewWithProjectCandidate,
): row is ProjectInterviewWithProjectCandidate {
  return "project_candidate_id" in row && Boolean(row.project_candidate_id);
}

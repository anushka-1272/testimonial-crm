import type { SupabaseClient } from "@supabase/supabase-js";

import { logActivity } from "@/lib/activity-logger";
import { POC_INTERVIEWER_SLACK_EMAILS } from "@/lib/slack-contacts";
import { voidSlackNotify } from "@/lib/slack-client";
import { getUserSafe } from "@/lib/supabase-auth";

import {
  isProjectInterviewRow,
  type InterviewWithCandidate,
  type ProjectInterviewWithProjectCandidate,
} from "./types";

export type ReschedulePipelineKind = "testimonial" | "project";

export type RescheduleableInterview =
  | InterviewWithCandidate
  | ProjectInterviewWithProjectCandidate;

export function rescheduleKindFromInterview(
  interview: RescheduleableInterview,
): ReschedulePipelineKind {
  return isProjectInterviewRow(interview) ? "project" : "testimonial";
}

/** Display name for Slack / activity (testimonial: name || email; project: name || title || email). */
export function rescheduleCandidateDisplayName(
  interview: RescheduleableInterview,
  kind: ReschedulePipelineKind,
): string {
  if (kind === "project" && isProjectInterviewRow(interview)) {
    const pc = interview.project_candidates;
    if (!pc) return "Candidate";
    return (
      pc.full_name?.trim() ||
      pc.project_title?.trim() ||
      pc.email?.trim() ||
      "Candidate"
    );
  }
  const t = interview as InterviewWithCandidate;
  return (
    t.candidates?.full_name?.trim() ||
    t.candidates?.email?.trim() ||
    "Candidate"
  );
}

export function slackProjectInterviewSuffix(kind: ReschedulePipelineKind): string {
  return kind === "project" ? "\n\n(Project Interview)" : "";
}

/** Draft + cleared Zoom; interviewer cleared so Anushka re-assigns per reschedule → Slack workflow. */
export function buildRescheduleDraftPatch(input: {
  previousScheduledDate: string | null;
  reasonText: string;
  scheduledDateIso: string;
}): Record<string, unknown> {
  return {
    previous_scheduled_date: input.previousScheduledDate,
    reschedule_reason: input.reasonText,
    scheduled_date: input.scheduledDateIso,
    interviewer: null,
    interview_status: "draft",
    zoom_link: null,
    zoom_account: null,
    interviewer_assigned_at: null,
    invitation_sent: false,
  };
}

/**
 * Draft created by the reschedule flow: `interview_status` stays `draft` while
 * interviewer/zoom are cleared. We persist the reason on every reschedule; we
 * also persist the prior slot when it existed. Either signal distinguishes this
 * from a brand-new draft from Eligible (no reason, no previous slot).
 */
export function isPostRescheduleDraftRow(row: {
  interview_status?: string | null;
  previous_scheduled_date?: string | null;
  reschedule_reason?: string | null;
}): boolean {
  if (row.interview_status !== "draft") return false;
  return (
    Boolean(row.previous_scheduled_date?.trim()) ||
    Boolean(row.reschedule_reason?.trim())
  );
}

function slackStep1RescheduledAnushka(
  candidateName: string,
  kind: ReschedulePipelineKind,
): string {
  const base =
    `Interview rescheduled for ${candidateName}. Please assign interviewer.`;
  return `${base}${slackProjectInterviewSuffix(kind)}`;
}

/** Step 2: after interviewer is assigned on a post-reschedule draft, notify Dishan to add Zoom. */
export function slackStep2InterviewerAssignedDishan(
  candidateName: string,
  kind: ReschedulePipelineKind,
): string {
  const base =
    `Interviewer assigned for ${candidateName}. Please add Zoom link.`;
  return `${base}${slackProjectInterviewSuffix(kind)}`;
}

/**
 * Apply reschedule: move row to draft, clear Zoom & interviewer, persist new slot + reason,
 * log activity, notify Anushka (step 1). Dishan is notified only after assign (step 2).
 */
export async function handleReschedule(
  supabase: SupabaseClient,
  interview: RescheduleableInterview,
  type: ReschedulePipelineKind,
  input: { scheduledDateIso: string; reasonText: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const table = type === "project" ? "project_interviews" : "interviews";
  const candDisplay = rescheduleCandidateDisplayName(interview, type);
  const patch = buildRescheduleDraftPatch({
    previousScheduledDate: interview.scheduled_date,
    reasonText: input.reasonText,
    scheduledDateIso: input.scheduledDateIso,
  });

  const { error: upErr } = await supabase
    .from(table)
    .update(patch)
    .eq("id", interview.id);

  if (upErr) {
    return { ok: false, error: upErr.message };
  }

  const authRe = await getUserSafe(supabase);
  if (authRe) {
    await logActivity({
      supabase,
      user: authRe,
      action_type: "interviews",
      entity_type: "interview",
      entity_id: interview.id,
      candidate_name: candDisplay,
      description: `Interview rescheduled for ${candDisplay}`,
      metadata: {
        pipeline: type,
        reason: input.reasonText,
        scheduled_date: input.scheduledDateIso,
      },
    });
  }

  const anushkaMsg = slackStep1RescheduledAnushka(candDisplay, type);
  voidSlackNotify(supabase, POC_INTERVIEWER_SLACK_EMAILS.Anushka, anushkaMsg);

  return { ok: true };
}

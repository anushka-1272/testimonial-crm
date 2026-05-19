import type { SupabaseClient, User } from "@supabase/supabase-js";

import { logActivity } from "@/lib/activity-logger";

/**
 * Revert a scheduled interview back to the callings (follow-up) pipeline.
 * - Deletes the row in `interviews` / `project_interviews`.
 * - Resets the candidate's follow-up fields so they reappear in callings.
 * - Keeps `poc_assigned` unchanged (same POC continues owning the candidate).
 */
export async function revertInterviewToCallings(opts: {
  supabase: SupabaseClient;
  interviewId: string;
  candidateId: string;
  isProject: boolean;
  candidateName: string;
  user: User | null;
}): Promise<{ error: string | null }> {
  const { supabase, interviewId, candidateId, isProject, candidateName, user } = opts;

  const interviewTable = isProject ? "project_interviews" : "interviews";
  const candidateTable = isProject ? "project_candidates" : "candidates";

  const { data: deleted, error: delErr } = await supabase
    .from(interviewTable)
    .delete()
    .eq("id", interviewId)
    .select("id");
  if (delErr) {
    return { error: delErr.message };
  }
  if (!deleted?.length) {
    return {
      error:
        "Could not remove the scheduled interview. Database delete permission may be missing — contact your admin.",
    };
  }

  const candidateUpdate = isProject
    ? supabase
        .from(candidateTable)
        .update({
          followup_status: "pending",
          followup_count: 0,
          callback_datetime: null,
          not_interested_reason: null,
          not_interested_at: null,
        })
        .eq("id", candidateId)
        .eq("is_deleted", false)
    : supabase
        .from(candidateTable)
        .update({
          followup_status: "pending",
          followup_count: 0,
          callback_datetime: null,
          not_interested_reason: null,
          not_interested_at: null,
        })
        .eq("id", candidateId)
        .eq("is_deleted", false);

  const { error: updErr } = await candidateUpdate;
  if (updErr) {
    return { error: updErr.message };
  }

  if (user) {
    await logActivity({
      supabase,
      user,
      action_type: "interviews",
      entity_type: isProject ? "project_interview" : "interview",
      entity_id: interviewId,
      candidate_name: candidateName,
      description: `Reverted ${candidateName} from scheduled back to callings`,
      metadata: { reverted: true, project: isProject },
    });
  }

  return { error: null };
}

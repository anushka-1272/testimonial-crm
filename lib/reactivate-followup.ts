import type { SupabaseClient } from "@supabase/supabase-js";

import { FOLLOWUP_CYCLE_RESET_STATUS } from "./followup-constants";
import { displayNameFromUser, getUserSafe } from "./supabase-auth";

/**
 * Put a not-interested candidate back on the calling list with a fresh
 * 3-attempt budget. A reset row is written first so the auto not-interested
 * sync does not immediately re-apply the previous no-answer history.
 */
export async function reactivateFollowupCandidate(opts: {
  supabase: SupabaseClient;
  table: "candidates" | "project_candidates";
  id: string;
}): Promise<{ error: string | null }> {
  const actor = await getUserSafe(opts.supabase);
  const logRow =
    opts.table === "project_candidates"
      ? {
          project_candidate_id: opts.id,
          attempt_number: 0,
          status: FOLLOWUP_CYCLE_RESET_STATUS,
          notes: "Marked active again. Follow-up attempts reset.",
          logged_by: actor ? displayNameFromUser(actor) : null,
          logged_by_email: actor?.email ?? null,
        }
      : {
          candidate_id: opts.id,
          attempt_number: 0,
          status: FOLLOWUP_CYCLE_RESET_STATUS,
          notes: "Marked active again. Follow-up attempts reset.",
          logged_by: actor ? displayNameFromUser(actor) : null,
          logged_by_email: actor?.email ?? null,
        };

  const { error: logErr } = await opts.supabase.from("followup_log").insert(logRow);
  if (logErr) return { error: logErr.message };

  const { data, error: upErr } = await opts.supabase
    .from(opts.table)
    .update({
      followup_status: "pending",
      followup_count: 0,
      callback_datetime: null,
      not_interested_reason: null,
      not_interested_at: null,
    })
    .eq("id", opts.id)
    .eq("is_deleted", false)
    .select("id");

  if (upErr) return { error: upErr.message };
  if (!data?.length) {
    return {
      error: "Could not mark this candidate active. Refresh and try again.",
    };
  }
  return { error: null };
}

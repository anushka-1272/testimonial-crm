import type { SupabaseClient } from "@supabase/supabase-js";

import {
  chooseDispatchForLookup,
  digitsOnly,
  normalizeSupportLookupPayload,
  pickBestInterviewForLookup,
  type SupportCandidate,
  type SupportDispatch,
  type SupportInterview,
  type SupportLookupPayload,
} from "@/lib/support-lookup";

const CANDIDATE_SELECT =
  "id, full_name, email, whatsapp_number, eligibility_status, interview_type, poc_assigned, congratulation_call_pending, followup_status, followup_count, callback_datetime, not_interested_reason";

/** Omit `created_at` on interviews — not present in all deployed DBs; pickBest runs in memory. */
const INTERVIEW_SELECT =
  "id, interview_status, scheduled_date, interviewer, reschedule_reason, interview_type, reward_item, completed_at";

const DISPATCH_SELECT =
  "dispatch_status, tracking_id, expected_delivery_date, reward_item, special_comments, created_at, dispatch_date";

export type PublicCandidateLookupResponse =
  | { ok: true; payload: SupportLookupPayload }
  | { ok: false; notFound: true }
  | { ok: false; multiPhone: true }
  | { ok: false; error: string };

/**
 * Shared lookup used by the login modal and POST /api/public/candidate-lookup.
 * Pass a service-role client in production so interview/dispatch rows are visible
 * even when browser RLS policies differ.
 */
export async function runPublicCandidateLookup(
  supabase: SupabaseClient,
  raw: string,
): Promise<PublicCandidateLookupResponse> {
  const query = raw.trim();
  if (!query || query.length > 200) {
    return { ok: false, error: "Invalid query" };
  }

  let candidate: SupportCandidate | null = null;

  if (query.includes("@")) {
    const { data, error } = await supabase
      .from("candidates")
      .select(CANDIDATE_SELECT)
      .eq("is_deleted", false)
      .ilike("email", query)
      .limit(2);
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as SupportCandidate[];
    if (rows.length === 1) candidate = rows[0]!;
    else return { ok: false, notFound: true };
  } else {
    const digits = digitsOnly(query);
    if (digits.length < 8) return { ok: false, notFound: true };
    const { data, error } = await supabase
      .from("candidates")
      .select(CANDIDATE_SELECT)
      .eq("is_deleted", false)
      .ilike("whatsapp_number", `%${digits}%`)
      .limit(15);
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as SupportCandidate[];
    const normalized = rows.filter((r) => {
      const w = digitsOnly(r.whatsapp_number ?? "");
      if (!w) return false;
      return (
        w === digits ||
        w.endsWith(digits) ||
        digits.endsWith(w) ||
        w.includes(digits)
      );
    });
    if (normalized.length === 1) candidate = normalized[0]!;
    else if (normalized.length === 0) return { ok: false, notFound: true };
    else return { ok: false, multiPhone: true };
  }

  if (!candidate) return { ok: false, notFound: true };

  const { data: intRows, error: intErr } = await supabase
    .from("interviews")
    .select(INTERVIEW_SELECT)
    .eq("candidate_id", candidate.id)
    .limit(120);

  if (intErr) return { ok: false, error: intErr.message };

  let interview = pickBestInterviewForLookup(
    (intRows ?? []) as SupportInterview[],
  );

  if (!interview) {
    const { data: ppRows, error: ppErr } = await supabase
      .from("post_production")
      .select("interview_id")
      .eq("candidate_id", candidate.id)
      .not("interview_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1);

    if (ppErr) return { ok: false, error: ppErr.message };

    const interviewId = (ppRows?.[0] as { interview_id?: string } | undefined)
      ?.interview_id;
    if (interviewId) {
      const { data: ivRow, error: ivErr } = await supabase
        .from("interviews")
        .select(INTERVIEW_SELECT)
        .eq("id", interviewId)
        .maybeSingle();

      if (ivErr) return { ok: false, error: ivErr.message };
      if (ivRow) interview = ivRow as SupportInterview;
    }
  }

  let dispatchList: SupportDispatch[] = [];
  const { data: dispRows, error: dispErr } = await supabase
    .from("dispatch")
    .select(DISPATCH_SELECT)
    .eq("candidate_id", candidate.id)
    .order("dispatch_date", { ascending: false, nullsFirst: false })
    .limit(30);

  if (dispErr) {
    const { data: dispRetry, error: dispRetryErr } = await supabase
      .from("dispatch")
      .select(
        "dispatch_status, tracking_id, expected_delivery_date, reward_item, special_comments",
      )
      .eq("candidate_id", candidate.id)
      .limit(30);
    if (dispRetryErr) return { ok: false, error: dispRetryErr.message };
    dispatchList = (dispRetry ?? []) as SupportDispatch[];
  } else {
    dispatchList = (dispRows ?? []) as SupportDispatch[];
  }

  let dispatch = chooseDispatchForLookup(dispatchList);

  return {
    ok: true,
    payload: normalizeSupportLookupPayload({
      candidate,
      interview,
      dispatch,
    }),
  };
}

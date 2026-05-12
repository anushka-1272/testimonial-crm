import type { SupabaseClient } from "@supabase/supabase-js";

import {
  attachIdentity,
  buildCandidateLookupCard,
  type CandidateLookupSnapshot,
} from "./build-card";
import type { CandidateLookupApiResponse } from "./types";

const CANDIDATE_SELECT =
  "id, full_name, email, whatsapp_number, eligibility_status, interview_type, poc_assigned, congratulation_call_pending, followup_status, followup_count, callback_datetime, not_interested_reason";

const INTERVIEW_SELECT =
  "id, interview_status, scheduled_date, interviewer, reschedule_reason, interview_type, reward_item, completed_at";

const DISPATCH_SELECT_FULL =
  "dispatch_status, tracking_id, expected_delivery_date, reward_item, special_comments, created_at, dispatch_date";

const DISPATCH_SELECT_MIN =
  "dispatch_status, tracking_id, expected_delivery_date, reward_item, special_comments";

type DbEligibility = "pending_review" | "eligible" | "not_eligible";
type DbInterviewType = "testimonial" | "project";
type DbDispatchStatus = "pending" | "dispatched" | "delivered";

type CandidateRow = {
  id: string;
  full_name: string | null;
  email: string;
  whatsapp_number: string | null;
  eligibility_status: DbEligibility;
  interview_type: DbInterviewType | null;
  poc_assigned: string | null;
  congratulation_call_pending: boolean | null;
  followup_status: string | null;
  followup_count: number | null;
  callback_datetime: string | null;
  not_interested_reason: string | null;
};

type InterviewRow = {
  id: string;
  interview_status: string;
  scheduled_date: string | null;
  interviewer: string | null;
  reschedule_reason: string | null;
  interview_type: DbInterviewType;
  reward_item: string | null;
  completed_at: string | null;
};

type DispatchRow = {
  dispatch_status: DbDispatchStatus;
  tracking_id: string | null;
  expected_delivery_date: string | null;
  reward_item: string | null;
  special_comments?: string | null;
  created_at?: string | null;
  dispatch_date?: string | null;
};

export function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

function isLinkedInDispatch(d: DispatchRow): boolean {
  return (d.special_comments ?? "").toLowerCase().includes("linkedin track");
}

function dispatchRecencyKey(d: DispatchRow): number {
  const iso =
    d.dispatch_date?.trim() ??
    d.created_at?.trim() ??
    d.expected_delivery_date?.trim() ??
    "";
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/** Prefer testimonial reward rows when multiple `dispatch` rows exist. */
export function pickTestimonialDispatch(rows: DispatchRow[]): DispatchRow | null {
  if (!rows.length) return null;
  const nonLi = rows.filter((r) => !isLinkedInDispatch(r));
  const pool = nonLi.length ? nonLi : rows;
  const withReward = pool.filter((r) => r.reward_item?.trim());
  const candidates = withReward.length ? withReward : pool;
  return [...candidates].sort(
    (a, b) => dispatchRecencyKey(b) - dispatchRecencyKey(a),
  )[0]!;
}

type EffectiveInterview =
  | "draft"
  | "scheduled"
  | "rescheduled"
  | "completed"
  | "cancelled";

function effectiveInterview(row: InterviewRow): EffectiveInterview {
  if (row.completed_at?.trim()) return "completed";
  const raw = String(row.interview_status ?? "")
    .trim()
    .toLowerCase();
  if (
    raw === "completed" ||
    raw === "scheduled" ||
    raw === "rescheduled" ||
    raw === "draft" ||
    raw === "cancelled"
  ) {
    return raw as EffectiveInterview;
  }
  if (row.scheduled_date?.trim()) return "scheduled";
  return "draft";
}

function pickPrimaryInterview(rows: InterviewRow[]): InterviewRow | null {
  if (rows.length === 0) return null;
  if (rows.length === 1) return rows[0] ?? null;

  const rank = (s: EffectiveInterview): number => {
    switch (s) {
      case "completed":
        return 5;
      case "scheduled":
      case "rescheduled":
        return 4;
      case "draft":
        return 3;
      case "cancelled":
        return 1;
      default:
        return 0;
    }
  };

  const t = (iso: string | null | undefined): number => {
    if (!iso?.trim()) return 0;
    try {
      return new Date(iso.trim()).getTime();
    } catch {
      return 0;
    }
  };

  return [...rows].sort((a, b) => {
    const sa = effectiveInterview(a);
    const sb = effectiveInterview(b);
    const ra = rank(sa);
    const rb = rank(sb);
    if (rb !== ra) return rb - ra;
    if (sa === "completed" && sb === "completed") {
      return t(b.completed_at) - t(a.completed_at);
    }
    if (
      (sa === "scheduled" || sa === "rescheduled") &&
      (sb === "scheduled" || sb === "rescheduled")
    ) {
      return t(b.scheduled_date) - t(a.scheduled_date);
    }
    return 0;
  })[0]!;
}

function mapInterview(row: InterviewRow): NonNullable<CandidateLookupSnapshot["interview"]> {
  return {
    effective: effectiveInterview(row),
    scheduledDate: row.scheduled_date,
    interviewer: row.interviewer,
    rescheduleReason: row.reschedule_reason,
    interviewType: row.interview_type,
    rewardItem: row.reward_item,
  };
}

function mapDispatch(row: DispatchRow): NonNullable<CandidateLookupSnapshot["testimonialDispatch"]> {
  return {
    status: row.dispatch_status,
    trackingId: row.tracking_id,
    expectedDeliveryDate: row.expected_delivery_date,
    rewardItem: row.reward_item,
  };
}

export async function runCandidateLookup(
  supabase: SupabaseClient,
  raw: string,
): Promise<CandidateLookupApiResponse> {
  const query = raw.trim();
  if (!query || query.length > 200) {
    return { ok: false, reason: "error", message: "Invalid query" };
  }

  let candidate: CandidateRow | null = null;

  if (query.includes("@")) {
    const { data, error } = await supabase
      .from("candidates")
      .select(CANDIDATE_SELECT)
      .eq("is_deleted", false)
      .ilike("email", query)
      .limit(2);
    if (error) return { ok: false, reason: "error", message: error.message };
    const rows = (data ?? []) as CandidateRow[];
    if (rows.length === 1) candidate = rows[0]!;
    else return { ok: false, reason: "not_found" };
  } else {
    const digits = digitsOnly(query);
    if (digits.length < 8) return { ok: false, reason: "not_found" };
    const { data, error } = await supabase
      .from("candidates")
      .select(CANDIDATE_SELECT)
      .eq("is_deleted", false)
      .ilike("whatsapp_number", `%${digits}%`)
      .limit(15);
    if (error) return { ok: false, reason: "error", message: error.message };
    const rows = (data ?? []) as CandidateRow[];
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
    else if (normalized.length === 0) return { ok: false, reason: "not_found" };
    else return { ok: false, reason: "multi_phone" };
  }

  if (!candidate) return { ok: false, reason: "not_found" };

  const { data: intRows, error: intErr } = await supabase
    .from("interviews")
    .select(INTERVIEW_SELECT)
    .eq("candidate_id", candidate.id)
    .limit(120);

  if (intErr) return { ok: false, reason: "error", message: intErr.message };

  let primaryIv = pickPrimaryInterview((intRows ?? []) as InterviewRow[]);

  if (!primaryIv) {
    const { data: ppRows, error: ppErr } = await supabase
      .from("post_production")
      .select("interview_id")
      .eq("candidate_id", candidate.id)
      .not("interview_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1);

    if (ppErr) return { ok: false, reason: "error", message: ppErr.message };

    const interviewId = (ppRows?.[0] as { interview_id?: string } | undefined)
      ?.interview_id;
    if (interviewId) {
      const { data: ivRow, error: ivErr } = await supabase
        .from("interviews")
        .select(INTERVIEW_SELECT)
        .eq("id", interviewId)
        .maybeSingle();

      if (ivErr) return { ok: false, reason: "error", message: ivErr.message };
      if (ivRow) primaryIv = ivRow as InterviewRow;
    }
  }

  let dispatchList: DispatchRow[] = [];
  const { data: dispRows, error: dispErr } = await supabase
    .from("dispatch")
    .select(DISPATCH_SELECT_FULL)
    .eq("candidate_id", candidate.id)
    .order("dispatch_date", { ascending: false, nullsFirst: false })
    .limit(30);

  if (dispErr) {
    const { data: dispRetry, error: dispRetryErr } = await supabase
      .from("dispatch")
      .select(DISPATCH_SELECT_MIN)
      .eq("candidate_id", candidate.id)
      .limit(30);
    if (dispRetryErr)
      return { ok: false, reason: "error", message: dispRetryErr.message };
    dispatchList = (dispRetry ?? []) as DispatchRow[];
  } else {
    dispatchList = (dispRows ?? []) as DispatchRow[];
  }

  const testimonialDispatchRow = pickTestimonialDispatch(dispatchList);
  const testimonialDispatch = testimonialDispatchRow
    ? mapDispatch(testimonialDispatchRow)
    : null;

  const interview = primaryIv ? mapInterview(primaryIv) : null;

  const snapshot: CandidateLookupSnapshot = {
    eligibility: candidate.eligibility_status,
    congratulationCallPending: candidate.congratulation_call_pending,
    followupStatus: candidate.followup_status,
    followupCount: candidate.followup_count,
    callbackDatetime: candidate.callback_datetime,
    candidateInterviewType: candidate.interview_type,
    interview,
    testimonialDispatch,
    poc: candidate.poc_assigned,
  };

  const cardBase = buildCandidateLookupCard(snapshot);
  const card = attachIdentity(cardBase, {
    fullName: candidate.full_name?.trim() || "—",
    email: candidate.email,
    phone: candidate.whatsapp_number?.trim() || null,
  });

  return { ok: true, card };
}
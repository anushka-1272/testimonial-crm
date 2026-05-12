import { format, isToday, isTomorrow, parseISO } from "date-fns";

export type EligibilityStatus = "pending_review" | "eligible" | "not_eligible";
export type InterviewStatus =
  | "draft"
  | "scheduled"
  | "rescheduled"
  | "completed"
  | "cancelled";
export type DispatchStatus = "pending" | "dispatched" | "delivered";
export type InterviewType = "testimonial" | "project";

export type SupportCandidate = {
  id: string;
  full_name: string | null;
  email: string;
  whatsapp_number: string | null;
  eligibility_status: EligibilityStatus;
  interview_type: InterviewType | null;
  poc_assigned: string | null;
  congratulation_call_pending: boolean | null;
  followup_status: string | null;
  followup_count: number | null;
  callback_datetime: string | null;
  not_interested_reason: string | null;
};

export type SupportInterview = {
  interview_status: InterviewStatus;
  scheduled_date: string | null;
  interviewer: string | null;
  reschedule_reason: string | null;
  interview_type: InterviewType;
  reward_item: string | null;
  completed_at?: string | null;
  created_at?: string | null;
};

export type SupportDispatch = {
  dispatch_status: DispatchStatus;
  tracking_id: string | null;
  expected_delivery_date: string | null;
  reward_item: string | null;
};

export type SupportLookupPayload = {
  candidate: SupportCandidate;
  interview: SupportInterview | null;
  dispatch: SupportDispatch | null;
};

/** Candidate-facing follow-up line shown on the login lookup card. */
export type SupportFollowupStatusDisplay = {
  title: string;
  subtitle: string | null;
};

export type SupportStatusKind =
  | "under_review"
  | "not_eligible"
  | "eligible_unscheduled"
  | "interview_draft"
  | "scheduled"
  | "rescheduled"
  | "completed"
  | "reward_processing"
  | "reward_dispatched"
  | "reward_delivered"
  | "cancelled";

export type SupportStatusDisplay = {
  kind: SupportStatusKind;
  title: string;
  /** Tailwind classes for the status pill (bg, text, optional ring). */
  badgeClass: string;
  lines: string[];
};

function formatSlot(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    return format(parseISO(iso), "MMM d, yyyy · h:mm a");
  } catch {
    return null;
  }
}

/** Short relative phrase for login lookup (e.g. "tomorrow at 3:00 PM"). */
export function formatScheduledHeadline(iso: string | null | undefined): string | null {
  if (!iso?.trim()) return null;
  try {
    const d = parseISO(iso.trim());
    const time = format(d, "h:mm a");
    if (isToday(d)) return `today at ${time}`;
    if (isTomorrow(d)) return `tomorrow at ${time}`;
    return `${format(d, "MMM d")} at ${time}`;
  } catch {
    return null;
  }
}

/**
 * Row is "completed" when `completed_at` is set even if `interview_status` was not updated.
 * Normalizes unknown status strings to a safe bucket for ranking/display.
 */
export function effectiveInterviewStatus(iv: SupportInterview): InterviewStatus {
  if (iv.completed_at?.trim()) return "completed";
  const raw = String(iv.interview_status ?? "")
    .trim()
    .toLowerCase();
  if (
    raw === "completed" ||
    raw === "scheduled" ||
    raw === "rescheduled" ||
    raw === "draft" ||
    raw === "cancelled"
  ) {
    return raw as InterviewStatus;
  }
  if (iv.scheduled_date?.trim()) return "scheduled";
  return "draft";
}

function formatDateOnly(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    return format(parseISO(iso), "MMM d, yyyy");
  } catch {
    return null;
  }
}

/**
 * When multiple interview rows exist for one candidate, prefer the row that best
 * reflects pipeline reality (completed beats a newer draft, etc.).
 */
export function pickBestInterviewForLookup(
  rows: SupportInterview[],
): SupportInterview | null {
  if (rows.length === 0) return null;
  if (rows.length === 1) return rows[0] ?? null;

  const rank = (s: InterviewStatus): number => {
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

  const completedTime = (iso: string | null | undefined): number => {
    if (!iso?.trim()) return 0;
    try {
      return new Date(iso.trim()).getTime();
    } catch {
      return 0;
    }
  };

  const scheduledTime = (iso: string | null | undefined): number =>
    completedTime(iso);

  return [...rows].sort((a, b) => {
    const sa = effectiveInterviewStatus(a);
    const sb = effectiveInterviewStatus(b);
    const ra = rank(sa);
    const rb = rank(sb);
    if (rb !== ra) return rb - ra;

    const same = sa === "completed" && sb === "completed";
    if (same) {
      return (
        completedTime(b.completed_at) - completedTime(a.completed_at)
      );
    }

    if (
      (sa === "scheduled" || sa === "rescheduled") &&
      (sb === "scheduled" || sb === "rescheduled")
    ) {
      return scheduledTime(b.scheduled_date) - scheduledTime(a.scheduled_date);
    }

    const ca = completedTime(a.created_at);
    const cb = completedTime(b.created_at);
    return cb - ca;
  })[0]!;
}

/**
 * Public copy for the candidate lookup modal. Callback and not_interested take
 * precedence; otherwise any positive followup_count shows the no-answer attempts line.
 * When an interview row shows scheduling or completion, outbound follow-up lines are hidden
 * so viewers don't see stale "called — no answer" after the pipeline moved forward.
 */
export function resolveFollowupStatusPublicDisplay(
  candidate: SupportCandidate,
  interview: SupportInterview | null,
): SupportFollowupStatusDisplay | null {
  // Eligible + no interview row: outreach copy is folded into resolveSupportStatus.
  if (candidate.eligibility_status === "eligible" && !interview) {
    return null;
  }
  // Hide outbound follow-up once there is a real pipeline row (draft → completed).
  // Keep follow-up visible only when there is no interview yet, or it was cancelled.
  if (interview && effectiveInterviewStatus(interview) !== "cancelled") {
    return null;
  }

  const count = Math.max(0, Number(candidate.followup_count ?? 0));
  const status = (candidate.followup_status ?? "").trim();

  if (status === "callback") {
    const when = formatSlot(candidate.callback_datetime);
    return {
      title: when
        ? `Callback Scheduled — ${when}`
        : "Callback Scheduled",
      subtitle: null,
    };
  }

  if (status === "not_interested") {
    return { title: "Not Interested", subtitle: null };
  }

  if (status === "already_completed") {
    return { title: "Interview already completed", subtitle: null };
  }

  if (status === "not_eligible") {
    return {
      title: "Not eligible for post production",
      subtitle: "Interview completed; follow-up logged as not eligible",
    };
  }

  if (count > 0) {
    return {
      title:
        count === 1
          ? "Called once — did not pick up"
          : `Called ${count} times — did not pick up`,
      subtitle: "Our team will try again",
    };
  }

  return null;
}

export function resolveSupportStatus(
  payload: SupportLookupPayload,
): SupportStatusDisplay {
  const { candidate, interview, dispatch } = payload;

  if (candidate.eligibility_status === "not_eligible") {
    return {
      kind: "not_eligible",
      title: "Not Eligible",
      badgeClass:
        "bg-red-50 text-red-800 ring-1 ring-red-200/80",
      lines: [],
    };
  }

  if (candidate.eligibility_status === "pending_review") {
    return {
      kind: "under_review",
      title: "Under Review",
      badgeClass:
        "bg-amber-50 text-amber-900 ring-1 ring-amber-200/80",
      lines: [],
    };
  }

  // eligible — no interview row: fold congratulation + follow-up into one status.
  if (!interview) {
    const lines: string[] = [];
    let title = "Eligible — interview not scheduled yet";

    if (candidate.congratulation_call_pending === true) {
      title = "Eligible — calling pending";
    } else {
      const count = Math.max(0, Number(candidate.followup_count ?? 0));
      const fs = (candidate.followup_status ?? "").trim();

      if (fs === "callback") {
        const when = formatSlot(candidate.callback_datetime);
        title = when ? `Callback scheduled — ${when}` : "Callback scheduled";
      } else if (fs === "not_interested") {
        title = "Not interested";
      } else if (fs === "already_completed") {
        title = "Marked as interview already completed";
      } else if (fs === "not_eligible") {
        title = "Not eligible (per follow-up)";
        lines.push("Latest follow-up after your interview.");
      } else if (count > 0) {
        title =
          count === 1
            ? "Called once — did not pick up"
            : `Called ${count} times — did not pick up`;
        lines.push("Our team will try again soon.");
      }
    }

    return {
      kind: "eligible_unscheduled",
      title,
      badgeClass:
        "bg-blue-50 text-blue-900 ring-1 ring-blue-200/80",
      lines,
    };
  }

  const st = effectiveInterviewStatus(interview);
  const ivName = interview.interviewer?.trim() || "To be assigned";

  if (st === "cancelled") {
    return {
      kind: "cancelled",
      title: "Interview cancelled",
      badgeClass:
        "bg-zinc-100 text-zinc-700 ring-1 ring-zinc-200/80",
      lines: [],
    };
  }

  if (st === "draft") {
    const head = formatScheduledHeadline(interview.scheduled_date);
    const lines: string[] = [`Interviewer: ${ivName}`];
    if (interview.scheduled_date?.trim()) {
      const full = formatSlot(interview.scheduled_date);
      if (full) lines.push(`Slot: ${full}`);
    }
    lines.push("Zoom link is not live yet.");
    return {
      kind: "interview_draft",
      title: head
        ? `Scheduled for ${head} — Zoom pending`
        : "Interview slot reserved — Zoom pending",
      badgeClass:
        "bg-amber-50 text-amber-900 ring-1 ring-amber-200/80",
      lines,
    };
  }

  if (st === "scheduled") {
    const head = formatScheduledHeadline(interview.scheduled_date);
    const lines: string[] = [`Interviewer: ${ivName}`];
    const full = formatSlot(interview.scheduled_date);
    if (full) lines.push(`Slot: ${full}`);
    return {
      kind: "scheduled",
      title: head ? `Scheduled for ${head}` : "Interview scheduled",
      badgeClass:
        "bg-blue-50 text-blue-900 ring-1 ring-blue-200/80",
      lines,
    };
  }

  if (st === "rescheduled") {
    const head = formatScheduledHeadline(interview.scheduled_date);
    const lines: string[] = [`Interviewer: ${ivName}`];
    const full = formatSlot(interview.scheduled_date);
    if (full) lines.push(`New slot: ${full}`);
    const reason = interview.reschedule_reason?.trim();
    if (reason) lines.push(`Reason: ${reason}`);
    return {
      kind: "rescheduled",
      title: head ? `Rescheduled — ${head}` : "Interview rescheduled",
      badgeClass:
        "bg-orange-50 text-orange-900 ring-1 ring-orange-200/80",
      lines,
    };
  }

  if (st !== "completed") {
    const lines: string[] = [`Interviewer: ${ivName}`];
    const full = formatSlot(interview.scheduled_date);
    if (full) lines.push(`Slot: ${full}`);
    return {
      kind: "scheduled",
      title: "Interview status updating",
      badgeClass:
        "bg-blue-50 text-blue-900 ring-1 ring-blue-200/80",
      lines,
    };
  }

  // completed
  if (!dispatch) {
    return {
      kind: "completed",
      title: "Interview done — dispatch pending",
      badgeClass:
        "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200/80",
      lines: [],
    };
  }

  const ds = dispatch.dispatch_status;

  if (ds === "pending") {
    return {
      kind: "reward_processing",
      title: "Interview done — reward processing",
      badgeClass:
        "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200/80",
      lines: [],
    };
  }

  if (ds === "dispatched") {
    const lines: string[] = [];
    if (dispatch.tracking_id?.trim()) {
      lines.push(`Tracking: ${dispatch.tracking_id.trim()}`);
    }
    const exp = formatDateOnly(dispatch.expected_delivery_date);
    if (exp) lines.push(`Expected delivery: ${exp}`);
    return {
      kind: "reward_dispatched",
      title: "Dispatched — delivery pending",
      badgeClass:
        "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200/80",
      lines,
    };
  }

  // delivered
  return {
    kind: "reward_delivered",
    title: "Delivered",
    badgeClass:
      "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200/80",
    lines: [],
  };
}

export function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

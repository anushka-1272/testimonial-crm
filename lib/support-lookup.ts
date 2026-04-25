import { format, parseISO } from "date-fns";

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
  followup_status: string | null;
  followup_count: number | null;
  callback_datetime: string | null;
  not_interested_reason: string | null;
};

export type SupportInterview = {
  interview_status: InterviewStatus;
  scheduled_date: string | null;
  interviewer: string;
  reschedule_reason: string | null;
  interview_type: InterviewType;
  reward_item: string | null;
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

function formatDateOnly(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    return format(parseISO(iso), "MMM d, yyyy");
  } catch {
    return null;
  }
}

/**
 * Public copy for the candidate lookup modal. Callback and not_interested take
 * precedence; otherwise any positive followup_count shows the no-answer attempts line.
 */
export function resolveFollowupStatusPublicDisplay(
  candidate: SupportCandidate,
): SupportFollowupStatusDisplay | null {
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
    const attemptLabel = count === 1 ? "1 attempt" : `${count} attempts`;
    return {
      title: `Called — No Answer (${attemptLabel})`,
      subtitle: "Our team will reach out again",
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

  // eligible
  if (!interview) {
    return {
      kind: "eligible_unscheduled",
      title: "Eligible — Not Yet Scheduled",
      badgeClass:
        "bg-blue-50 text-blue-900 ring-1 ring-blue-200/80",
      lines: [],
    };
  }

  const st = interview.interview_status;

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
    const slot = formatSlot(interview.scheduled_date);
    const lines: string[] = [];
    if (slot) lines.push(slot);
    lines.push(`Interviewer: ${interview.interviewer}`);
    lines.push("Awaiting Zoom details");
    return {
      kind: "interview_draft",
      title: "Interview draft — awaiting Zoom",
      badgeClass:
        "bg-amber-50 text-amber-900 ring-1 ring-amber-200/80",
      lines,
    };
  }

  if (st === "scheduled") {
    const slot = formatSlot(interview.scheduled_date);
    const lines: string[] = [];
    if (slot) lines.push(slot);
    lines.push(`Interviewer: ${interview.interviewer}`);
    return {
      kind: "scheduled",
      title: "Interview Scheduled",
      badgeClass:
        "bg-blue-50 text-blue-900 ring-1 ring-blue-200/80",
      lines,
    };
  }

  if (st === "rescheduled") {
    const slot = formatSlot(interview.scheduled_date);
    const lines: string[] = [];
    if (slot) lines.push(`New time: ${slot}`);
    const reason = interview.reschedule_reason?.trim();
    if (reason) lines.push(`Reason: ${reason}`);
    lines.push(`Interviewer: ${interview.interviewer}`);
    return {
      kind: "rescheduled",
      title: "Interview Rescheduled",
      badgeClass:
        "bg-orange-50 text-orange-900 ring-1 ring-orange-200/80",
      lines,
    };
  }

  // completed
  if (!dispatch) {
    return {
      kind: "completed",
      title: "Interview Completed",
      badgeClass:
        "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200/80",
      lines: [],
    };
  }

  const ds = dispatch.dispatch_status;

  if (ds === "pending") {
    return {
      kind: "reward_processing",
      title: "Reward Being Processed",
      badgeClass:
        "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200/80",
      lines: [],
    };
  }

  if (ds === "dispatched") {
    const lines: string[] = [];
    if (dispatch.tracking_id?.trim()) {
      lines.push(`Tracking ID: ${dispatch.tracking_id.trim()}`);
    }
    const exp = formatDateOnly(dispatch.expected_delivery_date);
    if (exp) lines.push(`Expected delivery: ${exp}`);
    return {
      kind: "reward_dispatched",
      title: "Reward Dispatched",
      badgeClass:
        "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200/80",
      lines,
    };
  }

  // delivered
  return {
    kind: "reward_delivered",
    title: "Reward Delivered ✓",
    badgeClass:
      "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200/80",
    lines: [],
  };
}

export function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

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

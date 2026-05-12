import { format, isToday, isTomorrow, parseISO } from "date-fns";

import type { CandidateLookupCardData } from "./types";

/** Internal snapshot: everything needed to derive public copy (no DB shapes here). */
export type CandidateLookupSnapshot = {
  eligibility: "pending_review" | "eligible" | "not_eligible";
  congratulationCallPending: boolean | null;
  followupStatus: string | null;
  followupCount: number | null;
  callbackDatetime: string | null;
  candidateInterviewType: "testimonial" | "project" | null;
  interview: {
    effective:
      | "draft"
      | "scheduled"
      | "rescheduled"
      | "completed"
      | "cancelled";
    scheduledDate: string | null;
    interviewer: string | null;
    rescheduleReason: string | null;
    interviewType: "testimonial" | "project";
    rewardItem: string | null;
  } | null;
  /** Post–testimonial reward shipping (excludes LinkedIn-only rows). */
  testimonialDispatch: {
    status: "pending" | "dispatched" | "delivered";
    trackingId: string | null;
    expectedDeliveryDate: string | null;
    rewardItem: string | null;
  } | null;
  poc: string | null;
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

function formatScheduledHeadline(iso: string | null | undefined): string | null {
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

const badge = {
  neutral: "bg-zinc-100 text-zinc-700 ring-1 ring-zinc-200/80",
  blue: "bg-blue-50 text-blue-900 ring-1 ring-blue-200/80",
  amber: "bg-amber-50 text-amber-900 ring-1 ring-amber-200/80",
  orange: "bg-orange-50 text-orange-900 ring-1 ring-orange-200/80",
  emerald: "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200/80",
  red: "bg-red-50 text-red-800 ring-1 ring-red-200/80",
} as const;

/**
 * Public status copy for the candidate lookup card.
 *
 * Priority (highest first):
 * 1. Eligibility gates (not eligible, under review).
 * 2. **Testimonial dispatch row** — if present, status follows shipping only. A dispatch row is
 *    created only after the interview is finished in your CRM, so this must win over “eligible /
 *    not scheduled” even when the `interviews` row is missing from the API.
 * 3. Interview row (draft → completed) when no testimonial dispatch.
 * 4. Eligible pre-interview (congratulation + follow-up).
 */
export function buildCandidateLookupCard(
  s: CandidateLookupSnapshot,
): CandidateLookupCardData {
  const interviewType =
    s.interview?.interviewType ?? s.candidateInterviewType ?? null;

  const rewardItem =
    s.testimonialDispatch?.rewardItem?.trim() ||
    (s.interview?.effective === "completed"
      ? s.interview.rewardItem?.trim()
      : null) ||
    null;

  if (s.eligibility === "not_eligible") {
    return {
      fullName: "",
      email: "",
      phone: null,
      interviewType,
      statusTitle: "Not eligible",
      statusBadgeClass: badge.red,
      statusDetailLines: [],
      followup: null,
      poc: s.poc?.trim() || null,
      rewardItem,
    };
  }

  if (s.eligibility === "pending_review") {
    return {
      fullName: "",
      email: "",
      phone: null,
      interviewType,
      statusTitle: "Under review",
      statusBadgeClass: badge.amber,
      statusDetailLines: [],
      followup: null,
      poc: s.poc?.trim() || null,
      rewardItem,
    };
  }

  // --- Eligible ---

  if (s.testimonialDispatch) {
    const lines: string[] = [];
    const ds = s.testimonialDispatch.status;
    if (ds === "pending") {
      return {
        fullName: "",
        email: "",
        phone: null,
        interviewType,
        statusTitle: "Interview done — reward processing",
        statusBadgeClass: badge.emerald,
        statusDetailLines: lines,
        followup: null,
        poc: s.poc?.trim() || null,
        rewardItem,
      };
    }
    if (ds === "dispatched") {
      if (s.testimonialDispatch.trackingId?.trim()) {
        lines.push(`Tracking: ${s.testimonialDispatch.trackingId.trim()}`);
      }
      const exp = formatDateOnly(s.testimonialDispatch.expectedDeliveryDate);
      if (exp) lines.push(`Expected delivery: ${exp}`);
      return {
        fullName: "",
        email: "",
        phone: null,
        interviewType,
        statusTitle: "Dispatched — delivery pending",
        statusBadgeClass: badge.emerald,
        statusDetailLines: lines,
        followup: null,
        poc: s.poc?.trim() || null,
        rewardItem,
      };
    }
    return {
      fullName: "",
      email: "",
      phone: null,
      interviewType,
      statusTitle: "Delivered",
      statusBadgeClass: badge.emerald,
      statusDetailLines: [],
      followup: null,
      poc: s.poc?.trim() || null,
      rewardItem,
    };
  }

  const iv = s.interview;
  if (iv) {
    const st = iv.effective;
    const ivName = iv.interviewer?.trim() || "To be assigned";

    if (st === "cancelled") {
      return {
        fullName: "",
        email: "",
        phone: null,
        interviewType,
        statusTitle: "Interview cancelled",
        statusBadgeClass: badge.neutral,
        statusDetailLines: [],
        followup: buildFollowup(s, true),
        poc: s.poc?.trim() || null,
        rewardItem,
      };
    }

    if (st === "draft") {
      const head = formatScheduledHeadline(iv.scheduledDate);
      const lines: string[] = [`Interviewer: ${ivName}`];
      const full = formatSlot(iv.scheduledDate);
      if (full) lines.push(`Slot: ${full}`);
      lines.push("Zoom link is not live yet.");
      return {
        fullName: "",
        email: "",
        phone: null,
        interviewType,
        statusTitle: head
          ? `Scheduled for ${head} — Zoom pending`
          : "Interview slot reserved — Zoom pending",
        statusBadgeClass: badge.amber,
        statusDetailLines: lines,
        followup: null,
        poc: s.poc?.trim() || null,
        rewardItem,
      };
    }

    if (st === "scheduled") {
      const head = formatScheduledHeadline(iv.scheduledDate);
      const lines: string[] = [`Interviewer: ${ivName}`];
      const full = formatSlot(iv.scheduledDate);
      if (full) lines.push(`Slot: ${full}`);
      return {
        fullName: "",
        email: "",
        phone: null,
        interviewType,
        statusTitle: head ? `Scheduled for ${head}` : "Interview scheduled",
        statusBadgeClass: badge.blue,
        statusDetailLines: lines,
        followup: null,
        poc: s.poc?.trim() || null,
        rewardItem,
      };
    }

    if (st === "rescheduled") {
      const head = formatScheduledHeadline(iv.scheduledDate);
      const lines: string[] = [`Interviewer: ${ivName}`];
      const full = formatSlot(iv.scheduledDate);
      if (full) lines.push(`New slot: ${full}`);
      const reason = iv.rescheduleReason?.trim();
      if (reason) lines.push(`Reason: ${reason}`);
      return {
        fullName: "",
        email: "",
        phone: null,
        interviewType,
        statusTitle: head ? `Rescheduled — ${head}` : "Interview rescheduled",
        statusBadgeClass: badge.orange,
        statusDetailLines: lines,
        followup: null,
        poc: s.poc?.trim() || null,
        rewardItem,
      };
    }

    if (st === "completed") {
      return {
        fullName: "",
        email: "",
        phone: null,
        interviewType,
        statusTitle: "Interview done — dispatch pending",
        statusBadgeClass: badge.emerald,
        statusDetailLines: [],
        followup: null,
        poc: s.poc?.trim() || null,
        rewardItem,
      };
    }

    const lines: string[] = [`Interviewer: ${ivName}`];
    const full = formatSlot(iv.scheduledDate);
    if (full) lines.push(`Slot: ${full}`);
    return {
      fullName: "",
      email: "",
      phone: null,
      interviewType,
      statusTitle: "Interview status updating",
      statusBadgeClass: badge.blue,
      statusDetailLines: lines,
      followup: null,
      poc: s.poc?.trim() || null,
      rewardItem,
    };
  }

  // Eligible, no interview row, no testimonial dispatch
  const lines: string[] = [];
  let title = "Eligible — not yet scheduled";

  if (s.congratulationCallPending === true) {
    title = "Eligible — calling pending";
  } else {
    const count = Math.max(0, Number(s.followupCount ?? 0));
    const fs = (s.followupStatus ?? "").trim();

    if (fs === "callback") {
      const when = formatSlot(s.callbackDatetime);
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
    fullName: "",
    email: "",
    phone: null,
    interviewType,
    statusTitle: title,
    statusBadgeClass: badge.blue,
    statusDetailLines: lines,
    followup: null,
    poc: s.poc?.trim() || null,
    rewardItem,
  };
}

function buildFollowup(
  s: CandidateLookupSnapshot,
  interviewCancelled: boolean,
): { title: string; subtitle: string | null } | null {
  if (!interviewCancelled) return null;
  const count = Math.max(0, Number(s.followupCount ?? 0));
  const status = (s.followupStatus ?? "").trim();

  if (status === "callback") {
    const when = formatSlot(s.callbackDatetime);
    return {
      title: when ? `Callback scheduled — ${when}` : "Callback scheduled",
      subtitle: null,
    };
  }
  if (status === "not_interested") {
    return { title: "Not interested", subtitle: null };
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

/** Fills identity fields on the card after build (identity is not part of status logic). */
export function attachIdentity(
  card: CandidateLookupCardData,
  identity: {
    fullName: string;
    email: string;
    phone: string | null;
  },
): CandidateLookupCardData {
  return {
    ...card,
    fullName: identity.fullName,
    email: identity.email,
    phone: identity.phone,
  };
}

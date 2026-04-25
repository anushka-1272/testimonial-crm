import { format, parseISO } from "date-fns";

import type { FollowupStatus } from "./types";

export type FollowupStatusSnapshot = {
  followup_status: FollowupStatus;
  followup_count: number;
  callback_datetime: string | null;
};

export type FollowupLogStatusRow = {
  created_at: string;
  project_candidate_id?: string | null;
  status: string | null;
  attempt_number: number | null;
  callback_datetime: string | null;
};

const allowedStatuses: FollowupStatus[] = [
  "pending",
  "no_answer",
  "callback",
  "wrong_number",
  "not_interested",
  "scheduled",
  "interested",
  "already_completed",
  "not_eligible",
];

function normalizeFollowupStatus(value: string | null | undefined): FollowupStatus {
  if (typeof value === "string" && (allowedStatuses as string[]).includes(value)) {
    return value as FollowupStatus;
  }
  return "pending";
}

/**
 * Derive follow-up summary from followup_log rows.
 * Mirrors how testimonial badges interpret status/count/callback fields.
 */
export function getFollowUpStatus(
  logs: FollowupLogStatusRow[],
): FollowupStatusSnapshot | null {
  if (!logs.length) return null;
  const sorted = [...logs].sort((a, b) => {
    const byAttempt = (b.attempt_number ?? 0) - (a.attempt_number ?? 0);
    if (byAttempt !== 0) return byAttempt;
    return (b.created_at ?? "").localeCompare(a.created_at ?? "");
  });
  const latest = sorted[0];
  const followup_count = Math.max(
    0,
    ...logs.map((row) => Number(row.attempt_number ?? 0)),
    logs.length,
  );
  const latestStatus = normalizeFollowupStatus(latest.status);
  const followup_status =
    latestStatus === "no_answer" && followup_count < 3
      ? "pending"
      : latestStatus;
  return {
    followup_status,
    followup_count,
    callback_datetime:
      followup_status === "callback" ? latest.callback_datetime ?? null : null,
  };
}

export function followupStatusBadgeFromSnapshot(c: FollowupStatusSnapshot) {
  if (c.followup_status === "already_completed") {
    return (
      <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-800">
        Already Completed
      </span>
    );
  }
  if (c.followup_status === "not_eligible") {
    return (
      <span className="inline-flex rounded-full bg-[#fef2f2] px-2.5 py-1 text-xs font-medium text-[#b91c1c]">
        Not Eligible
      </span>
    );
  }
  if (c.followup_status === "wrong_number") {
    return (
      <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
        Wrong Number
      </span>
    );
  }
  if (c.followup_status === "callback" && c.callback_datetime) {
    let label = "Callback";
    try {
      label = format(parseISO(c.callback_datetime), "MMM d, h:mm a");
    } catch {
      /* ignore */
    }
    return (
      <span className="inline-flex rounded-full bg-[#eff6ff] px-2.5 py-1 text-xs font-medium text-[#1d4ed8]">
        Callback: {label}
      </span>
    );
  }
  if (c.followup_count >= 3 && c.followup_status === "no_answer") {
    return (
      <span className="inline-flex rounded-full bg-[#374151] px-2.5 py-1 text-xs font-medium text-gray-100">
        Max attempts reached
      </span>
    );
  }
  if (c.followup_status === "interested") {
    return (
      <span className="inline-flex rounded-full bg-[#f0fdf4] px-2.5 py-1 text-xs font-medium text-[#15803d]">
        Scheduled
      </span>
    );
  }
  if (c.followup_count === 2 && c.followup_status === "pending") {
    return (
      <span className="inline-flex rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">
        Final attempt
      </span>
    );
  }
  if (c.followup_count === 2) {
    return (
      <span className="inline-flex rounded-full bg-[#fff7ed] px-2.5 py-1 text-xs font-medium text-[#c2410c]">
        Follow-up 2/3
      </span>
    );
  }
  if (c.followup_count === 1) {
    return (
      <span className="inline-flex rounded-full bg-[#fef9c3] px-2.5 py-1 text-xs font-medium text-[#a16207]">
        Follow-up 1/3
      </span>
    );
  }
  return null;
}

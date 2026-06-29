import type { InterviewColumnStatus } from "@/app/dashboard/interviews/types";

type NoShowRevertInput = {
  previous_scheduled_date?: string | null;
  interviewer?: string | null;
};

/** Restore a no-show row to the scheduled pipeline; keeps existing `scheduled_date`. */
export function buildNoShowRevertPatch(interview: NoShowRevertInput): {
  interview_status: InterviewColumnStatus;
  no_show_reason: null;
  no_show_at: null;
} {
  let interview_status: InterviewColumnStatus;
  if (interview.previous_scheduled_date?.trim()) {
    interview_status = "rescheduled";
  } else if (!interview.interviewer?.trim()) {
    interview_status = "draft";
  } else {
    interview_status = "scheduled";
  }
  return {
    interview_status,
    no_show_reason: null,
    no_show_at: null,
  };
}

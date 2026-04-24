/**
 * Display labels for `followup_log.status` / `followup_status` string values.
 * Backend keys are unchanged (e.g. still store `interested`).
 */
export function followupOutcomeDisplayLabel(status: string): string {
  if (status === "interested") return "Scheduled";

  switch (status) {
    case "no_answer":
      return "No answer";
    case "callback":
      return "Callback";
    case "already_completed":
      return "Already completed";
    case "not_interested":
      return "Not interested";
    case "wrong_number":
      return "Wrong number";
    case "pending":
      return "Pending";
    case "scheduled":
      return "Interview scheduled";
    default:
      return status.replace(/_/g, " ");
  }
}

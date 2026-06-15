/** Pipeline state for in-person interview track (testimonial + project). */
export type PhysicalInterviewStatus =
  | "pending"
  | "completed"
  | "eligible"
  | "not_eligible";

export const PHYSICAL_INTERVIEW_STATUSES: readonly PhysicalInterviewStatus[] = [
  "pending",
  "completed",
  "eligible",
  "not_eligible",
] as const;

/** Default reward when physical interview track candidate is marked eligible. */
export const PHYSICAL_INTERVIEW_REWARD_ITEM = "JBL Clip 5";

export const PHYSICAL_INTERVIEW_DISPATCH_COMMENT =
  "Physical interview track reward — collect shipping address before dispatch.";

const LEGACY_STATUS_MAP: Record<string, PhysicalInterviewStatus> = {
  pending_post: "pending",
  posted: "completed",
  verified: "completed",
  pending: "pending",
  completed: "completed",
  eligible: "eligible",
  not_eligible: "not_eligible",
};

export function normalizePhysicalInterviewStatus(
  raw: string | null | undefined,
): PhysicalInterviewStatus {
  const s = raw?.trim() ?? "";
  const mapped = LEGACY_STATUS_MAP[s];
  if (mapped) return mapped;
  return (PHYSICAL_INTERVIEW_STATUSES as readonly string[]).includes(s)
    ? (s as PhysicalInterviewStatus)
    : "pending";
}

export function physicalInterviewStatusLabel(
  status: PhysicalInterviewStatus | null,
): string {
  if (!status) return "—";
  switch (status) {
    case "pending":
      return "Pending interview";
    case "completed":
      return "Interview completed";
    case "eligible":
      return "Eligible";
    case "not_eligible":
      return "Not eligible";
    default:
      return status;
  }
}

export function isPhysicalInterviewDispatchComment(
  specialComments: string | null | undefined,
): boolean {
  const s = (specialComments ?? "").toLowerCase();
  return (
    s.includes("physical interview track") || s.includes("linkedin track")
  );
}

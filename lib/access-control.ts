export type TeamRole =
  | "admin"
  | "interviewer"
  | "poc"
  | "operations"
  | "post_production"
  | "viewer";

export type AccessScope =
  | "dashboard"
  | "analytics"
  | "eligibility"
  | "interviews"
  | "dispatch"
  | "activity"
  | "post_production"
  | "interview_library"
  | "settings";

export function canEditScope(role: TeamRole, scope: AccessScope): boolean {
  if (scope === "interview_library") return true;
  if (role === "admin") return true;
  if (role === "viewer") return false;
  if (role === "interviewer") return scope === "interviews";
  if (role === "poc") return scope === "eligibility" || scope === "interviews";
  if (role === "operations") return scope === "interviews" || scope === "dispatch";
  if (role === "post_production") return scope === "post_production";
  return false;
}

export function roleLabel(role: TeamRole): string {
  switch (role) {
    case "admin":
      return "Admin";
    case "interviewer":
      return "Interviewer";
    case "poc":
      return "POC";
    case "operations":
      return "Operations";
    case "post_production":
      return "Post Production";
    case "viewer":
      return "Viewer";
    default:
      return "Viewer";
  }
}

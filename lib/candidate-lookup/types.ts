/** What the login modal renders after a successful lookup (all strings ready for display). */
export type CandidateLookupCardData = {
  fullName: string;
  email: string;
  phone: string | null;
  interviewType: "testimonial" | "project" | "written_feedback" | "gwc" | null;
  statusTitle: string;
  statusBadgeClass: string;
  statusDetailLines: string[];
  followup: { title: string; subtitle: string | null } | null;
  poc: string | null;
  rewardItem: string | null;
};

export type CandidateLookupApiResponse =
  | { ok: true; card: CandidateLookupCardData }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "multi_phone" }
  | { ok: false; reason: "error"; message: string };

export type GwcInterestedIn =
  | "blog_post"
  | "linkedin_post"
  | "reddit_reply"
  | "own_video"
  | "video_interview";

export type GwcContentChannel = Exclude<GwcInterestedIn, "video_interview">;

export type GwcWorkflowStage = "active" | "scheduled" | "dispatch";

export type GwcCallOutcome =
  | "no_answer"
  | "callback"
  | "interested"
  | "not_interested"
  | "wrong_number"
  | "scheduled"
  | "other";

export const GWC_INTERESTED_IN_OPTIONS: {
  value: GwcInterestedIn;
  label: string;
}[] = [
  { value: "blog_post", label: "Blog Post" },
  { value: "linkedin_post", label: "LinkedIn Post" },
  { value: "reddit_reply", label: "Reddit Reply" },
  { value: "own_video", label: "Own Video" },
  { value: "video_interview", label: "Video Interview" },
];

export const GWC_CONTENT_CHANNELS: GwcContentChannel[] = [
  "blog_post",
  "linkedin_post",
  "reddit_reply",
  "own_video",
];

export function interestedInLabel(value: GwcInterestedIn): string {
  return (
    GWC_INTERESTED_IN_OPTIONS.find((o) => o.value === value)?.label ?? value
  );
}

export function channelLabel(channel: GwcContentChannel): string {
  return interestedInLabel(channel);
}

export function isContentChannel(
  value: string,
): value is GwcContentChannel {
  return (GWC_CONTENT_CHANNELS as string[]).includes(value);
}

export type GwcInterestedInPointers = Partial<Record<GwcInterestedIn, string>>;

const VALID_INTEREST_KEYS = new Set(
  GWC_INTERESTED_IN_OPTIONS.map((o) => o.value),
);

/** Parse `interested_in_pointers` jsonb from Supabase. */
export function parseInterestedInPointers(raw: unknown): GwcInterestedInPointers {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: GwcInterestedInPointers = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!VALID_INTEREST_KEYS.has(key as GwcInterestedIn)) continue;
    if (typeof value === "string" && value.trim()) {
      out[key as GwcInterestedIn] = value;
    }
  }
  return out;
}

/** Keep queue rows active so multiple Interested In options can be selected together. */
export function workflowStageFromInterestedIn(
  interestedIn: GwcInterestedIn[],
  currentStage: GwcWorkflowStage = "active",
): GwcWorkflowStage {
  if (currentStage === "dispatch") return "dispatch";
  void interestedIn;
  return "active";
}

export type GwcTestingTab =
  | "queue"
  | "scheduled"
  | "blog_post"
  | "linkedin_post"
  | "reddit_reply"
  | "own_video"
  | "dispatch";

export const GWC_TESTING_TABS: { id: GwcTestingTab; label: string }[] = [
  { id: "queue", label: "GWC Queue" },
  { id: "scheduled", label: "Scheduled" },
  { id: "blog_post", label: "Blog Post" },
  { id: "linkedin_post", label: "LinkedIn Post" },
  { id: "reddit_reply", label: "Reddit Reply" },
  { id: "own_video", label: "Own Video" },
  { id: "dispatch", label: "Dispatch" },
];

export function tabMatchesChannel(tab: GwcTestingTab): GwcContentChannel | null {
  if (tab === "blog_post") return "blog_post";
  if (tab === "linkedin_post") return "linkedin_post";
  if (tab === "reddit_reply") return "reddit_reply";
  if (tab === "own_video") return "own_video";
  return null;
}

export type GwcContentVerificationRow = {
  id: string;
  gwc_testing_id: string;
  channel: GwcContentChannel;
  content_link: string | null;
  verified: boolean;
  verified_at: string | null;
  verified_by: string | null;
};

export type GwcSourceType = "testimonial" | "project";

export type GwcTestingRow = {
  id: string;
  candidate_id: string | null;
  project_candidate_id: string | null;
  source_type: GwcSourceType;
  poc: string | null;
  interested_in: GwcInterestedIn[];
  interested_in_pointers: GwcInterestedInPointers;
  workflow_stage: GwcWorkflowStage;
  created_at: string;
  updated_at: string;
  candidates: {
    id: string;
    full_name: string | null;
    email: string;
    whatsapp_number: string | null;
  } | null;
  project_candidates: {
    id: string;
    full_name: string | null;
    email: string;
    whatsapp_number: string | null;
    project_title: string | null;
  } | null;
  verifications: GwcContentVerificationRow[];
};

export function gwcEntryDisplayName(row: GwcTestingRow): string {
  if (row.source_type === "project") {
    const pc = row.project_candidates;
    return (
      pc?.full_name?.trim() ||
      pc?.email?.trim() ||
      pc?.project_title?.trim() ||
      "Project candidate"
    );
  }
  const c = row.candidates;
  return c?.full_name?.trim() || c?.email?.trim() || "Candidate";
}

export function gwcEntryEntityId(row: GwcTestingRow): string {
  return row.candidate_id ?? row.project_candidate_id ?? row.id;
}

export function isProjectGwcRow(row: GwcTestingRow): boolean {
  return row.source_type === "project";
}

export function gwcSourceTypeLabel(source: GwcSourceType): string {
  return source === "project" ? "Project" : "Testimonial";
}

export function gwcSourceTypeBadgeClass(source: GwcSourceType): string {
  return source === "project"
    ? "inline-flex shrink-0 rounded-full bg-[#eff6ff] px-2.5 py-1 text-xs font-medium text-[#2563eb]"
    : "inline-flex shrink-0 rounded-full bg-[#f0fdf4] px-2.5 py-1 text-xs font-medium text-[#16a34a]";
}

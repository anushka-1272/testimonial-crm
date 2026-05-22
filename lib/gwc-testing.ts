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

/** Video Interview selection routes the entry to the Scheduled stage. */
export function workflowStageFromInterestedIn(
  interestedIn: GwcInterestedIn[],
): GwcWorkflowStage {
  if (interestedIn.includes("video_interview")) return "scheduled";
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

export type GwcTestingRow = {
  id: string;
  candidate_id: string;
  poc: string | null;
  interested_in: GwcInterestedIn[];
  workflow_stage: GwcWorkflowStage;
  created_at: string;
  updated_at: string;
  candidates: {
    id: string;
    full_name: string | null;
    email: string;
    whatsapp_number: string | null;
  } | null;
  verifications: GwcContentVerificationRow[];
};

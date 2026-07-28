export type PostContentStatus =
  | "awaiting_posts"
  | "posts_confirmed"
  | "dispatch_ready"
  | "not_applicable";

export type PostContentStageFilter =
  | "all"
  | "awaiting_posts"
  | "posts_confirmed"
  | "dispatch_ready"
  | "in_dispatch";

export const POST_CONTENT_STAGE_FILTER_OPTIONS: {
  value: PostContentStageFilter;
  label: string;
}[] = [
  { value: "all", label: "All completed" },
  { value: "awaiting_posts", label: "Awaiting posts" },
  { value: "posts_confirmed", label: "Posts confirmed" },
  { value: "dispatch_ready", label: "Ready for dispatch" },
  { value: "in_dispatch", label: "In dispatch" },
];

export function postContentStatusLabel(
  status: PostContentStatus | null | undefined,
): string {
  switch (status) {
    case "awaiting_posts":
      return "Awaiting posts";
    case "posts_confirmed":
      return "Posts confirmed";
    case "dispatch_ready":
      return "Ready for dispatch";
    case "not_applicable":
      return "N/A";
    default:
      return "—";
  }
}

export function postContentStatusBadgeClass(
  status: PostContentStatus | null | undefined,
): string {
  switch (status) {
    case "awaiting_posts":
      return "bg-[#fff7ed] text-[#c2410c]";
    case "posts_confirmed":
      return "bg-[#eff6ff] text-[#2563eb]";
    case "dispatch_ready":
      return "bg-[#f0fdf4] text-[#16a34a]";
    case "not_applicable":
      return "bg-background/80 text-muted";
    default:
      return "bg-background/80 text-muted";
  }
}

export function resolvePostContentStatusOnComplete(input: {
  eligible: boolean;
  skipSocialPosts: boolean;
  rewardIsNoDispatch: boolean;
}): PostContentStatus {
  if (!input.eligible) return "not_applicable";
  if (input.rewardIsNoDispatch) return "not_applicable";
  if (input.skipSocialPosts) return "dispatch_ready";
  return "awaiting_posts";
}

export function hasSocialPostLink(input: {
  linkedinPostUrl?: string | null;
  blogPostUrl?: string | null;
}): boolean {
  return Boolean(
    input.linkedinPostUrl?.trim() || input.blogPostUrl?.trim(),
  );
}

export function matchesPostContentStageFilter(
  interview: {
    post_content_status?: PostContentStatus | null;
    id: string;
    candidate_id?: string;
    project_candidate_id?: string;
  },
  filter: PostContentStageFilter,
  dispatchEntityIds: Set<string>,
  isProject: boolean,
): boolean {
  if (filter === "all") return true;
  const entityId = isProject
    ? interview.project_candidate_id
    : interview.candidate_id;
  const inDispatch = entityId ? dispatchEntityIds.has(entityId) : false;
  if (filter === "in_dispatch") return inDispatch;
  if (inDispatch) return false;
  return interview.post_content_status === filter;
}

export function canConfirmSocialPosts(
  status: PostContentStatus | null | undefined,
): boolean {
  return status === "awaiting_posts";
}

export function canFinalizeDispatch(
  status: PostContentStatus | null | undefined,
  rewardItem: string | null | undefined,
): boolean {
  if (rewardItem?.trim() === "No Dispatch") return false;
  return status === "posts_confirmed" || status === "dispatch_ready";
}

/** True when dispatch was already finalized (ready + row exists in dispatch). */
export function isDispatchAlreadyFinalized(
  status: PostContentStatus | null | undefined,
  entityInDispatch: boolean,
): boolean {
  return status === "dispatch_ready" && entityInDispatch;
}

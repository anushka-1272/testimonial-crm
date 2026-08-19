/** Content the candidate is expected to publish after the interview. */
export const PLANNED_CONTENT_TYPES = [
  "blog_post",
  "linkedin_post",
  "both",
] as const;

export type PlannedContentType = (typeof PLANNED_CONTENT_TYPES)[number];

export const PLANNED_CONTENT_OPTIONS: {
  value: PlannedContentType;
  label: string;
}[] = [
  { value: "blog_post", label: "Blog post" },
  { value: "linkedin_post", label: "LinkedIn Post" },
  { value: "both", label: "Both" },
];

export function isPlannedContentType(
  value: string | null | undefined,
): value is PlannedContentType {
  return (
    typeof value === "string" &&
    (PLANNED_CONTENT_TYPES as readonly string[]).includes(value)
  );
}

export function plannedContentTypeLabel(
  value: PlannedContentType | null | undefined,
): string {
  if (!value) return "—";
  return PLANNED_CONTENT_OPTIONS.find((o) => o.value === value)?.label ?? "—";
}

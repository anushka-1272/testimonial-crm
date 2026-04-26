/**
 * Interviewer dropdowns use `team_members` display names for both label and value.
 * Legacy rows may still store historical labels; filters and display handle free text.
 */
export type InterviewerSelectOption = {
  value: string;
  label: string;
};

function mergeInterviewerNamesForDropdown(
  rosterNames: string[],
  currentStored: string | null | undefined,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string | null | undefined) => {
    const t = raw?.trim() ?? "";
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  for (const n of rosterNames) push(n);
  push(currentStored ?? null);
  out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return out;
}

/** Trimmed stored interviewer string, or null if empty. */
export function normalizeStoredInterviewerValue(
  raw: string | null | undefined,
): string | null {
  const t = raw?.trim();
  return t || null;
}

export function interviewerRowMatchesFilter(
  filter: string,
  rowStored: string | null | undefined,
): boolean {
  if (filter === "all") return true;
  const f = filter.trim();
  const raw = rowStored?.trim() ?? "";
  if (!f) return true;
  return (
    raw === f ||
    raw.toLowerCase() === f.toLowerCase()
  );
}

/**
 * Dropdown options: `value` and `label` are the same display name (team_members).
 * Includes current stored value even if not on the roster (legacy / removed member).
 */
export function buildInterviewerSelectOptions(
  rosterNames: string[],
  currentStored: string | null | undefined,
): InterviewerSelectOption[] {
  const names = mergeInterviewerNamesForDropdown(rosterNames, currentStored);
  return names.map((name) => ({ value: name, label: name }));
}

/** Shown in tables when `stored` may be any name saved from the roster. */
export function formatInterviewerStoredForUi(
  stored: string | null | undefined,
): string {
  const t = stored?.trim();
  return t || "—";
}

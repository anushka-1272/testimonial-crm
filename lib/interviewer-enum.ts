/**
 * PostgreSQL `public.interviewer` enum labels (see supabase/migrations/001 + 026).
 * UI roster names may differ; always persist `value` here, never arbitrary display text.
 */
export const INTERVIEWER_ENUM_VALUES = [
  "Harika",
  "Gargi",
  "Mudit",
  "Anushka",
  "Anushka Roy",
] as const;

export type InterviewerEnumValue = (typeof INTERVIEWER_ENUM_VALUES)[number];

const ENUM_SET = new Set<string>(INTERVIEWER_ENUM_VALUES);

export type InterviewerSelectOption = {
  /** Exact DB enum label */
  value: InterviewerEnumValue;
  /** Shown in the select (usually roster `name`) */
  label: string;
};

/** Roster / free-text → canonical enum (null = cannot map). */
export function rosterNameToInterviewerEnum(
  rosterName: string,
): InterviewerEnumValue | null {
  const t = rosterName.trim();
  if (!t) return null;
  if (ENUM_SET.has(t)) return t as InterviewerEnumValue;
  const lower = t.toLowerCase();
  for (const ev of INTERVIEWER_ENUM_VALUES) {
    if (ev.toLowerCase() === lower) return ev;
  }
  return null;
}

/**
 * Normalize whatever is stored on `interviews.interviewer` / `project_interviews.interviewer`
 * to a valid enum label when possible (exact, case-insensitive, or legacy aliases).
 */
export function normalizeStoredInterviewerValue(
  raw: string | null | undefined,
): InterviewerEnumValue | null {
  const fromRoster = rosterNameToInterviewerEnum(raw ?? "");
  if (fromRoster) return fromRoster;
  const t = raw?.trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  if (lower === "anushka roy") {
    return ENUM_SET.has("Anushka Roy")
      ? "Anushka Roy"
      : ("Anushka" as InterviewerEnumValue);
  }
  return null;
}

export function interviewerDisplayLabel(
  enumVal: InterviewerEnumValue,
): string {
  return enumVal;
}

/** Completed-tab filter: `filter` is an enum value or `"all"`. */
export function interviewerRowMatchesFilter(
  filter: string,
  rowStored: string | null | undefined,
): boolean {
  if (filter === "all") return true;
  const normalized = normalizeStoredInterviewerValue(rowStored);
  const raw = rowStored?.trim() ?? "";
  return normalized === filter || raw === filter;
}

/**
 * Dropdown options: `value` = enum for Supabase; `label` = roster display name.
 * Includes current stored enum even if absent from roster (read-only legacy rows).
 */
export function buildInterviewerSelectOptions(
  rosterNames: string[],
  currentStored: string | null | undefined,
): InterviewerSelectOption[] {
  const byValue = new Map<InterviewerEnumValue, string>();
  for (const rosterName of rosterNames) {
    const ev = rosterNameToInterviewerEnum(rosterName);
    if (!ev) continue;
    if (!byValue.has(ev)) byValue.set(ev, rosterName.trim());
  }
  const cur = normalizeStoredInterviewerValue(currentStored);
  if (cur && !byValue.has(cur)) {
    byValue.set(cur, interviewerDisplayLabel(cur));
  }
  const out: InterviewerSelectOption[] = [];
  for (const ev of INTERVIEWER_ENUM_VALUES) {
    const label = byValue.get(ev);
    if (label) out.push({ value: ev, label });
  }
  return out;
}

/** Shown in tables when `stored` might be legacy or already canonical. */
export function formatInterviewerStoredForUi(
  stored: string | null | undefined,
): string {
  const ev = normalizeStoredInterviewerValue(stored);
  if (ev) return interviewerDisplayLabel(ev);
  const t = stored?.trim();
  return t || "—";
}

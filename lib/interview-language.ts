/** Stored lowercase keys for `interviews.interview_language` */
export const INTERVIEW_LANG_PRESETS = [
  "english",
  "hindi",
  "kannada",
  "telugu",
  "marathi",
  "bengali",
] as const;

export type InterviewLangPreset = (typeof INTERVIEW_LANG_PRESETS)[number];

export type InterviewLanguageFilter =
  | "all"
  | InterviewLangPreset
  | "other";

const PRESET_SET = new Set<string>(INTERVIEW_LANG_PRESETS);

const DISPLAY: Record<InterviewLangPreset, string> = {
  english: "English",
  hindi: "Hindi",
  kannada: "Kannada",
  telugu: "Telugu",
  marathi: "Marathi",
  bengali: "Bengali",
};

/** Effective key: new column, else legacy `language`, else english */
export function effectiveInterviewLanguage(row: {
  interview_language?: string | null;
  language?: string | null;
}): string {
  const il = row.interview_language?.trim().toLowerCase();
  if (il) return il;
  const leg = row.language?.trim().toLowerCase();
  if (leg) {
    if (PRESET_SET.has(leg)) return leg;
    const compact = leg.replace(/\s+/g, "");
    if (PRESET_SET.has(compact)) return compact;
    return leg;
  }
  return "english";
}

export function interviewLanguageFilterBucket(
  effective: string,
): InterviewLanguageFilter {
  if (PRESET_SET.has(effective)) return effective as InterviewLangPreset;
  return "other";
}

export function formatInterviewLanguageLabel(effective: string): string {
  if (PRESET_SET.has(effective)) {
    return DISPLAY[effective as InterviewLangPreset];
  }
  if (!effective) return "English";
  return effective.charAt(0).toUpperCase() + effective.slice(1);
}

/** Badge palette: English gray, listed Indian languages blue, custom yellow */
export function interviewLanguageBadgeClass(effective: string): string {
  const bucket = interviewLanguageFilterBucket(effective);
  if (bucket === "english") {
    return "inline-flex rounded-full bg-[#f4f4f5] px-3 py-1 text-xs font-medium text-[#52525b]";
  }
  if (bucket === "other") {
    return "inline-flex rounded-full bg-[#fef9c3] px-3 py-1 text-xs font-medium text-[#854d0e]";
  }
  return "inline-flex rounded-full bg-[#dbeafe] px-3 py-1 text-xs font-medium text-[#1d4ed8]";
}

export function matchesInterviewLanguageFilter(
  effective: string,
  filter: InterviewLanguageFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "other") return interviewLanguageFilterBucket(effective) === "other";
  return effective === filter;
}

/** Value to persist for testimonial `interview_language` (lowercase key or custom) */
export function interviewLanguageForSubmit(
  preset: InterviewLangPreset | "other",
  otherText: string,
): { ok: true; value: string } | { ok: false; error: string } {
  if (preset === "other") {
    const t = otherText.trim().toLowerCase();
    if (!t) return { ok: false, error: "Specify the interview language." };
    return { ok: true, value: t };
  }
  return { ok: true, value: preset };
}

/** Human-readable string for legacy `language` column / project interviews */
export function interviewLanguageDisplayString(
  preset: InterviewLangPreset | "other",
  otherText: string,
): string {
  if (preset === "other") {
    const t = otherText.trim();
    return t
      ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()
      : "Other";
  }
  return DISPLAY[preset];
}

/** Display-only achievement text (keeps dashboard bundle free of Claude SDK). */
export type CandidateSummaryFields = {
  achievement_type?: string | null;
  achievement_title?: string | null;
  quantified_result?: string | null;
  primary_goal?: string | null;
  skills_modules_helped?: string | null;
  how_program_helped?: string | null;
};

export function formatAchievementSummary(row: CandidateSummaryFields): string {
  const lines = [
    row.achievement_type && `Achievement type: ${row.achievement_type}`,
    row.achievement_title && `Title: ${row.achievement_title}`,
    row.quantified_result && `Quantified result: ${row.quantified_result}`,
    row.primary_goal && `Primary goal: ${row.primary_goal}`,
    row.skills_modules_helped && `Skills/modules: ${row.skills_modules_helped}`,
    row.how_program_helped && `How the program helped: ${row.how_program_helped}`,
  ].filter(Boolean) as string[];

  return lines.length ? lines.join("\n") : "";
}

export function truncateText(text: string, maxLen: number): string {
  const t = text.trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}

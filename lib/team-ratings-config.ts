import type { RatingScores } from "@/lib/team-member-ratings-db";

/** Exact roster names omitted from the team ratings table (Anushka Roy stays). */
export const TEAM_RATINGS_EXCLUDED_NAMES = new Set(["Anushka", "Saumy"]);

export function isExcludedFromTeamRatings(name: string): boolean {
  return TEAM_RATINGS_EXCLUDED_NAMES.has(name.trim());
}

export function filterTeamRatingsMemberNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name || seen.has(name) || isExcludedFromTeamRatings(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function isTeamRatingComplete(scores: RatingScores): boolean {
  return (
    scores.callings != null &&
    scores.callings >= 1 &&
    scores.interviews != null &&
    scores.interviews >= 1 &&
    scores.reminder != null &&
    scores.reminder >= 1
  );
}

export function areAllTeamRatingsComplete(
  memberNames: string[],
  ratings: Map<string, RatingScores>,
): boolean {
  if (memberNames.length === 0) return false;
  return memberNames.every((name) => isTeamRatingComplete(ratings.get(name) ?? {
    callings: null,
    interviews: null,
    reminder: null,
  }));
}

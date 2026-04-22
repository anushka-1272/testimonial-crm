/**
 * Post production pipeline: only post-interview eligible completed rows may enter.
 */

export const POST_PRODUCTION_NOT_ELIGIBLE_ERROR =
  "Candidate is not eligible for post production";

export const POST_PRODUCTION_ELIGIBILITY_TOOLTIP =
  "Only eligible candidates can be sent to post production";

/** Activity log descriptions */
export const ACTIVITY_BLOCKED_POST_PRODUCTION =
  "Blocked post production attempt for non-eligible candidate";

export const ACTIVITY_ADDED_ELIGIBLE_TO_POST_PRODUCTION =
  "Candidate marked eligible and added to post production";

export type PostProductionEligibilityInput = {
  post_interview_eligible?: boolean | null;
};

/**
 * Whether a completed interview row may be sent to post production.
 * Pass the interview row (or any object with `post_interview_eligible`).
 */
export function canMoveToPostProduction(
  candidate: PostProductionEligibilityInput,
): boolean {
  return candidate.post_interview_eligible === true;
}

/** Maximum follow-up call attempts before auto not-interested. */
export const MAX_FOLLOWUP_ATTEMPTS = 3;

/** Months of inactivity before auto not-interested (pending follow-up states). */
export const FOLLOWUP_INACTIVE_MONTHS = 3;

export const AUTO_NOT_INTERESTED_MAX_ATTEMPTS_REASON =
  "Automatically marked not interested: maximum follow-up attempts reached (3 no answers).";

export const AUTO_NOT_INTERESTED_STALE_REASON =
  "Automatically marked not interested: inactive for more than 3 months (follow-up pending).";

export const NOT_ELIGIBLE_NOT_INTERESTED_REASON = "Marked as not eligible.";

/** followup_log.status written when someone is marked active again. Starts a new attempt cycle. */
export const FOLLOWUP_CYCLE_RESET_STATUS = "reactivated";

import { MAX_FOLLOWUP_ATTEMPTS } from "./followup-constants";

export type FollowupLogCountRow = {
  created_at?: string | null;
  status?: string | null;
  attempt_number?: number | null;
  callback_datetime?: string | null;
};

/** Highest attempt count from followup_log history and denormalized DB column. */
export function resolveEffectiveFollowupCount(
  logs: FollowupLogCountRow[],
  dbFollowupCount?: number | null,
): number {
  const fromLogs = logs.length
    ? Math.max(
        0,
        ...logs.map((row) => Number(row.attempt_number ?? 0)),
        logs.length,
      )
    : 0;
  return Math.max(fromLogs, Math.max(0, Number(dbFollowupCount ?? 0)));
}

export function getLatestFollowupLog<T extends FollowupLogCountRow>(
  logs: T[],
): T | null {
  if (!logs.length) return null;
  return [...logs].sort((a, b) => {
    const byAttempt = (b.attempt_number ?? 0) - (a.attempt_number ?? 0);
    if (byAttempt !== 0) return byAttempt;
    return (b.created_at ?? "").localeCompare(a.created_at ?? "");
  })[0];
}

export function hasReachedMaxFollowupAttempts(
  logs: FollowupLogCountRow[],
  dbFollowupCount?: number | null,
): boolean {
  return (
    resolveEffectiveFollowupCount(logs, dbFollowupCount) >=
    MAX_FOLLOWUP_ATTEMPTS
  );
}

/** True when historical logs + DB state indicate max no-answer attempts were exhausted. */
export function shouldBackfillMaxAttemptsNotInterested(input: {
  logs: FollowupLogCountRow[];
  followup_status: string | null | undefined;
  followup_count?: number | null;
}): boolean {
  if (input.followup_status === "not_interested") return false;
  const effectiveCount = resolveEffectiveFollowupCount(
    input.logs,
    input.followup_count,
  );
  if (effectiveCount < MAX_FOLLOWUP_ATTEMPTS) return false;

  const latestStatus = getLatestFollowupLog(input.logs)?.status?.trim();
  if (latestStatus === "no_answer") return true;
  if (input.followup_status === "no_answer") return true;

  // Legacy rows: count reached via historical logs but status never advanced.
  if (
    (input.followup_status === "pending" ||
      input.followup_status === "wrong_number") &&
    effectiveCount >= MAX_FOLLOWUP_ATTEMPTS
  ) {
    const noAnswerLogs = input.logs.filter(
      (row) => row.status?.trim() === "no_answer",
    ).length;
    return noAnswerLogs >= MAX_FOLLOWUP_ATTEMPTS;
  }

  return false;
}

export function groupFollowupLogsByEntity<
  T extends FollowupLogCountRow & {
    candidate_id?: string | null;
    project_candidate_id?: string | null;
  },
>(
  logs: T[],
): { testimonials: Map<string, T[]>; projects: Map<string, T[]> } {
  const testimonials = new Map<string, T[]>();
  const projects = new Map<string, T[]>();
  for (const log of logs) {
    if (log.candidate_id) {
      const list = testimonials.get(log.candidate_id) ?? [];
      list.push(log);
      testimonials.set(log.candidate_id, list);
    }
    if (log.project_candidate_id) {
      const list = projects.get(log.project_candidate_id) ?? [];
      list.push(log);
      projects.set(log.project_candidate_id, list);
    }
  }
  return { testimonials, projects };
}

import {
  FOLLOWUP_CYCLE_RESET_STATUS,
  MAX_FOLLOWUP_ATTEMPTS,
} from "./followup-constants";

export type FollowupLogCountRow = {
  created_at?: string | null;
  status?: string | null;
  attempt_number?: number | null;
  callback_datetime?: string | null;
};

function isFollowupCycleReset(log: FollowupLogCountRow): boolean {
  return log.status?.trim() === FOLLOWUP_CYCLE_RESET_STATUS;
}

function logTimeMs(log: FollowupLogCountRow): number | null {
  const raw = log.created_at?.trim();
  if (!raw) return null;
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Logs that count toward the current follow-up cycle (after the latest "marked active" reset). */
export function logsInCurrentFollowupCycle<T extends FollowupLogCountRow>(
  logs: T[],
): T[] {
  let latestResetAt: number | null = null;
  for (const log of logs) {
    if (!isFollowupCycleReset(log)) continue;
    const at = logTimeMs(log);
    if (at == null) continue;
    if (latestResetAt == null || at >= latestResetAt) latestResetAt = at;
  }
  if (latestResetAt == null) return logs;
  return logs.filter((log) => {
    if (isFollowupCycleReset(log)) return false;
    const at = logTimeMs(log);
    return at != null && at > latestResetAt;
  });
}

/** Highest attempt count from followup_log history and denormalized DB column. */
export function resolveEffectiveFollowupCount(
  logs: FollowupLogCountRow[],
  dbFollowupCount?: number | null,
): number {
  const cycleReset = logs.some(isFollowupCycleReset);
  const cycleLogs = logsInCurrentFollowupCycle(logs);
  const fromLogs = cycleLogs.length
    ? Math.max(
        0,
        ...cycleLogs.map((row) => Number(row.attempt_number ?? 0)),
        cycleLogs.length,
      )
    : 0;
  // After "Mark as Active", stored followup_count still reflects the previous cycle
  // until the next call is logged. Count only logs in the new cycle.
  if (cycleReset) return fromLogs;
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
  const cycleReset = input.logs.some(isFollowupCycleReset);
  const logs = logsInCurrentFollowupCycle(input.logs);
  const effectiveCount = resolveEffectiveFollowupCount(
    logs,
    cycleReset ? undefined : input.followup_count,
  );
  if (effectiveCount < MAX_FOLLOWUP_ATTEMPTS) return false;

  const latestStatus = getLatestFollowupLog(logs)?.status?.trim();
  if (latestStatus === "no_answer") return true;
  if (input.followup_status === "no_answer") return true;

  // Legacy rows: count reached via historical logs but status never advanced.
  if (
    (input.followup_status === "pending" ||
      input.followup_status === "wrong_number") &&
    effectiveCount >= MAX_FOLLOWUP_ATTEMPTS
  ) {
    const noAnswerLogs = logs.filter(
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

import type { SupabaseClient } from "@supabase/supabase-js";

const SYNC_COOLDOWN_MS = 2 * 60 * 1000;

let inFlight: Promise<boolean> | null = null;
let lastFinishedAt = 0;

type AutoNotInterestedResponse = {
  ok?: boolean;
  testimonialsMaxAttempts?: number;
  projectsMaxAttempts?: number;
  testimonialsStale?: number;
  projectsStale?: number;
  testimonialsNotEligible?: number;
  projectsNotEligible?: number;
};

function responseChangedRows(body: AutoNotInterestedResponse): boolean {
  return (
    (body.testimonialsMaxAttempts ?? 0) +
      (body.projectsMaxAttempts ?? 0) +
      (body.testimonialsStale ?? 0) +
      (body.projectsStale ?? 0) +
      (body.testimonialsNotEligible ?? 0) +
      (body.projectsNotEligible ?? 0) >
    0
  );
}

/**
 * Applies auto not-interested rules in the background.
 * Returns true when rows were updated and the caller should reload.
 * Repeated calls within a short window share one request.
 */
export function syncAutoNotInterestedFollowups(
  supabase: SupabaseClient,
): Promise<boolean> {
  if (inFlight) return inFlight;
  if (Date.now() - lastFinishedAt < SYNC_COOLDOWN_MS) {
    return Promise.resolve(false);
  }

  inFlight = (async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return false;

      const res = await fetch("/api/followup/auto-not-interested", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return false;
      const body = (await res.json()) as AutoNotInterestedResponse;
      return body.ok !== false && responseChangedRows(body);
    } catch {
      return false;
    } finally {
      inFlight = null;
      lastFinishedAt = Date.now();
    }
  })();

  return inFlight;
}

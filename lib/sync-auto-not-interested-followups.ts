import type { SupabaseClient } from "@supabase/supabase-js";

/** Applies auto not-interested rules using full followup_log history (server-side). */
export async function syncAutoNotInterestedFollowups(
  supabase: SupabaseClient,
): Promise<void> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return;

    await fetch("/api/followup/auto-not-interested", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // Non-blocking background sync
  }
}

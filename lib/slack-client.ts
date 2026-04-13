import type { SupabaseClient } from "@supabase/supabase-js";

export async function sendSlackNotification(
  accessToken: string | null | undefined,
  userEmail: string,
  message: string,
): Promise<{ success: boolean }> {
  if (!accessToken?.trim()) {
    return { success: false };
  }
  try {
    const res = await fetch("/api/slack/notify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ userEmail: userEmail.trim(), message }),
    });
    return (await res.json()) as { success: boolean };
  } catch (err) {
    console.error("Slack client error:", err);
    return { success: false };
  }
}

/** Fire-and-forget Slack DM; errors only hit the console. */
export function voidSlackNotify(
  supabase: SupabaseClient,
  userEmail: string,
  message: string,
): void {
  void (async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      await sendSlackNotification(
        session?.access_token ?? null,
        userEmail,
        message,
      );
    } catch (err) {
      console.error("Slack voidSlackNotify:", err);
    }
  })();
}

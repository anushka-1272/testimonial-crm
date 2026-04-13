import type { SupabaseClient } from "@supabase/supabase-js";

import type { WatiTemplateParameter } from "@/lib/wati";

/**
 * Sends a WATI template from the browser via `/api/wati/send-template` (keeps API keys server-side).
 * Returns false if the user has no phone, no session, or the API reports failure.
 */
export async function sendWatiNotification(
  supabase: SupabaseClient,
  phone: string | null | undefined,
  template_name: string,
  parameters: WatiTemplateParameter[],
): Promise<boolean> {
  const trimmed = phone?.trim();
  if (!trimmed) {
    return true;
  }

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      console.error("WATI: no session");
      return false;
    }

    const res = await fetch("/api/wati/send-template", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        phone: trimmed,
        template_name,
        parameters,
      }),
    });

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = null;
    }

    const success =
      res.ok &&
      typeof body === "object" &&
      body !== null &&
      (body as { success?: boolean }).success === true;

    if (!success) {
      console.error("WATI notification failed:", body);
      return false;
    }

    console.log("WATI notification sent:", template_name);
    return true;
  } catch (err) {
    console.error("WATI client error:", err);
    return false;
  }
}

import type { SupabaseClient } from "@supabase/supabase-js";

/** Slack lookup emails (must match Slack workspace member emails). */
export const POC_INTERVIEWER_SLACK_EMAILS: Record<string, string> = {
  Harika: "harika.pydi@houseofedtech.in",
  Anushka: "anushka@houseofedtech.in",
  Gargi: "gargi.rani.pathak@houseofedtech.in",
  Mudit: "mudit.saxena@houseofedtech.in",
};

export const SLACK_DISHAN_EMAIL = "dishan.pramanik.ost@houseofedtech.in";
export const SLACK_RIANKA_EMAIL = "rianka.dutta.ost@houseofedtech.in";
export const SLACK_SIDDHARTHA_EMAIL = "siddhartha.bardhan.ost@houseofedtech.in";
export const SLACK_PRKHRVV_EMAIL = "prkhrvv@houseofedtech.in";
export const SLACK_ANUSHKA_WEEKLY_EMAIL = "anushka@houseofedtech.in";

export async function slackEmailForTeamMember(
  supabase: SupabaseClient,
  name: string | null | undefined,
): Promise<string | null> {
  const n = name?.trim();
  if (!n) return null;
  const { data } = await supabase
    .from("team_roster")
    .select("email")
    .eq("name", n)
    .eq("is_active", true)
    .not("email", "is", null)
    .order("display_order", { ascending: true })
    .limit(1);

  const email = (data?.[0] as { email?: string | null } | undefined)?.email;
  if (email?.trim()) return email.trim();
  return POC_INTERVIEWER_SLACK_EMAILS[n] ?? null;
}

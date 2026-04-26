import type { SupabaseClient } from "@supabase/supabase-js";

/** Slack lookup emails (must match Slack workspace member emails). */
export const POC_INTERVIEWER_SLACK_EMAILS: Record<string, string> = {
  Harika: "harika.pydi@houseofedtech.in",
  Anushka: "anushka@houseofedtech.in",
  "Anushka Roy": "anushka.roy.ost@houseofedtech.in",
  Gargi: "gargi.rani.pathak@houseofedtech.in",
  Mudit: "mudit.saxena@houseofedtech.in",
};

export const SLACK_DISHAN_EMAIL = "dishan.pramanik.ost@houseofedtech.in";
export const SLACK_RIANKA_EMAIL = "rianka.dutta.ost@houseofedtech.in";
export const SLACK_SIDDHARTHA_EMAIL = "siddhartha.bardhan.ost@houseofedtech.in";
export const SLACK_PRKHRVV_EMAIL = "prkhrvv@houseofedtech.in";
/** Post production: pre-review + post-review + YouTube (private) upload */
export const SLACK_SAPNA_POST_PRODUCTION_EMAIL =
  "sapna.kumari@houseofedtech.in";
/** Post production: editing after pre-review */
export const SLACK_SOMOSHREE_POST_PRODUCTION_EMAIL =
  "somoshree.roy.chowdhury@houseofedtech.in";
export const SLACK_ANUSHKA_WEEKLY_EMAIL = "anushka@houseofedtech.in";

export async function slackEmailForTeamMember(
  supabase: SupabaseClient,
  name: string | null | undefined,
): Promise<string | null> {
  const n = name?.trim();
  if (!n) return null;
  const lower = n.toLowerCase();

  const { data: teamRows, error: teamErr } = await supabase
    .from("team_members")
    .select("email, full_name")
    .eq("status", "active")
    .not("email", "is", null);

  if (!teamErr && teamRows?.length) {
    for (const row of teamRows as Array<{
      email?: string | null;
      full_name?: string | null;
    }>) {
      const email = row.email?.trim();
      if (!email) continue;
      const fn = row.full_name?.trim().toLowerCase() ?? "";
      const local = email.split("@")[0]?.toLowerCase() ?? "";
      if (fn === lower || local === lower) return email;
    }
  }

  const { data } = await supabase
    .from("team_roster")
    .select("email")
    .eq("name", n)
    .eq("is_active", true)
    .not("email", "is", null)
    .order("display_order", { ascending: true })
    .limit(1);

  const legacy = (data?.[0] as { email?: string | null } | undefined)?.email;
  if (legacy?.trim()) return legacy.trim();
  return POC_INTERVIEWER_SLACK_EMAILS[n] ?? null;
}

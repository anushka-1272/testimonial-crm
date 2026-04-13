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

export function slackEmailForTeamMember(name: string | null | undefined): string | null {
  const n = name?.trim();
  if (!n) return null;
  return POC_INTERVIEWER_SLACK_EMAILS[n] ?? null;
}

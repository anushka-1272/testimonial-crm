import { NextResponse } from "next/server";

import { SLACK_ANUSHKA_WEEKLY_EMAIL } from "@/lib/slack-contacts";
import { sendSlackDM } from "@/lib/slack";

export const runtime = "nodejs";

/**
 * Vercel Cron: secured with CRON_SECRET (Authorization: Bearer <secret>).
 * Schedule in vercel.json: Mon & Fri 09:00 UTC.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.warn("weekly-reminder: CRON_SECRET not set");
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET not configured" },
      { status: 503 },
    );
  }

  const auth = request.headers.get("authorization")?.trim();
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const message =
    "👋 Hi Anushka! Reminder to review new testimonial entries in the CRM.\nPlease check the Eligibility page for pending reviews.";

  try {
    const result = await sendSlackDM(SLACK_ANUSHKA_WEEKLY_EMAIL, message);
    return NextResponse.json({ ok: result.success });
  } catch (e) {
    console.error("weekly-reminder:", e);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}

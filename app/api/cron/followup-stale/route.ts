import { NextResponse } from "next/server";

import { runAutoNotInterestedFollowups } from "@/lib/followup-auto-not-interested";
import { createSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * Daily cron: move stale follow-up entries to not interested.
 * - Backfill max-attempt (no_answer × 3) rows
 * - Inactive pending / wrong number / max attempts for 3+ months
 *
 * Secure with CRON_SECRET: Authorization: Bearer <CRON_SECRET>
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.warn("followup-stale: CRON_SECRET not set");
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET not configured" },
      { status: 503 },
    );
  }

  const auth = request.headers.get("authorization")?.trim();
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createSupabaseAdmin();
    const result = await runAutoNotInterestedFollowups(supabase);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("followup-stale:", e);
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

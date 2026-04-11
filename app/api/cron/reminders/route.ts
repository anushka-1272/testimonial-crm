import { format } from "date-fns";
import { NextResponse } from "next/server";

import { sendInterviewReminderEmail } from "@/lib/resend";
import { createSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * Hourly cron: interviews starting in ~1 hour get one reminder email and reminder_count set to 1.
 * Secure with CRON_SECRET: Authorization: Bearer <CRON_SECRET>
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const supabase = createSupabaseAdmin();
  const now = Date.now();
  const windowStart = new Date(now + 55 * 60 * 1000).toISOString();
  const windowEnd = new Date(now + 65 * 60 * 1000).toISOString();

  const { data: interviews, error } = await supabase
    .from("interviews")
    .select("id, candidate_id, scheduled_date, zoom_link, reminder_count")
    .in("interview_status", ["scheduled", "rescheduled"])
    .not("scheduled_date", "is", null)
    .gte("scheduled_date", windowStart)
    .lte("scheduled_date", windowEnd)
    .eq("reminder_count", 0);

  if (error) {
    return NextResponse.json(
      { error: "Query failed", details: error.message },
      { status: 500 },
    );
  }

  const results: Array<{ interview_id: string; ok: boolean; error?: string }> =
    [];

  for (const inv of interviews ?? []) {
    const { data: cand, error: cErr } = await supabase
      .from("candidates")
      .select("email, full_name")
      .eq("id", inv.candidate_id)
      .eq("is_deleted", false)
      .maybeSingle();

    if (cErr || !cand?.email) {
      results.push({
        interview_id: inv.id,
        ok: false,
        error: cErr?.message ?? "missing candidate email",
      });
      continue;
    }

    const timeStr = format(new Date(inv.scheduled_date!), "h:mm a");
    const sendResult = await sendInterviewReminderEmail({
      to: cand.email,
      name: cand.full_name,
      time: timeStr,
      zoom_link: inv.zoom_link ?? "",
    });

    if (!sendResult.ok) {
      results.push({
        interview_id: inv.id,
        ok: false,
        error: sendResult.error,
      });
      continue;
    }

    const { error: upErr } = await supabase
      .from("interviews")
      .update({ reminder_count: 1 })
      .eq("id", inv.id);

    if (upErr) {
      results.push({ interview_id: inv.id, ok: false, error: upErr.message });
      continue;
    }

    results.push({ interview_id: inv.id, ok: true });
  }

  return NextResponse.json({
    processed: results.length,
    results,
  });
}

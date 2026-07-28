import { NextResponse } from "next/server";

import { runAutoNotInterestedFollowups } from "@/lib/followup-auto-not-interested";
import { verifyRequestUser } from "@/lib/google-sheet-gviz";
import { createSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * Runs auto not-interested rules for historical + current follow-up rows.
 * Callable by authenticated team members when loading interviews dashboards.
 */
export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const auth = request.headers.get("authorization")?.trim();
  const isCron = Boolean(cronSecret && auth === `Bearer ${cronSecret}`);

  if (!isCron) {
    const user = await verifyRequestUser(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) {
      return NextResponse.json(
        { error: "Server is missing Supabase configuration" },
        { status: 500 },
      );
    }

    const token = auth?.replace(/^Bearer\s+/i, "").trim();
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: tm } = await supabase
      .from("team_members")
      .select("role, status")
      .eq("user_id", user.id)
      .neq("status", "removed")
      .maybeSingle();
    const role = tm?.role;
    if (
      !role ||
      (role !== "admin" &&
        role !== "interviewer" &&
        role !== "poc" &&
        role !== "operations")
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  try {
    const admin = createSupabaseAdmin();
    const result = await runAutoNotInterestedFollowups(admin);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("followup/auto-not-interested:", e);
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

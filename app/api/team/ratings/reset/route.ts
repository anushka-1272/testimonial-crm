import { NextResponse } from "next/server";

import {
  fetchRateableMemberNames,
  verifyAdminFromRequest,
} from "@/lib/team-ratings-admin";
import { createSupabaseAdmin } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const adminUser = await verifyAdminFromRequest(request);
    if (!adminUser) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const body = json as { periodStart?: string; periodEnd?: string };
    const periodStart =
      typeof body.periodStart === "string" ? body.periodStart.trim() : "";
    const periodEnd = typeof body.periodEnd === "string" ? body.periodEnd.trim() : "";
    if (!periodStart || !periodEnd) {
      return NextResponse.json({ error: "periodStart and periodEnd required" }, { status: 400 });
    }

    const admin = createSupabaseAdmin();
    const memberNames = await fetchRateableMemberNames(admin);

    const { error: ratingsError } = await admin
      .from("team_member_ratings")
      .delete()
      .eq("period_start", periodStart)
      .eq("period_end", periodEnd)
      .in("member_name", memberNames);

    if (ratingsError) {
      return NextResponse.json({ error: ratingsError.message }, { status: 500 });
    }

    await admin
      .from("team_ratings_period_notifications")
      .delete()
      .eq("period_start", periodStart)
      .eq("period_end", periodEnd);

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("team ratings reset:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Reset failed" },
      { status: 500 },
    );
  }
}

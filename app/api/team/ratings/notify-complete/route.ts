import { NextResponse } from "next/server";

import {
  fetchRateableMemberNames,
  verifyAdminFromRequest,
} from "@/lib/team-ratings-admin";
import { areAllTeamRatingsComplete } from "@/lib/team-ratings-config";
import { fetchTeamMemberRatings } from "@/lib/team-member-ratings-db";
import { SLACK_JAY_EMAIL, slackEmailForTeamMember } from "@/lib/slack-contacts";
import { teamRatingsSlackMessage } from "@/lib/team-ratings-slack";
import { sendSlackDM } from "@/lib/slack";
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
    if (memberNames.length === 0) {
      return NextResponse.json({ complete: false, notified: false, reason: "no_members" });
    }

    const { rows, error: ratingsError } = await fetchTeamMemberRatings(
      admin,
      periodStart,
      periodEnd,
    );
    if (ratingsError) {
      return NextResponse.json({ error: ratingsError }, { status: 500 });
    }

    if (!areAllTeamRatingsComplete(memberNames, rows)) {
      return NextResponse.json({ complete: false, notified: false });
    }

    const { data: existing } = await admin
      .from("team_ratings_period_notifications")
      .select("period_start")
      .eq("period_start", periodStart)
      .eq("period_end", periodEnd)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ complete: true, notified: false, alreadySent: true });
    }

    const jayEmail =
      (await slackEmailForTeamMember(admin, "Jay")) ?? SLACK_JAY_EMAIL;
    const message = teamRatingsSlackMessage(periodStart);
    const slack = await sendSlackDM(jayEmail, message);

    if (!slack.success) {
      return NextResponse.json(
        { complete: true, notified: false, error: "Slack delivery failed" },
        { status: 502 },
      );
    }

    const { error: insertError } = await admin
      .from("team_ratings_period_notifications")
      .insert({ period_start: periodStart, period_end: periodEnd });

    if (insertError) {
      console.error("team ratings notification insert:", insertError);
    }

    return NextResponse.json({ complete: true, notified: true });
  } catch (e) {
    console.error("team ratings notify-complete:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Notify failed" },
      { status: 500 },
    );
  }
}

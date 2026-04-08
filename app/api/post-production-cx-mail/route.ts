import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

import { verifyRequestUser } from "@/lib/google-sheet-gviz";
import { sendPostProductionCxEmail } from "@/lib/resend";

export const runtime = "nodejs";

const BodySchema = z.object({
  post_production_id: z.string().uuid(),
});

export async function POST(request: Request) {
  const user = await verifyRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cxTo = process.env.POST_PRODUCTION_CX_EMAIL?.trim();
  if (!cxTo) {
    return NextResponse.json(
      {
        error:
          "POST_PRODUCTION_CX_EMAIL is not configured (internal recipient for CX notifications)",
      },
      { status: 500 },
    );
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return NextResponse.json(
      { error: "Server is missing Supabase configuration" },
      { status: 500 },
    );
  }

  const token = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: row, error: fetchErr } = await supabase
    .from("post_production")
    .select(
      "id, candidate_name, youtube_link, youtube_status, summary, cx_mail_sent",
    )
    .eq("id", parsed.data.post_production_id)
    .maybeSingle();

  if (fetchErr || !row) {
    return NextResponse.json(
      { error: fetchErr?.message ?? "Entry not found" },
      { status: fetchErr ? 500 : 404 },
    );
  }

  if (row.youtube_status !== "live") {
    return NextResponse.json(
      { error: "CX mail can only be sent when the video is Live on YouTube" },
      { status: 400 },
    );
  }

  if (row.cx_mail_sent) {
    return NextResponse.json(
      { error: "CX mail was already sent for this entry" },
      { status: 400 },
    );
  }

  const yt = row.youtube_link?.trim();
  if (!yt) {
    return NextResponse.json(
      { error: "Add a YouTube link before sending CX mail" },
      { status: 400 },
    );
  }

  const name = row.candidate_name?.trim() || "Candidate";
  const sent = await sendPostProductionCxEmail({
    to: cxTo,
    candidateName: name,
    youtubeLink: yt,
    summary: row.summary,
  });

  if (!sent.ok) {
    return NextResponse.json({ error: sent.error }, { status: 500 });
  }

  const sentAt = new Date().toISOString();
  const { error: upErr } = await supabase
    .from("post_production")
    .update({ cx_mail_sent: true, cx_mail_sent_at: sentAt })
    .eq("id", row.id);

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  const userName =
    (typeof user.user_metadata?.name === "string" && user.user_metadata.name) ||
    user.email ||
    "Unknown";
  await supabase.from("activity_log").insert({
    user_id: user.id,
    user_name: userName,
    action_type: "post_production",
    entity_type: "post_production",
    entity_id: row.id,
    candidate_name: name,
    description: `Sent CX mail for ${name}`,
    metadata: {},
  });

  return NextResponse.json({ ok: true, cx_mail_sent_at: sentAt });
}

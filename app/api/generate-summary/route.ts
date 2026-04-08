import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

import { verifyRequestUser } from "@/lib/google-sheet-gviz";
import { generateYoutubeInterviewSummary } from "@/lib/youtube-summary";

export const runtime = "nodejs";

const BodySchema = z.object({
  post_production_id: z.string().uuid(),
});

export async function POST(request: Request) {
  const user = await verifyRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
      "id, candidate_name, youtube_link, youtube_status, summary",
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
      { error: "Summary can only be generated when YouTube status is Live" },
      { status: 400 },
    );
  }

  const yt = row.youtube_link?.trim();
  if (!yt) {
    return NextResponse.json(
      { error: "Add a YouTube link before generating a summary" },
      { status: 400 },
    );
  }

  const name = row.candidate_name?.trim() || "Learner";
  const gen = await generateYoutubeInterviewSummary({
    learnerName: name,
    youtubeLink: yt,
  });

  if (!gen.ok) {
    return NextResponse.json({ error: gen.error }, { status: 500 });
  }

  const { error: upErr } = await supabase
    .from("post_production")
    .update({ summary: gen.summary })
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
    description: `Generated summary for ${name}`,
    metadata: {},
  });

  return NextResponse.json({ summary: gen.summary });
}

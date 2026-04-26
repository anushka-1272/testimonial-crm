import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

import { logActivity } from "@/lib/activity-logger";
import { verifyRequestUser } from "@/lib/google-sheet-gviz";
import {
  ACTIVITY_ADDED_ELIGIBLE_TO_POST_PRODUCTION,
  ACTIVITY_BLOCKED_POST_PRODUCTION,
  POST_PRODUCTION_NOT_ELIGIBLE_ERROR,
  canMoveToPostProduction,
} from "@/lib/post-production-eligibility";

export const runtime = "nodejs";

const BodySchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("testimonial"),
    interview_id: z.string().uuid(),
  }),
  z.object({
    source: z.literal("project"),
    project_interview_id: z.string().uuid(),
  }),
]);

export async function POST(request: Request) {
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

  const body = parsed.data;

  if (body.source === "testimonial") {
    const { data: iv, error: ivErr } = await supabase
      .from("interviews")
      .select(
        "id, candidate_id, interview_status, post_interview_eligible, interview_language, interview_type, candidates!inner ( full_name, email, is_deleted )",
      )
      .eq("id", body.interview_id)
      .eq("post_interview_eligible", true)
      .maybeSingle();

    if (ivErr || !iv) {
      return NextResponse.json(
        { error: ivErr?.message ?? POST_PRODUCTION_NOT_ELIGIBLE_ERROR },
        { status: ivErr ? 500 : 400 },
      );
    }

    const candRaw = iv.candidates as
      | { full_name: string | null; email: string; is_deleted?: boolean | null }
      | {
          full_name: string | null;
          email: string;
          is_deleted?: boolean | null;
        }[]
      | null;
    const cand = Array.isArray(candRaw) ? candRaw[0] : candRaw;
    if (!cand || cand.is_deleted) {
      return NextResponse.json(
        { error: "Candidate not found or removed" },
        { status: 400 },
      );
    }

    if (iv.interview_status !== "completed") {
      return NextResponse.json(
        { error: "Interview must be completed before post production" },
        { status: 400 },
      );
    }

    if (!canMoveToPostProduction(iv)) {
      await logActivity({
        supabase,
        user,
        action_type: "post_production",
        entity_type: "interview",
        entity_id: iv.id,
        candidate_name: cand.full_name?.trim() || cand.email,
        description: ACTIVITY_BLOCKED_POST_PRODUCTION,
        metadata: { interview_id: iv.id, candidate_id: iv.candidate_id },
      });
      return NextResponse.json(
        { error: POST_PRODUCTION_NOT_ELIGIBLE_ERROR },
        { status: 400 },
      );
    }

    const name =
      cand.full_name?.trim() ||
      cand.email.split("@")[0] ||
      "Candidate";
    const lang =
      (iv.interview_language as string | null | undefined)?.trim() ||
      "english";

    const upsertRow = {
      interview_id: iv.id,
      project_interview_id: null,
      candidate_id: iv.candidate_id,
      project_candidate_id: null,
      source_type: "testimonial" as const,
      candidate_name: name,
      interview_language: lang,
      created_at: new Date().toISOString(),
    };

    const { data: upserted, error: insErr } = await supabase
      .from("post_production")
      .upsert(upsertRow, {
        onConflict: "interview_id",
        ignoreDuplicates: true,
      })
      .select("id");

    if (insErr) {
      console.error("Post production insert failed", {
        source: "testimonial",
        interview_id: iv.id,
        candidate_id: iv.candidate_id,
        error: insErr,
      });
      const msg = insErr.message ?? "Insert failed";
      if (
        msg.includes("not eligible") ||
        insErr.code === "23514" ||
        insErr.code === "P0001"
      ) {
        await logActivity({
          supabase,
          user,
          action_type: "post_production",
          entity_type: "interview",
          entity_id: iv.id,
          candidate_name: name,
          description: ACTIVITY_BLOCKED_POST_PRODUCTION,
          metadata: { interview_id: iv.id, reason: "db_trigger" },
        });
        return NextResponse.json(
          { error: POST_PRODUCTION_NOT_ELIGIBLE_ERROR },
          { status: 400 },
        );
      }
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    let postProdId: string | null = upserted?.[0]?.id ?? null;
    if (!postProdId) {
      const { data: existing, error: loadErr } = await supabase
        .from("post_production")
        .select("id")
        .eq("interview_id", iv.id)
        .maybeSingle();
      if (loadErr) {
        return NextResponse.json({ error: loadErr.message }, { status: 500 });
      }
      postProdId = existing?.id ?? null;
    }
    if (!postProdId) {
      return NextResponse.json(
        { error: "Could not create or load post production row" },
        { status: 500 },
      );
    }

    const insertedNew = Boolean(upserted?.[0]?.id);
    if (insertedNew) {
      await logActivity({
        supabase,
        user,
        action_type: "post_production",
        entity_type: "post_production",
        entity_id: postProdId,
        candidate_name: name,
        description: ACTIVITY_ADDED_ELIGIBLE_TO_POST_PRODUCTION,
        metadata: { interview_id: iv.id, source: "testimonial" },
      });
    }

    return NextResponse.json({ ok: true, id: postProdId });
  }

  const { data: piv, error: pErr } = await supabase
    .from("project_interviews")
    .select(
      "id, project_candidate_id, interview_status, post_interview_eligible, project_candidates!inner ( id, email, full_name, project_title, is_deleted )",
    )
    .eq("id", body.project_interview_id)
    .eq("post_interview_eligible", true)
    .maybeSingle();

  if (pErr || !piv) {
    return NextResponse.json(
      { error: pErr?.message ?? POST_PRODUCTION_NOT_ELIGIBLE_ERROR },
      { status: pErr ? 500 : 400 },
    );
  }

  const pcRaw = piv.project_candidates as
    | {
        id: string;
        email: string;
        full_name: string | null;
        project_title: string | null;
        is_deleted?: boolean | null;
      }
    | {
        id: string;
        email: string;
        full_name: string | null;
        project_title: string | null;
        is_deleted?: boolean | null;
      }[]
    | null;
  const pc = Array.isArray(pcRaw) ? pcRaw[0] : pcRaw;
  if (!pc || pc.is_deleted) {
    return NextResponse.json(
      { error: "Project candidate not found or removed" },
      { status: 400 },
    );
  }

  if (piv.interview_status !== "completed") {
    return NextResponse.json(
      { error: "Interview must be completed before post production" },
      { status: 400 },
    );
  }

  if (!canMoveToPostProduction(piv)) {
    await logActivity({
      supabase,
      user,
      action_type: "post_production",
      entity_type: "interview",
      entity_id: piv.id,
      candidate_name: pc.project_title?.trim() || pc.email,
      description: ACTIVITY_BLOCKED_POST_PRODUCTION,
      metadata: {
        project_interview_id: piv.id,
        project_candidate_id: piv.project_candidate_id,
      },
    });
    return NextResponse.json(
      { error: POST_PRODUCTION_NOT_ELIGIBLE_ERROR },
      { status: 400 },
    );
  }

  const name =
    pc.project_title?.trim() ||
    pc.full_name?.trim() ||
    pc.email.split("@")[0] ||
    "Candidate";

  const upsertProjectRow = {
    interview_id: null,
    project_interview_id: piv.id,
    candidate_id: null,
    project_candidate_id: piv.project_candidate_id,
    source_type: "project" as const,
    candidate_name: name,
    interview_language: "english",
    created_at: new Date().toISOString(),
  };

  const { data: upsertedP, error: insPErr } = await supabase
    .from("post_production")
    .upsert(upsertProjectRow, {
      onConflict: "project_interview_id",
      ignoreDuplicates: true,
    })
    .select("id");

  if (insPErr) {
    console.error("Post production insert failed", {
      source: "project",
      project_interview_id: piv.id,
      project_candidate_id: piv.project_candidate_id,
      error: insPErr,
    });
    const msg = insPErr.message ?? "Insert failed";
    if (
      msg.includes("not eligible") ||
      insPErr.code === "23514" ||
      insPErr.code === "P0001"
    ) {
      await logActivity({
        supabase,
        user,
        action_type: "post_production",
        entity_type: "interview",
        entity_id: piv.id,
        candidate_name: name,
        description: ACTIVITY_BLOCKED_POST_PRODUCTION,
        metadata: { project_interview_id: piv.id, reason: "db_trigger" },
      });
      return NextResponse.json(
        { error: POST_PRODUCTION_NOT_ELIGIBLE_ERROR },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  let postProdProjectId: string | null = upsertedP?.[0]?.id ?? null;
  if (!postProdProjectId) {
    const { data: existingP, error: loadPErr } = await supabase
      .from("post_production")
      .select("id")
      .eq("project_interview_id", piv.id)
      .maybeSingle();
    if (loadPErr) {
      return NextResponse.json({ error: loadPErr.message }, { status: 500 });
    }
    postProdProjectId = existingP?.id ?? null;
  }
  if (!postProdProjectId) {
    return NextResponse.json(
      { error: "Could not create or load post production row" },
      { status: 500 },
    );
  }

  const insertedProjectNew = Boolean(upsertedP?.[0]?.id);
  if (insertedProjectNew) {
    await logActivity({
      supabase,
      user,
      action_type: "post_production",
      entity_type: "post_production",
      entity_id: postProdProjectId,
      candidate_name: name,
      description: ACTIVITY_ADDED_ELIGIBLE_TO_POST_PRODUCTION,
      metadata: { project_interview_id: piv.id, source: "project" },
    });
  }

  return NextResponse.json({ ok: true, id: postProdProjectId });
}

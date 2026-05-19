import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getUserSafe } from "@/lib/supabase-auth";
import { revertInterviewToCallings } from "@/lib/revert-interview";
import { createSupabaseAdmin } from "@/lib/supabase";

const REVERT_ROLES = new Set(["admin", "interviewer", "operations"]);

async function verifyRevertUser(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  const supabase = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const user = await getUserSafe(supabase);
  if (!user) return null;

  let admin;
  try {
    admin = createSupabaseAdmin();
  } catch {
    return null;
  }

  const { data: tm } = await admin
    .from("team_members")
    .select("role, status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!tm || tm.status === "removed" || !REVERT_ROLES.has(tm.role)) {
    return null;
  }

  return { user, admin };
}

export async function POST(request: Request) {
  try {
    const auth = await verifyRevertUser(request);
    if (!auth) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const body = json as {
      interviewId?: string;
      candidateId?: string;
      isProject?: boolean;
      candidateName?: string;
    };
    const interviewId =
      typeof body.interviewId === "string" ? body.interviewId.trim() : "";
    const candidateId =
      typeof body.candidateId === "string" ? body.candidateId.trim() : "";
    const isProject = Boolean(body.isProject);
    const candidateName =
      typeof body.candidateName === "string" ? body.candidateName.trim() : "Candidate";

    if (!interviewId || !candidateId) {
      return NextResponse.json(
        { error: "interviewId and candidateId are required" },
        { status: 400 },
      );
    }

    const { error } = await revertInterviewToCallings({
      supabase: auth.admin,
      interviewId,
      candidateId,
      isProject,
      candidateName: candidateName || "Candidate",
      user: auth.user,
    });

    if (error) {
      return NextResponse.json({ error }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("interviews revert:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Revert failed" },
      { status: 500 },
    );
  }
}

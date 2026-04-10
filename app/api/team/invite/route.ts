import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import type { TeamRole } from "@/lib/access-control";
import { createSupabaseAdmin } from "@/lib/supabase";
import { getUserSafe } from "@/lib/supabase-auth";

type InviteBody = {
  full_name?: string;
  email?: string;
  role?: TeamRole;
};

function normalizeRole(raw: unknown): TeamRole | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (
    v === "admin" ||
    v === "interviewer" ||
    v === "poc" ||
    v === "operations" ||
    v === "post_production" ||
    v === "viewer"
  )
    return v;
  return null;
}

async function verifyRequestUser(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Missing Supabase env");
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const supabase = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  return getUserSafe(supabase);
}

export async function POST(request: Request) {
  try {
    const user = await verifyRequestUser(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const admin = createSupabaseAdmin();
    const { data: adminRow } = await admin
      .from("team_members")
      .select("role, status")
      .eq("user_id", user.id)
      .maybeSingle();
    if (adminRow?.role !== "admin" || adminRow?.status === "removed") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as InviteBody;
    const email = body.email?.trim().toLowerCase();
    const fullName = body.full_name?.trim() || null;
    const role = normalizeRole(body.role);
    if (!email || !role) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const inviteRes = await admin.auth.admin.inviteUserByEmail(email, {
      data: { name: fullName ?? undefined },
    });
    if (inviteRes.error) {
      return NextResponse.json(
        { error: inviteRes.error.message },
        { status: 400 },
      );
    }
    const invitedUserId = inviteRes.data.user?.id ?? null;

    const { error: upErr } = await admin.from("team_members").upsert(
      {
        user_id: invitedUserId,
        email,
        full_name: fullName,
        role,
        invited_by: user.id,
        invited_at: new Date().toISOString(),
        status: "invited",
      },
      { onConflict: "email" },
    );
    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 400 });
    }

    const actorName =
      (typeof user.user_metadata?.name === "string" && user.user_metadata.name) ||
      user.email ||
      "Admin";
    await admin.from("activity_log").insert({
      user_id: user.id,
      user_name: actorName,
      action_type: "settings",
      entity_type: "team_member",
      candidate_name: email,
      description: `Admin ${actorName} invited ${email} as ${role}`,
      metadata: { role },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to invite user";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import type { TeamRole } from "@/lib/access-control";
import { createSupabaseAdmin } from "@/lib/supabase";
import { getUserSafe } from "@/lib/supabase-auth";

type MutateBody = {
  id?: string;
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

async function ensureAdmin(request: Request) {
  const user = await verifyRequestUser(request);
  if (!user) return { error: "Unauthorized", status: 401 as const };
  const admin = createSupabaseAdmin();
  const { data: adminRow } = await admin
    .from("team_members")
    .select("role, status")
    .eq("user_id", user.id)
    .maybeSingle();
  if (adminRow?.role !== "admin" || adminRow?.status === "removed") {
    return { error: "Forbidden", status: 403 as const };
  }
  return { user, admin } as const;
}

export async function PATCH(request: Request) {
  try {
    const guard = await ensureAdmin(request);
    if ("error" in guard) {
      return NextResponse.json({ error: guard.error }, { status: guard.status });
    }
    const { admin, user } = guard;
    const body = (await request.json().catch(() => ({}))) as MutateBody;
    const id = body.id?.trim();
    const role = normalizeRole(body.role);
    if (!id || !role) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    const { data: row } = await admin
      .from("team_members")
      .select("email, full_name")
      .eq("id", id)
      .maybeSingle();
    const { error: upErr } = await admin
      .from("team_members")
      .update({ role })
      .eq("id", id);
    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 400 });
    }
    const actorName =
      (typeof user.user_metadata?.name === "string" && user.user_metadata.name) ||
      user.email ||
      "Admin";
    const memberLabel = row?.full_name?.trim() || row?.email || "member";
    await admin.from("activity_log").insert({
      user_id: user.id,
      user_name: actorName,
      action_type: "settings",
      entity_type: "team_member",
      candidate_name: row?.email ?? null,
      description: `Admin ${actorName} changed ${memberLabel} role to ${role}`,
      metadata: { role },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update member";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const guard = await ensureAdmin(request);
    if ("error" in guard) {
      return NextResponse.json({ error: guard.error }, { status: guard.status });
    }
    const { admin, user } = guard;
    const body = (await request.json().catch(() => ({}))) as MutateBody;
    const id = body.id?.trim();
    if (!id) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    const { data: row } = await admin
      .from("team_members")
      .select("email, full_name")
      .eq("id", id)
      .maybeSingle();
    const { error: upErr } = await admin
      .from("team_members")
      .update({ status: "removed" })
      .eq("id", id);
    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 400 });
    }
    const actorName =
      (typeof user.user_metadata?.name === "string" && user.user_metadata.name) ||
      user.email ||
      "Admin";
    const memberLabel = row?.full_name?.trim() || row?.email || "member";
    await admin.from("activity_log").insert({
      user_id: user.id,
      user_name: actorName,
      action_type: "settings",
      entity_type: "team_member",
      candidate_name: row?.email ?? null,
      description: `Admin ${actorName} removed ${memberLabel} from team`,
      metadata: {},
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to remove member";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

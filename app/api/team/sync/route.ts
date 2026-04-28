import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { createSupabaseAdmin } from "@/lib/supabase";
import { getUserSafe } from "@/lib/supabase-auth";

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

    const allAuthUsers: Array<{
      id: string;
      email: string | null;
      user_metadata?: Record<string, unknown> | null;
    }> = [];
    let page = 1;
    const perPage = 1000;
    for (let guard = 0; guard < 100; guard++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      const users = data?.users ?? [];
      for (const u of users) {
        allAuthUsers.push({
          id: u.id,
          email: u.email ?? null,
          user_metadata:
            (u.user_metadata as Record<string, unknown> | undefined) ?? null,
        });
      }
      if (users.length < perPage) break;
      page += 1;
    }

    const { data: currentRows, error: currentErr } = await admin
      .from("team_members")
      .select("id, email, user_id, full_name");
    if (currentErr) {
      return NextResponse.json({ error: currentErr.message }, { status: 400 });
    }

    const currentByEmail = new Map<
      string,
      { id: string; email: string; user_id: string | null; full_name: string | null }
    >();
    for (const row of (currentRows ?? []) as Array<{
      id: string;
      email: string;
      user_id: string | null;
      full_name: string | null;
    }>) {
      const email = row.email.trim().toLowerCase();
      if (!email) continue;
      currentByEmail.set(email, row);
    }

    const nowIso = new Date().toISOString();
    const toInsert: Array<{
      user_id: string;
      email: string;
      full_name: string | null;
      role: "viewer";
      invited_by: string;
      invited_at: string;
      status: "active";
    }> = [];
    const toBackfill: Array<{ id: string; user_id: string; full_name: string | null }> = [];
    let skipped = 0;

    for (const authUser of allAuthUsers) {
      const email = authUser.email?.trim().toLowerCase() ?? "";
      if (!email) {
        skipped += 1;
        continue;
      }
      const fullNameRaw = authUser.user_metadata?.name;
      const fullName =
        typeof fullNameRaw === "string" && fullNameRaw.trim()
          ? fullNameRaw.trim()
          : null;
      const existing = currentByEmail.get(email);
      if (!existing) {
        toInsert.push({
          user_id: authUser.id,
          email,
          full_name: fullName,
          role: "viewer",
          invited_by: user.id,
          invited_at: nowIso,
          status: "active",
        });
        continue;
      }
      if (!existing.user_id) {
        toBackfill.push({
          id: existing.id,
          user_id: authUser.id,
          full_name: existing.full_name ?? fullName,
        });
      }
    }

    if (toInsert.length > 0) {
      const { error: insertErr } = await admin.from("team_members").insert(toInsert);
      if (insertErr) {
        return NextResponse.json({ error: insertErr.message }, { status: 400 });
      }
    }

    let backfilled = 0;
    for (const row of toBackfill) {
      const { error: upErr } = await admin
        .from("team_members")
        .update({
          user_id: row.user_id,
          full_name: row.full_name,
        })
        .eq("id", row.id);
      if (!upErr) backfilled += 1;
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
      candidate_name: null,
      description: `Admin ${actorName} synced ${toInsert.length} auth users into Team`,
      metadata: {
        inserted: toInsert.length,
        backfilled,
        skipped,
        auth_total: allAuthUsers.length,
      },
    });

    return NextResponse.json({
      ok: true,
      inserted: toInsert.length,
      backfilled,
      skipped,
      auth_total: allAuthUsers.length,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to sync auth users";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

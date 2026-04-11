import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import type { TeamRole } from "@/lib/access-control";
import { getUserSafe } from "@/lib/supabase-auth";

/** GoTrue returns this when the email already has an auth account. */
function isExistingAuthUserInviteError(err: {
  message: string;
  status?: number;
  code?: string;
}): boolean {
  const code = (err.code ?? "").toLowerCase();
  const msg = err.message.toLowerCase();
  if (code === "email_exists" || code === "user_already_exists") return true;
  if (msg.includes("already registered")) return true;
  if (msg.includes("already been registered")) return true;
  return false;
}

/** Resolve auth user id by email (admin listUsers is paginated; no getUserByEmail in this SDK). */
async function authUserIdByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<string | null> {
  const normalized = email.toLowerCase();
  let page = 1;
  const perPage = 1000;
  for (let guard = 0; guard < 100; guard++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) return null;
    const users = data?.users ?? [];
    for (const u of users) {
      if ((u.email ?? "").toLowerCase() === normalized) return u.id;
    }
    if (users.length < perPage) break;
    page += 1;
  }
  return null;
}

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

    const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: "Server misconfiguration" },
        { status: 500 },
      );
    }
    const supabaseAdmin = createClient(serviceUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: adminRow } = await supabaseAdmin
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

    const inviteRes = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email,
      {
        data: { name: fullName ?? undefined },
      },
    );

    let targetUserId: string | null = null;
    let reactivatedExistingAccount = false;

    if (!inviteRes.error && inviteRes.data.user?.id) {
      targetUserId = inviteRes.data.user.id;
    } else if (inviteRes.error && isExistingAuthUserInviteError(inviteRes.error)) {
      const existingId = await authUserIdByEmail(supabaseAdmin, email);
      if (!existingId) {
        return NextResponse.json(
          {
            error:
              "This email is already registered, but the account could not be found. Please try again.",
          },
          { status: 400 },
        );
      }
      targetUserId = existingId;
      reactivatedExistingAccount = true;
    } else if (inviteRes.error) {
      return NextResponse.json(
        { error: inviteRes.error.message },
        { status: 400 },
      );
    } else {
      return NextResponse.json(
        { error: "Invite did not return a user id" },
        { status: 400 },
      );
    }

    const { error: upErr } = await supabaseAdmin.from("team_members").upsert(
      {
        user_id: targetUserId,
        email,
        full_name: fullName,
        role,
        invited_by: user.id,
        invited_at: new Date().toISOString(),
        status: reactivatedExistingAccount ? "active" : "invited",
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
    await supabaseAdmin.from("activity_log").insert({
      user_id: user.id,
      user_name: actorName,
      action_type: "settings",
      entity_type: "team_member",
      candidate_name: email,
      description: reactivatedExistingAccount
        ? `Admin ${actorName} added ${email} as ${role} (existing account)`
        : `Admin ${actorName} invited ${email} as ${role}`,
      metadata: { role },
    });

    if (reactivatedExistingAccount) {
      return NextResponse.json({
        ok: true,
        success: "Member added successfully",
      });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to invite user";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

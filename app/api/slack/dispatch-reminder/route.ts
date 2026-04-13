import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getUserSafe } from "@/lib/supabase-auth";
import { SLACK_SIDDHARTHA_EMAIL } from "@/lib/slack-contacts";
import { sendSlackDM } from "@/lib/slack";
import { createSupabaseAdmin } from "@/lib/supabase";

async function verifyRequestUser(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
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

    let admin;
    try {
      admin = createSupabaseAdmin();
    } catch (e) {
      console.error("dispatch-reminder admin client:", e);
      return NextResponse.json(
        { success: false, error: "Server misconfiguration" },
        { status: 500 },
      );
    }
    const { data: tm } = await admin
      .from("team_members")
      .select("role, status")
      .eq("user_id", user.id)
      .maybeSingle();

    if (tm?.role !== "admin" || tm?.status === "removed") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { count, error } = await admin
      .from("dispatch")
      .select("id, candidates!inner(id)", { count: "exact", head: true })
      .eq("candidates.is_deleted", false)
      .eq("dispatch_status", "pending");

    if (error) {
      console.error("dispatch-reminder count:", error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 },
      );
    }

    const n = count ?? 0;
    const message = `📦 Dispatch reminder!\nThere are *${n} pending dispatch(es)* waiting to be processed.\nPlease review and update in the CRM.`;

    const result = await sendSlackDM(SLACK_SIDDHARTHA_EMAIL, message);
    return NextResponse.json({
      success: result.success,
      pending_count: n,
    });
  } catch (e) {
    console.error("dispatch-reminder route:", e);
    return NextResponse.json({ success: false }, { status: 200 });
  }
}

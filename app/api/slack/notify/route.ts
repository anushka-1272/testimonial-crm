import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getUserSafe } from "@/lib/supabase-auth";
import { sendSlackDM } from "@/lib/slack";

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

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const body = json as { userEmail?: string; message?: string };
    const userEmail =
      typeof body.userEmail === "string" ? body.userEmail.trim() : "";
    const message = typeof body.message === "string" ? body.message : "";
    if (!userEmail || !message) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const result = await sendSlackDM(userEmail, message);
    return NextResponse.json({ success: result.success });
  } catch (e) {
    console.error("Slack notify route:", e);
    return NextResponse.json({ success: false }, { status: 200 });
  }
}

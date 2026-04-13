import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getUserSafe } from "@/lib/supabase-auth";
import { sendWatiMessage, type WatiTemplateParameter } from "@/lib/wati";

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

    const body = json as {
      phone?: string;
      template_name?: string;
      parameters?: WatiTemplateParameter[];
    };

    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const template_name =
      typeof body.template_name === "string" ? body.template_name.trim() : "";
    const parameters = Array.isArray(body.parameters) ? body.parameters : [];

    if (!phone || !template_name) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const result = await sendWatiMessage(phone, template_name, parameters);
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 502 },
      );
    }
    return NextResponse.json({ success: true, data: result.data });
  } catch (e) {
    console.error("WATI route error:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

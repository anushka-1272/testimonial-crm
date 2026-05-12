import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { runCandidateLookup } from "@/lib/candidate-lookup";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { query?: unknown };
    const query = typeof body.query === "string" ? body.query : "";

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || (!serviceKey && !anonKey)) {
      return NextResponse.json(
        { ok: false, reason: "error", message: "Server misconfigured" } as const,
        { status: 503 },
      );
    }

    const supabase = createClient(url, serviceKey ?? anonKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const result = await runCandidateLookup(supabase, query);
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch {
    return NextResponse.json(
      { ok: false, reason: "error", message: "Lookup failed" } as const,
      { status: 500 },
    );
  }
}

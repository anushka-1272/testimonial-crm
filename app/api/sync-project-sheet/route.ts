import { NextResponse } from "next/server";

import {
  cellToString,
  extractGvizJson,
  type GvizCell,
  type GvizResponse,
  type GvizRow,
  verifyRequestUser,
} from "@/lib/google-sheet-gviz";
import { createSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

function normalizeHeader(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Find column index by exact or substring match on header row. */
function colIndex(headers: string[], ...candidates: string[]): number {
  const H = headers.map(normalizeHeader);
  for (const cand of candidates) {
    const n = normalizeHeader(cand);
    let i = H.findIndex((h) => h === n);
    if (i >= 0) return i;
    i = H.findIndex((h) => h.includes(n) || n.includes(h));
    if (i >= 0) return i;
  }
  return -1;
}

function buildSheetUrl(): string | null {
  const id = process.env.GOOGLE_PROJECT_SHEET_ID?.trim();
  if (!id) return null;
  const sheet =
    process.env.GOOGLE_PROJECT_SHEET_TAB?.trim() || "Form_Responses";
  return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheet)}`;
}

export async function POST(request: Request) {
  const errors: string[] = [];
  let totalRows = 0;
  let upserted = 0;

  try {
    const user = await verifyRequestUser(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sheetUrl = buildSheetUrl();
    if (!sheetUrl) {
      return NextResponse.json(
        {
          error: "GOOGLE_PROJECT_SHEET_ID is not configured",
          total_rows: 0,
          upserted: 0,
          errors: [],
        },
        { status: 500 },
      );
    }

    const res = await fetch(sheetUrl, { next: { revalidate: 0 } });
    if (!res.ok) {
      return NextResponse.json(
        {
          error: `Failed to fetch project sheet (${res.status})`,
          total_rows: 0,
          upserted: 0,
          errors: [],
        },
        { status: 502 },
      );
    }

    const text = await res.text();
    let parsed: GvizResponse;
    try {
      parsed = extractGvizJson(text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Parse error";
      return NextResponse.json(
        {
          error: msg,
          total_rows: 0,
          upserted: 0,
          errors: [msg],
        },
        { status: 422 },
      );
    }

    if (parsed.status === "error") {
      const msg =
        parsed.errors?.[0]?.detailed_message ?? "Google Sheet query error";
      return NextResponse.json(
        {
          error: msg,
          total_rows: 0,
          upserted: 0,
          errors: [msg],
        },
        { status: 422 },
      );
    }

    const rows = parsed.table?.rows ?? [];
    if (rows.length < 2) {
      return NextResponse.json({
        total_rows: 0,
        upserted: 0,
        errors: [],
      });
    }

    const headerRow = rows[0];
    const headers = (headerRow.c ?? []).map((cell) => cellToString(cell));
    const idx = {
      email: colIndex(headers, "Email Address"),
      phone: colIndex(headers, "Phone Number"),
      title: colIndex(headers, "Project Title"),
      problem: colIndex(
        headers,
        "What real-world problem are you solving?",
      ),
      target: colIndex(headers, "Who is this problem for?"),
      ai: colIndex(headers, "How does your solution use AI?"),
      demo: colIndex(
        headers,
        "Please share GOOGLE DRIVE link",
        "GOOGLE DRIVE",
        "demo link",
      ),
    };

    if (idx.email < 0) {
      return NextResponse.json(
        {
          error: "Sheet is missing an Email Address column",
          total_rows: 0,
          upserted: 0,
          errors: [],
        },
        { status: 422 },
      );
    }

    const dataRows = rows.slice(1);
    totalRows = dataRows.length;
    const supabase = createSupabaseAdmin();

    for (let idxRow = 0; idxRow < dataRows.length; idxRow++) {
      const row = dataRows[idxRow];
      const sheetRowNum = idxRow + 2;
      const c = row.c ?? [];

      const pick = (i: number) => (i >= 0 ? cellToString(c[i] ?? null) : "");

      const emailRaw = pick(idx.email).trim().toLowerCase();
      if (!emailRaw) {
        continue;
      }

      const rowPayload = {
        email: emailRaw,
        whatsapp_number: pick(idx.phone) || null,
        project_title: pick(idx.title) || null,
        problem_statement: pick(idx.problem) || null,
        target_user: pick(idx.target) || null,
        ai_usage: pick(idx.ai) || null,
        demo_link: pick(idx.demo) || null,
        synced_at: new Date().toISOString(),
      };

      const { error: upErr } = await supabase
        .from("project_candidates")
        .upsert(rowPayload, { onConflict: "email" });

      if (upErr) {
        errors.push(`Row ${sheetRowNum}: ${upErr.message}`);
        continue;
      }
      upserted++;
    }

    return NextResponse.json({
      total_rows: totalRows,
      upserted,
      errors,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sync failed";
    errors.push(msg);
    return NextResponse.json(
      {
        error: msg,
        total_rows: totalRows,
        upserted,
        errors,
      },
      { status: 500 },
    );
  }
}

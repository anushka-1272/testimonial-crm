import { format, isValid, parseISO } from "date-fns";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { runAssessEligibilityAndPersist } from "@/lib/candidate-assessment";
import { createSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

const SHEET_GVIZ_URL =
  "https://docs.google.com/spreadsheets/d/1tUKfTRAR6Jh48t272EM-etC-yq71-y9yPpC3Aizx5hU/gviz/tq?tqx=out:json&sheet=Form_Responses";

type GvizCell = { v?: unknown; f?: string | null } | null | undefined;
type GvizRow = { c?: GvizCell[] };

type GvizTable = {
  cols?: unknown[];
  rows?: GvizRow[];
};

type GvizResponse = {
  version?: string;
  status?: string;
  errors?: { detailed_message?: string }[];
  table?: GvizTable;
};

function extractGvizJson(text: string): GvizResponse {
  const marker = "setResponse(";
  const start = text.indexOf(marker);
  if (start === -1) {
    throw new Error("Response is not a Google Visualization JSONP payload");
  }
  let i = start + marker.length;
  while (/\s/.test(text[i] ?? "")) i++;
  if (text[i] !== "{") {
    throw new Error("Expected JSON object after setResponse(");
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  const begin = i;
  for (; i < text.length; i++) {
    const c = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\" && inString) {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          return JSON.parse(text.slice(begin, i + 1)) as GvizResponse;
        }
      }
    }
  }
  throw new Error("Unterminated JSON in gviz response");
}

/** Prefer formatted cell text; parse Google `Date(y,m,d,...)` strings to ISO. */
function cellToString(cell: GvizCell): string {
  if (cell == null) return "";
  if (cell.f != null && String(cell.f).trim() !== "") {
    return String(cell.f).trim();
  }
  const v = cell.v;
  if (v == null || v === "") return "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number" && Number.isFinite(v)) {
    return String(v);
  }
  if (typeof v === "string") {
    const m =
      /^Date\((-?\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)$/.exec(v.trim());
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      const h = m[4] != null ? Number(m[4]) : 0;
      const min = m[5] != null ? Number(m[5]) : 0;
      const s = m[6] != null ? Number(m[6]) : 0;
      return new Date(y, mo, d, h, min, s).toISOString();
    }
    return v;
  }
  return String(v);
}

function cellToIsoTimestamp(cell: GvizCell): string | null {
  const raw = cellToString(cell);
  if (!raw) return null;
  const d = parseISO(raw.includes("T") ? raw : `${raw.replace(/\//g, "-")}T12:00:00.000Z`);
  if (!isValid(d)) {
    const try2 = parseISO(raw);
    if (!isValid(try2)) return null;
    return try2.toISOString();
  }
  return d.toISOString();
}

function cellToDateOnly(cell: GvizCell): string | null {
  const raw = cellToString(cell);
  if (!raw) return null;
  const normalized = raw.includes("T") ? raw : `${raw}T12:00:00.000Z`;
  let d = parseISO(normalized);
  if (!isValid(d)) {
    d = parseISO(raw);
  }
  if (!isValid(d)) return null;
  return format(d, "yyyy-MM-dd");
}

function declarationFromCell(cell: GvizCell): boolean {
  const s = cellToString(cell);
  if (!s) return false;
  const lower = s.toLowerCase();
  if (["true", "yes", "1", "on", "checked", "✓", "y"].includes(lower)) {
    return true;
  }
  return s.length > 0;
}

function escapeILikeExact(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function verifyRequestUser(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error("Missing Supabase env");
  }
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return null;
  }
  const supabase = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

export async function POST(request: Request) {
  const errors: string[] = [];
  let totalRows = 0;
  let newInserted = 0;
  let skippedDuplicates = 0;

  try {
    const user = await verifyRequestUser(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const res = await fetch(SHEET_GVIZ_URL, { next: { revalidate: 0 } });
    if (!res.ok) {
      return NextResponse.json(
        {
          error: `Failed to fetch sheet (${res.status})`,
          total_rows: 0,
          new_inserted: 0,
          skipped_duplicates: 0,
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
          new_inserted: 0,
          skipped_duplicates: 0,
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
          new_inserted: 0,
          skipped_duplicates: 0,
          errors: [msg],
        },
        { status: 422 },
      );
    }

    const rows = parsed.table?.rows ?? [];
    if (rows.length === 0) {
      return NextResponse.json({
        total_rows: 0,
        new_inserted: 0,
        skipped_duplicates: 0,
        errors: [],
      });
    }

    const dataRows = rows.slice(1);
    totalRows = dataRows.length;

    const supabase = createSupabaseAdmin();
    const insertedIds: string[] = [];

    for (let idx = 0; idx < dataRows.length; idx++) {
      const row = dataRows[idx];
      const sheetRowNum = idx + 2;
      const c = row.c ?? [];

      const emailRaw = cellToString(c[1] ?? null).trim();
      if (!emailRaw) {
        continue;
      }

      const { data: existing } = await supabase
        .from("candidates")
        .select("id")
        .ilike("email", escapeILikeExact(emailRaw))
        .maybeSingle();

      if (existing?.id) {
        skippedDuplicates++;
        continue;
      }

      const form_filled_date = cellToIsoTimestamp(c[0] ?? null);
      const insertRow = {
        form_filled_date: form_filled_date ?? new Date().toISOString(),
        email: emailRaw,
        full_name: cellToString(c[2] ?? null) || null,
        whatsapp_number: cellToString(c[3] ?? null) || null,
        role_before_program: cellToString(c[4] ?? null) || null,
        salary_before_program: cellToString(c[5] ?? null) || null,
        primary_goal: cellToString(c[6] ?? null) || null,
        achievement_type: cellToString(c[7] ?? null) || null,
        achievement_title: cellToString(c[8] ?? null) || null,
        achieved_on_date: cellToDateOnly(c[9] ?? null),
        program_joined_date: cellToDateOnly(c[10] ?? null),
        quantified_result: cellToString(c[11] ?? null) || null,
        skills_modules_helped: cellToString(c[12] ?? null) || null,
        how_program_helped: cellToString(c[13] ?? null) || null,
        proof_document_url: cellToString(c[14] ?? null) || null,
        proof_description: cellToString(c[15] ?? null) || null,
        linkedin_url: cellToString(c[16] ?? null) || null,
        instagram_url: cellToString(c[17] ?? null) || null,
        declaration_accepted: declarationFromCell(c[18] ?? null),
        poc: cellToString(c[19] ?? null) || null,
        remarks: cellToString(c[20] ?? null) || null,
        eligibility_status: "pending_review" as const,
        congratulation_call_pending: false,
      };

      const { data: inserted, error: insErr } = await supabase
        .from("candidates")
        .insert(insertRow)
        .select("id")
        .single();

      if (insErr) {
        errors.push(`Row ${sheetRowNum}: ${insErr.message}`);
        continue;
      }

      if (inserted?.id) {
        insertedIds.push(inserted.id);
        newInserted++;
      }
    }

    for (let i = 0; i < insertedIds.length; i++) {
      const id = insertedIds[i];
      const result = await runAssessEligibilityAndPersist(supabase, id);
      if (!result.ok) {
        errors.push(`Assessment ${id}: ${result.error}`);
      }
      if (i < insertedIds.length - 1) {
        await sleep(500);
      }
    }

    return NextResponse.json({
      total_rows: totalRows,
      new_inserted: newInserted,
      skipped_duplicates: skippedDuplicates,
      errors,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sync failed";
    errors.push(msg);
    return NextResponse.json(
      {
        error: msg,
        total_rows: totalRows,
        new_inserted: newInserted,
        skipped_duplicates: skippedDuplicates,
        errors,
      },
      { status: 500 },
    );
  }
}

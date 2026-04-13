import { isValid, parseISO } from "date-fns";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { runAssessEligibilityAndPersist } from "@/lib/candidate-assessment";
import { getUserSafe } from "@/lib/supabase-auth";
import { createSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

/** Testimonial candidates — Google Sheet (not project pipeline). */
const SHEET_ID = "1tw4h3C1wYi1Nyt2CjXaf_eRSHV1-pV9g8i8-r2J5_F0";
const TAB_NAME = "Responses 8-4";
const RANGE_FIRST_ROW = 1956;
/** gviz range: testimonial responses from this row through column Z. */
const SHEET_RANGE = `${TAB_NAME}!A${RANGE_FIRST_ROW}:Z`;

const SHEET_GVIZ_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&range=${encodeURIComponent(SHEET_RANGE)}`;

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
  const d = parseISO(
    raw.includes("T") ? raw : `${raw.replace(/\//g, "-")}T12:00:00.000Z`,
  );
  if (!isValid(d)) {
    const try2 = parseISO(raw);
    if (!isValid(try2)) return null;
    return try2.toISOString();
  }
  return d.toISOString();
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

/**
 * Column order from sheet "Responses 8-4" (0-based):
 * 0 Timestamp, 1 Email, 2 Full Name, 3 WhatsApp, 4 Domain, 5 Job Role,
 * 6 Achievement Type, 7 Title, 8 Summary, 9 Quantified Result, 10 Proof,
 * 11 LinkedIn, 12 Instagram, 13 Declaration
 */
function rowFromSheetCells(c: GvizCell[], emailNormalized: string) {
  const ts = cellToIsoTimestamp(c[0] ?? null);
  const jobRole = cellToString(c[5] ?? null) || null;
  const declaration = declarationFromCell(c[13] ?? null);

  return {
    email: emailNormalized,
    created_at: ts ?? undefined,
    form_filled_date: ts ?? new Date().toISOString(),
    full_name: cellToString(c[2] ?? null) || null,
    whatsapp_number: cellToString(c[3] ?? null) || null,
    domain: cellToString(c[4] ?? null) || null,
    job_role: jobRole,
    role_before_program: jobRole,
    achievement_type: cellToString(c[6] ?? null) || null,
    achievement_title: cellToString(c[7] ?? null) || null,
    achievement_summary: cellToString(c[8] ?? null) || null,
    quantified_result: cellToString(c[9] ?? null) || null,
    proof_document_url: cellToString(c[10] ?? null) || null,
    linkedin_url: cellToString(c[11] ?? null) || null,
    instagram_url: cellToString(c[12] ?? null) || null,
    declaration,
    declaration_accepted: declaration,
  };
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
  const user = await getUserSafe(supabase);
  if (!user) return null;
  return user;
}

export async function POST(request: Request) {
  const errors: string[] = [];
  let totalRows = 0;
  let newInserted = 0;
  let updatedRows = 0;
  let skippedEmptyEmail = 0;
  let scored = 0;
  let failedScore = 0;

  try {
    const user = await verifyRequestUser(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.log("Syncing TESTIMONIAL sheet:", SHEET_ID, "Tab:", TAB_NAME);

    const res = await fetch(SHEET_GVIZ_URL, { next: { revalidate: 0 } });
    if (!res.ok) {
      return NextResponse.json(
        {
          error: `Failed to fetch sheet (${res.status})`,
          total_rows: 0,
          new_inserted: 0,
          updated_rows: 0,
          upserted: 0,
          scored: 0,
          failed: 0,
          skipped_empty_email: 0,
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
          updated_rows: 0,
          upserted: 0,
          scored: 0,
          failed: 0,
          skipped_empty_email: 0,
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
          updated_rows: 0,
          upserted: 0,
          scored: 0,
          failed: 0,
          skipped_empty_email: 0,
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
        updated_rows: 0,
        upserted: 0,
        scored: 0,
        failed: 0,
        skipped_empty_email: 0,
        errors: [],
      });
    }

    /** Range `A1956:Z` returns rows starting at sheet row 1956 (no separate header skip). */
    const dataRows = rows;
    totalRows = dataRows.length;

    const supabase = createSupabaseAdmin();
    /** Candidate rows successfully written this run (insert or update). */
    const syncedCandidateIds = new Set<string>();

    for (let idx = 0; idx < dataRows.length; idx++) {
      const row = dataRows[idx];
      const sheetRowNum = RANGE_FIRST_ROW + idx;
      const c = row.c ?? [];

      const emailRaw = cellToString(c[1] ?? null).trim();
      if (!emailRaw) {
        skippedEmptyEmail++;
        continue;
      }

      const emailNormalized = emailRaw.toLowerCase();
      const payload = rowFromSheetCells(c, emailNormalized);

      const { data: existing } = await supabase
        .from("candidates")
        .select("id, is_deleted")
        .ilike("email", escapeILikeExact(emailRaw.trim()))
        .maybeSingle();

      if (existing?.is_deleted) {
        errors.push(
          `Row ${sheetRowNum}: skipped (candidate deleted — not restored from sheet)`,
        );
        continue;
      }

      if (existing?.id) {
        const { created_at: _omitCreated, ...updateFields } = payload;
        const { error: upErr } = await supabase
          .from("candidates")
          .update(updateFields)
          .eq("id", existing.id)
          .eq("is_deleted", false);

        if (upErr) {
          errors.push(`Row ${sheetRowNum}: ${upErr.message}`);
          continue;
        }
        syncedCandidateIds.add(existing.id);
        updatedRows++;
        continue;
      }

      const { created_at, ...restPayload } = payload;
      const insertRow = {
        ...restPayload,
        ...(created_at ? { created_at } : {}),
        eligibility_status: "pending_review" as const,
        congratulation_call_pending: false,
      };

      const { data: inserted, error: insErr } = await supabase
        .from("candidates")
        .insert(insertRow)
        .select("id")
        .single();

      if (insErr) {
        const dup =
          insErr.code === "23505" ||
          (insErr.message ?? "").toLowerCase().includes("duplicate");
        if (dup) {
          const { data: clash } = await supabase
            .from("candidates")
            .select("is_deleted")
            .ilike("email", escapeILikeExact(emailRaw.trim()))
            .maybeSingle();
          if (clash?.is_deleted) {
            errors.push(
              `Row ${sheetRowNum}: skipped (deleted candidate with same email — not restored)`,
            );
            continue;
          }
        }
        errors.push(`Row ${sheetRowNum}: ${insErr.message}`);
        continue;
      }

      if (inserted?.id) {
        syncedCandidateIds.add(inserted.id);
        newInserted++;
      }
    }

    const idsSynced = [...syncedCandidateIds];
    if (idsSynced.length > 0) {
      const { data: needScoreRows, error: needScoreErr } = await supabase
        .from("candidates")
        .select("id, email")
        .in("id", idsSynced)
        .is("ai_eligibility_score", null)
        .eq("is_deleted", false);

      if (needScoreErr) {
        errors.push(`AI scoring prefetch: ${needScoreErr.message}`);
      } else {
        const candidatesNeedingScore = needScoreRows ?? [];
        const total = candidatesNeedingScore.length;
        for (let i = 0; i < total; i++) {
          const row = candidatesNeedingScore[i];
          const email = row.email ?? row.id;
          console.log(`Scoring candidate ${i + 1} of ${total}: ${email}`);
          try {
            const result = await runAssessEligibilityAndPersist(
              supabase,
              row.id as string,
            );
            if (result.ok) {
              scored++;
            } else {
              failedScore++;
              errors.push(`Assessment ${row.id}: ${result.error}`);
              console.error("AI scoring failed for:", email, result.error);
            }
          } catch (err) {
            failedScore++;
            console.error("AI scoring failed for:", email, err);
            errors.push(
              `Assessment ${row.id}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          if (i < total - 1) {
            await sleep(1000);
          }
        }
      }
    }

    const upserted = newInserted + updatedRows;

    // UI lists testimonial candidates by created_at DESC so the newest sheet rows appear first after sync.
    return NextResponse.json({
      total_rows: totalRows,
      new_inserted: newInserted,
      updated_rows: updatedRows,
      upserted,
      scored,
      failed: failedScore,
      skipped_empty_email: skippedEmptyEmail,
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
        updated_rows: updatedRows,
        upserted: newInserted + updatedRows,
        scored,
        failed: failedScore,
        skipped_empty_email: skippedEmptyEmail,
        errors,
      },
      { status: 500 },
    );
  }
}

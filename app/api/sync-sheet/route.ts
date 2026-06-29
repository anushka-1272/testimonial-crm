import { isValid, parseISO } from "date-fns";
import { createClient } from "@supabase/supabase-js";
import { after, NextResponse } from "next/server";

import { runAssessEligibilityAndPersist } from "@/lib/candidate-assessment";
import { getUserSafe } from "@/lib/supabase-auth";
import { createSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
/** Sheet sync + AI scoring can run long on large batches (Vercel Pro). */
export const maxDuration = 300;

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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type SheetColumnKey =
  | "timestamp"
  | "email"
  | "full_name"
  | "whatsapp"
  | "city"
  | "domain"
  | "job_role"
  | "achievement_type"
  | "achievement_title"
  | "achievement_summary"
  | "quantified_result"
  | "proof"
  | "linkedin"
  | "instagram"
  | "declaration";

type SheetColumnMap = Record<SheetColumnKey, number>;

const HEADER_RANGE = `${TAB_NAME}!A1:AA1`;
const HEADER_GVIZ_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&range=${encodeURIComponent(HEADER_RANGE)}`;

/** Legacy fixed indices before optional "Current City of Residence" column. */
const LEGACY_COLUMN_MAP: SheetColumnMap = {
  timestamp: 0,
  email: 1,
  full_name: 2,
  whatsapp: 3,
  city: -1,
  domain: 4,
  job_role: 5,
  achievement_type: 6,
  achievement_title: 7,
  achievement_summary: 8,
  quantified_result: 9,
  proof: 10,
  linkedin: 11,
  instagram: 12,
  declaration: 13,
};

const COLUMN_HEADER_MATCHERS: Record<SheetColumnKey, string[]> = {
  timestamp: ["timestamp"],
  email: ["email address", "email"],
  full_name: ["full name"],
  whatsapp: ["whatsapp"],
  city: ["current city of residence"],
  domain: ["select your domain", "domain"],
  job_role: ["current job role"],
  achievement_type: ["select your achievement type", "achievement type"],
  achievement_title: ["enter achievement title", "achievement title"],
  achievement_summary: ["enter achievement summary", "achievement summary"],
  quantified_result: ["mention quantified result", "quantified result"],
  proof: ["upload proof document", "proof document"],
  linkedin: ["linkedin profile", "linkedin"],
  instagram: ["instagram profile", "instagram"],
  declaration: ["declaration"],
};

function normalizeHeaderLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/:$/, "");
}

function findColumnIndex(headers: string[], matchers: string[]): number {
  const normalizedHeaders = headers.map((h) => normalizeHeaderLabel(h));
  for (const matcher of matchers) {
    const m = normalizeHeaderLabel(matcher);
    const idx = normalizedHeaders.findIndex(
      (h) => h === m || h.startsWith(m) || m.startsWith(h) || h.includes(m),
    );
    if (idx >= 0) return idx;
  }
  return -1;
}

function buildColumnMap(headers: string[]): SheetColumnMap {
  const map = { ...LEGACY_COLUMN_MAP };
  for (const key of Object.keys(COLUMN_HEADER_MATCHERS) as SheetColumnKey[]) {
    const idx = findColumnIndex(headers, COLUMN_HEADER_MATCHERS[key]);
    if (idx >= 0) map[key] = idx;
  }
  return map;
}

function cellAt(c: GvizCell[], map: SheetColumnMap, key: SheetColumnKey): GvizCell {
  const idx = map[key];
  if (idx < 0) return null;
  return c[idx] ?? null;
}

async function fetchSheetColumnMap(): Promise<SheetColumnMap> {
  try {
    const res = await fetch(HEADER_GVIZ_URL, { next: { revalidate: 0 } });
    if (!res.ok) return LEGACY_COLUMN_MAP;
    const parsed = extractGvizJson(await res.text());
    const headerCells = parsed.table?.rows?.[0]?.c ?? [];
    const headers = headerCells.map((cell) => cellToString(cell));
    if (headers.length === 0) return LEGACY_COLUMN_MAP;
    return buildColumnMap(headers);
  } catch {
    return LEGACY_COLUMN_MAP;
  }
}

function rowFromSheetCells(
  c: GvizCell[],
  emailNormalized: string,
  columns: SheetColumnMap,
) {
  const ts = cellToIsoTimestamp(cellAt(c, columns, "timestamp"));
  const jobRole = cellToString(cellAt(c, columns, "job_role")) || null;
  const declaration = declarationFromCell(cellAt(c, columns, "declaration"));

  return {
    email: emailNormalized,
    created_at: ts ?? undefined,
    form_filled_date: ts ?? new Date().toISOString(),
    full_name: cellToString(cellAt(c, columns, "full_name")) || null,
    whatsapp_number: cellToString(cellAt(c, columns, "whatsapp")) || null,
    city: cellToString(cellAt(c, columns, "city")) || null,
    domain: cellToString(cellAt(c, columns, "domain")) || null,
    job_role: jobRole,
    role_before_program: jobRole,
    achievement_type: cellToString(cellAt(c, columns, "achievement_type")) || null,
    achievement_title: cellToString(cellAt(c, columns, "achievement_title")) || null,
    achievement_summary:
      cellToString(cellAt(c, columns, "achievement_summary")) || null,
    quantified_result:
      cellToString(cellAt(c, columns, "quantified_result")) || null,
    proof_document_url: cellToString(cellAt(c, columns, "proof")) || null,
    linkedin_url: cellToString(cellAt(c, columns, "linkedin")) || null,
    instagram_url: cellToString(cellAt(c, columns, "instagram")) || null,
    declaration,
    declaration_accepted: declaration,
  };
}

type SupabaseAdmin = ReturnType<typeof createSupabaseAdmin>;

type ExistingCandidate = {
  id: string;
  is_deleted: boolean;
};

/** Preload emails so sync does not issue one SELECT per sheet row. */
async function loadExistingCandidates(supabase: SupabaseAdmin): Promise<{
  byEmail: Map<string, ExistingCandidate>;
  error: string | null;
}> {
  const byEmail = new Map<string, ExistingCandidate>();
  let rangeStart = 0;
  const pageSize = 1000;
  for (;;) {
    const { data: batch, error } = await supabase
      .from("candidates")
      .select("id, email, is_deleted")
      .order("id", { ascending: true })
      .range(rangeStart, rangeStart + pageSize - 1);
    if (error) {
      return { byEmail, error: error.message };
    }
    const chunk = batch ?? [];
    for (const r of chunk) {
      const email = String(r.email ?? "")
        .trim()
        .toLowerCase();
      if (!email) continue;
      byEmail.set(email, {
        id: String(r.id),
        is_deleted: Boolean(r.is_deleted),
      });
    }
    if (chunk.length < pageSize) break;
    rangeStart += pageSize;
  }
  return { byEmail, error: null };
}

function isUniqueViolation(err: { code?: string; message?: string }): boolean {
  if (err.code === "23505") return true;
  const m = (err.message ?? "").toLowerCase();
  return m.includes("duplicate key") || m.includes("unique constraint");
}

async function scoreCandidatesInBackground(
  supabase: SupabaseAdmin,
  candidateIds: string[],
): Promise<void> {
  if (candidateIds.length === 0) return;

  const { data: needScoreRows, error: needScoreErr } = await supabase
    .from("candidates")
    .select("id, email")
    .in("id", candidateIds)
    .is("ai_eligibility_score", null)
    .eq("is_deleted", false);

  if (needScoreErr) {
    console.error("AI scoring prefetch failed:", needScoreErr.message);
    return;
  }

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
      if (!result.ok) {
        console.error("AI scoring failed for:", email, result.error);
      }
    } catch (err) {
      console.error("AI scoring failed for:", email, err);
    }
    if (i < total - 1) {
      await sleep(1000);
    }
  }
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
    const columnMap = await fetchSheetColumnMap();
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
    const { byEmail: existingByEmail, error: existingLoadErr } =
      await loadExistingCandidates(supabase);
    if (existingLoadErr) {
      return NextResponse.json(
        {
          error: `Failed to load existing candidates: ${existingLoadErr}`,
          total_rows: totalRows,
          new_inserted: 0,
          updated_rows: 0,
          upserted: 0,
          scored: 0,
          failed: 0,
          skipped_empty_email: 0,
          errors: [],
        },
        { status: 500 },
      );
    }

    /** Candidate rows successfully written this run (insert or update). */
    const syncedCandidateIds = new Set<string>();

    for (let idx = 0; idx < dataRows.length; idx++) {
      const row = dataRows[idx];
      const sheetRowNum = RANGE_FIRST_ROW + idx;
      const c = row.c ?? [];

      const emailRaw = cellToString(cellAt(c, columnMap, "email")).trim();
      if (!emailRaw) {
        skippedEmptyEmail++;
        continue;
      }

      const emailNormalized = emailRaw.toLowerCase();
      const payload = rowFromSheetCells(c, emailNormalized, columnMap);
      const existing = existingByEmail.get(emailNormalized);

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
        if (isUniqueViolation(insErr)) {
          const clash = existingByEmail.get(emailNormalized);
          if (clash?.is_deleted) {
            errors.push(
              `Row ${sheetRowNum}: skipped (deleted candidate with same email — not restored)`,
            );
            continue;
          }
          if (clash?.id) {
            const { created_at: _omitCreated, ...updateFields } = payload;
            const { error: upErr } = await supabase
              .from("candidates")
              .update(updateFields)
              .eq("id", clash.id)
              .eq("is_deleted", false);
            if (upErr) {
              errors.push(`Row ${sheetRowNum}: ${upErr.message}`);
              continue;
            }
            syncedCandidateIds.add(clash.id);
            updatedRows++;
            continue;
          }
        }
        errors.push(`Row ${sheetRowNum}: ${insErr.message}`);
        continue;
      }

      if (inserted?.id) {
        existingByEmail.set(emailNormalized, {
          id: String(inserted.id),
          is_deleted: false,
        });
        syncedCandidateIds.add(inserted.id);
        newInserted++;
      }
    }

    const idsSynced = [...syncedCandidateIds];
    const pendingScoreCount = idsSynced.length;
    if (pendingScoreCount > 0) {
      after(async () => {
        await scoreCandidatesInBackground(supabase, idsSynced);
      });
    }

    const upserted = newInserted + updatedRows;

    // UI lists testimonial candidates by created_at DESC so the newest sheet rows appear first after sync.
    return NextResponse.json({
      total_rows: totalRows,
      new_inserted: newInserted,
      updated_rows: updatedRows,
      upserted,
      scored: 0,
      failed: 0,
      scoring_queued: pendingScoreCount,
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
        scored: 0,
        failed: 0,
        skipped_empty_email: skippedEmptyEmail,
        errors,
      },
      { status: 500 },
    );
  }
}

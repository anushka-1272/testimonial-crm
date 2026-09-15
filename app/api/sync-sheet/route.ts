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
/** How far back to re-read when the CRM already has newer form dates. */
const INCREMENTAL_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const INSERT_CHUNK = 150;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toGvizDateTime(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

function sheetGvizUrl(tq: string): string {
  const params = new URLSearchParams({
    tqx: "out:json",
    sheet: TAB_NAME,
    tq,
  });
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?${params.toString()}`;
}

function buildSheetDataUrl(since: Date | null): string {
  if (since) {
    return sheetGvizUrl(
      `select * where A >= datetime '${toGvizDateTime(since)}'`,
    );
  }
  const range = encodeURIComponent(`${TAB_NAME}!A${RANGE_FIRST_ROW}:Z`);
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&range=${range}`;
}

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

type SheetColumnMap = Record<SheetColumnKey, number[]>;

const HEADER_RANGE = `${TAB_NAME}!A1:AZ1`;
const HEADER_GVIZ_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&range=${encodeURIComponent(HEADER_RANGE)}`;

/** Legacy fixed indices before optional "Current City of Residence" column. */
const LEGACY_COLUMN_INDICES: Record<SheetColumnKey, number> = {
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
  email: ["email address"],
  full_name: ["full name"],
  whatsapp: ["registered whatsapp number", "whatsapp"],
  city: [
    "current city of residence:\nplease mention the city where you currently live",
    "current city of residence",
  ],
  domain: ["select your domain"],
  job_role: ["current job role"],
  achievement_type: ["select your achievement type"],
  achievement_title: [
    "enter achievement title (one-line summary)",
    "enter achievement title",
  ],
  achievement_summary: [
    "tell us the story behind this achievement",
    "enter achievement summary",
  ],
  quantified_result: [
    "mention quantified result (numbers only)",
    "mention quantified result",
  ],
  proof: ["upload proof document"],
  linkedin: ["add your linkedin profile url", "linkedin profile"],
  instagram: ["add your instagram profile url", "instagram profile"],
  declaration: ["declaration checkbox"],
};

function normalizeHeaderLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/:$/, "");
}

function headerMatches(header: string, matcher: string): boolean {
  const h = normalizeHeaderLabel(header);
  const m = normalizeHeaderLabel(matcher);
  if (!h || !m) return false;
  return h === m || h.startsWith(m) || h.includes(m);
}

function findAllColumnIndices(headers: string[], matchers: string[]): number[] {
  const found = new Set<number>();
  headers.forEach((header, idx) => {
    if (matchers.some((matcher) => headerMatches(header, matcher))) {
      found.add(idx);
    }
  });
  return [...found].sort((a, b) => a - b);
}

function legacyColumnMap(): SheetColumnMap {
  const map = {} as SheetColumnMap;
  for (const key of Object.keys(LEGACY_COLUMN_INDICES) as SheetColumnKey[]) {
    const idx = LEGACY_COLUMN_INDICES[key];
    map[key] = idx >= 0 ? [idx] : [];
  }
  return map;
}

function buildColumnMap(headers: string[]): SheetColumnMap {
  const map = legacyColumnMap();
  for (const key of Object.keys(COLUMN_HEADER_MATCHERS) as SheetColumnKey[]) {
    const idxs = findAllColumnIndices(headers, COLUMN_HEADER_MATCHERS[key]);
    if (idxs.length > 0) map[key] = idxs;
  }
  return map;
}

/** Prefer the newest matching column that actually has a value (Forms appends new questions on the right). */
function cellAt(c: GvizCell[], map: SheetColumnMap, key: SheetColumnKey): GvizCell {
  const idxs = map[key] ?? [];
  let fallback: GvizCell = null;
  for (let i = idxs.length - 1; i >= 0; i--) {
    const idx = idxs[i];
    if (idx < 0) continue;
    const cell = c[idx] ?? null;
    if (cellToString(cell)) return cell;
    if (cell != null && fallback == null) fallback = cell;
  }
  return fallback;
}

async function fetchGviz(url: string): Promise<Response> {
  return fetch(url, { cache: "no-store", next: { revalidate: 0 } });
}

async function fetchSheetColumnMap(): Promise<SheetColumnMap> {
  try {
    const res = await fetchGviz(HEADER_GVIZ_URL);
    if (!res.ok) return legacyColumnMap();
    const parsed = extractGvizJson(await res.text());
    const headerCells = parsed.table?.rows?.[0]?.c ?? [];
    const headers = headerCells.map((cell) => cellToString(cell));
    if (headers.length === 0) return legacyColumnMap();
    return buildColumnMap(headers);
  } catch {
    return legacyColumnMap();
  }
}

async function getLatestFormFilledAt(
  supabase: SupabaseAdmin,
): Promise<Date | null> {
  const { data, error } = await supabase
    .from("candidates")
    .select("form_filled_date")
    .eq("is_deleted", false)
    .not("form_filled_date", "is", null)
    .order("form_filled_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.form_filled_date) return null;
  const d = parseISO(String(data.form_filled_date));
  return isValid(d) ? d : null;
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

/** Look up only the emails present in this sync batch. */
async function loadExistingByEmails(
  supabase: SupabaseAdmin,
  emails: string[],
): Promise<{
  byEmail: Map<string, ExistingCandidate>;
  error: string | null;
}> {
  const byEmail = new Map<string, ExistingCandidate>();
  const unique = [...new Set(emails.filter(Boolean))];
  const pageSize = 150;
  for (let i = 0; i < unique.length; i += pageSize) {
    const chunk = unique.slice(i, i + pageSize);
    const { data: batch, error } = await supabase
      .from("candidates")
      .select("id, email, is_deleted")
      .in("email", chunk);
    if (error) {
      return { byEmail, error: error.message };
    }
    for (const r of batch ?? []) {
      const email = String(r.email ?? "")
        .trim()
        .toLowerCase();
      if (!email) continue;
      byEmail.set(email, {
        id: String(r.id),
        is_deleted: Boolean(r.is_deleted),
      });
    }
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
  let alreadyInCrm = 0;
  let skippedEmptyEmail = 0;

  try {
    const user = await verifyRequestUser(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.log("Syncing TESTIMONIAL sheet:", SHEET_ID, "Tab:", TAB_NAME);

    const supabase = createSupabaseAdmin();
    const latestTsPromise = getLatestFormFilledAt(supabase);
    const columnMapPromise = fetchSheetColumnMap();
    const latestTs = await latestTsPromise;
    const since =
      latestTs != null
        ? new Date(latestTs.getTime() - INCREMENTAL_LOOKBACK_MS)
        : null;
    const sheetUrl = buildSheetDataUrl(since);

    const [res, columnMap] = await Promise.all([
      fetchGviz(sheetUrl),
      columnMapPromise,
    ]);
    console.log("[sync-sheet] column map", columnMap);
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

    const dataRows = parsed.table?.rows ?? [];
    totalRows = dataRows.length;
    if (dataRows.length === 0) {
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

    const sheetEmails: string[] = [];
    for (const row of dataRows) {
      const emailRaw = cellToString(
        cellAt(row.c ?? [], columnMap, "email"),
      ).trim();
      if (!emailRaw) continue;
      sheetEmails.push(emailRaw, emailRaw.toLowerCase());
    }

    const { byEmail: existingByEmail, error: existingLoadErr } =
      await loadExistingByEmails(supabase, sheetEmails);
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

    /** New candidate ids written this run (existing rows are left unchanged). */
    const syncedCandidateIds = new Set<string>();
    const pendingInserts: {
      sheetRowNum: number;
      emailNormalized: string;
      insertRow: Record<string, unknown>;
    }[] = [];

    for (let idx = 0; idx < dataRows.length; idx++) {
      const row = dataRows[idx];
      const sheetRowNum = since ? idx + 1 : RANGE_FIRST_ROW + idx;
      const c = row.c ?? [];

      const emailRaw = cellToString(cellAt(c, columnMap, "email")).trim();
      if (!emailRaw) {
        skippedEmptyEmail++;
        continue;
      }

      const emailNormalized = emailRaw.toLowerCase();
      const existing = existingByEmail.get(emailNormalized);

      if (existing?.is_deleted) {
        errors.push(
          `Row ${sheetRowNum}: skipped (candidate deleted — not restored from sheet)`,
        );
        continue;
      }

      // Already in CRM — skip the per-row UPDATE. Rewriting 1000+ existing
      // candidates on every click is what made Sync Sheet time out.
      if (existing?.id) {
        alreadyInCrm++;
        continue;
      }

      const payload = rowFromSheetCells(c, emailNormalized, columnMap);
      const { created_at, ...restPayload } = payload;
      pendingInserts.push({
        sheetRowNum,
        emailNormalized,
        insertRow: {
          ...restPayload,
          ...(created_at ? { created_at } : {}),
          eligibility_status: "pending_review" as const,
          congratulation_call_pending: false,
        },
      });
    }

    const uniqueInserts = new Map<string, (typeof pendingInserts)[number]>();
    for (const item of pendingInserts) {
      uniqueInserts.set(item.emailNormalized, item);
    }
    const insertList = [...uniqueInserts.values()];

    const insertChunk = async (
      chunk: (typeof insertList)[number][],
    ): Promise<void> => {
      const { data: inserted, error: insErr } = await supabase
        .from("candidates")
        .insert(chunk.map((item) => item.insertRow))
        .select("id, email");

      if (!insErr) {
        for (const row of inserted ?? []) {
          const email = String(row.email ?? "")
            .trim()
            .toLowerCase();
          if (email) {
            existingByEmail.set(email, {
              id: String(row.id),
              is_deleted: false,
            });
          }
          syncedCandidateIds.add(String(row.id));
          newInserted++;
        }
        return;
      }

      for (const item of chunk) {
        const { data: one, error: oneErr } = await supabase
          .from("candidates")
          .insert(item.insertRow)
          .select("id")
          .single();

        if (oneErr) {
          if (isUniqueViolation(oneErr)) {
            continue;
          }
          errors.push(`Row ${item.sheetRowNum}: ${oneErr.message}`);
          continue;
        }
        if (one?.id) {
          existingByEmail.set(item.emailNormalized, {
            id: String(one.id),
            is_deleted: false,
          });
          syncedCandidateIds.add(String(one.id));
          newInserted++;
        }
      }
    };

    const chunks: (typeof insertList)[number][][] = [];
    for (let i = 0; i < insertList.length; i += INSERT_CHUNK) {
      chunks.push(insertList.slice(i, i + INSERT_CHUNK));
    }
    const PARALLEL_INSERTS = 3;
    for (let i = 0; i < chunks.length; i += PARALLEL_INSERTS) {
      await Promise.all(
        chunks.slice(i, i + PARALLEL_INSERTS).map((chunk) => insertChunk(chunk)),
      );
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
      already_in_crm: alreadyInCrm,
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

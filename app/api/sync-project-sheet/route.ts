import { NextResponse } from "next/server";

import {
  cellToString,
  extractGvizJson,
  type GvizCell,
  type GvizCol,
  type GvizResponse,
  type GvizRow,
  verifyRequestUser,
} from "@/lib/google-sheet-gviz";
import { phoneFromGvizCell } from "@/lib/phone-normalize";
import { createSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

/** Default project intake sheet (overridable via GOOGLE_PROJECT_SHEET_ID / GOOGLE_PROJECT_SHEET_TAB). */
const DEFAULT_PROJECT_SHEET_ID =
  "11z0ekuzC64uNWeExxk_I3YTv44lfAUvF3H4IvK5DjIY";
const DEFAULT_PROJECT_SHEET_TAB = "Sheet1";

/**
 * Default column indices (A = 0) when header labels are missing.
 * Sheet row 1 is the header row returned by gviz as `rows[0]`; data rows start at row 2.
 */
const DEFAULT_COL = {
  email: 0,
  full_name: 1,
  whatsapp_number: 2,
  project_title: 3,
  problem_statement: 4,
  target_user: 5,
  demo_link: 6,
} as const;

type ProjectSheetField = keyof typeof DEFAULT_COL;

const HEADER_PATTERNS: Record<ProjectSheetField, RegExp[]> = {
  email: [/^email/i],
  full_name: [/^name$/i, /full name/i],
  whatsapp_number: [
    /^number$/i,
    /phone/i,
    /whatsapp/i,
    /mobile/i,
    /contact.*number/i,
  ],
  project_title: [/project title/i],
  problem_statement: [/problem/i, /what real-world problem/i],
  target_user: [/who is this problem for/i, /target user/i, /profession.*domain/i],
  demo_link: [/demo/i, /google drive link/i, /drive link/i],
};

function buildProjectColumnMap(
  cols: GvizCol[] | undefined,
): Record<ProjectSheetField, number> {
  const map: Record<ProjectSheetField, number> = { ...DEFAULT_COL };
  if (!cols?.length) return map;

  const used = new Set<number>();
  for (const field of Object.keys(HEADER_PATTERNS) as ProjectSheetField[]) {
    for (let i = 0; i < cols.length; i++) {
      if (used.has(i)) continue;
      const label = (cols[i]?.label ?? "").trim();
      if (!label) continue;
      if (HEADER_PATTERNS[field].some((pattern) => pattern.test(label))) {
        map[field] = i;
        used.add(i);
        break;
      }
    }
  }
  return map;
}

function pickCell(cells: GvizCell[] | undefined, index: number): string {
  if (!cells || index < 0) return "";
  return cellToString(cells[index] ?? null).trim();
}

function resolvePhoneFromRow(
  cells: GvizCell[],
  colMap: Record<ProjectSheetField, number>,
): string | null {
  const primary = phoneFromGvizCell(cells[colMap.whatsapp_number] ?? null);
  if (primary) return primary;

  const skip = new Set([
    colMap.email,
    colMap.project_title,
    colMap.problem_statement,
    colMap.target_user,
    colMap.demo_link,
  ]);
  for (let i = 0; i < cells.length; i++) {
    if (skip.has(i) || i === colMap.whatsapp_number) continue;
    const phone = phoneFromGvizCell(cells[i] ?? null);
    if (phone) return phone;
  }
  return null;
}

function buildSheetUrl(): string {
  const id =
    process.env.GOOGLE_PROJECT_SHEET_ID?.trim() || DEFAULT_PROJECT_SHEET_ID;
  const tab =
    process.env.GOOGLE_PROJECT_SHEET_TAB?.trim() || DEFAULT_PROJECT_SHEET_TAB;
  return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(tab)}`;
}

/** Normalize sheet email: trim, lowercase, reject empty / placeholder. */
function normalizeEmail(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  return s;
}

function isHeaderLikeEmail(raw: string): boolean {
  const s = raw.trim().toLowerCase();
  return s === "email address" || s === "email" || /^email[\s_-]/.test(s);
}

function escapeILikeExact(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function isUniqueViolation(err: { code?: string; message?: string }): boolean {
  if (err.code === "23505") return true;
  const m = (err.message ?? "").toLowerCase();
  return m.includes("duplicate key") || m.includes("unique constraint");
}

type SupabaseAdmin = ReturnType<typeof createSupabaseAdmin>;

type ExistingProjectCandidate = {
  id: string;
  whatsapp_number: string | null;
};

/** Normalized email → existing row (paginated). */
async function loadExistingCandidates(supabase: SupabaseAdmin): Promise<{
  byEmail: Map<string, ExistingProjectCandidate>;
  error: string | null;
}> {
  const byEmail = new Map<string, ExistingProjectCandidate>();
  let rangeStart = 0;
  const pageSize = 1000;
  for (;;) {
    const { data: batch, error } = await supabase
      .from("project_candidates")
      .select("id, email, whatsapp_number")
      .eq("is_deleted", false)
      .order("id", { ascending: true })
      .range(rangeStart, rangeStart + pageSize - 1);
    if (error) {
      return { byEmail, error: error.message };
    }
    const chunk = batch ?? [];
    for (const r of chunk) {
      const e = normalizeEmail(String(r.email ?? ""));
      if (!e) continue;
      byEmail.set(e, {
        id: String(r.id),
        whatsapp_number:
          (r.whatsapp_number as string | null | undefined)?.trim() || null,
      });
    }
    if (chunk.length < pageSize) break;
    rangeStart += pageSize;
  }
  return { byEmail, error: null };
}

export async function POST(request: Request) {
  const errors: string[] = [];
  let totalRows = 0;
  let upserted = 0;
  let phonesUpdated = 0;

  try {
    const user = await verifyRequestUser(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sheetUrl = buildSheetUrl();
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
    if (rows.length < 1) {
      return NextResponse.json({
        total_rows: 0,
        upserted: 0,
        phones_updated: 0,
        errors: [],
        message: "Sheet has no data rows",
      });
    }

    const colMap = buildProjectColumnMap(parsed.table?.cols);
    const dataRows = rows.filter((row) => {
      const emailRaw = pickCell(row.c ?? [], colMap.email);
      if (!emailRaw) return false;
      return !isHeaderLikeEmail(emailRaw);
    });
    totalRows = dataRows.length;
    if (totalRows < 1) {
      return NextResponse.json({
        total_rows: 0,
        upserted: 0,
        phones_updated: 0,
        errors: [],
        message: "Sheet has no valid data rows (check email column)",
      });
    }

    const supabase = createSupabaseAdmin();

    console.log(
      `[sync-project-sheet] Column map:`,
      JSON.stringify(colMap),
    );

    const { byEmail: existingByEmail, error: existingLoadErr } =
      await loadExistingCandidates(supabase);
    if (existingLoadErr) {
      return NextResponse.json(
        {
          error: `Failed to load existing emails: ${existingLoadErr}`,
          total_rows: totalRows,
          upserted: 0,
          errors: [],
        },
        { status: 500 },
      );
    }

    console.log(
      `[sync-project-sheet] Dedup: ${existingByEmail.size} distinct emails already in project_candidates`,
    );

    for (let idxRow = 0; idxRow < dataRows.length; idxRow++) {
      const row = dataRows[idxRow] as GvizRow;
      const sheetRowNum = idxRow + 2;
      const c = row.c ?? [];

      const emailFromSheet = pickCell(c, colMap.email);
      const email = normalizeEmail(emailFromSheet);
      if (!email) {
        console.log("Skipping row (empty or invalid email):", {
          sheetRow: sheetRowNum,
          raw: emailFromSheet,
        });
        continue;
      }

      const fullName = pickCell(c, colMap.full_name) || null;
      const sheetPhone = resolvePhoneFromRow(c, colMap);
      const rowPayload = {
        email,
        full_name: fullName,
        whatsapp_number: sheetPhone,
        project_title: pickCell(c, colMap.project_title) || null,
        problem_statement: pickCell(c, colMap.problem_statement) || null,
        target_user: pickCell(c, colMap.target_user) || null,
        demo_link: pickCell(c, colMap.demo_link) || null,
        synced_at: new Date().toISOString(),
      };

      const updateFields: Record<string, unknown> = {
        full_name: rowPayload.full_name,
        project_title: rowPayload.project_title,
        problem_statement: rowPayload.problem_statement,
        target_user: rowPayload.target_user,
        demo_link: rowPayload.demo_link,
        synced_at: rowPayload.synced_at,
      };
      if (sheetPhone) {
        updateFields.whatsapp_number = sheetPhone;
      }

      const existing = existingByEmail.get(email);
      if (existing) {
        console.log("Updating existing row:", {
          email,
          full_name: fullName,
          phone: sheetPhone ?? "(unchanged)",
        });
        const { error: updateErr } = await supabase
          .from("project_candidates")
          .update(updateFields)
          .eq("id", existing.id)
          .eq("is_deleted", false);

        if (updateErr) {
          console.log("Update error:", updateErr);
          errors.push(`Row ${sheetRowNum} (update): ${updateErr.message}`);
          continue;
        }
        if (
          sheetPhone &&
          sheetPhone !== (existing.whatsapp_number ?? null)
        ) {
          phonesUpdated++;
          existing.whatsapp_number = sheetPhone;
        }
        upserted++;
        continue;
      }

      console.log("Inserting new row:", {
        email,
        full_name: fullName,
        phone: sheetPhone ?? "(none)",
      });
      const { data: inserted, error: insertErr } = await supabase
        .from("project_candidates")
        .insert(rowPayload)
        .select("id")
        .maybeSingle();

      if (!insertErr && inserted?.id) {
        existingByEmail.set(email, {
          id: String(inserted.id),
          whatsapp_number: sheetPhone,
        });
        if (sheetPhone) phonesUpdated++;
        upserted++;
        continue;
      }

      if (insertErr) console.log("Insert error:", insertErr);
      else if (!inserted?.id) {
        errors.push(`Row ${sheetRowNum}: insert succeeded but no id returned`);
        continue;
      }

      if (insertErr && isUniqueViolation(insertErr)) {
        const { data: clash } = await supabase
          .from("project_candidates")
          .select("id, is_deleted, whatsapp_number")
          .ilike("email", escapeILikeExact(email))
          .maybeSingle();
        if (clash?.is_deleted) {
          errors.push(
            `Row ${sheetRowNum}: skipped (deleted project candidate — not restored)`,
          );
          continue;
        }
        if (!clash?.id) {
          errors.push(
            `Row ${sheetRowNum}: duplicate email but no active row found`,
          );
          continue;
        }
        const { error: updateErr } = await supabase
          .from("project_candidates")
          .update(updateFields)
          .eq("id", clash.id)
          .eq("is_deleted", false);
        if (updateErr) {
          console.log("Update after duplicate insert error:", updateErr);
          errors.push(
            `Row ${sheetRowNum} (update after race): ${updateErr.message}`,
          );
          continue;
        }
        const prevPhone =
          (clash.whatsapp_number as string | null | undefined)?.trim() || null;
        existingByEmail.set(email, {
          id: String(clash.id),
          whatsapp_number: sheetPhone ?? prevPhone,
        });
        if (sheetPhone && sheetPhone !== prevPhone) phonesUpdated++;
        upserted++;
        continue;
      }

      if (insertErr && !isUniqueViolation(insertErr)) {
        errors.push(`Row ${sheetRowNum} (insert): ${insertErr.message}`);
        continue;
      }
    }

    // UI lists project_candidates by created_at DESC so the newest rows appear first after sync.
    return NextResponse.json({
      total_rows: totalRows,
      upserted,
      phones_updated: phonesUpdated,
      errors,
      sheet_id: process.env.GOOGLE_PROJECT_SHEET_ID?.trim() || DEFAULT_PROJECT_SHEET_ID,
      tab:
        process.env.GOOGLE_PROJECT_SHEET_TAB?.trim() || DEFAULT_PROJECT_SHEET_TAB,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sync failed";
    errors.push(msg);
    return NextResponse.json(
      {
        error: msg,
        total_rows: totalRows,
        upserted,
        phones_updated: phonesUpdated,
        errors,
      },
      { status: 500 },
    );
  }
}

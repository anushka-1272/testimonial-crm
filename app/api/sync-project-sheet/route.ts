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

/** Default project intake sheet (overridable via GOOGLE_PROJECT_SHEET_ID / GOOGLE_PROJECT_SHEET_TAB). */
const DEFAULT_PROJECT_SHEET_ID =
  "11z0ekuzC64uNWeExxk_I3YTv44lfAUvF3H4IvK5DjIY";
const DEFAULT_PROJECT_SHEET_TAB = "Sheet1";

/**
 * Fixed column indices (A = 0). Sheet row 1 is the header row returned by gviz
 * as `rows[0]`; data rows start at sheet row 2 → `rows[1]` onward.
 */
const COL = {
  email: 0,
  full_name: 1,
  whatsapp_number: 2,
  project_title: 3,
  problem_statement: 4,
  target_user: 5,
  demo_link: 6,
} as const;

function buildSheetUrl(): string {
  const id =
    process.env.GOOGLE_PROJECT_SHEET_ID?.trim() || DEFAULT_PROJECT_SHEET_ID;
  const tab =
    process.env.GOOGLE_PROJECT_SHEET_TAB?.trim() || DEFAULT_PROJECT_SHEET_TAB;
  return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(tab)}`;
}

function pickCell(cells: GvizCell[] | undefined, index: number): string {
  if (!cells || index < 0 || index >= cells.length) return "";
  return cellToString(cells[index] ?? null).trim();
}

/** Normalize sheet email: trim, lowercase, reject empty / placeholder. */
function normalizeEmail(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  return s;
}

function isUniqueViolation(err: { code?: string; message?: string }): boolean {
  if (err.code === "23505") return true;
  const m = (err.message ?? "").toLowerCase();
  return m.includes("duplicate key") || m.includes("unique constraint");
}

type SupabaseAdmin = ReturnType<typeof createSupabaseAdmin>;

/** All normalized emails already in project_candidates (paginated). */
async function loadExistingEmails(supabase: SupabaseAdmin): Promise<{
  emails: Set<string>;
  error: string | null;
}> {
  const emails = new Set<string>();
  let rangeStart = 0;
  const pageSize = 1000;
  for (;;) {
    const { data: batch, error } = await supabase
      .from("project_candidates")
      .select("email")
      .order("id", { ascending: true })
      .range(rangeStart, rangeStart + pageSize - 1);
    if (error) {
      return { emails, error: error.message };
    }
    const chunk = batch ?? [];
    for (const r of chunk) {
      const e = normalizeEmail(String(r.email ?? ""));
      if (e) emails.add(e);
    }
    if (chunk.length < pageSize) break;
    rangeStart += pageSize;
  }
  return { emails, error: null };
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
        message:
          rows.length === 0
            ? "Sheet has no rows"
            : "Sheet has only a header row; add data from row 2 onward",
      });
    }

    const dataRows = rows.slice(1);
    totalRows = dataRows.length;
    const supabase = createSupabaseAdmin();

    const { emails: existingEmails, error: existingLoadErr } =
      await loadExistingEmails(supabase);
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
      `[sync-project-sheet] Dedup: ${existingEmails.size} distinct emails already in project_candidates`,
    );

    for (let idxRow = 0; idxRow < dataRows.length; idxRow++) {
      const row = dataRows[idxRow] as GvizRow;
      const sheetRowNum = idxRow + 2;
      const c = row.c ?? [];

      const emailFromSheet = pickCell(c, COL.email);
      const email = normalizeEmail(emailFromSheet);
      if (!email) {
        console.log("Skipping row (empty or invalid email):", {
          sheetRow: sheetRowNum,
          raw: emailFromSheet,
        });
        continue;
      }

      const fullName = pickCell(c, COL.full_name) || null;
      const rowPayload = {
        email,
        full_name: fullName,
        whatsapp_number: pickCell(c, COL.whatsapp_number) || null,
        project_title: pickCell(c, COL.project_title) || null,
        problem_statement: pickCell(c, COL.problem_statement) || null,
        target_user: pickCell(c, COL.target_user) || null,
        demo_link: pickCell(c, COL.demo_link) || null,
        synced_at: new Date().toISOString(),
      };

      const updateFields = {
        full_name: rowPayload.full_name,
        whatsapp_number: rowPayload.whatsapp_number,
        project_title: rowPayload.project_title,
        problem_statement: rowPayload.problem_statement,
        target_user: rowPayload.target_user,
        demo_link: rowPayload.demo_link,
        synced_at: rowPayload.synced_at,
      };

      if (existingEmails.has(email)) {
        console.log("Updating existing row:", { email, full_name: fullName });
        const { error: updateErr } = await supabase
          .from("project_candidates")
          .update(updateFields)
          .eq("email", email);

        if (updateErr) {
          console.log("Update error:", updateErr);
          errors.push(`Row ${sheetRowNum} (update): ${updateErr.message}`);
          continue;
        }
        upserted++;
        continue;
      }

      console.log("Inserting new row:", { email, full_name: fullName });
      const { error: insertErr } = await supabase
        .from("project_candidates")
        .insert(rowPayload);

      if (!insertErr) {
        existingEmails.add(email);
        upserted++;
        continue;
      }

      console.log("Insert error:", insertErr);

      if (isUniqueViolation(insertErr)) {
        const { error: updateErr } = await supabase
          .from("project_candidates")
          .update(updateFields)
          .eq("email", email);
        if (updateErr) {
          console.log("Update after duplicate insert error:", updateErr);
          errors.push(
            `Row ${sheetRowNum} (update after race): ${updateErr.message}`,
          );
          continue;
        }
        existingEmails.add(email);
        upserted++;
        continue;
      }

      errors.push(`Row ${sheetRowNum} (insert): ${insertErr.message}`);
    }

    // UI lists project_candidates by created_at DESC so the newest rows appear first after sync.
    return NextResponse.json({
      total_rows: totalRows,
      upserted,
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
        errors,
      },
      { status: 500 },
    );
  }
}

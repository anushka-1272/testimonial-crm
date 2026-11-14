import { NextResponse } from "next/server";

import {
  buildProjectSheetCsvExportUrl,
  DEFAULT_PROJECT_SHEET_ID,
  DEFAULT_PROJECT_SHEET_TAB,
  parseProjectSheetCsv,
  type ParsedProjectSheetRow,
} from "@/lib/project-sheet-sync";
import { verifyRequestUser } from "@/lib/google-sheet-gviz";
import { createSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
/** The project sheet is thousands of rows. Without this, the platform cuts the request off. */
export const maxDuration = 300;

const UPDATE_CONCURRENCY = 20;
const INSERT_CHUNK = 80;

type SupabaseAdmin = ReturnType<typeof createSupabaseAdmin>;

type ExistingLite = {
  id: string;
  email: string;
  whatsapp_number: string | null;
  is_deleted: boolean;
  full_name: string | null;
  project_title: string | null;
  problem_statement: string | null;
  target_user: string | null;
  demo_link: string | null;
};

type RowUpdate = {
  id: string;
  sheet: ParsedProjectSheetRow;
  phoneChanged: boolean;
};

function blankToNull(value: string | null | undefined): string | null {
  const s = (value ?? "").trim();
  return s.length ? s : null;
}

/** Line-ending differences should not force a rewrite of an unchanged row. */
function normText(value: string | null | undefined): string | null {
  const s = (value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  return s.length ? s : null;
}

function needsSheetWrite(
  existing: ExistingLite,
  sheet: ParsedProjectSheetRow,
): boolean {
  if (normText(existing.full_name) !== normText(sheet.full_name)) return true;
  if (normText(existing.project_title) !== normText(sheet.project_title)) {
    return true;
  }
  if (
    normText(existing.problem_statement) !== normText(sheet.problem_statement)
  ) {
    return true;
  }
  if (normText(existing.target_user) !== normText(sheet.target_user)) {
    return true;
  }
  if (normText(existing.demo_link) !== normText(sheet.demo_link)) return true;
  if (
    sheet.whatsapp_number &&
    sheet.whatsapp_number !== existing.whatsapp_number
  ) {
    return true;
  }
  return false;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let next = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const item = items[next];
        next += 1;
        await worker(item);
      }
    },
  );
  await Promise.all(runners);
}

function updateFieldsFor(sheet: ParsedProjectSheetRow, syncedAt: string) {
  const fields: Record<string, unknown> = {
    full_name: sheet.full_name,
    project_title: sheet.project_title,
    problem_statement: sheet.problem_statement,
    target_user: sheet.target_user,
    demo_link: sheet.demo_link,
    synced_at: syncedAt,
  };
  if (sheet.whatsapp_number) fields.whatsapp_number = sheet.whatsapp_number;
  return fields;
}

const EXISTING_PAGE = 1000;
const EXISTING_PARALLEL_PAGES = 4;

async function loadExistingEmails(supabase: SupabaseAdmin): Promise<{
  byEmail: Map<string, ExistingLite[]>;
  error: string | null;
}> {
  const byEmail = new Map<string, ExistingLite[]>();
  const select =
    "id, email, whatsapp_number, is_deleted, full_name, project_title, problem_statement, target_user, demo_link";
  let rangeStart = 0;
  for (;;) {
    const pages = await Promise.all(
      Array.from({ length: EXISTING_PARALLEL_PAGES }, (_, i) => {
        const start = rangeStart + i * EXISTING_PAGE;
        return supabase
          .from("project_candidates")
          .select(select)
          .order("id", { ascending: true })
          .range(start, start + EXISTING_PAGE - 1);
      }),
    );
    let reachedEnd = false;
    for (const page of pages) {
      if (page.error) return { byEmail, error: page.error.message };
      const rows = page.data ?? [];
      for (const r of rows) {
        const stored = String(r.email ?? "").trim();
        const key = stored.toLowerCase();
        if (!key) continue;
        const row: ExistingLite = {
          id: String(r.id),
          email: stored,
          whatsapp_number: blankToNull(r.whatsapp_number as string | null),
          is_deleted: Boolean(r.is_deleted),
          full_name: (r.full_name as string | null) ?? null,
          project_title: (r.project_title as string | null) ?? null,
          problem_statement: (r.problem_statement as string | null) ?? null,
          target_user: (r.target_user as string | null) ?? null,
          demo_link: (r.demo_link as string | null) ?? null,
        };
        const list = byEmail.get(key);
        if (list) list.push(row);
        else byEmail.set(key, [row]);
      }
      if (rows.length < EXISTING_PAGE) reachedEnd = true;
    }
    if (reachedEnd) break;
    rangeStart += EXISTING_PAGE * EXISTING_PARALLEL_PAGES;
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

    const sheetUrl = buildProjectSheetCsvExportUrl();
    const res = await fetch(sheetUrl, {
      next: { revalidate: 0 },
      redirect: "follow",
    });
    if (!res.ok) {
      return NextResponse.json(
        {
          error: `Failed to fetch project sheet CSV (${res.status})`,
          total_rows: 0,
          upserted: 0,
          phones_updated: 0,
          errors: [],
        },
        { status: 502 },
      );
    }

    const csvText = await res.text();
    const { colMap, rows: sheetRows } = parseProjectSheetCsv(csvText);
    totalRows = sheetRows.length;

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
      `[sync-project-sheet] CSV column map:`,
      JSON.stringify(colMap),
      `rows=${totalRows}`,
    );

    const { byEmail: existingByEmail, error: existingLoadErr } =
      await loadExistingEmails(supabase);
    if (existingLoadErr) {
      return NextResponse.json(
        {
          error: `Failed to load existing emails: ${existingLoadErr}`,
          total_rows: totalRows,
          upserted: 0,
          phones_updated: 0,
          errors: [],
        },
        { status: 500 },
      );
    }

    console.log(
      `[sync-project-sheet] Dedup: ${existingByEmail.size} distinct emails already in project_candidates`,
    );

    const latestByEmail = new Map<string, ParsedProjectSheetRow>();
    for (const sheetRow of sheetRows) {
      latestByEmail.set(sheetRow.email, sheetRow);
    }

    const syncedAt = new Date().toISOString();
    const updates: RowUpdate[] = [];
    const inserts: ParsedProjectSheetRow[] = [];
    let updatedCount = 0;
    let insertedCount = 0;
    let skippedDeleted = 0;
    let unchanged = 0;

    for (const sheetRow of latestByEmail.values()) {
      const matches = existingByEmail.get(sheetRow.email) ?? [];
      const active = matches.filter((row) => !row.is_deleted);
      if (matches.length > 0 && active.length === 0) {
        skippedDeleted++;
        continue;
      }
      if (active.length === 0) {
        inserts.push(sheetRow);
        continue;
      }
      const dirty = active.filter((row) => needsSheetWrite(row, sheetRow));
      if (dirty.length === 0) {
        unchanged++;
        continue;
      }
      for (const row of dirty) {
        updates.push({
          id: row.id,
          sheet: sheetRow,
          phoneChanged: Boolean(
            sheetRow.whatsapp_number &&
              sheetRow.whatsapp_number !== row.whatsapp_number,
          ),
        });
      }
    }

    await runPool(updates, UPDATE_CONCURRENCY, async (job) => {
      const { error } = await supabase
        .from("project_candidates")
        .update(updateFieldsFor(job.sheet, syncedAt))
        .eq("id", job.id)
        .eq("is_deleted", false);
      if (error) {
        errors.push(
          `Row ${job.sheet.sheetRowNum} (${job.sheet.email}): ${error.message}`,
        );
        return;
      }
      updatedCount++;
      upserted++;
      if (job.phoneChanged) phonesUpdated++;
    });

    const insertChunk = async (group: ParsedProjectSheetRow[]) => {
      if (group.length === 0) return;
      const { error } = await supabase.from("project_candidates").insert(
        group.map((sheet) => ({
          email: sheet.email,
          full_name: sheet.full_name,
          whatsapp_number: sheet.whatsapp_number,
          project_title: sheet.project_title,
          problem_statement: sheet.problem_statement,
          target_user: sheet.target_user,
          demo_link: sheet.demo_link,
          synced_at: syncedAt,
        })),
      );
      if (!error) {
        for (const sheet of group) {
          insertedCount++;
          upserted++;
          if (sheet.whatsapp_number) phonesUpdated++;
        }
        return;
      }
      if (group.length === 1) {
        const sheet = group[0];
        errors.push(`Row ${sheet.sheetRowNum} (${sheet.email}): ${error.message}`);
        return;
      }
      const mid = Math.ceil(group.length / 2);
      await insertChunk(group.slice(0, mid));
      await insertChunk(group.slice(mid));
    };

    await runPool(chunk(inserts, INSERT_CHUNK), 3, insertChunk);

    if (skippedDeleted > 0) {
      errors.push(
        `Skipped ${skippedDeleted} deleted project candidate${skippedDeleted === 1 ? "" : "s"} (not restored)`,
      );
    }

    console.log(
      `[sync-project-sheet] wrote ${upserted} (${updatedCount} updated, ${insertedCount} inserted, ${unchanged} unchanged, ${skippedDeleted} deleted skipped)`,
    );

    return NextResponse.json({
      total_rows: totalRows,
      upserted,
      updated: updatedCount,
      inserted: insertedCount,
      unchanged,
      skipped_deleted: skippedDeleted,
      phones_updated: phonesUpdated,
      errors,
      source: "csv_export",
      sheet_id:
        process.env.GOOGLE_PROJECT_SHEET_ID?.trim() || DEFAULT_PROJECT_SHEET_ID,
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

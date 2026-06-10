import { NextResponse } from "next/server";

import {
  buildProjectSheetCsvExportUrl,
  DEFAULT_PROJECT_SHEET_ID,
  DEFAULT_PROJECT_SHEET_TAB,
  parseProjectSheetCsv,
} from "@/lib/project-sheet-sync";
import { verifyRequestUser } from "@/lib/google-sheet-gviz";
import { createSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

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
      const e = String(r.email ?? "")
        .trim()
        .toLowerCase();
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
      await loadExistingCandidates(supabase);
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

    for (const sheetRow of sheetRows) {
      const {
        sheetRowNum,
        email,
        full_name: fullName,
        whatsapp_number: sheetPhone,
        project_title,
        problem_statement,
        target_user,
        demo_link,
      } = sheetRow;

      const syncedAt = new Date().toISOString();
      const rowPayload = {
        email,
        full_name: fullName,
        whatsapp_number: sheetPhone,
        project_title,
        problem_statement,
        target_user,
        demo_link,
        synced_at: syncedAt,
      };

      const updateFields: Record<string, unknown> = {
        full_name: rowPayload.full_name,
        project_title: rowPayload.project_title,
        problem_statement: rowPayload.problem_statement,
        target_user: rowPayload.target_user,
        demo_link: rowPayload.demo_link,
        synced_at: syncedAt,
      };
      if (sheetPhone) {
        updateFields.whatsapp_number = sheetPhone;
      }

      const existing = existingByEmail.get(email);
      if (existing) {
        const { error: updateErr } = await supabase
          .from("project_candidates")
          .update(updateFields)
          .eq("id", existing.id)
          .eq("is_deleted", false);

        if (updateErr) {
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

      if (insertErr) {
        errors.push(`Row ${sheetRowNum} (insert): ${insertErr.message}`);
      }
    }

    return NextResponse.json({
      total_rows: totalRows,
      upserted,
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

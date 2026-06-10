import { normalizePhoneFromRaw } from "@/lib/phone-normalize";
import { parseCsv } from "@/lib/parse-csv";

/** Default project intake sheet (overridable via env). */
export const DEFAULT_PROJECT_SHEET_ID =
  "11z0ekuzC64uNWeExxk_I3YTv44lfAUvF3H4IvK5DjIY";
export const DEFAULT_PROJECT_SHEET_TAB = "Sheet1";

export const DEFAULT_COL = {
  email: 0,
  full_name: 1,
  whatsapp_number: 2,
  project_title: 3,
  problem_statement: 4,
  target_user: 5,
  demo_link: 6,
} as const;

export type ProjectSheetField = keyof typeof DEFAULT_COL;

export const HEADER_PATTERNS: Record<ProjectSheetField, RegExp[]> = {
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

export function buildProjectSheetCsvExportUrl(
  sheetId = process.env.GOOGLE_PROJECT_SHEET_ID?.trim() || DEFAULT_PROJECT_SHEET_ID,
  tab = process.env.GOOGLE_PROJECT_SHEET_TAB?.trim() || DEFAULT_PROJECT_SHEET_TAB,
): string {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&sheet=${encodeURIComponent(tab)}`;
}

export function buildColumnMapFromHeader(
  header: string[],
): Record<ProjectSheetField, number> {
  const map: Record<ProjectSheetField, number> = { ...DEFAULT_COL };
  const used = new Set<number>();
  for (const field of Object.keys(HEADER_PATTERNS) as ProjectSheetField[]) {
    for (let i = 0; i < header.length; i++) {
      if (used.has(i)) continue;
      const label = (header[i] ?? "").trim();
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

export function pickCsvCell(cells: string[], index: number): string {
  if (index < 0 || index >= cells.length) return "";
  return (cells[index] ?? "").trim();
}

export function normalizeEmail(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  return s;
}

export function isHeaderLikeEmail(raw: string): boolean {
  const s = raw.trim().toLowerCase();
  return s === "email address" || s === "email" || /^email[\s_-]/.test(s);
}

export function resolvePhoneFromCsvRow(
  cells: string[],
  colMap: Record<ProjectSheetField, number>,
): string | null {
  const primary = normalizePhoneFromRaw(
    pickCsvCell(cells, colMap.whatsapp_number),
  );
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
    const phone = normalizePhoneFromRaw(pickCsvCell(cells, i));
    if (phone) return phone;
  }
  return null;
}

export type ParsedProjectSheetRow = {
  sheetRowNum: number;
  email: string;
  full_name: string | null;
  whatsapp_number: string | null;
  project_title: string | null;
  problem_statement: string | null;
  target_user: string | null;
  demo_link: string | null;
};

export function parseProjectSheetCsv(text: string): {
  colMap: Record<ProjectSheetField, number>;
  rows: ParsedProjectSheetRow[];
} {
  const table = parseCsv(text);
  if (table.length < 2) {
    return { colMap: { ...DEFAULT_COL }, rows: [] };
  }

  const colMap = buildColumnMapFromHeader(table[0] ?? []);
  const rows: ParsedProjectSheetRow[] = [];

  for (let idx = 1; idx < table.length; idx++) {
    const cells = table[idx] ?? [];
    const emailRaw = pickCsvCell(cells, colMap.email);
    if (!emailRaw || isHeaderLikeEmail(emailRaw)) continue;

    const email = normalizeEmail(emailRaw);
    if (!email) continue;

    rows.push({
      sheetRowNum: idx + 1,
      email,
      full_name: pickCsvCell(cells, colMap.full_name) || null,
      whatsapp_number: resolvePhoneFromCsvRow(cells, colMap),
      project_title: pickCsvCell(cells, colMap.project_title) || null,
      problem_statement: pickCsvCell(cells, colMap.problem_statement) || null,
      target_user: pickCsvCell(cells, colMap.target_user) || null,
      demo_link: pickCsvCell(cells, colMap.demo_link) || null,
    });
  }

  return { colMap, rows };
}

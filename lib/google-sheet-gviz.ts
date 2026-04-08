import { createClient } from "@supabase/supabase-js";

export type GvizCell = { v?: unknown; f?: string | null } | null | undefined;
export type GvizRow = { c?: GvizCell[] };

export type GvizTable = {
  cols?: unknown[];
  rows?: GvizRow[];
};

export type GvizResponse = {
  version?: string;
  status?: string;
  errors?: { detailed_message?: string }[];
  table?: GvizTable;
};

export function extractGvizJson(text: string): GvizResponse {
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

export function cellToString(cell: GvizCell): string {
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

export async function verifyRequestUser(request: Request) {
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

import type { SupabaseClient } from "@supabase/supabase-js";

export type TeamRosterRole =
  | "poc"
  | "interviewer"
  | "post_production"
  | "operations";

export type TeamRosterRow = {
  id: string;
  created_at: string;
  name: string;
  email: string | null;
  role_type: TeamRosterRole;
  is_active: boolean;
  display_order: number;
};

function normalizeNames(rows: Array<{ name: string | null | undefined }>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const name = row.name?.trim() ?? "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

export function teamMemberDisplayName(row: {
  full_name: string | null | undefined;
  email: string | null | undefined;
}): string {
  const n = row.full_name?.trim() ?? "";
  if (n) return n;
  const email = row.email?.trim() ?? "";
  if (!email) return "";
  const local = email.split("@")[0] ?? "";
  return local || email;
}

export function mergeRosterWithCurrent(
  names: string[],
  current: string | null | undefined,
): string[] {
  const list = normalizeNames(names.map((name) => ({ name })));
  const cur = current?.trim();
  if (cur && !list.includes(cur)) {
    return [...list, cur];
  }
  return list;
}

/**
 * Active roster names from `team_members` (Settings → Team), keyed by `role` and `status = 'active'`.
 */
export async function fetchTeamRosterNames(
  supabase: SupabaseClient,
  role: TeamRosterRole,
  onlyActive = true,
): Promise<string[]> {
  let query = supabase
    .from("team_members")
    .select("full_name, email")
    .eq("role", role)
    .order("created_at", { ascending: true });

  if (onlyActive) {
    query = query.eq("status", "active");
  }

  const { data, error } = await query;

  console.log("[fetchTeamRosterNames] team_members response", {
    role,
    onlyActive,
    error: error?.message ?? null,
    rowCount: data?.length ?? 0,
    raw: data,
  });

  if (error) return [];

  const rows = (data ?? []) as Array<{
    full_name: string | null;
    email: string | null;
  }>;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const name = teamMemberDisplayName(row);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

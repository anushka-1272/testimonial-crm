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

export async function fetchTeamRosterNames(
  supabase: SupabaseClient,
  role: TeamRosterRole,
  onlyActive = true,
): Promise<string[]> {
  let query = supabase
    .from("team_roster")
    .select("name")
    .eq("role_type", role)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (onlyActive) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query;
  if (error) return [];

  return normalizeNames((data ?? []) as Array<{ name: string | null }>);
}

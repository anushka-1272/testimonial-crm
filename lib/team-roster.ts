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
  const email = row.email?.trim() ?? "";
  if (email) return email;
  const n = row.full_name?.trim() ?? "";
  return n;
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

async function fetchTeamMemberNames(
  supabase: SupabaseClient,
  role: TeamRosterRole,
  onlyActive: boolean,
): Promise<string[]> {
  let query = supabase
    .from("team_members")
    .select("full_name, email, status")
    .eq("role", role)
    .order("created_at", { ascending: true });

  if (onlyActive) {
    // Interviewers often need assigning before the member finishes onboarding; include invited.
    if (role === "interviewer") {
      query = query.in("status", ["active", "invited"]);
    } else {
      query = query.eq("status", "active");
    }
  }

  const { data, error } = await query;
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

async function fetchLegacyTeamRosterNames(
  supabase: SupabaseClient,
  role: TeamRosterRole,
  onlyActive: boolean,
): Promise<string[]> {
  let query = supabase
    .from("team_roster")
    .select("name, email")
    .eq("role_type", role)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (onlyActive) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query;
  if (error) return [];
  const rows = (data ?? []) as Array<{ name: string | null; email: string | null }>;
  return normalizeNames(
    rows.map((row) => ({
      name: row.email?.trim() || row.name,
    })),
  );
}

function mergeUniqueNameLists(primary: string[], secondary: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string) => {
    const t = raw.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  for (const n of primary) push(n);
  for (const n of secondary) push(n);
  return out;
}

/**
 * Roster names for dropdowns: `team_members` first (Settings → Team), then `team_roster`
 * so legacy seed rows (e.g. Anushka, Anushka Roy) still appear if not yet mirrored in team_members.
 */
export async function fetchTeamRosterNames(
  supabase: SupabaseClient,
  role: TeamRosterRole,
  onlyActive = true,
): Promise<string[]> {
  const [fromMembers, fromRoster] = await Promise.all([
    fetchTeamMemberNames(supabase, role, onlyActive),
    fetchLegacyTeamRosterNames(supabase, role, onlyActive),
  ]);

  const merged = mergeUniqueNameLists(fromMembers, fromRoster);

  console.log("[fetchTeamRosterNames] merged team_members + team_roster", {
    role,
    onlyActive,
    fromMembersCount: fromMembers.length,
    fromRosterCount: fromRoster.length,
    mergedCount: merged.length,
    merged,
  });

  return merged;
}

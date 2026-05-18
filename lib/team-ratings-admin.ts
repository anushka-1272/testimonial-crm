import { createClient } from "@supabase/supabase-js";

import { getUserSafe } from "@/lib/supabase-auth";
import { filterTeamRatingsMemberNames } from "@/lib/team-ratings-config";
import { createSupabaseAdmin } from "@/lib/supabase";

const RATING_ROLES = ["poc", "interviewer"] as const;

export async function verifyAdminFromRequest(
  request: Request,
): Promise<{ userId: string } | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const supabase = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const user = await getUserSafe(supabase);
  if (!user) return null;

  let admin;
  try {
    admin = createSupabaseAdmin();
  } catch {
    return null;
  }

  const { data: tm } = await admin
    .from("team_members")
    .select("role, status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (tm?.role !== "admin" || tm?.status === "removed") return null;
  return { userId: user.id };
}

export async function fetchRateableMemberNames(
  admin: ReturnType<typeof createSupabaseAdmin>,
): Promise<string[]> {
  const { data, error } = await admin
    .from("team_roster")
    .select("name")
    .eq("is_active", true)
    .in("role_type", [...RATING_ROLES])
    .order("display_order", { ascending: true });

  if (error) throw new Error(error.message);

  const raw = (data ?? []).map((r) => (r as { name: string | null }).name?.trim() ?? "");
  return filterTeamRatingsMemberNames(raw);
}

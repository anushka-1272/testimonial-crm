import type { User } from "@supabase/supabase-js";

type SupabaseLike = {
  auth: {
    getUser: () => Promise<{
      data: { user: User | null };
    }>;
  };
};

function errorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const candidate = error as { message?: unknown };
  return typeof candidate.message === "string" ? candidate.message : "";
}

export function isSupabaseAuthLockError(error: unknown): boolean {
  const msg = errorMessage(error).toLowerCase();
  return msg.includes("lock") || msg.includes("steal");
}

/** Display name for activity / audit fields (metadata name, else email). */
export function displayNameFromUser(user: User): string {
  const n = user.user_metadata?.name;
  if (typeof n === "string" && n.trim()) return n.trim();
  return user.email ?? "Unknown";
}

export async function getUserSafe(
  supabase: SupabaseLike,
): Promise<User | null> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user ?? null;
  } catch (error) {
    if (isSupabaseAuthLockError(error)) return null;
    throw error;
  }
}

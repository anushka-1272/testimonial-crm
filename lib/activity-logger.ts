import type { SupabaseClient, User } from "@supabase/supabase-js";

/** Used for filters and badge colors on the Activity page. */
export type ActivityCategory =
  | "eligibility"
  | "interviews"
  | "dispatch"
  | "post_production"
  | "settings";

export type ActivityLogParams = {
  supabase: SupabaseClient;
  user: User;
  action_type: ActivityCategory;
  entity_type: string;
  entity_id?: string | null;
  candidate_name?: string | null;
  description: string;
  metadata?: Record<string, unknown>;
};

export async function logActivity({
  supabase,
  user,
  action_type,
  entity_type,
  entity_id,
  candidate_name,
  description,
  metadata,
}: ActivityLogParams): Promise<void> {
  const userName =
    (typeof user.user_metadata?.name === "string" && user.user_metadata.name) ||
    user.email ||
    "Unknown";
  const { error } = await supabase.from("activity_log").insert({
    user_id: user.id,
    user_name: userName,
    action_type,
    entity_type,
    entity_id: entity_id ?? null,
    candidate_name: candidate_name ?? null,
    description,
    metadata: metadata ?? {},
  });
  if (error) {
    console.error("activity_log insert failed:", error.message);
  }
}

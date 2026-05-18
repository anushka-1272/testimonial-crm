import type { SupabaseClient } from "@supabase/supabase-js";

export type RatingScores = {
  callings: number | null;
  interviews: number | null;
  reminder: number | null;
};

type RatingsSchema = "new" | "legacy";

const NEW_SELECT = "member_name, callings, interviews, reminder";
const LEGACY_SELECT = "member_name, consistency, activeness, reminders";

function isMissingColumnError(message: string, column: string): boolean {
  const m = message.toLowerCase();
  return m.includes(column.toLowerCase()) && m.includes("does not exist");
}

function rowToScores(row: Record<string, unknown>): RatingScores {
  if ("callings" in row || "interviews" in row || "reminder" in row) {
    return {
      callings: (row.callings as number | null) ?? null,
      interviews: (row.interviews as number | null) ?? null,
      reminder: (row.reminder as number | null) ?? null,
    };
  }
  return {
    callings: (row.consistency as number | null) ?? null,
    interviews: (row.activeness as number | null) ?? null,
    reminder: (row.reminders as number | null) ?? null,
  };
}

function scoresToPayload(
  scores: RatingScores,
  schema: RatingsSchema,
): Record<string, number | null> {
  if (schema === "new") {
    return {
      callings: scores.callings,
      interviews: scores.interviews,
      reminder: scores.reminder,
    };
  }
  return {
    consistency: scores.callings,
    activeness: scores.interviews,
    reminders: scores.reminder,
  };
}

async function detectRatingsSchema(supabase: SupabaseClient): Promise<RatingsSchema> {
  const probe = await supabase.from("team_member_ratings").select("callings").limit(1);
  if (!probe.error) return "new";
  if (isMissingColumnError(probe.error.message, "callings")) return "legacy";
  return "new";
}

export async function fetchTeamMemberRatings(
  supabase: SupabaseClient,
  periodStart: string,
  periodEnd: string,
): Promise<{ rows: Map<string, RatingScores>; error: string | null; schema: RatingsSchema }> {
  const schema = await detectRatingsSchema(supabase);
  const select = schema === "new" ? NEW_SELECT : LEGACY_SELECT;

  const { data, error } = await supabase
    .from("team_member_ratings")
    .select(select)
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd);

  if (error) {
    return { rows: new Map(), error: error.message, schema };
  }

  const rows = new Map<string, RatingScores>();
  for (const row of data ?? []) {
    const name = String((row as { member_name: string }).member_name ?? "").trim();
    if (!name) continue;
    rows.set(name, rowToScores(row as Record<string, unknown>));
  }

  return { rows, error: null, schema };
}

export async function upsertTeamMemberRating(
  supabase: SupabaseClient,
  input: {
    periodStart: string;
    periodEnd: string;
    memberName: string;
    scores: RatingScores;
    ratedBy: string | null;
    schema?: RatingsSchema;
  },
): Promise<{ error: string | null; schema: RatingsSchema }> {
  let schema = input.schema ?? (await detectRatingsSchema(supabase));

  const base = {
    period_start: input.periodStart,
    period_end: input.periodEnd,
    member_name: input.memberName,
    rated_by: input.ratedBy,
    updated_at: new Date().toISOString(),
  };

  const tryUpsert = async (s: RatingsSchema) => {
    const payload = { ...base, ...scoresToPayload(input.scores, s) };
    return supabase
      .from("team_member_ratings")
      .upsert(payload, { onConflict: "period_start,period_end,member_name" });
  };

  let result = await tryUpsert(schema);
  if (
    result.error &&
    schema === "new" &&
    isMissingColumnError(result.error.message, "callings")
  ) {
    schema = "legacy";
    result = await tryUpsert(schema);
  }
  if (
    result.error &&
    schema === "legacy" &&
    isMissingColumnError(result.error.message, "consistency")
  ) {
    schema = "new";
    result = await tryUpsert(schema);
  }

  return { error: result.error?.message ?? null, schema };
}

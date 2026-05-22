import type { SupabaseClient } from "@supabase/supabase-js";

/** Insert gwc_testing row if missing (works with partial unique indexes; avoids upsert onConflict). */
export async function ensureGwcTestingForCandidate(
  supabase: SupabaseClient,
  candidateId: string,
): Promise<{ error: string | null }> {
  const { data: existing, error: selErr } = await supabase
    .from("gwc_testing")
    .select("id")
    .eq("candidate_id", candidateId)
    .maybeSingle();
  if (selErr) return { error: selErr.message };
  if (existing) return { error: null };

  const { error: insErr } = await supabase
    .from("gwc_testing")
    .insert({ candidate_id: candidateId });
  if (insErr) return { error: insErr.message };
  return { error: null };
}

export async function ensureGwcTestingForProjectCandidate(
  supabase: SupabaseClient,
  projectCandidateId: string,
): Promise<{ error: string | null }> {
  const { data: existing, error: selErr } = await supabase
    .from("gwc_testing")
    .select("id")
    .eq("project_candidate_id", projectCandidateId)
    .maybeSingle();
  if (selErr) return { error: selErr.message };
  if (existing) return { error: null };

  const { error: insErr } = await supabase
    .from("gwc_testing")
    .insert({ project_candidate_id: projectCandidateId });
  if (insErr) return { error: insErr.message };
  return { error: null };
}

/**
 * Creates missing gwc_testing rows for candidates already marked GWC in eligibility
 * or project pending (e.g. when upsert failed after partial-unique-index migration).
 */
export async function backfillGwcTestingRows(
  supabase: SupabaseClient,
): Promise<{ error: string | null; created: number }> {
  const [
    { data: testimonialMarked, error: tErr },
    { data: projectMarked, error: pErr },
    { data: existing, error: eErr },
  ] = await Promise.all([
    supabase
      .from("candidates")
      .select("id")
      .eq("interview_type", "gwc")
      .eq("is_deleted", false),
    supabase
      .from("project_candidates")
      .select("id, status, interview_type")
      .eq("is_deleted", false),
    supabase.from("gwc_testing").select("candidate_id, project_candidate_id"),
  ]);

  if (tErr) return { error: tErr.message, created: 0 };
  if (pErr) return { error: pErr.message, created: 0 };
  if (eErr) return { error: eErr.message, created: 0 };

  const hasCandidate = new Set(
    (existing ?? [])
      .map((r) => r.candidate_id as string | null)
      .filter((id): id is string => Boolean(id)),
  );
  const hasProject = new Set(
    (existing ?? [])
      .map((r) => r.project_candidate_id as string | null)
      .filter((id): id is string => Boolean(id)),
  );

  let created = 0;

  for (const c of testimonialMarked ?? []) {
    const id = c.id as string;
    if (hasCandidate.has(id)) continue;
    const { error } = await ensureGwcTestingForCandidate(supabase, id);
    if (error) return { error, created };
    hasCandidate.add(id);
    created++;
  }

  for (const pc of projectMarked ?? []) {
    const status = ((pc.status as string | null) ?? "").trim().toLowerCase();
    const track = ((pc.interview_type as string | null) ?? "")
      .trim()
      .toLowerCase();
    if (status !== "gwc" && track !== "gwc") continue;
    const id = pc.id as string;
    if (hasProject.has(id)) continue;
    const { error } = await ensureGwcTestingForProjectCandidate(supabase, id);
    if (error) return { error, created };
    hasProject.add(id);
    created++;
  }

  return { error: null, created };
}

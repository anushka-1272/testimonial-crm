import type { SupabaseClient } from "@supabase/supabase-js";

import {
  assessEligibility,
  eligibilityCandidateFromDbRow,
  type EligibilityAssessmentResult,
} from "@/lib/claude";

type CriteriaRow = { criteria_name: string; criteria_description: string | null };

async function loadActiveCriteria(
  supabase: SupabaseClient,
): Promise<{ criteria: CriteriaRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("eligibility_criteria")
    .select("criteria_name, criteria_description")
    .eq("is_active", true);

  if (error) {
    return { criteria: [], error: error.message };
  }

  const criteria = (data ?? []).map((r) => ({
    criteria_name: String(r.criteria_name),
    criteria_description:
      r.criteria_description == null ? null : String(r.criteria_description),
  }));

  return { criteria, error: null };
}

export type RunAssessmentOk = {
  ok: true;
  candidate_id: string;
  assessment: EligibilityAssessmentResult;
};

export type RunAssessmentErr = {
  ok: false;
  candidate_id: string;
  error: string;
};

/**
 * Loads candidate + criteria, runs Claude, persists score/reason and sets status to pending_review.
 */
export async function runAssessEligibilityAndPersist(
  supabase: SupabaseClient,
  candidateId: string,
): Promise<RunAssessmentOk | RunAssessmentErr> {
  const { data: row, error: fetchError } = await supabase
    .from("candidates")
    .select(
      "id, full_name, achievement_type, achievement_title, quantified_result, primary_goal, skills_modules_helped, how_program_helped, proof_document_url, role_before_program, linkedin_url",
    )
    .eq("id", candidateId)
    .maybeSingle();

  if (fetchError) {
    return { ok: false, candidate_id: candidateId, error: fetchError.message };
  }
  if (!row) {
    return { ok: false, candidate_id: candidateId, error: "Candidate not found" };
  }

  const { criteria, error: criteriaError } = await loadActiveCriteria(supabase);
  if (criteriaError) {
    return { ok: false, candidate_id: candidateId, error: criteriaError };
  }

  const candidate = eligibilityCandidateFromDbRow(row);
  const assessment = await assessEligibility(candidate, criteria);

  const { error: updateError } = await supabase
    .from("candidates")
    .update({
      ai_eligibility_score: assessment.score,
      ai_eligibility_reason: assessment.reason,
      eligibility_status: "pending_review",
    })
    .eq("id", candidateId);

  if (updateError) {
    return { ok: false, candidate_id: candidateId, error: updateError.message };
  }

  return { ok: true, candidate_id: candidateId, assessment };
}

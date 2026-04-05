import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

export const CLAUDE_MODEL = "claude-sonnet-4-20250514" as const;

export type EligibilityCriterionRow = {
  criteria_name: string;
  criteria_description: string | null;
};

/** Minimal candidate profile passed into Claude for scoring. */
export type EligibilityAssessmentCandidate = {
  name: string | null;
  achievement_summary: string | null;
  proof_link: string | null;
  industry: string | null;
  linkedin_url: string | null;
};

export type EligibilityAssessmentResult = {
  score: number;
  reason: string;
  recommendation: "eligible" | "not_eligible";
};

const AssessmentResponseSchema = z.object({
  score: z.number().min(0).max(100),
  reason: z.string().min(1),
  recommendation: z.enum(["eligible", "not_eligible"]),
});

/** Map a Supabase `candidates` row (current schema) into the assessment shape. */
export function eligibilityCandidateFromDbRow(row: {
  full_name?: string | null;
  achievement_type?: string | null;
  achievement_title?: string | null;
  quantified_result?: string | null;
  primary_goal?: string | null;
  skills_modules_helped?: string | null;
  how_program_helped?: string | null;
  proof_document_url?: string | null;
  role_before_program?: string | null;
  linkedin_url?: string | null;
}): EligibilityAssessmentCandidate {
  const summaryLines = [
    row.achievement_type && `Achievement type: ${row.achievement_type}`,
    row.achievement_title && `Title: ${row.achievement_title}`,
    row.quantified_result && `Quantified result: ${row.quantified_result}`,
    row.primary_goal && `Primary goal: ${row.primary_goal}`,
    row.skills_modules_helped && `Skills/modules: ${row.skills_modules_helped}`,
    row.how_program_helped && `How the program helped: ${row.how_program_helped}`,
  ].filter(Boolean) as string[];

  return {
    name: row.full_name ?? null,
    achievement_summary: summaryLines.length ? summaryLines.join("\n") : null,
    proof_link: row.proof_document_url ?? null,
    industry: row.role_before_program ?? null,
    linkedin_url: row.linkedin_url ?? null,
  };
}

function formatCandidateForPrompt(c: EligibilityAssessmentCandidate): string {
  return [
    `name: ${c.name ?? "(empty)"}`,
    `achievement_summary: ${c.achievement_summary ?? "(empty)"}`,
    `proof_link: ${c.proof_link ?? "(empty)"}`,
    `industry: ${c.industry ?? "(empty)"}`,
    `linkedin_url: ${c.linkedin_url ?? "(empty)"}`,
  ].join("\n");
}

function formatCriteriaForPrompt(rows: EligibilityCriterionRow[]): string {
  if (rows.length === 0) {
    return "(No active criteria are configured. State this in your reason and use recommendation \"not_eligible\" unless the submission is clearly strong enough to warrant human review anyway — prefer conservative scoring.)";
  }
  return rows
    .map(
      (r, i) =>
        `${i + 1}. ${r.criteria_name}${r.criteria_description ? `: ${r.criteria_description}` : ""}`,
    )
    .join("\n");
}

function extractAssistantText(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

function parseJsonFromAssistant(raw: string): unknown {
  const trimmed = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(trimmed);
  const jsonStr = fence ? fence[1].trim() : trimmed;
  return JSON.parse(jsonStr) as unknown;
}

/**
 * Scores the candidate against the provided criteria using Claude.
 * Evaluation must follow the criteria list strictly; do not invent extra rules.
 */
export async function assessEligibility(
  candidate: EligibilityAssessmentCandidate,
  criteria: EligibilityCriterionRow[],
): Promise<EligibilityAssessmentResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      score: 0,
      reason: "ANTHROPIC_API_KEY is not configured; assessment skipped.",
      recommendation: "not_eligible",
    };
  }

  const client = new Anthropic({ apiKey });

  const system = `You are a strict eligibility reviewer. You MUST base your judgment ONLY on the numbered eligibility criteria provided in the user message.
Do not apply outside assumptions or rules that are not implied by those criteria.
Use the candidate fields (name, achievement_summary, proof_link, industry, linkedin_url) as evidence when checking each criterion.

Output rules:
- Return a single JSON object only (no markdown fences), with keys: score (integer 0-100), reason (string, brief but specific and reference the criteria), recommendation (either "eligible" or "not_eligible").
- score must reflect how fully the evidence satisfies ALL criteria together.
- recommendation "eligible" only if the criteria are clearly satisfied; otherwise "not_eligible".`;

  const user = `## Eligibility criteria (evaluate strictly against these)
${formatCriteriaForPrompt(criteria)}

## Candidate
${formatCandidateForPrompt(candidate)}

Respond with JSON only: {"score": <0-100>, "reason": "<string>", "recommendation": "<eligible|not_eligible>"}`;

  const message = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1200,
    system,
    messages: [{ role: "user", content: user }],
  });

  const text = extractAssistantText(message.content);
  let parsed: unknown;
  try {
    parsed = parseJsonFromAssistant(text);
  } catch {
    return {
      score: 0,
      reason: `Model response was not valid JSON. Snippet: ${text.slice(0, 280)}`,
      recommendation: "not_eligible",
    };
  }

  const parsedResult = AssessmentResponseSchema.safeParse(parsed);
  if (!parsedResult.success) {
    return {
      score: 0,
      reason: `Invalid assessment JSON: ${parsedResult.error.message}`,
      recommendation: "not_eligible",
    };
  }

  return parsedResult.data;
}

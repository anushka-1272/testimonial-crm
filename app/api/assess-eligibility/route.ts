import { NextResponse } from "next/server";
import { z } from "zod";

import { runAssessEligibilityAndPersist } from "@/lib/candidate-assessment";
import { createSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

const BodySchema = z.object({
  candidate_id: z.string().uuid(),
});

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const supabase = createSupabaseAdmin();
  const result = await runAssessEligibilityAndPersist(
    supabase,
    parsed.data.candidate_id,
  );

  if (!result.ok) {
    const status = result.error === "Candidate not found" ? 404 : 500;
    return NextResponse.json(
      { error: result.error, candidate_id: result.candidate_id },
      { status },
    );
  }

  return NextResponse.json({
    candidate_id: result.candidate_id,
    score: result.assessment.score,
    reason: result.assessment.reason,
    recommendation: result.assessment.recommendation,
    eligibility_status: "pending_review",
  });
}

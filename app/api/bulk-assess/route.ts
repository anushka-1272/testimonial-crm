import { NextResponse } from "next/server";
import { z } from "zod";

import { runAssessEligibilityAndPersist } from "@/lib/candidate-assessment";
import { createSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

const BodySchema = z.object({
  candidate_ids: z.array(z.string().uuid()).min(1),
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  const candidate_ids = parsed.data.candidate_ids;

  const results: Array<{
    candidate_id: string;
    ok: boolean;
    score?: number;
    reason?: string;
    recommendation?: "eligible" | "not_eligible";
    error?: string;
  }> = [];

  for (let i = 0; i < candidate_ids.length; i++) {
    if (i > 0) {
      await delay(500);
    }

    const id = candidate_ids[i];
    const outcome = await runAssessEligibilityAndPersist(supabase, id);

    if (outcome.ok) {
      results.push({
        candidate_id: id,
        ok: true,
        score: outcome.assessment.score,
        reason: outcome.assessment.reason,
        recommendation: outcome.assessment.recommendation,
      });
    } else {
      results.push({
        candidate_id: id,
        ok: false,
        error: outcome.error,
      });
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.length - succeeded;

  return NextResponse.json({
    total: results.length,
    succeeded,
    failed,
    results,
  });
}

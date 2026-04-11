import { format, isValid, parseISO } from "date-fns";
import { NextResponse } from "next/server";

import { assessEligibility, eligibilityCandidateFromDbRow } from "@/lib/claude";
import { createSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

function firstString(
  raw: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const v = raw[key];
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.trim() !== "") return v.trim();
    if (typeof v === "number" && !Number.isNaN(v)) return String(v);
  }
  return null;
}

function parseOptionalDate(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const s = String(value).trim();
  if (!s) return null;
  const d = parseISO(s.includes("T") ? s : `${s}T12:00:00.000Z`);
  if (!isValid(d)) return null;
  return format(d, "yyyy-MM-dd");
}

function parseFormFilledDate(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const d = parseISO(String(value).trim());
  if (!isValid(d)) return null;
  return d.toISOString();
}

function parseDeclarationAccepted(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (["true", "1", "yes", "on", "checked"].includes(s)) return true;
    if (["false", "0", "no", "off", ""].includes(s)) return false;
  }
  return false;
}

function normalizeFormPayload(raw: Record<string, unknown>): {
  row: Record<string, unknown>;
} {
  const email = firstString(raw, ["email", "Email", "email_address"]);
  if (!email) {
    throw new Error("email is required");
  }

  const full_name = firstString(raw, ["full_name", "fullName", "name"]);
  const whatsapp_number = firstString(raw, [
    "whatsapp_number",
    "whatsappNumber",
    "whatsapp",
    "phone",
    "Phone",
  ]);
  const role_before_program = firstString(raw, [
    "role_before_program",
    "roleBeforeProgram",
    "your_role_before_joining_the_program",
  ]);
  const salary_before_program = firstString(raw, [
    "salary_before_program",
    "salaryBeforeProgram",
    "your_monthly_salary_or_income_range_before_joining",
  ]);
  const primary_goal = firstString(raw, [
    "primary_goal",
    "primaryGoal",
    "your_primary_goal_when_joining_this_program",
  ]);
  const achievement_type = firstString(raw, [
    "achievement_type",
    "achievementType",
    "select_your_achievement_type",
  ]);
  const achievement_title = firstString(raw, [
    "achievement_title",
    "achievementTitle",
    "achievement_title_one_line_summary",
  ]);
  const quantified_result = firstString(raw, [
    "quantified_result",
    "quantifiedResult",
    "mention_quantified_result_numbers_only",
  ]);
  const skills_modules_helped = firstString(raw, [
    "skills_modules_helped",
    "skillsModulesHelped",
    "which_skills_modules_helped_you_most",
  ]);
  const how_program_helped = firstString(raw, [
    "how_program_helped",
    "howProgramHelped",
    "how_exactly_did_this_program_help_you_achieve_this_result",
  ]);
  const proof_document_url = firstString(raw, [
    "proof_document_url",
    "proofDocumentUrl",
    "upload_proof_document",
    "proof_link",
    "proofLink",
  ]);
  const proof_description = firstString(raw, [
    "proof_description",
    "proofDescription",
    "description_of_the_proof_uploaded_above",
  ]);
  const linkedin_url = firstString(raw, ["linkedin_url", "linkedinUrl"]);
  const instagram_url = firstString(raw, ["instagram_url", "instagramUrl"]);

  const achieved_on_date =
    parseOptionalDate(
      raw.achieved_on_date ??
        raw.achievedOnDate ??
        raw.achievement_timeline_achieved_on_which_date,
    ) ??
    parseOptionalDate(
      raw["achievement_timeline_-_achieved_on_which_date?"],
    );

  const program_joined_date =
    parseOptionalDate(
      raw.program_joined_date ??
        raw.programJoinedDate ??
        raw.achievement_timeline_program_joined_on_which_date,
    ) ??
    parseOptionalDate(
      raw["achievement_timeline_-_program_joined_on_which_date?"],
    );

  const form_filled_date =
    parseFormFilledDate(
      raw.form_filled_date ?? raw.formFilledDate ?? raw.submitted_at,
    ) ?? new Date().toISOString();

  const declaration_accepted = parseDeclarationAccepted(
    raw.declaration_accepted ??
      raw.declarationAccepted ??
      raw.declaration ??
      raw.accept_declaration,
  );

  const row: Record<string, unknown> = {
    form_filled_date,
    email,
    full_name,
    whatsapp_number,
    role_before_program,
    salary_before_program,
    primary_goal,
    achievement_type,
    achievement_title,
    achieved_on_date,
    program_joined_date,
    quantified_result,
    skills_modules_helped,
    how_program_helped,
    proof_document_url,
    proof_description,
    linkedin_url,
    instagram_url,
    declaration_accepted,
  };

  return { row };
}

function verifyWebhookSecret(request: Request): boolean {
  const secret = process.env.FORM_WEBHOOK_SECRET;
  if (!secret) return true;
  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  if (request.headers.get("x-webhook-secret") === secret) return true;
  return false;
}

export async function POST(request: Request) {
  if (!verifyWebhookSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const raw =
    body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  if (!raw) {
    return NextResponse.json(
      { error: "Expected a JSON object payload" },
      { status: 400 },
    );
  }

  let row: Record<string, unknown>;
  try {
    ({ row } = normalizeFormPayload(raw));
  } catch (e) {
    if (e instanceof Error && e.message === "email is required") {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }

  const supabase = createSupabaseAdmin();

  const { data: criteriaRows, error: criteriaError } = await supabase
    .from("eligibility_criteria")
    .select("criteria_name, criteria_description")
    .eq("is_active", true);

  if (criteriaError) {
    return NextResponse.json(
      { error: "Failed to load eligibility criteria", details: criteriaError.message },
      { status: 500 },
    );
  }

  const activeCriteria = (criteriaRows ?? []).map((r) => ({
    criteria_name: String(r.criteria_name),
    criteria_description:
      r.criteria_description === null || r.criteria_description === undefined
        ? null
        : String(r.criteria_description),
  }));

  const emailKey = String(row.email ?? "").trim().toLowerCase();
  if (emailKey) {
    const { data: existingDel } = await supabase
      .from("candidates")
      .select("id, is_deleted")
      .eq("email", emailKey)
      .maybeSingle();
    if (existingDel?.is_deleted) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "This email was removed from the CRM and cannot be updated via webhook.",
        },
        { status: 409 },
      );
    }
  }

  const candidateForAi = eligibilityCandidateFromDbRow(
    row as Parameters<typeof eligibilityCandidateFromDbRow>[0],
  );
  const ai = await assessEligibility(candidateForAi, activeCriteria);

  const upsertPayload = {
    ...row,
    ai_eligibility_score: ai.score,
    ai_eligibility_reason: ai.reason,
    eligibility_status:
      ai.recommendation === "eligible" ? "eligible" : "not_eligible",
  };

  const { data: saved, error: upsertError } = await supabase
    .from("candidates")
    .upsert(upsertPayload, { onConflict: "email" })
    .select("id, email, eligibility_status, ai_eligibility_score")
    .single();

  if (upsertError) {
    return NextResponse.json(
      { error: "Failed to save candidate", details: upsertError.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    candidate: saved,
  });
}

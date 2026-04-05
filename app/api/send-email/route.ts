import { NextResponse } from "next/server";
import { z } from "zod";

import {
  sendDispatchConfirmationEmail,
  sendEligibilityRejectionEmail,
  sendInterviewConfirmationEmail,
  sendInterviewReminderEmail,
  sendInterviewThankYouEmail,
} from "@/lib/resend";

export const runtime = "nodejs";

const InterviewConfirmation = z.object({
  type: z.literal("interview_confirmation"),
  to: z.string().email(),
  name: z.string().nullable().optional(),
  date: z.string().min(1),
  time: z.string().min(1),
  zoom_link: z.string(),
});

const InterviewReminder = z.object({
  type: z.literal("interview_reminder"),
  to: z.string().email(),
  name: z.string().nullable().optional(),
  time: z.string().min(1),
  zoom_link: z.string(),
});

const InterviewThankYou = z.object({
  type: z.literal("interview_thankyou"),
  to: z.string().email(),
  name: z.string().nullable().optional(),
});

const EligibilityReject = z.object({
  type: z.literal("eligibility_reject"),
  to: z.string().email(),
  candidateName: z.string().nullable().optional(),
});

const DispatchConfirmation = z.object({
  type: z.literal("dispatch_confirmation"),
  to: z.string().email(),
  name: z.string().nullable().optional(),
  tracking_id: z.string().min(1),
  date: z.string().min(1),
});

const BodySchema = z.discriminatedUnion("type", [
  InterviewConfirmation,
  InterviewReminder,
  InterviewThankYou,
  EligibilityReject,
  DispatchConfirmation,
]);

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

  const body = parsed.data;
  let result!: { ok: true } | { ok: false; error: string };

  switch (body.type) {
    case "interview_confirmation":
      result = await sendInterviewConfirmationEmail({
        to: body.to,
        name: body.name,
        date: body.date,
        time: body.time,
        zoom_link: body.zoom_link,
      });
      break;
    case "interview_reminder":
      result = await sendInterviewReminderEmail({
        to: body.to,
        name: body.name,
        time: body.time,
        zoom_link: body.zoom_link,
      });
      break;
    case "interview_thankyou":
      result = await sendInterviewThankYouEmail({
        to: body.to,
        name: body.name,
      });
      break;
    case "eligibility_reject":
      result = await sendEligibilityRejectionEmail({
        to: body.to,
        candidateName: body.candidateName,
      });
      break;
    case "dispatch_confirmation":
      result = await sendDispatchConfirmationEmail({
        to: body.to,
        name: body.name,
        tracking_id: body.tracking_id,
        date: body.date,
      });
      break;
  }

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

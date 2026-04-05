import { Resend } from "resend";

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

const defaultFrom =
  process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function displayName(name?: string | null): string {
  return name?.trim() || "there";
}

export async function sendInterviewConfirmationEmail(params: {
  to: string;
  name?: string | null;
  date: string;
  time: string;
  zoom_link: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const resend = getResend();
  if (!resend) {
    return { ok: false, error: "RESEND_API_KEY is not configured" };
  }
  const n = displayName(params.name);
  const zoom = params.zoom_link?.trim() || "(link to follow)";
  const body = `Hi ${escapeHtml(n)}, your interview is confirmed for ${escapeHtml(params.date)} at ${escapeHtml(params.time)}. Zoom link: ${escapeHtml(zoom)}`;
  const { error } = await resend.emails.send({
    from: defaultFrom,
    to: params.to,
    subject: "Your interview is confirmed",
    html: `<p>${body.replace(/\n/g, "<br/>")}</p>`,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function sendInterviewReminderEmail(params: {
  to: string;
  name?: string | null;
  time: string;
  zoom_link: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const resend = getResend();
  if (!resend) {
    return { ok: false, error: "RESEND_API_KEY is not configured" };
  }
  const n = displayName(params.name);
  const zoom = params.zoom_link?.trim() || "(see your confirmation email)";
  const text = `Hi ${escapeHtml(n)}, reminder: your interview is in 1 hour at ${escapeHtml(params.time)}. Zoom link: ${escapeHtml(zoom)}`;
  const { error } = await resend.emails.send({
    from: defaultFrom,
    to: params.to,
    subject: "Interview reminder — starting in 1 hour",
    html: `<p>${text}</p>`,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function sendInterviewThankYouEmail(params: {
  to: string;
  name?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const resend = getResend();
  if (!resend) {
    return { ok: false, error: "RESEND_API_KEY is not configured" };
  }
  const n = displayName(params.name);
  const text = `Hi ${escapeHtml(n)}, thank you for the interview. We'll be in touch soon.`;
  const { error } = await resend.emails.send({
    from: defaultFrom,
    to: params.to,
    subject: "Thank you for your interview",
    html: `<p>${text}</p>`,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function sendEligibilityRejectionEmail(params: {
  to: string;
  candidateName?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const resend = getResend();
  if (!resend) {
    return { ok: false, error: "RESEND_API_KEY is not configured" };
  }
  const n = displayName(params.candidateName);
  const text = `Hi ${escapeHtml(n)}, thank you for sharing your achievement. Unfortunately you don't qualify at this time.`;
  const { error } = await resend.emails.send({
    from: defaultFrom,
    to: params.to,
    subject: "Update on your submission",
    html: `<p>${text}</p>`,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function sendDispatchConfirmationEmail(params: {
  to: string;
  name?: string | null;
  tracking_id: string;
  date: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const resend = getResend();
  if (!resend) {
    return { ok: false, error: "RESEND_API_KEY is not configured" };
  }
  const n = displayName(params.name);
  const text = `Hi ${escapeHtml(n)}, your AirPods have been dispatched! Tracking ID: ${escapeHtml(params.tracking_id)}. Expected delivery: ${escapeHtml(params.date)}`;
  const { error } = await resend.emails.send({
    from: defaultFrom,
    to: params.to,
    subject: "Your shipment is on the way",
    html: `<p>${text}</p>`,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

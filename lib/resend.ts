import { Resend } from "resend";

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}


const defaultFrom = `Early Achiever's Bonus <${process.env.RESEND_FROM_EMAIL ?? "earlyachieversbonus@resend.dev"}>`;

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
  reward_item?: string | null;
  tracking_id: string;
  dispatch_date: string;
  expected_delivery_date: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const resend = getResend();
  if (!resend) {
    return { ok: false, error: "RESEND_API_KEY is not configured" };
  }
  const n = displayName(params.name);
  const rewardRaw = params.reward_item?.trim();
  const reward = rewardRaw ? escapeHtml(rewardRaw) : "—";
  const tracking = escapeHtml(params.tracking_id);
  const dispatchDate = escapeHtml(params.dispatch_date);
  const expected = escapeHtml(params.expected_delivery_date);

  const html = `<p>Hi ${escapeHtml(n)},</p>
<p>Great news! Your reward has been dispatched and is on its way to you.</p>
<p>Reward: ${reward}<br/>
Tracking ID: ${tracking}<br/>
Dispatch Date: ${dispatchDate}<br/>
Expected Delivery: ${expected} (7-10 working days)</p>
<p>If you have any questions, feel free to reach out to us.</p>
<p>Warm regards,<br/>
Team Be10x</p>`;

  const { error } = await resend.emails.send({
    from: defaultFrom,
    to: params.to,
    subject: "Your shipment is on the way",
    html,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Internal CX notification when a testimonial video goes live on YouTube. */
export async function sendPostProductionCxEmail(params: {
  to: string;
  candidateName: string;
  youtubeLink: string;
  summary: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const resend = getResend();
  if (!resend) {
    return { ok: false, error: "RESEND_API_KEY is not configured" };
  }
  const name = escapeHtml(params.candidateName.trim() || "Candidate");
  const link = escapeHtml(params.youtubeLink.trim());
  const summaryBlock = params.summary?.trim()
    ? `<p><strong>Summary</strong></p><p>${escapeHtml(params.summary.trim()).replace(/\n/g, "<br/>")}</p>`
    : "<p><em>No summary generated yet.</em></p>";

  const html = `<p>A testimonial video is <strong>live on YouTube</strong>.</p>
<p><strong>Learner:</strong> ${name}<br/>
<strong>YouTube:</strong> <a href="${link}">${link}</a></p>
${summaryBlock}
<p>— Post Production (Testimonial CRM)</p>`;

  const { error } = await resend.emails.send({
    from: defaultFrom,
    to: params.to,
    subject: `Live on YouTube: ${params.candidateName.trim() || "Testimonial"}`,
    html,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

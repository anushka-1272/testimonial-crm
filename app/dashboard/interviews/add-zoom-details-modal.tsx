"use client";

import { format, parseISO } from "date-fns";
import { useEffect, useState } from "react";

import type { SupabaseClient } from "@supabase/supabase-js";

import { logActivity } from "@/lib/activity-logger";
import { getUserSafe } from "@/lib/supabase-auth";
import { slackEmailForTeamMember } from "@/lib/slack-contacts";
import { modalOverlayClass, modalPanelClass } from "@/lib/modal-responsive";
import { voidSlackNotify } from "@/lib/slack-client";
import { sendWatiNotification } from "@/lib/wati-client";

import { formatInterviewerStoredForUi } from "@/lib/interviewer-enum";

import {
  rescheduleCandidateDisplayName,
  rescheduleKindFromInterview,
} from "./interview-reschedule-workflow";
import type {
  InterviewWithCandidate,
  ProjectInterviewWithProjectCandidate,
} from "./types";
import { isProjectInterviewRow } from "./types";

type AnyInterview = InterviewWithCandidate | ProjectInterviewWithProjectCandidate;

function formatSlot(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "MMM d, yyyy h:mm a");
  } catch {
    return "—";
  }
}

type Props = {
  open: boolean;
  interview: AnyInterview | null;
  supabase: SupabaseClient;
  onClose: () => void;
  onSaved: () => void;
  onToast: (message: string) => void;
};

export function AddZoomDetailsModal({
  open,
  interview,
  supabase,
  onClose,
  onSaved,
  onToast,
}: Props) {
  const [zoomLink, setZoomLink] = useState("");
  const [zoomAccount, setZoomAccount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setZoomLink("");
    setZoomAccount("");
    setError(null);
  }, [open, interview?.id]);

  if (!open || !interview) return null;

  const kind = rescheduleKindFromInterview(interview);
  const isProject = isProjectInterviewRow(interview);
  const candName = rescheduleCandidateDisplayName(interview, kind);
  const ivLabel = formatInterviewerStoredForUi(interview.interviewer);
  const subtitle = `${candName} · ${formatSlot(interview.scheduled_date)} · Interviewer: ${ivLabel}`;

  const inp =
    "mt-1 w-full rounded-xl border border-border px-3 py-2.5 text-sm text-foreground focus:border-[#3b82f6] focus:outline-none focus:ring-0";
  const lab = "text-xs font-medium uppercase tracking-widest text-muted/80";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const link = zoomLink.trim();
    const account = zoomAccount.trim();
    if (!link) {
      setError("Meeting link is required.");
      return;
    }
    if (!link.startsWith("https://")) {
      setError("Meeting link must start with https://");
      return;
    }
    if (!account) {
      setError("Host account is required.");
      return;
    }

    const dateLabel = interview.scheduled_date
      ? format(parseISO(interview.scheduled_date), "MMMM d, yyyy")
      : "";
    const timeLabel = interview.scheduled_date
      ? format(parseISO(interview.scheduled_date), "h:mm a")
      : "";

    setSubmitting(true);
    try {
      const table = isProject ? "project_interviews" : "interviews";
      const patch: Record<string, string> = {
        zoom_link: link,
        zoom_account: account,
        interview_status: "scheduled",
      };
      const { error: upErr } = await supabase
        .from(table)
        .update(patch)
        .eq("id", interview.id);

      if (upErr) {
        setError(upErr.message);
        setSubmitting(false);
        return;
      }

      const authUser = await getUserSafe(supabase);
      if (authUser) {
        await logActivity({
          supabase,
          user: authUser,
          action_type: "interviews",
          entity_type: "interview",
          entity_id: interview.id,
          candidate_name: candName,
          description: `Meeting link added for ${candName}`,
          metadata: {},
        });
      }

      const formattedDateTime = interview.scheduled_date
        ? format(parseISO(interview.scheduled_date), "dd MMM yyyy, h:mm a")
        : "";
      const interviewerSlackEmail = await slackEmailForTeamMember(
        supabase,
        interview.interviewer,
      );
      if (interviewerSlackEmail) {
        const slackMsg =
          `📅 New interview scheduled!\n` +
          `*Candidate:* ${candName}\n` +
          `*Date & Time:* ${formattedDateTime || "—"}\n` +
          `*Meeting Link:* ${link}\n` +
          `*Host Account:* ${account}`;
        voidSlackNotify(supabase, interviewerSlackEmail, slackMsg);
      }
      const waPhone = isProject
        ? interview.project_candidates?.whatsapp_number?.trim()
        : interview.candidates?.whatsapp_number?.trim();
      const watiName = isProject
        ? interview.project_candidates?.full_name?.trim() ||
          interview.project_candidates?.email ||
          candName
        : interview.candidates?.full_name?.trim() ||
          interview.candidates?.email ||
          candName;
      void (async () => {
        if (!waPhone) return;
        try {
          const ok = await sendWatiNotification(supabase, waPhone, "interview_", [
            { name: "1", value: watiName },
            { name: "2", value: formattedDateTime },
            { name: "3", value: link },
          ]);
          if (!ok) onToast("WhatsApp notification failed to send");
        } catch (err) {
          console.error("WATI:", err);
          onToast("WhatsApp notification failed to send");
        }
      })();

      const toEmail = isProject
        ? interview.project_candidates?.email
        : interview.candidates?.email;
      const toName = isProject
        ? interview.project_candidates?.project_title
        : interview.candidates?.full_name;
      let emailFailed = false;
      if (toEmail && dateLabel && timeLabel) {
        try {
          const emailRes = await fetch("/api/send-email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "interview_confirmation",
              to: toEmail,
              name: toName,
              date: dateLabel,
              time: timeLabel,
              zoom_link: link,
            }),
          });

          if (emailRes.ok) {
            await supabase
              .from(table)
              .update({ invitation_sent: true })
              .eq("id", interview.id);
          } else {
            emailFailed = true;
            const errBody = (await emailRes.json().catch(() => ({}))) as {
              error?: string;
            };
            console.error(
              "Interview confirmation email failed:",
              errBody.error ?? emailRes.status,
            );
          }
        } catch (err) {
          emailFailed = true;
          console.error("Interview confirmation email:", err);
        }
      }

      onToast(
        emailFailed
          ? "Interview scheduled. Email notification failed (domain not verified)"
          : "Interview scheduled successfully",
      );
      onSaved();
      onClose();
    } catch {
      setError("Something went wrong.");
    }
    setSubmitting(false);
  };

  return (
    <div className={modalOverlayClass}>
      <button
        type="button"
        className="absolute inset-0"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        className={`${modalPanelClass} p-6 shadow-card`}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              Add Meeting Details
            </h2>
            <p className="text-sm text-muted">{subtitle}</p>
          </div>
          <button
            type="button"
            className="rounded-xl p-2 text-muted/80 transition-all hover:bg-background hover:text-foreground"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 text-sm">
          {error && (
            <p className="rounded-xl border border-border-subtle bg-background px-3 py-2 text-sm text-foreground">
              {error}
            </p>
          )}

          <label className="block text-sm">
            <span className={lab}>Meeting link</span>
            <input
              type="url"
              required
              className={inp}
              placeholder="https://meet.google.com/... or https://zoom.us/j/..."
              value={zoomLink}
              onChange={(e) => setZoomLink(e.target.value)}
              autoComplete="off"
            />
          </label>

          <label className="block text-sm">
            <span className={lab}>Host account (internal reference)</span>
            <input
              type="text"
              required
              className={inp}
              placeholder="e.g. be10x@gmail.com or Be10x Main"
              value={zoomAccount}
              onChange={(e) => setZoomAccount(e.target.value)}
              autoComplete="off"
            />
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="rounded-xl border border-border-subtle bg-elevated px-4 py-2 text-sm font-medium text-foreground transition-all hover:bg-background/80"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background transition-all hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Confirm & Schedule"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

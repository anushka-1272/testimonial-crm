"use client";

import { format, parseISO } from "date-fns";
import { useEffect, useState } from "react";

import type { SupabaseClient } from "@supabase/supabase-js";

import { logActivity } from "@/lib/activity-logger";
import { getUserSafe } from "@/lib/supabase-auth";
import { slackEmailForTeamMember } from "@/lib/slack-contacts";
import { voidSlackNotify } from "@/lib/slack-client";
import { sendWatiNotification } from "@/lib/wati-client";

import type { InterviewWithCandidate } from "./types";

function actorLabel(
  user: {
    user_metadata?: { name?: string };
    email?: string;
  } | null,
): string {
  if (!user) return "User";
  const n = user.user_metadata?.name;
  if (typeof n === "string" && n.trim()) return n.trim();
  if (user.email) return user.email;
  return "User";
}

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
  interview: InterviewWithCandidate | null;
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

  const candName =
    interview.candidates?.full_name?.trim() ||
    interview.candidates?.email ||
    "Candidate";
  const subtitle = `${candName} · ${formatSlot(interview.scheduled_date)}`;

  const inp =
    "mt-1 w-full rounded-xl border border-[#e5e5e5] px-3 py-2.5 text-sm text-[#1d1d1f] focus:border-[#3b82f6] focus:outline-none focus:ring-0";
  const lab = "text-xs font-medium uppercase tracking-widest text-[#aeaeb2]";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const link = zoomLink.trim();
    const account = zoomAccount.trim();
    if (!link) {
      setError("Zoom link is required.");
      return;
    }
    if (!link.startsWith("https://")) {
      setError("Zoom link must start with https://");
      return;
    }
    if (!account) {
      setError("Zoom account is required.");
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
      const { error: upErr } = await supabase
        .from("interviews")
        .update({
          zoom_link: link,
          zoom_account: account,
          interview_status: "scheduled",
        })
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
          description: `Zoom details added for ${candName} by ${actorLabel(authUser)}`,
          metadata: {},
        });
      }

      const formattedDateTime = interview.scheduled_date
        ? format(parseISO(interview.scheduled_date), "dd MMM yyyy, h:mm a")
        : "";
      const interviewerSlackEmail = slackEmailForTeamMember(
        interview.interviewer,
      );
      if (interviewerSlackEmail) {
        const slackMsg =
          `📅 New interview scheduled!\n` +
          `*Candidate:* ${candName}\n` +
          `*Date & Time:* ${formattedDateTime || "—"}\n` +
          `*Zoom Link:* ${link}\n` +
          `*Zoom Account:* ${account}`;
        voidSlackNotify(supabase, interviewerSlackEmail, slackMsg);
      }
      const waPhone = interview.candidates?.whatsapp_number?.trim();
      const watiName =
        interview.candidates?.full_name?.trim() ||
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

      const toEmail = interview.candidates?.email;
      const toName = interview.candidates?.full_name;
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
              .from("interviews")
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-[#1d1d1f]/25 backdrop-blur-sm"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#f0f0f0] bg-white p-6 shadow-[0_4px_16px_rgba(0,0,0,0.08)]">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[#1d1d1f]">
              Add Zoom Details
            </h2>
            <p className="text-sm text-[#6e6e73]">{subtitle}</p>
          </div>
          <button
            type="button"
            className="rounded-xl p-2 text-[#aeaeb2] transition-all hover:bg-[#f5f5f7] hover:text-[#1d1d1f]"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 text-sm">
          {error && (
            <p className="rounded-xl border border-[#f0f0f0] bg-[#f5f5f7] px-3 py-2 text-sm text-[#1d1d1f]">
              {error}
            </p>
          )}

          <label className="block text-sm">
            <span className={lab}>Zoom link</span>
            <input
              type="url"
              required
              className={inp}
              placeholder="https://zoom.us/j/..."
              value={zoomLink}
              onChange={(e) => setZoomLink(e.target.value)}
              autoComplete="off"
            />
          </label>

          <label className="block text-sm">
            <span className={lab}>Zoom account (internal reference)</span>
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
              className="rounded-xl border border-[#f0f0f0] bg-white px-4 py-2 text-sm font-medium text-[#1d1d1f] transition-all hover:bg-[#fafafa]"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-xl bg-[#1d1d1f] px-4 py-2 text-sm font-medium text-white transition-all hover:bg-[#2d2d2f] disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Confirm & Schedule"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

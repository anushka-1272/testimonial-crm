"use client";

import { format, parseISO } from "date-fns";
import { useEffect, useState } from "react";

import type { SupabaseClient } from "@supabase/supabase-js";

import { logActivity } from "@/lib/activity-logger";
import { modalOverlayClass, modalPanelClass } from "@/lib/modal-responsive";
import { getUserSafe } from "@/lib/supabase-auth";
import { sendWatiNotification } from "@/lib/wati-client";
import {
  noShowInterviewParamAttempts,
  WATI_TEMPLATES,
} from "@/lib/wati-templates";

import {
  type InterviewWithCandidate,
  type ProjectInterviewWithProjectCandidate,
  isProjectInterviewRow,
} from "./types";

type Props = {
  open: boolean;
  interview: InterviewWithCandidate | ProjectInterviewWithProjectCandidate | null;
  supabase: SupabaseClient;
  onClose: () => void;
  onSaved: () => void;
  onToast?: (message: string) => void;
};

function whatsappFromNested(
  value:
    | { whatsapp_number?: string | null }
    | { whatsapp_number?: string | null }[]
    | null
    | undefined,
): string | null {
  if (!value) return null;
  const row = Array.isArray(value) ? value[0] : value;
  const phone = row?.whatsapp_number?.trim();
  return phone || null;
}

function displayName(
  interview: InterviewWithCandidate | ProjectInterviewWithProjectCandidate,
): string {
  if (isProjectInterviewRow(interview)) {
    const pc = interview.project_candidates;
    return (
      pc?.full_name?.trim() ||
      pc?.project_title?.trim() ||
      pc?.email ||
      "Candidate"
    );
  }
  const c = interview.candidates;
  return c?.full_name?.trim() || c?.email || "Candidate";
}

function scheduledLabel(
  interview: InterviewWithCandidate | ProjectInterviewWithProjectCandidate,
): string | null {
  if (!interview.scheduled_date) return null;
  const d = parseISO(interview.scheduled_date);
  return `${format(d, "MMM d, yyyy")} at ${format(d, "h:mm a")}`;
}

export function MarkNoShowModal({
  open,
  interview,
  supabase,
  onClose,
  onSaved,
  onToast,
}: Props) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason("");
      setError(null);
    }
  }, [open, interview?.id]);

  if (!open || !interview) return null;

  const isProject = isProjectInterviewRow(interview);
  const label = displayName(interview);
  const slot = scheduledLabel(interview);
  const subtitle = isProject
    ? `${interview.project_candidates?.project_title?.trim() || "Project"} · ${interview.project_candidates?.email ?? ""}`
    : `${interview.candidates?.full_name ?? "Candidate"} · ${interview.candidates?.email ?? ""}`;

  const inp =
    "mt-1 w-full resize-none rounded-xl border border-border px-3 py-2.5 text-sm text-foreground focus:border-[#3b82f6] focus:outline-none focus:ring-0";
  const lab = "text-xs font-medium uppercase tracking-widest text-muted/80";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = reason.trim();
    setSubmitting(true);
    setError(null);
    const table = isProject ? "project_interviews" : "interviews";
    const now = new Date().toISOString();
    const { error: upErr } = await supabase
      .from(table)
      .update({
        interview_status: "no_show",
        no_show_reason: trimmed || null,
        no_show_at: now,
      })
      .eq("id", interview.id);

    if (upErr) {
      setError(upErr.message);
      setSubmitting(false);
      return;
    }

    const actor = await getUserSafe(supabase);
    if (actor) {
      await logActivity({
        supabase,
        user: actor,
        action_type: "interviews",
        entity_type: isProject ? "project_interview" : "interview",
        entity_id: interview.id,
        candidate_name: label,
        description: trimmed
          ? `Marked no show for ${label} — ${trimmed}`
          : `Marked no show for ${label}`,
      });
    }

    let waPhone = isProject
      ? whatsappFromNested(interview.project_candidates)
      : whatsappFromNested(interview.candidates);

    if (!waPhone) {
      if (isProject) {
        const projectCandidateId = interview.project_candidate_id;
        if (projectCandidateId) {
          const { data } = await supabase
            .from("project_candidates")
            .select("whatsapp_number")
            .eq("id", projectCandidateId)
            .maybeSingle();
          waPhone = data?.whatsapp_number?.trim() || null;
        }
      } else {
        const { data } = await supabase
          .from("candidates")
          .select("whatsapp_number")
          .eq("id", interview.candidate_id)
          .maybeSingle();
        waPhone = data?.whatsapp_number?.trim() || null;
      }
    }

    if (!waPhone) {
      onToast?.(
        "Marked no show, but WhatsApp was not sent — no phone number on this candidate.",
      );
    } else {
      const slotLabel = slot ?? "your scheduled interview";
      let sent = false;
      for (const params of noShowInterviewParamAttempts(label, slotLabel)) {
        sent = await sendWatiNotification(
          supabase,
          waPhone,
          WATI_TEMPLATES.interviewNoShow,
          params,
        );
        if (sent) break;
      }
      if (!sent) {
        console.error("WATI Interview_no_show failed");
        onToast?.(
          "Marked no show, but the WhatsApp no-show message failed to send.",
        );
      }
    }

    setSubmitting(false);
    onSaved();
    onClose();
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
        role="dialog"
        aria-modal="true"
        aria-labelledby="no-show-title"
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 id="no-show-title" className="text-lg font-semibold text-foreground">
              Mark as no show
            </h2>
            <p className="text-sm text-muted">{subtitle}</p>
          </div>
          <button
            type="button"
            className="rounded-xl p-2 text-muted/80 transition-all hover:bg-background hover:text-foreground"
            aria-label="Close dialog"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <p className="text-sm text-muted">
          {slot
            ? `${label} did not attend the interview scheduled for ${slot}. They will move to the No show list for follow-up.`
            : `${label} did not attend the scheduled interview. They will move to the No show list for follow-up.`}
        </p>

        <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 space-y-4 text-sm">
          {error ? (
            <p className="rounded-xl border border-border-subtle bg-background px-3 py-2 text-sm text-foreground">
              {error}
            </p>
          ) : null}

          <label className="block text-sm">
            <span className={lab}>
              Reason <span className="font-normal normal-case text-muted">(optional)</span>
            </span>
            <textarea
              rows={3}
              className={inp}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Did not join meeting, no response on WhatsApp"
            />
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="rounded-xl border border-border-subtle bg-elevated px-4 py-2 text-sm font-medium text-foreground transition-all hover:bg-background/80"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-xl bg-[#dc2626] px-4 py-2 text-sm font-medium text-white transition-all hover:bg-[#b91c1c] disabled:opacity-50"
              disabled={submitting}
            >
              {submitting ? "Saving…" : "Confirm no show"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

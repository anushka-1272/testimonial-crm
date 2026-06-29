"use client";

import { useEffect, useState } from "react";

import type { SupabaseClient } from "@supabase/supabase-js";

import { logActivity } from "@/lib/activity-logger";
import { modalOverlayClass, modalPanelClass } from "@/lib/modal-responsive";
import { getUserSafe } from "@/lib/supabase-auth";

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
};

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

export function MarkNoShowModal({
  open,
  interview,
  supabase,
  onClose,
  onSaved,
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

    setSubmitting(false);
    onSaved();
    onClose();
  };

  return (
    <div className={modalOverlayClass}>
      <div className={modalPanelClass} role="dialog" aria-labelledby="no-show-title">
        <h2 id="no-show-title" className="text-lg font-semibold text-foreground">
          Mark as no show
        </h2>
        <p className="mt-1 text-sm text-muted">
          {label} did not attend the scheduled interview. They will move to the
          No show list for follow-up.
        </p>
        <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 space-y-4">
          <label className="block text-sm">
            <span className="text-xs font-medium uppercase tracking-widest text-muted/80">
              Reason <span className="font-normal normal-case text-muted">(optional)</span>
            </span>
            <textarea
              className="mt-1 w-full resize-y rounded-xl border border-border px-3 py-2.5 text-sm text-foreground focus:border-[#3b82f6] focus:outline-none"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Did not join Zoom, no response on WhatsApp"
            />
          </label>
          {error ? (
            <p className="text-sm text-[#dc2626]">{error}</p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-muted hover:bg-background"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-xl bg-[#dc2626] px-4 py-2 text-sm font-medium text-white hover:bg-[#b91c1c] disabled:opacity-50"
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

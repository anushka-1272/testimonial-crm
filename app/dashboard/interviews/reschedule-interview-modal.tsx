"use client";

import { format, parseISO } from "date-fns";
import { useEffect, useState } from "react";

import type { SupabaseClient } from "@supabase/supabase-js";

import { modalOverlayClass, modalPanelClass } from "@/lib/modal-responsive";

import {
  handleReschedule,
  rescheduleKindFromInterview,
} from "./interview-reschedule-workflow";
import type {
  InterviewWithCandidate,
  ProjectInterviewWithProjectCandidate,
} from "./types";
import { isProjectInterviewRow } from "./types";

type AnyInterview = InterviewWithCandidate | ProjectInterviewWithProjectCandidate;

type Props = {
  open: boolean;
  interview: AnyInterview | null;
  mode: "from_scheduled" | "from_rescheduled";
  supabase: SupabaseClient;
  onClose: () => void;
  onSaved: () => void;
};

export function RescheduleInterviewModal({
  open,
  interview,
  mode,
  supabase,
  onClose,
  onSaved,
}: Props) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !interview?.scheduled_date) return;
    const d = parseISO(interview.scheduled_date);
    setDate(format(d, "yyyy-MM-dd"));
    setTime(format(d, "HH:mm"));
    setReason(
      mode === "from_rescheduled" ? (interview.reschedule_reason ?? "") : "",
    );
    setError(null);
  }, [open, interview?.id, interview?.scheduled_date, mode]);

  if (!open || !interview) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!date || !time) {
      setError("Date and time are required.");
      return;
    }
    if (!reason.trim()) {
      setError("Reschedule reason is required.");
      return;
    }

    const localIso = new Date(`${date}T${time}`).toISOString();
    setSubmitting(true);

    const reasonText = reason.trim();
    const type = rescheduleKindFromInterview(interview);

    try {
      const result = await handleReschedule(supabase, interview, type, {
        scheduledDateIso: localIso,
        reasonText,
      });
      if (!result.ok) {
        setError(result.error);
        setSubmitting(false);
        return;
      }

      setDate("");
      setTime("");
      setReason("");
      onSaved();
      onClose();
    } catch {
      setError("Something went wrong.");
    }
    setSubmitting(false);
  };

  const inp =
    "mt-1 w-full rounded-xl border border-border px-3 py-2.5 text-sm text-foreground focus:border-[#3b82f6] focus:outline-none focus:ring-0";
  const lab = "text-xs font-medium uppercase tracking-widest text-muted/80";
  const title = mode === "from_scheduled" ? "Reschedule interview" : "Schedule again";

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
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
            <p className="text-sm text-muted">
              {isProjectInterviewRow(interview)
                ? `${interview.project_candidates?.project_title?.trim() || "Project"} · ${interview.project_candidates?.email ?? ""}`
                : `${interview.candidates?.full_name ?? "Candidate"} · ${interview.candidates?.email}`}
            </p>
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

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className={lab}>New date</span>
              <input
                required
                type="date"
                className={inp}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className={lab}>New time</span>
              <input
                required
                type="time"
                className={inp}
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </label>
          </div>

          <label className="block text-sm">
            <span className={lab}>
              Reschedule reason
            </span>
            <textarea
              rows={3}
              className={inp}
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this being moved?"
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
              className={
                mode === "from_scheduled"
                  ? "rounded-xl bg-[#ea580c] px-4 py-2 text-sm font-medium text-white transition-all hover:bg-[#c2410c] disabled:opacity-50"
                  : "rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background transition-all hover:opacity-90 disabled:opacity-50"
              }
            >
              {submitting ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

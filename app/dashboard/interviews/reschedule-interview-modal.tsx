"use client";

import { format, parseISO } from "date-fns";
import { useEffect, useState } from "react";

import type { SupabaseClient } from "@supabase/supabase-js";

import { logActivity } from "@/lib/activity-logger";

import type {
  InterviewWithCandidate,
  ProjectInterviewWithProjectCandidate,
} from "./types";

const INTERVIEWERS = ["Harika", "Gargi", "Mudit", "Anushka"] as const;

type AnyInterview = InterviewWithCandidate | ProjectInterviewWithProjectCandidate;

function isProjectIv(
  i: AnyInterview | null,
): i is ProjectInterviewWithProjectCandidate {
  return i != null && "project_candidate_id" in i && Boolean(i.project_candidate_id);
}

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
  const [interviewer, setInterviewer] =
    useState<(typeof INTERVIEWERS)[number]>("Harika");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !interview?.scheduled_date) return;
    const d = parseISO(interview.scheduled_date);
    setDate(format(d, "yyyy-MM-dd"));
    setTime(format(d, "HH:mm"));
    const iv = interview.interviewer as (typeof INTERVIEWERS)[number];
    setInterviewer(INTERVIEWERS.includes(iv) ? iv : "Harika");
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
    if (mode === "from_scheduled" && !reason.trim()) {
      setError("Reschedule reason is required.");
      return;
    }

    const localIso = new Date(`${date}T${time}`).toISOString();
    setSubmitting(true);

    const table = isProjectIv(interview) ? "project_interviews" : "interviews";

    try {
      if (mode === "from_scheduled") {
        const { error: upErr } = await supabase
          .from(table)
          .update({
            previous_scheduled_date: interview.scheduled_date,
            reschedule_reason: reason.trim(),
            scheduled_date: localIso,
            interviewer,
            interview_status: "rescheduled",
          })
          .eq("id", interview.id);
        if (upErr) {
          setError(upErr.message);
          setSubmitting(false);
          return;
        }
        const candDisplay = isProjectIv(interview)
          ? interview.project_candidates?.project_title?.trim() ||
            interview.project_candidates?.email ||
            "Candidate"
          : interview.candidates?.full_name?.trim() ||
            interview.candidates?.email ||
            "Candidate";
        const reasonText = reason.trim();
        const { data: authRe } = await supabase.auth.getUser();
        if (authRe.user) {
          await logActivity({
            supabase,
            user: authRe.user,
            action_type: "interviews",
            entity_type: "interview",
            entity_id: interview.id,
            candidate_name: candDisplay,
            description: `Rescheduled interview for ${candDisplay} — Reason: ${reasonText || "—"}`,
          });
        }
      } else {
        const patch: Record<string, unknown> = {
          scheduled_date: localIso,
          interviewer,
        };
        if (reason.trim()) patch.reschedule_reason = reason.trim();
        const { error: upErr } = await supabase
          .from(table)
          .update(patch)
          .eq("id", interview.id);
        if (upErr) {
          setError(upErr.message);
          setSubmitting(false);
          return;
        }
        const candDisplay = isProjectIv(interview)
          ? interview.project_candidates?.project_title?.trim() ||
            interview.project_candidates?.email ||
            "Candidate"
          : interview.candidates?.full_name?.trim() ||
            interview.candidates?.email ||
            "Candidate";
        const reasonText =
          reason.trim() || interview.reschedule_reason?.trim() || "—";
        const { data: authRe2 } = await supabase.auth.getUser();
        if (authRe2.user) {
          await logActivity({
            supabase,
            user: authRe2.user,
            action_type: "interviews",
            entity_type: "interview",
            entity_id: interview.id,
            candidate_name: candDisplay,
            description: `Rescheduled interview for ${candDisplay} — Reason: ${reasonText}`,
          });
        }
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
    "mt-1 w-full rounded-xl border border-[#e5e5e5] px-3 py-2.5 text-sm text-[#1d1d1f] focus:border-[#3b82f6] focus:outline-none focus:ring-0";
  const lab = "text-xs font-medium uppercase tracking-widest text-[#aeaeb2]";
  const title =
    mode === "from_scheduled" ? "Reschedule interview" : "Schedule again";

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
            <h2 className="text-lg font-semibold text-[#1d1d1f]">{title}</h2>
            <p className="text-sm text-[#6e6e73]">
              {isProjectIv(interview)
                ? `${interview.project_candidates?.project_title?.trim() || "Project"} · ${interview.project_candidates?.email ?? ""}`
                : `${interview.candidates?.full_name ?? "Candidate"} · ${interview.candidates?.email}`}
            </p>
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
            <span className={lab}>Interviewer</span>
            <select
              className={inp}
              value={interviewer}
              onChange={(e) =>
                setInterviewer(e.target.value as (typeof INTERVIEWERS)[number])
              }
            >
              {INTERVIEWERS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className={lab}>
              {mode === "from_scheduled"
                ? "Reschedule reason"
                : "Reason / note (optional)"}
            </span>
            <textarea
              rows={3}
              className={inp}
              required={mode === "from_scheduled"}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                mode === "from_scheduled"
                  ? "Why is this being moved?"
                  : "Update reason if needed"
              }
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
              className={
                mode === "from_scheduled"
                  ? "rounded-xl bg-[#ea580c] px-4 py-2 text-sm font-medium text-white transition-all hover:bg-[#c2410c] disabled:opacity-50"
                  : "rounded-xl bg-[#1d1d1f] px-4 py-2 text-sm font-medium text-white transition-all hover:bg-[#2d2d2f] disabled:opacity-50"
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

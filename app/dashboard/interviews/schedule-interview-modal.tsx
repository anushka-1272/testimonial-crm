"use client";

import { format } from "date-fns";
import { useState } from "react";

import type { SupabaseClient } from "@supabase/supabase-js";

export type ScheduleCandidate = {
  id: string;
  full_name: string | null;
  email: string;
};

const INTERVIEWERS = ["Harika", "Gargi", "Mudit", "Anushka"] as const;

type Props = {
  open: boolean;
  candidate: ScheduleCandidate | null;
  supabase: SupabaseClient;
  onClose: () => void;
  onCreated: () => void;
};

export function ScheduleInterviewModal({
  open,
  candidate,
  supabase,
  onClose,
  onCreated,
}: Props) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [interviewer, setInterviewer] =
    useState<(typeof INTERVIEWERS)[number]>("Harika");
  const [interviewType, setInterviewType] = useState<"testimonial" | "project">(
    "testimonial",
  );
  const [language, setLanguage] = useState("English");
  const [zoomLink, setZoomLink] = useState("");
  const [poc, setPoc] = useState("");
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open || !candidate) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!date || !time) {
      setError("Date and time are required.");
      return;
    }
    const localIso = new Date(`${date}T${time}`).toISOString();
    const dateLabel = format(new Date(`${date}T${time}`), "MMMM d, yyyy");
    const timeLabel = format(new Date(`${date}T${time}`), "h:mm a");

    setSubmitting(true);
    try {
      const { data: row, error: insErr } = await supabase
        .from("interviews")
        .insert({
          candidate_id: candidate.id,
          scheduled_date: localIso,
          interviewer,
          zoom_link: zoomLink.trim() || null,
          language: language.trim() || null,
          poc: poc.trim() || null,
          remarks: remarks.trim() || null,
          interview_type: interviewType,
          interview_status: "scheduled",
          invitation_sent: false,
        })
        .select("id")
        .single();

      if (insErr) {
        setError(insErr.message);
        setSubmitting(false);
        return;
      }

      const emailRes = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "interview_confirmation",
          to: candidate.email,
          name: candidate.full_name,
          date: dateLabel,
          time: timeLabel,
          zoom_link: zoomLink.trim() || "TBD",
        }),
      });

      if (!emailRes.ok) {
        const j = (await emailRes.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(j.error ?? "Interview saved but confirmation email failed.");
        setSubmitting(false);
        onCreated();
        onClose();
        return;
      }

      await supabase
        .from("interviews")
        .update({ invitation_sent: true })
        .eq("id", row.id);

      setDate("");
      setTime("");
      setZoomLink("");
      setPoc("");
      setRemarks("");
      onCreated();
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
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Schedule interview
            </h2>
            <p className="text-sm text-slate-500">
              {candidate.full_name ?? "Candidate"} · {candidate.email}
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Date</span>
              <input
                required
                type="date"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Time</span>
              <input
                required
                type="time"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </label>
          </div>

          <label className="block text-sm">
            <span className="font-medium text-slate-700">Interviewer</span>
            <select
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
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
            <span className="font-medium text-slate-700">Interview type</span>
            <select
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
              value={interviewType}
              onChange={(e) =>
                setInterviewType(e.target.value as "testimonial" | "project")
              }
            >
              <option value="testimonial">Testimonial</option>
              <option value="project">Project</option>
            </select>
          </label>

          <label className="block text-sm">
            <span className="font-medium text-slate-700">Language</span>
            <input
              type="text"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            />
          </label>

          <label className="block text-sm">
            <span className="font-medium text-slate-700">Zoom link</span>
            <input
              type="url"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
              placeholder="https://..."
              value={zoomLink}
              onChange={(e) => setZoomLink(e.target.value)}
            />
          </label>

          <label className="block text-sm">
            <span className="font-medium text-slate-700">POC</span>
            <input
              type="text"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
              value={poc}
              onChange={(e) => setPoc(e.target.value)}
            />
          </label>

          <label className="block text-sm">
            <span className="font-medium text-slate-700">Remarks</span>
            <textarea
              rows={2}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Create & send confirmation"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

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

  const inp =
    "mt-1 w-full rounded-xl border border-[#e5e5e5] px-3 py-2.5 text-sm text-[#1d1d1f] focus:border-[#3b82f6] focus:outline-none focus:ring-0";
  const lab = "text-xs font-medium uppercase tracking-widest text-[#aeaeb2]";

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
              Schedule interview
            </h2>
            <p className="text-sm text-[#6e6e73]">
              {candidate.full_name ?? "Candidate"} · {candidate.email}
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
              <span className={lab}>Date</span>
              <input
                required
                type="date"
                className={inp}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className={lab}>Time</span>
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
            <span className={lab}>Interview type</span>
            <select
              className={inp}
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
            <span className={lab}>Language</span>
            <input
              type="text"
              className={inp}
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            />
          </label>

          <label className="block text-sm">
            <span className={lab}>Zoom link</span>
            <input
              type="url"
              className={inp}
              placeholder="https://..."
              value={zoomLink}
              onChange={(e) => setZoomLink(e.target.value)}
            />
          </label>

          <label className="block text-sm">
            <span className={lab}>POC</span>
            <input
              type="text"
              className={inp}
              value={poc}
              onChange={(e) => setPoc(e.target.value)}
            />
          </label>

          <label className="block text-sm">
            <span className={lab}>Remarks</span>
            <textarea
              rows={2}
              className={inp}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
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
              {submitting ? "Saving…" : "Create & send confirmation"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

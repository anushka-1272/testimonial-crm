"use client";

import { format, parseISO } from "date-fns";
import { useEffect, useState } from "react";

import type { SupabaseClient } from "@supabase/supabase-js";

import { logActivity } from "@/lib/activity-logger";
import { getUserSafe } from "@/lib/supabase-auth";
import { slackEmailForTeamMember } from "@/lib/slack-contacts";
import { voidSlackNotify } from "@/lib/slack-client";
import {
  fetchTeamRosterNames,
  mergeRosterWithCurrent,
} from "@/lib/team-roster";

import type { InterviewWithCandidate } from "./types";

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
};

export function AssignInterviewerModal({
  open,
  interview,
  supabase,
  onClose,
  onSaved,
}: Props) {
  const [interviewerOptions, setInterviewerOptions] = useState<string[]>([]);
  const [interviewer, setInterviewer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    let active = true;
    void (async () => {
      const names = await fetchTeamRosterNames(supabase, "interviewer", true);
      const current = interview?.interviewer?.trim() || null;
      const options = mergeRosterWithCurrent(names, current);
      if (!active) return;
      setInterviewerOptions(options);
      setInterviewer(current || options[0] || "");
    })();
    return () => {
      active = false;
    };
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

  const pocName =
    interview.poc?.trim() ||
    interview.candidates?.poc_assigned?.trim() ||
    "—";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!interviewer.trim()) {
      setError("Please select an interviewer.");
      return;
    }
    setSubmitting(true);
    try {
      const assignedAt = new Date().toISOString();
      const { error: upErr } = await supabase
        .from("interviews")
        .update({
          interviewer,
          interviewer_assigned_at: assignedAt,
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
          description: `Assigned ${interviewer} to interview ${candName}`,
          metadata: {},
        });
      }

      const formattedDateTime = interview.scheduled_date
        ? format(parseISO(interview.scheduled_date), "dd MMM yyyy, h:mm a")
        : "—";
      const slackEmail = await slackEmailForTeamMember(supabase, interviewer);
      if (slackEmail) {
        const slackMsg =
          `📅 You have been assigned to interview *${candName}*\n` +
          `Date & Time: ${formattedDateTime}\n` +
          `POC: ${pocName}\n` +
          `Please be ready. Zoom details will be shared soon.`;
        voidSlackNotify(supabase, slackEmail, slackMsg);
      }

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
              Assign Interviewer
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
            <span className={lab}>Interviewer</span>
            <select
              className={inp}
              value={interviewer}
              onChange={(e) => setInterviewer(e.target.value)}
            >
              {interviewerOptions.length === 0 ? (
                <option value="">No active interviewers</option>
              ) : (
                interviewerOptions.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))
              )}
            </select>
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
              {submitting ? "Saving…" : "Assign"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

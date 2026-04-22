"use client";

import { format, parseISO } from "date-fns";
import { useEffect, useState } from "react";

import type { SupabaseClient } from "@supabase/supabase-js";

import { logActivity } from "@/lib/activity-logger";
import {
  effectiveInterviewLanguage,
  interviewLanguageDisplayString,
  interviewLanguageFilterBucket,
  interviewLanguageForSubmit,
  type InterviewLangPreset,
} from "@/lib/interview-language";
import { modalOverlayClass, modalPanelClass } from "@/lib/modal-responsive";
import { getUserSafe } from "@/lib/supabase-auth";
import { slackEmailForTeamMember } from "@/lib/slack-contacts";
import { voidSlackNotify } from "@/lib/slack-client";
import {
  fetchTeamRosterNames,
  mergeRosterWithCurrent,
} from "@/lib/team-roster";

import {
  isProjectInterviewRow,
  type InterviewWithCandidate,
  type ProjectInterviewWithProjectCandidate,
} from "./types";

const LANG_CARD_ORDER: { key: InterviewLangPreset | "other"; label: string }[] =
  [
    { key: "english", label: "English" },
    { key: "hindi", label: "Hindi" },
    { key: "kannada", label: "Kannada" },
    { key: "telugu", label: "Telugu" },
    { key: "marathi", label: "Marathi" },
    { key: "bengali", label: "Bengali" },
    { key: "other", label: "Other" },
  ];

type LangCardKey = (typeof LANG_CARD_ORDER)[number]["key"];

export type EditableInterviewDetails =
  | InterviewWithCandidate
  | ProjectInterviewWithProjectCandidate;

function scheduledToParts(iso: string | null | undefined): {
  date: string;
  time: string;
} {
  if (!iso) return { date: "", time: "" };
  try {
    const d = parseISO(iso);
    return { date: format(d, "yyyy-MM-dd"), time: format(d, "HH:mm") };
  } catch {
    return { date: "", time: "" };
  }
}

function activityCandidateName(interview: EditableInterviewDetails): string {
  if (isProjectInterviewRow(interview)) {
    const pc = interview.project_candidates;
    if (!pc) return "Candidate";
    const fn = pc.full_name?.trim();
    if (fn) return fn;
    const title = pc.project_title?.trim();
    if (title) return title;
    const e = pc.email?.trim();
    if (e) return e;
    return "Candidate";
  }
  return (
    interview.candidates?.full_name?.trim() ||
    interview.candidates?.email ||
    "Candidate"
  );
}

function slackCandidateLabel(interview: EditableInterviewDetails): string {
  if (isProjectInterviewRow(interview)) {
    return (
      interview.project_candidates?.project_title?.trim() ||
      interview.project_candidates?.email ||
      "Candidate"
    );
  }
  return (
    interview.candidates?.full_name?.trim() ||
    interview.candidates?.email ||
    "Candidate"
  );
}

type Props = {
  open: boolean;
  interview: EditableInterviewDetails | null;
  supabase: SupabaseClient;
  onClose: () => void;
  onSaved: () => void;
  /** Shown after a successful save (e.g. testimonial / project interviews board toast). */
  onToast?: (message: string) => void;
};

const SAVE_SUCCESS_TOAST = "Interview details saved.";

export function EditInterviewDetailsModal({
  open,
  interview,
  supabase,
  onClose,
  onSaved,
  onToast,
}: Props) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [interviewerOptions, setInterviewerOptions] = useState<string[]>([]);
  const [interviewer, setInterviewer] = useState("");
  const [pocOptions, setPocOptions] = useState<string[]>([]);
  const [poc, setPoc] = useState("");
  const [remarks, setRemarks] = useState("");
  const [langPreset, setLangPreset] = useState<LangCardKey>("english");
  const [otherLanguageText, setOtherLanguageText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !interview) return;
    setError(null);
    const { date: d, time: t } = scheduledToParts(interview.scheduled_date);
    setDate(d);
    setTime(t);

    const eff = effectiveInterviewLanguage(interview);
    const bucket = interviewLanguageFilterBucket(eff);
    if (bucket === "other") {
      setLangPreset("other");
      setOtherLanguageText(eff);
    } else {
      setLangPreset(bucket as InterviewLangPreset);
      setOtherLanguageText("");
    }

    const initialPoc =
      interview.poc?.trim() ||
      (isProjectInterviewRow(interview)
        ? interview.project_candidates?.poc_assigned?.trim()
        : interview.candidates?.poc_assigned?.trim()) ||
      "";
    setPoc(initialPoc);
    setRemarks(interview.remarks?.trim() ?? "");

    let active = true;
    void (async () => {
      const [ivNames, pocNames] = await Promise.all([
        fetchTeamRosterNames(supabase, "interviewer", true),
        fetchTeamRosterNames(supabase, "poc", true),
      ]);
      const currentIv = interview.interviewer?.trim() || null;
      const ivOpts = mergeRosterWithCurrent(ivNames, currentIv);
      const pocOpts = mergeRosterWithCurrent(pocNames, initialPoc || null);
      if (!active) return;
      setInterviewerOptions(ivOpts);
      setInterviewer(currentIv ?? "");
      setPocOptions(pocOpts);
    })();
    return () => {
      active = false;
    };
  }, [
    open,
    interview,
    supabase,
  ]);

  if (!open || !interview) return null;

  const isProject = isProjectInterviewRow(interview);
  const candName = activityCandidateName(interview);
  const slackCand = slackCandidateLabel(interview);

  const pocName =
    interview.poc?.trim() ||
    (isProject
      ? interview.project_candidates?.poc_assigned?.trim()
      : interview.candidates?.poc_assigned?.trim()) ||
    "—";

  const isScheduledStatus = interview.interview_status === "scheduled";

  const inp =
    "mt-1 w-full rounded-xl border border-[#e5e5e5] px-3 py-2.5 text-sm text-[#1d1d1f] focus:border-[#3b82f6] focus:outline-none focus:ring-0";
  const lab = "text-xs font-medium uppercase tracking-widest text-[#aeaeb2]";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!date || !time) {
      setError("Date and time are required.");
      return;
    }
    const langSubmit = interviewLanguageForSubmit(langPreset, otherLanguageText);
    if (!langSubmit.ok) {
      setError(langSubmit.error);
      return;
    }

    const nextIv = interviewer.trim();
    if (isScheduledStatus && !nextIv) {
      setError("Interviewer is required for scheduled interviews.");
      return;
    }

    const prevIv = (interview.interviewer ?? "").trim();
    const languageDisplay = interviewLanguageDisplayString(
      langPreset,
      otherLanguageText,
    );
    const localIso = new Date(`${date}T${time}`).toISOString();
    const nextPoc = poc.trim();
    const nextRemarks = remarks.trim();

    setSubmitting(true);
    try {
      const table = isProject ? "project_interviews" : "interviews";
      const patch: Record<string, string | null> = {
        scheduled_date: localIso,
        interviewer: nextIv || null,
        poc: nextPoc || null,
        remarks: nextRemarks || null,
      };

      if (!isProject) {
        patch.interview_language = langSubmit.value;
        patch.language = languageDisplay;
      } else {
        patch.language = languageDisplay;
      }

      if (nextIv !== prevIv) {
        patch.interviewer_assigned_at = nextIv
          ? new Date().toISOString()
          : null;
      }

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
          description: `Updated interview details for ${candName}`,
          metadata: {
            pipeline: isProject ? "project" : "testimonial",
            scheduled_date: localIso,
            interviewer: nextIv || null,
            interview_language: langSubmit.value,
            poc: nextPoc || null,
            remarks: nextRemarks || null,
          },
        });
      }

      if (nextIv !== prevIv && nextIv) {
        const formattedDateTime = format(
          parseISO(localIso),
          "dd MMM yyyy, h:mm a",
        );
        const slackEmail = await slackEmailForTeamMember(supabase, nextIv);
        if (slackEmail) {
          const pipelineNote = isProject ? " (project interview)" : "";
          const slackPocDisplay = nextPoc || pocName;
          const slackMsg =
            `📅 Interview details updated — you are assigned to interview *${slackCand}*${pipelineNote}\n` +
            `Date & Time: ${formattedDateTime}\n` +
            `POC: ${slackPocDisplay}\n` +
            `Please check the CRM for Zoom details.`;
          voidSlackNotify(supabase, slackEmail, slackMsg);
        }
      }

      onSaved();
      onClose();
      onToast?.(SAVE_SUCCESS_TOAST);
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
        className={`${modalPanelClass} p-6 shadow-[0_4px_16px_rgba(0,0,0,0.08)]`}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[#1d1d1f]">
              Edit Interview Details
            </h2>
            <p className="text-sm text-[#6e6e73]">{candName}</p>
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
          {error ? (
            <p className="rounded-xl border border-[#f0f0f0] bg-[#f5f5f7] px-3 py-2 text-sm text-[#1d1d1f]">
              {error}
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className={lab}>Date &amp; time · Date</span>
              <input
                required
                type="date"
                className={inp}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className={lab}>Date &amp; time · Time</span>
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
              onChange={(e) => setInterviewer(e.target.value)}
            >
              {!isScheduledStatus ? (
                <option value="">— Not assigned —</option>
              ) : null}
              {interviewerOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className={lab}>POC</span>
            <select
              className={inp}
              value={poc}
              onChange={(e) => setPoc(e.target.value)}
            >
              <option value="">— Not set —</option>
              {pocOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className={lab}>Remarks</span>
            <textarea
              className={`${inp} min-h-[88px] resize-y`}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={3}
              placeholder="Optional notes…"
            />
          </label>

          <div className="block text-sm">
            <span className={lab}>Interview language</span>
            <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {LANG_CARD_ORDER.map(({ key, label }) => {
                const selected = langPreset === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setLangPreset(key);
                      if (key !== "other") setOtherLanguageText("");
                    }}
                    className={`flex flex-col items-center justify-center rounded-xl border p-3 text-center transition-colors ${
                      selected
                        ? "border-black bg-black text-white"
                        : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
                    }`}
                  >
                    <span className="text-[11px] font-medium leading-tight">
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>
            {langPreset === "other" ? (
              <input
                type="text"
                className={inp}
                placeholder="Specify language..."
                value={otherLanguageText}
                onChange={(e) => setOtherLanguageText(e.target.value)}
                autoComplete="off"
              />
            ) : null}
          </div>

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              className="rounded-xl border border-[#f0f0f0] bg-white px-4 py-2.5 text-sm font-medium text-[#1d1d1f] transition-all hover:bg-[#fafafa]"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-xl bg-[#1d1d1f] px-4 py-2.5 text-sm font-medium text-white transition-all hover:bg-[#2d2d2f] disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

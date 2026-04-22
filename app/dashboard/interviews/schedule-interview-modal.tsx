"use client";

import { format } from "date-fns";
import { useEffect, useState } from "react";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildInterviewerSelectOptions,
  type InterviewerSelectOption,
} from "@/lib/interviewer-enum";
import { logActivity } from "@/lib/activity-logger";
import {
  interviewLanguageDisplayString,
  interviewLanguageForSubmit,
  type InterviewLangPreset,
} from "@/lib/interview-language";
import { getUserSafe } from "@/lib/supabase-auth";
import {
  POC_INTERVIEWER_SLACK_EMAILS,
  SLACK_DISHAN_EMAIL,
} from "@/lib/slack-contacts";
import { modalOverlayClass, modalPanelClass } from "@/lib/modal-responsive";
import { voidSlackNotify } from "@/lib/slack-client";
import { fetchTeamRosterNames } from "@/lib/team-roster";

export type ScheduleCandidate = {
  id: string;
  full_name: string | null;
  email: string;
  whatsapp_number?: string | null;
  interview_type?: "testimonial" | "project" | null;
  poc_assigned?: string | null;
};

export type ScheduleProjectCandidate = {
  id: string;
  email: string;
  whatsapp_number: string | null;
  project_title: string | null;
  poc_assigned: string | null;
};

const SLACK_ANUSHKA_EMAIL = POC_INTERVIEWER_SLACK_EMAILS.Anushka;

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

type Props = {
  open: boolean;
  candidate: ScheduleCandidate | null;
  projectCandidate: ScheduleProjectCandidate | null;
  supabase: SupabaseClient;
  onClose: () => void;
  onCreated: () => void;
};

export function ScheduleInterviewModal({
  open,
  candidate,
  projectCandidate,
  supabase,
  onClose,
  onCreated,
}: Props) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [interviewerOptions, setInterviewerOptions] = useState<
    InterviewerSelectOption[]
  >([]);
  const [interviewer, setInterviewer] = useState("");
  const [interviewType, setInterviewType] = useState<"testimonial" | "project">(
    "testimonial",
  );
  const [langPreset, setLangPreset] = useState<LangCardKey>("english");
  const [otherLanguageText, setOtherLanguageText] = useState("");
  const [zoomLink, setZoomLink] = useState("");
  const [poc, setPoc] = useState("");
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLangPreset("english");
    setOtherLanguageText("");
    if (projectCandidate) {
      setInterviewType("project");
      setPoc(projectCandidate.poc_assigned?.trim() ?? "");
      return;
    }
    if (!candidate) return;
    setPoc(candidate.poc_assigned?.trim() ?? "");
    const t = candidate.interview_type;
    if (t === "testimonial" || t === "project") {
      setInterviewType(t);
    } else {
      setInterviewType("testimonial");
    }
  }, [
    open,
    candidate?.id,
    candidate?.interview_type,
    candidate?.poc_assigned,
    projectCandidate?.id,
    projectCandidate?.poc_assigned,
  ]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void (async () => {
      const names = await fetchTeamRosterNames(supabase, "interviewer", true);
      if (!active) return;
      const options = buildInterviewerSelectOptions(names, null);
      setInterviewerOptions(options);
      setInterviewer((prev) =>
        prev && options.some((o) => o.value === prev)
          ? prev
          : (options[0]?.value ?? ""),
      );
    })();
    return () => {
      active = false;
    };
  }, [open, supabase]);

  if (!open || (!candidate && !projectCandidate)) return null;

  const isProject = !!projectCandidate;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!date || !time) {
      setError("Date and time are required.");
      return;
    }
    if (!isProject && interviewType === "project" && !interviewer.trim()) {
      setError("Interviewer is required.");
      return;
    }
    const langSubmit = interviewLanguageForSubmit(langPreset, otherLanguageText);
    if (!langSubmit.ok) {
      setError(langSubmit.error);
      return;
    }
    const languageDisplay = interviewLanguageDisplayString(
      langPreset,
      otherLanguageText,
    );
    const localIso = new Date(`${date}T${time}`).toISOString();
    const dateLabel = format(new Date(`${date}T${time}`), "MMMM d, yyyy");
    const timeLabel = format(new Date(`${date}T${time}`), "h:mm a");

    setSubmitting(true);
    try {
      const assignedNow = new Date().toISOString();
      const insertPayload = isProject
        ? {
            project_candidate_id: projectCandidate!.id,
            scheduled_date: localIso,
            interviewer: null,
            interviewer_assigned_at: null,
            zoom_link: null,
            language: languageDisplay,
            poc: poc.trim() || null,
            remarks: remarks.trim() || null,
            interview_type: "project" as const,
            interview_status: "draft" as const,
            invitation_sent: false,
          }
        : {
            candidate_id: candidate!.id,
            scheduled_date: localIso,
            interviewer:
              interviewType === "testimonial" ? null : interviewer,
            interviewer_assigned_at:
              interviewType === "testimonial" ? null : assignedNow,
            zoom_link: null,
            language: languageDisplay,
            interview_language: langSubmit.value,
            poc: poc.trim() || null,
            remarks: remarks.trim() || null,
            interview_type: interviewType,
            interview_status: "draft" as const,
            invitation_sent: false,
          };

      const table = isProject ? "project_interviews" : "interviews";
      const { data: row, error: insErr } = await supabase
        .from(table)
        .insert(insertPayload)
        .select("id")
        .single();

      if (insErr) {
        setError(insErr.message);
        setSubmitting(false);
        return;
      }

      const candDisplay = isProject
        ? projectCandidate!.project_title?.trim() ||
          projectCandidate!.email ||
          "Candidate"
        : candidate!.full_name?.trim() || candidate!.email || "Candidate";
      const typeWord =
        interviewType === "testimonial" ? "Testimonial" : "Project";
      const authUser = await getUserSafe(supabase);
      const actorName =
        authUser?.user_metadata &&
        typeof authUser.user_metadata.name === "string" &&
        authUser.user_metadata.name.trim()
          ? authUser.user_metadata.name.trim()
          : (authUser?.email ?? "POC");

      if (authUser) {
        if (isProject) {
          await logActivity({
            supabase,
            user: authUser,
            action_type: "interviews",
            entity_type: "interview",
            entity_id: row.id,
            candidate_name: candDisplay,
            description: `Drafted ${typeWord} interview for ${candDisplay} on ${dateLabel}`,
            metadata: { time: timeLabel, project: true },
          });
        } else {
          await logActivity({
            supabase,
            user: authUser,
            action_type: "interviews",
            entity_type: "interview",
            entity_id: row.id,
            candidate_name: candDisplay,
            description: `POC ${actorName} drafted interview for ${candDisplay} on ${dateLabel}`,
            metadata: { time: timeLabel, project: false },
          });
        }
      }

      if (!isProject) {
        const anushkaMsg =
          `👋 New interview draft needs an interviewer!\n` +
          `*Candidate:* ${candDisplay}\n` +
          `*Date & Time:* ${dateLabel} at ${timeLabel}\n` +
          `*POC:* ${actorName}\n` +
          `*Interview Type:* ${typeWord}\n` +
          `Please assign an interviewer in the CRM.`;
        voidSlackNotify(supabase, SLACK_ANUSHKA_EMAIL, anushkaMsg);

        const dishMsg =
          `🗓️ New interview draft created!\n` +
          `*Candidate:* ${candDisplay}\n` +
          `*Date & Time:* ${dateLabel} at ${timeLabel}\n` +
          `Please wait for Anushka to assign an interviewer before adding Zoom details.`;
        voidSlackNotify(supabase, SLACK_DISHAN_EMAIL, dishMsg);
        setDate("");
        setTime("");
        setPoc("");
        setRemarks("");
        setLangPreset("english");
        setOtherLanguageText("");
        onCreated();
        onClose();
        setSubmitting(false);
        return;
      }

      const anushkaProjectMsg =
        `👋 New *project* interview draft needs an interviewer!\n` +
        `*Project / candidate:* ${candDisplay}\n` +
        `*Date & Time:* ${dateLabel} at ${timeLabel}\n` +
        `*POC:* ${actorName}\n` +
        `Please assign an interviewer in the CRM (Project Interviews → Scheduled).`;
      voidSlackNotify(supabase, SLACK_ANUSHKA_EMAIL, anushkaProjectMsg);

      const dishProjectMsg =
        `🗓️ New project interview draft created!\n` +
        `*Project / candidate:* ${candDisplay}\n` +
        `*Date & Time:* ${dateLabel} at ${timeLabel}\n` +
        `Please wait for Anushka to assign an interviewer before adding Zoom details.`;
      voidSlackNotify(supabase, SLACK_DISHAN_EMAIL, dishProjectMsg);

      setDate("");
      setTime("");
      setPoc("");
      setRemarks("");
      setLangPreset("english");
      setOtherLanguageText("");
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
              Schedule interview
            </h2>
            <p className="text-sm text-[#6e6e73]">
              {isProject
                ? `${projectCandidate!.project_title?.trim() || "Project"} · ${projectCandidate!.email}`
                : `${candidate!.full_name ?? "Candidate"} · ${candidate!.email}`}
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

          {!isProject && interviewType === "project" ? (
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
                  interviewerOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))
                )}
              </select>
            </label>
          ) : null}

          {!isProject ? (
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
          ) : null}

          <div className="block text-sm">
            <span className={lab}>Interview language</span>
            <div className="mt-2 grid grid-cols-3 gap-2">
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

          <label className="block text-sm">
            <span className={lab}>POC (assigned)</span>
            <div className="mt-1 rounded-xl border border-[#e5e5e5] bg-[#f5f5f7] px-3 py-2.5 text-sm text-[#6e6e73]">
              {poc || "—"}
            </div>
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
              {submitting ? "Saving…" : "Save as Draft"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

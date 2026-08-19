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
} from "@/lib/slack-contacts";
import { modalOverlayClass, modalPanelClass } from "@/lib/modal-responsive";
import { voidSlackNotify } from "@/lib/slack-client";
import { fetchTeamRosterNames } from "@/lib/team-roster";
import {
  PLANNED_CONTENT_OPTIONS,
  type PlannedContentType,
} from "@/lib/planned-content-type";
import {
  isTestimonialInterviewType,
  TESTIMONIAL_INTERVIEW_TYPE_OPTIONS,
  testimonialInterviewTypeLabel,
  testimonialInterviewTypeRequiresInterviewer,
  type TestimonialInterviewType,
} from "@/lib/testimonial-interview-type";

export type ScheduleCandidate = {
  id: string;
  full_name: string | null;
  email: string;
  whatsapp_number?: string | null;
  interview_type?: TestimonialInterviewType | null;
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

const LANGUAGE_OPTIONS: { key: InterviewLangPreset | "other"; label: string }[] =
  [
    { key: "english", label: "English" },
    { key: "hindi", label: "Hindi" },
    { key: "kannada", label: "Kannada" },
    { key: "telugu", label: "Telugu" },
    { key: "marathi", label: "Marathi" },
    { key: "bengali", label: "Bengali" },
    { key: "other", label: "Other" },
  ];

type LangOptionKey = (typeof LANGUAGE_OPTIONS)[number]["key"];

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
  const [interviewType, setInterviewType] = useState<TestimonialInterviewType>(
    "testimonial",
  );
  const [langPreset, setLangPreset] = useState<LangOptionKey>("english");
  const [otherLanguageText, setOtherLanguageText] = useState("");
  const [plannedContentType, setPlannedContentType] =
    useState<PlannedContentType | null>(null);
  const [zoomLink, setZoomLink] = useState("");
  const [poc, setPoc] = useState("");
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLangPreset("english");
    setOtherLanguageText("");
    setPlannedContentType(null);
    if (projectCandidate) {
      setInterviewType("project");
      setPoc(projectCandidate.poc_assigned?.trim() ?? "");
      return;
    }
    if (!candidate) return;
    setPoc(candidate.poc_assigned?.trim() ?? "");
    const t = candidate.interview_type;
    if (isTestimonialInterviewType(t)) {
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
    if (
      !isProject &&
      testimonialInterviewTypeRequiresInterviewer(interviewType) &&
      !interviewer.trim()
    ) {
      setError("Interviewer is required.");
      return;
    }
    const langSubmit = interviewLanguageForSubmit(langPreset, otherLanguageText);
    if (!langSubmit.ok) {
      setError(langSubmit.error);
      return;
    }
    if (!plannedContentType) {
      setError("Select Blog post, LinkedIn Post, or Both.");
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
            planned_content_type: plannedContentType,
          }
        : {
            candidate_id: candidate!.id,
            scheduled_date: localIso,
            interviewer: testimonialInterviewTypeRequiresInterviewer(interviewType)
              ? interviewer
              : null,
            interviewer_assigned_at:
              testimonialInterviewTypeRequiresInterviewer(interviewType)
                ? assignedNow
                : null,
            zoom_link: null,
            language: languageDisplay,
            interview_language: langSubmit.value,
            poc: poc.trim() || null,
            remarks: remarks.trim() || null,
            interview_type: interviewType,
            interview_status: "draft" as const,
            invitation_sent: false,
            planned_content_type: plannedContentType,
          };

      const table = isProject ? "project_interviews" : "interviews";
      let { data: row, error: insErr } = await supabase
        .from(table)
        .insert(insertPayload)
        .select("id")
        .single();

      if (insErr?.message?.includes("planned_content_type")) {
        const { planned_content_type: _omit, ...withoutPlanned } =
          insertPayload;
        void _omit;
        const retry = await supabase
          .from(table)
          .insert(withoutPlanned)
          .select("id")
          .single();
        row = retry.data;
        insErr = retry.error;
      }

      if (insErr || !row) {
        setError(insErr?.message ?? "Could not save interview.");
        setSubmitting(false);
        return;
      }

      const candDisplay = isProject
        ? projectCandidate!.project_title?.trim() ||
          projectCandidate!.email ||
          "Candidate"
        : candidate!.full_name?.trim() || candidate!.email || "Candidate";
      const typeWord = testimonialInterviewTypeLabel(interviewType);
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
            metadata: {
              time: timeLabel,
              project: true,
              planned_content_type: plannedContentType,
            },
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
            metadata: {
              time: timeLabel,
              project: false,
              planned_content_type: plannedContentType,
            },
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

        setDate("");
        setTime("");
        setPoc("");
        setRemarks("");
        setLangPreset("english");
        setOtherLanguageText("");
        setPlannedContentType(null);
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

      setDate("");
      setTime("");
      setPoc("");
      setRemarks("");
      setLangPreset("english");
      setOtherLanguageText("");
      setPlannedContentType(null);
      onCreated();
      onClose();
    } catch {
      setError("Something went wrong.");
    }
    setSubmitting(false);
  };

  const inp =
    "mt-1 w-full rounded-xl border border-border px-3 py-2.5 text-sm text-foreground focus:border-[#3b82f6] focus:outline-none focus:ring-0";
  const lab = "text-xs font-medium uppercase tracking-widest text-muted/80";

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
            <h2 className="text-lg font-semibold text-foreground">
              Schedule interview
            </h2>
            <p className="text-sm text-muted">
              {isProject
                ? `${projectCandidate!.project_title?.trim() || "Project"} · ${projectCandidate!.email}`
                : `${candidate!.full_name ?? "Candidate"} · ${candidate!.email}`}
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

          {!isProject && testimonialInterviewTypeRequiresInterviewer(interviewType) ? (
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
                onChange={(e) => {
                  const next = e.target.value;
                  if (isTestimonialInterviewType(next)) {
                    setInterviewType(next);
                  }
                }}
              >
                {TESTIMONIAL_INTERVIEW_TYPE_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="block text-sm">
            <span className={lab}>Interview language</span>
            <select
              className={inp}
              value={langPreset}
              onChange={(e) => {
                const next = e.target.value as LangOptionKey;
                setLangPreset(next);
                if (next !== "other") setOtherLanguageText("");
              }}
            >
              {LANGUAGE_OPTIONS.map(({ key, label }) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
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
          </label>

          <fieldset className="block text-sm">
            <legend className={lab}>Content after interview</legend>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-4">
              {PLANNED_CONTENT_OPTIONS.map(({ value, label }) => (
                <label
                  key={value}
                  className="inline-flex items-center gap-2 text-sm text-foreground"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border"
                    checked={plannedContentType === value}
                    onChange={() =>
                      setPlannedContentType((prev) =>
                        prev === value ? null : value,
                      )
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="block text-sm">
            <span className={lab}>POC (assigned)</span>
            <div className="mt-1 rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-muted">
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
              className="rounded-xl border border-border-subtle bg-elevated px-4 py-2 text-sm font-medium text-foreground transition-all hover:bg-background/80"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background transition-all hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Save as Draft"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

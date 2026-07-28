"use client";

import { format, parseISO } from "date-fns";
import { useEffect, useState } from "react";

import type { SupabaseClient } from "@supabase/supabase-js";

import { logActivity } from "@/lib/activity-logger";
import {
  AUTO_NOT_INTERESTED_MAX_ATTEMPTS_REASON,
  MAX_FOLLOWUP_ATTEMPTS,
} from "@/lib/followup-constants";
import {
  shouldAutoNotInterestedForMaxAttempts,
} from "@/lib/followup-auto-not-interested";
import { getUserSafe } from "@/lib/supabase-auth";
import { slackEmailForTeamMember } from "@/lib/slack-contacts";
import { modalOverlayClass, modalPanelClass } from "@/lib/modal-responsive";
import { voidSlackNotify } from "@/lib/slack-client";

import type {
  EligibleCandidate,
  FollowupCallOutcome,
  ProjectLogFollowupRow,
} from "./types";

type InterviewPickRow = {
  id: string;
  post_interview_eligible: boolean | null;
  interview_status: string;
  scheduled_date: string | null;
};

function pickInterviewRowForNotEligible(
  rows: InterviewPickRow[] | null | undefined,
): InterviewPickRow | null {
  if (!rows?.length) return null;
  const eligible = rows.find((r) => r.post_interview_eligible === true);
  if (eligible) return eligible;
  const done = rows.find((r) => r.interview_status === "completed");
  if (done) return done;
  const sorted = rows.slice().sort((a, b) => {
    const ta = a.scheduled_date ? new Date(a.scheduled_date).getTime() : 0;
    const tb = b.scheduled_date ? new Date(b.scheduled_date).getTime() : 0;
    return tb - ta;
  });
  return sorted[0] ?? null;
}

async function markInterviewNotEligibleForFollowup(opts: {
  supabase: SupabaseClient;
  completedAt: string;
  mode: "testimonial" | "project";
  candidateId?: string;
  projectCandidateId?: string;
}): Promise<void> {
  const { supabase, completedAt, mode } = opts;
  if (mode === "testimonial" && opts.candidateId) {
    const { data, error } = await supabase
      .from("interviews")
      .select("id, post_interview_eligible, interview_status, scheduled_date")
      .eq("candidate_id", opts.candidateId)
      .eq("interview_type", "testimonial")
      .neq("interview_status", "cancelled");
    if (error) {
      console.error(
        "[LogFollowupCallModal] interviews select (not_eligible):",
        error.message,
      );
      return;
    }
    const pick = pickInterviewRowForNotEligible(data as InterviewPickRow[]);
    if (!pick) return;
    const { error: upErr } = await supabase
      .from("interviews")
      .update({
        interview_status: "completed",
        completed_at: completedAt,
        post_interview_eligible: false,
      })
      .eq("id", pick.id);
    if (upErr) {
      console.error(
        "[LogFollowupCallModal] interviews → not_eligible:",
        upErr.message,
      );
    }
    return;
  }
  if (mode === "project" && opts.projectCandidateId) {
    const { data, error } = await supabase
      .from("project_interviews")
      .select("id, post_interview_eligible, interview_status, scheduled_date")
      .eq("project_candidate_id", opts.projectCandidateId)
      .neq("interview_status", "cancelled");
    if (error) {
      console.error(
        "[LogFollowupCallModal] project_interviews select (not_eligible):",
        error.message,
      );
      return;
    }
    const pick = pickInterviewRowForNotEligible(data as InterviewPickRow[]);
    if (!pick) return;
    const { error: upErr } = await supabase
      .from("project_interviews")
      .update({
        interview_status: "completed",
        completed_at: completedAt,
        post_interview_eligible: false,
      })
      .eq("id", pick.id);
    if (upErr) {
      console.error(
        "[LogFollowupCallModal] project_interviews → not_eligible:",
        upErr.message,
      );
    }
  }
}

type Props = {
  open: boolean;
  /** Testimonial eligible-tab candidate (`candidates.id`) */
  candidate: EligibleCandidate | null;
  /** Project pending candidate (`project_candidates.id`); when set, logs to `followup_log.project_candidate_id` */
  projectCandidate: ProjectLogFollowupRow | null;
  supabase: SupabaseClient;
  onClose: () => void;
  onSaved: () => void;
};

function actorName(user: {
  user_metadata?: { name?: string };
  email?: string;
} | null): string {
  if (!user) return "Unknown";
  const n = user.user_metadata?.name;
  if (typeof n === "string" && n.trim()) return n.trim();
  return user.email ?? "Unknown";
}

const OUTCOMES: {
  value: FollowupCallOutcome;
  label: string;
  hint: string;
}[] = [
  {
    value: "no_answer",
    label: "No Answer",
    hint: "Will follow up again",
  },
  {
    value: "callback",
    label: "Callback Requested",
    hint: "Set date/time",
  },
  {
    value: "interested",
    label: "Scheduled",
    hint: "Proceed to schedule",
  },
  {
    value: "already_completed",
    label: "Interview Already Completed",
    hint: "Candidate has already completed interview",
  },
  {
    value: "not_eligible",
    label: "Not Eligible",
    hint: "Completed but not eligible for post production",
  },
  {
    value: "not_interested",
    label: "Not Interested",
    hint: "End pipeline",
  },
  {
    value: "wrong_number",
    label: "Wrong Number",
    hint: "Flag and stop",
  },
];

function statusLabelForActivity(outcome: FollowupCallOutcome): string {
  switch (outcome) {
    case "no_answer":
      return "no answer";
    case "callback":
      return "callback requested";
    case "interested":
      return "scheduled";
    case "already_completed":
      return "already completed (interview done)";
    case "not_eligible":
      return "not eligible for post production";
    case "not_interested":
      return "not interested";
    case "wrong_number":
      return "wrong number";
    default:
      return outcome;
  }
}

export function LogFollowupCallModal({
  open,
  candidate,
  projectCandidate,
  supabase,
  onClose,
  onSaved,
}: Props) {
  const [outcome, setOutcome] = useState<FollowupCallOutcome | "">("");
  const [callbackLocal, setCallbackLocal] = useState("");
  const [notInterestedReason, setNotInterestedReason] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setOutcome("");
    setCallbackLocal("");
    setNotInterestedReason("");
    setNotes("");
    setError(null);
  }, [open, candidate?.id, projectCandidate?.id]);

  if (!open || (!candidate && !projectCandidate)) return null;

  const row = projectCandidate ?? candidate!;
  const isProject = Boolean(projectCandidate);

  const nextAttempt = row.followup_count + 1;
  const phone = row.whatsapp_number?.trim() || "—";
  const displayName = row.full_name?.trim() || row.email;
  const emailLine = row.email?.trim() || "";

  const inp =
    "mt-1 w-full rounded-xl border border-border px-3 py-2.5 text-sm text-foreground focus:border-[#3b82f6] focus:outline-none focus:ring-0";
  const lab = "text-xs font-medium uppercase tracking-widest text-muted/80";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!outcome) {
      setError("Select a call outcome.");
      return;
    }
    if (outcome === "callback") {
      if (!callbackLocal) {
        setError("Callback date and time are required.");
        return;
      }
    }

    const callbackIso =
      outcome === "callback"
        ? new Date(callbackLocal).toISOString()
        : null;

    let newCount = row.followup_count + 1;
    let newStatus = row.followup_status;
    let newCallbackAt: string | null = row.callback_datetime;
    let newReason: string | null = row.not_interested_reason;

    switch (outcome) {
      case "no_answer":
        if (shouldAutoNotInterestedForMaxAttempts(outcome, newCount)) {
          newStatus = "not_interested";
          newReason = AUTO_NOT_INTERESTED_MAX_ATTEMPTS_REASON;
        } else {
          newStatus = "pending";
        }
        newCallbackAt = null;
        break;
      case "callback":
        newStatus = "callback";
        newCallbackAt = callbackIso;
        break;
      case "interested":
        newStatus = "interested";
        newCallbackAt = null;
        break;
      case "already_completed":
        newStatus = "already_completed";
        newCallbackAt = null;
        break;
      case "not_eligible":
        newStatus = "not_eligible";
        newCallbackAt = null;
        break;
      case "not_interested":
        newStatus = "not_interested";
        newReason = notInterestedReason.trim() || null;
        newCallbackAt = null;
        break;
      case "wrong_number":
        newStatus = "wrong_number";
        newCallbackAt = null;
        break;
      default:
        break;
    }

    setSubmitting(true);
    try {
      const authUser = await getUserSafe(supabase);
      const byName = actorName(authUser);
      const byEmail = authUser?.email ?? null;

      const logPayload = isProject
        ? {
            project_candidate_id: projectCandidate!.id,
            attempt_number: newCount,
            status: outcome,
            notes: notes.trim() || null,
            callback_datetime: outcome === "callback" ? callbackIso : null,
            logged_by: byName,
            logged_by_email: byEmail,
          }
        : {
            candidate_id: candidate!.id,
            attempt_number: newCount,
            status: outcome,
            notes: notes.trim() || null,
            callback_datetime: outcome === "callback" ? callbackIso : null,
            logged_by: byName,
            logged_by_email: byEmail,
          };

      const { error: logErr } = await supabase
        .from("followup_log")
        .insert(logPayload);

      if (logErr) {
        setError(logErr.message);
        setSubmitting(false);
        return;
      }

      const updatePayload = {
        followup_count: newCount,
        followup_status: newStatus,
        callback_datetime: newCallbackAt,
        not_interested_reason:
          newStatus === "not_interested" ? newReason : null,
        not_interested_at:
          newStatus === "not_interested" ? new Date().toISOString() : null,
      };

      const { error: upErr } = isProject
        ? await supabase
            .from("project_candidates")
            .update(updatePayload)
            .eq("id", projectCandidate!.id)
            .eq("is_deleted", false)
        : await supabase
            .from("candidates")
            .update(updatePayload)
            .eq("id", candidate!.id);

      if (upErr) {
        setError(upErr.message);
        setSubmitting(false);
        return;
      }

      if (isProject && outcome === "already_completed") {
        const completedAtIso = new Date().toISOString();
        const { error: piErr } = await supabase
          .from("project_interviews")
          .update({
            interview_status: "completed",
            completed_at: completedAtIso,
          })
          .eq("project_candidate_id", projectCandidate!.id)
          .neq("interview_status", "completed");
        if (piErr) {
          console.error(
            "[LogFollowupCallModal] project_interviews → completed:",
            piErr.message,
          );
        }
      }

      if (outcome === "not_eligible") {
        const completedAtIso = new Date().toISOString();
        await markInterviewNotEligibleForFollowup({
          supabase,
          completedAt: completedAtIso,
          mode: isProject ? "project" : "testimonial",
          candidateId: isProject ? undefined : candidate!.id,
          projectCandidateId: isProject ? projectCandidate!.id : undefined,
        });
      }

      const entityType = isProject ? "project_candidate" : "candidate";
      const entityId = isProject ? projectCandidate!.id : candidate!.id;

      if (authUser) {
        if (outcome === "callback" && callbackIso) {
          const dtLabel = format(parseISO(callbackIso), "MMM d, yyyy h:mm a");
          await logActivity({
            supabase,
            user: authUser,
            action_type: "eligibility",
            entity_type: entityType,
            entity_id: entityId,
            candidate_name: displayName,
            description: `Callback scheduled for ${displayName} at ${dtLabel}`,
            metadata: { followup: true, project: isProject },
          });
        } else if (outcome === "not_interested" || newStatus === "not_interested") {
          await logActivity({
            supabase,
            user: authUser,
            action_type: "eligibility",
            entity_type: entityType,
            entity_id: entityId,
            candidate_name: displayName,
            description: `Marked ${displayName} as not interested`,
            metadata: { followup: true, project: isProject },
          });
        } else {
          await logActivity({
            supabase,
            user: authUser,
            action_type: "eligibility",
            entity_type: entityType,
            entity_id: entityId,
            candidate_name: displayName,
            description: `Logged follow-up call for ${displayName}: ${statusLabelForActivity(outcome)}`,
            metadata: { followup: true, project: isProject },
          });
        }
      }

      const pocEmail = await slackEmailForTeamMember(
        supabase,
        row.poc_assigned,
      );
      if (pocEmail) {
        if (outcome === "no_answer") {
          if (newStatus === "not_interested") {
            voidSlackNotify(
              supabase,
              pocEmail,
              `⚠️ Follow-up limit reached for *${displayName}*\n` +
                `${MAX_FOLLOWUP_ATTEMPTS} attempts made with no response.\n` +
                `Candidate moved to Not Interested.`,
            );
          } else {
            voidSlackNotify(
              supabase,
              pocEmail,
              `📞 Follow-up needed for *${displayName}*\n` +
                `Attempt ${newCount} of ${MAX_FOLLOWUP_ATTEMPTS} — No answer\n` +
                `📱 ${phone}\n` +
                `Please try again.`,
            );
          }
        } else if (outcome === "callback" && callbackIso) {
          const dtLabel = format(parseISO(callbackIso), "MMM d, yyyy h:mm a");
          voidSlackNotify(
            supabase,
            pocEmail,
            `📅 Callback scheduled for *${displayName}*\n` +
              `Date & Time: ${dtLabel}\n` +
              `📱 ${phone}`,
          );
        }
      }

      onSaved();
      onClose();
    } catch {
      setError("Something went wrong.");
    }
    setSubmitting(false);
  };

  const showFinalWarning =
    outcome === "no_answer" && row.followup_count >= MAX_FOLLOWUP_ATTEMPTS - 1;

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
              Log Follow-up Call
            </h2>
            <p className="text-sm text-muted">
              {displayName} · {phone}
            </p>
            {emailLine ? (
              <p className="mt-0.5 text-xs text-muted">{emailLine}</p>
            ) : null}
            <p className="mt-1 text-sm font-medium text-foreground">
              Attempt {nextAttempt} of {MAX_FOLLOWUP_ATTEMPTS}
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
          {error ? (
            <p className="rounded-xl border border-border-subtle bg-background px-3 py-2 text-sm text-foreground">
              {error}
            </p>
          ) : null}

          {showFinalWarning ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              This is the final attempt. If there is no answer, the candidate
              will be moved to Not Interested.
            </p>
          ) : null}

          <fieldset>
            <legend className={lab}>Call outcome (required)</legend>
            <div className="mt-2 space-y-2">
              {OUTCOMES.map((o) => (
                <label
                  key={o.value}
                  className="flex cursor-pointer gap-3 rounded-xl border border-border p-3 has-[:checked]:border-foreground has-[:checked]:bg-background/80"
                >
                  <input
                    type="radio"
                    name="outcome"
                    value={o.value}
                    checked={outcome === o.value}
                    onChange={() => setOutcome(o.value)}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-medium text-foreground">
                      {o.value === "no_answer" && "📞 "}
                      {o.value === "callback" && "📅 "}
                      {o.value === "interested" && "✅ "}
                      {o.value === "already_completed" && "✓ "}
                      {o.value === "not_eligible" && "⛔ "}
                      {o.value === "not_interested" && "❌ "}
                      {o.value === "wrong_number" && "📵 "}
                      {o.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {o.hint}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {outcome === "callback" ? (
            <label className="block text-sm">
              <span className={lab}>Callback Date &amp; Time</span>
              <input
                type="datetime-local"
                required
                className={inp}
                value={callbackLocal}
                onChange={(e) => setCallbackLocal(e.target.value)}
              />
            </label>
          ) : null}

          {outcome === "not_interested" ? (
            <label className="block text-sm">
              <span className={lab}>Reason (optional)</span>
              <input
                type="text"
                className={inp}
                value={notInterestedReason}
                onChange={(e) => setNotInterestedReason(e.target.value)}
                placeholder="Why not interested…"
              />
            </label>
          ) : null}

          <label className="block text-sm">
            <span className={lab}>Notes</span>
            <textarea
              rows={3}
              className={inp}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes…"
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
              {submitting ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

"use client";

import { format, parseISO } from "date-fns";
import { useEffect, useState } from "react";

import type { SupabaseClient } from "@supabase/supabase-js";

import { logActivity } from "@/lib/activity-logger";
import { getUserSafe } from "@/lib/supabase-auth";
import { slackEmailForTeamMember } from "@/lib/slack-contacts";
import { modalOverlayClass, modalPanelClass } from "@/lib/modal-responsive";
import { voidSlackNotify } from "@/lib/slack-client";

import type {
  EligibleCandidate,
  FollowupCallOutcome,
  ProjectLogFollowupRow,
} from "./types";

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
    label: "Interested",
    hint: "Proceed to schedule",
  },
  {
    value: "already_completed",
    label: "Interview Already Completed",
    hint: "Candidate has already completed interview",
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
      return "interested";
    case "already_completed":
      return "already completed (interview done)";
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
    "mt-1 w-full rounded-xl border border-[#e5e5e5] px-3 py-2.5 text-sm text-[#1d1d1f] focus:border-[#3b82f6] focus:outline-none focus:ring-0";
  const lab = "text-xs font-medium uppercase tracking-widest text-[#aeaeb2]";

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
        newStatus = newCount >= 3 ? "no_answer" : "pending";
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
          outcome === "not_interested" ? newReason : null,
        not_interested_at:
          outcome === "not_interested" ? new Date().toISOString() : null,
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
        const { error: piErr } = await supabase
          .from("project_interviews")
          .update({ interview_status: "completed" })
          .eq("project_candidate_id", projectCandidate!.id)
          .neq("interview_status", "completed");
        if (piErr) {
          console.error(
            "[LogFollowupCallModal] project_interviews → completed:",
            piErr.message,
          );
        }
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
        } else if (outcome === "not_interested") {
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
          if (newCount >= 3 && newStatus === "no_answer") {
            voidSlackNotify(
              supabase,
              pocEmail,
              `⚠️ Follow-up limit reached for *${displayName}*\n` +
                `3 attempts made with no response.\n` +
                `Candidate will be moved to inactive.`,
            );
          } else {
            voidSlackNotify(
              supabase,
              pocEmail,
              `📞 Follow-up needed for *${displayName}*\n` +
                `Attempt ${newCount} of 3 — No answer\n` +
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

  const showFinalWarning = outcome === "no_answer" && row.followup_count >= 2;

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
              Log Follow-up Call
            </h2>
            <p className="text-sm text-[#6e6e73]">
              {displayName} · {phone}
            </p>
            {emailLine ? (
              <p className="mt-0.5 text-xs text-[#6e6e73]">{emailLine}</p>
            ) : null}
            <p className="mt-1 text-sm font-medium text-[#1d1d1f]">
              Attempt {nextAttempt} of 3
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
          {error ? (
            <p className="rounded-xl border border-[#f0f0f0] bg-[#f5f5f7] px-3 py-2 text-sm text-[#1d1d1f]">
              {error}
            </p>
          ) : null}

          {showFinalWarning ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              This is the final attempt. Further follow-ups will be stopped.
            </p>
          ) : null}

          <fieldset>
            <legend className={lab}>Call outcome (required)</legend>
            <div className="mt-2 space-y-2">
              {OUTCOMES.map((o) => (
                <label
                  key={o.value}
                  className="flex cursor-pointer gap-3 rounded-xl border border-[#e5e5e5] p-3 has-[:checked]:border-[#1d1d1f] has-[:checked]:bg-[#fafafa]"
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
                    <span className="font-medium text-[#1d1d1f]">
                      {o.value === "no_answer" && "📞 "}
                      {o.value === "callback" && "📅 "}
                      {o.value === "interested" && "✅ "}
                      {o.value === "already_completed" && "✓ "}
                      {o.value === "not_interested" && "❌ "}
                      {o.value === "wrong_number" && "📵 "}
                      {o.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-[#6e6e73]">
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
              {submitting ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

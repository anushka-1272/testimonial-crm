"use client";

import { useEffect, useState } from "react";

import type { SupabaseClient } from "@supabase/supabase-js";

import { logActivity } from "@/lib/activity-logger";
import type { GwcCallOutcome } from "@/lib/gwc-testing";
import {
  gwcEntryDisplayName,
  gwcEntryEntityId,
  type GwcTestingRow,
} from "@/lib/gwc-testing";
import { modalOverlayClass, modalPanelClass } from "@/lib/modal-responsive";
import { getUserSafe, displayNameFromUser } from "@/lib/supabase-auth";

const OUTCOMES: { value: GwcCallOutcome; label: string }[] = [
  { value: "no_answer", label: "No answer" },
  { value: "callback", label: "Callback requested" },
  { value: "interested", label: "Interested" },
  { value: "scheduled", label: "Scheduled" },
  { value: "not_interested", label: "Not interested" },
  { value: "wrong_number", label: "Wrong number" },
  { value: "other", label: "Other" },
];

const fieldLabelClass =
  "text-xs font-medium uppercase tracking-widest text-[#aeaeb2]";
const fieldInputClass =
  "mt-1 w-full rounded-xl border border-[#e5e5e5] px-3 py-2.5 text-sm text-[#1d1d1f] focus:border-[#3b82f6] focus:outline-none focus:ring-0";

type Props = {
  open: boolean;
  row: GwcTestingRow | null;
  supabase: SupabaseClient;
  onClose: () => void;
  onSaved: () => void;
};

export function LogGwcCallModal({
  open,
  row,
  supabase,
  onClose,
  onSaved,
}: Props) {
  const [outcome, setOutcome] = useState<GwcCallOutcome>("no_answer");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setOutcome("no_answer");
      setNotes("");
      setError(null);
    }
  }, [open]);

  if (!open || !row) return null;

  const display = gwcEntryDisplayName(row);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!row) return;
    const entry = row;
    setSubmitting(true);
    setError(null);
    const actor = await getUserSafe(supabase);
    const loggedBy = actor ? displayNameFromUser(actor) : "Unknown";
    const { error: insErr } = await supabase.from("gwc_call_log").insert({
      gwc_testing_id: entry.id,
      outcome,
      notes: notes.trim() || null,
      logged_by: loggedBy,
    });
    if (insErr) {
      setError(insErr.message);
      setSubmitting(false);
      return;
    }
    if (actor) {
      await logActivity({
        supabase,
        user: actor,
        action_type: "interviews",
        entity_type: "candidate",
        entity_id: gwcEntryEntityId(entry),
        candidate_name: display,
        description: `Logged GWC call for ${display} (${outcome})`,
        metadata: { gwc_testing_id: entry.id, outcome },
      });
    }
    setSubmitting(false);
    onSaved();
    onClose();
  }

  return (
    <div className={modalOverlayClass}>
      <button
        type="button"
        className="absolute inset-0"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        className={`${modalPanelClass} !overflow-hidden flex max-h-[min(90vh,100dvh-2rem)] flex-col p-0`}
        role="dialog"
        aria-labelledby="gwc-log-call-title"
      >
        <div className="flex shrink-0 items-start justify-between border-b border-[#f0f0f0] px-6 py-4">
          <div>
            <h2
              id="gwc-log-call-title"
              className="text-lg font-semibold text-[#1d1d1f]"
            >
              Log call
            </h2>
            <p className="mt-1 text-sm text-[#6e6e73]">{display}</p>
          </div>
          <button
            type="button"
            className="rounded-xl p-2 text-[#aeaeb2] transition-colors hover:bg-[#f5f5f7] hover:text-[#1d1d1f]"
            aria-label="Close dialog"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => void handleSubmit(e)}
        >
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
            {error ? (
              <p className="rounded-xl border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-sm text-[#dc2626]">
                {error}
              </p>
            ) : null}
            <div>
              <label className={fieldLabelClass}>Outcome</label>
              <select
                className={fieldInputClass}
                value={outcome}
                onChange={(e) => setOutcome(e.target.value as GwcCallOutcome)}
              >
                {OUTCOMES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={fieldLabelClass}>Notes</label>
              <textarea
                className={fieldInputClass}
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes"
              />
            </div>
          </div>

          <div className="flex shrink-0 justify-end gap-2 border-t border-[#f0f0f0] bg-white px-6 py-4">
            <button
              type="button"
              className="rounded-xl px-4 py-2.5 text-sm font-medium text-[#6e6e73] transition-colors hover:bg-[#f5f5f5]"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-xl bg-[#1d1d1f] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#2d2d2f] disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

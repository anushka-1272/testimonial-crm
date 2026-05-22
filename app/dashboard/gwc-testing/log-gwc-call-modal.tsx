"use client";

import { useEffect, useState } from "react";

import type { SupabaseClient } from "@supabase/supabase-js";

import { logActivity } from "@/lib/activity-logger";
import type { GwcCallOutcome } from "@/lib/gwc-testing";
import { modalOverlayClass, modalPanelClass } from "@/lib/modal-responsive";
import { getUserSafe, displayNameFromUser } from "@/lib/supabase-auth";

import { gwcEntryDisplayName, gwcEntryEntityId, type GwcTestingRow } from "@/lib/gwc-testing";

const OUTCOMES: { value: GwcCallOutcome; label: string }[] = [
  { value: "no_answer", label: "No answer" },
  { value: "callback", label: "Callback requested" },
  { value: "interested", label: "Interested" },
  { value: "scheduled", label: "Scheduled" },
  { value: "not_interested", label: "Not interested" },
  { value: "wrong_number", label: "Wrong number" },
  { value: "other", label: "Other" },
];

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
      <div className={modalPanelClass}>
        <h2 className="text-lg font-semibold text-[#1d1d1f]">Log call</h2>
        <p className="mt-1 text-sm text-[#6e6e73]">{display}</p>
        <form className="mt-4 space-y-4" onSubmit={(e) => void handleSubmit(e)}>
          <div>
            <label className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
              Outcome
            </label>
            <select
              className="mt-1 w-full rounded-xl border border-[#e5e5e5] px-3 py-2.5 text-sm"
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
            <label className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
              Notes
            </label>
            <textarea
              className="mt-1 w-full rounded-xl border border-[#e5e5e5] px-3 py-2.5 text-sm"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes"
            />
          </div>
          {error ? (
            <p className="text-sm text-[#dc2626]">{error}</p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-xl px-4 py-2 text-sm text-[#6e6e73] hover:bg-[#f5f5f5]"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-xl bg-[#1d1d1f] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

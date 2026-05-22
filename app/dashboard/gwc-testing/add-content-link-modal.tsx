"use client";

import { useEffect, useState } from "react";

import type { SupabaseClient } from "@supabase/supabase-js";

import { logActivity } from "@/lib/activity-logger";
import {
  channelLabel,
  type GwcContentChannel,
} from "@/lib/gwc-testing";
import { modalOverlayClass, modalPanelClass } from "@/lib/modal-responsive";
import { getUserSafe, displayNameFromUser } from "@/lib/supabase-auth";

import type { GwcTestingRow } from "@/lib/gwc-testing";

type Props = {
  open: boolean;
  row: GwcTestingRow | null;
  channel: GwcContentChannel | null;
  supabase: SupabaseClient;
  onClose: () => void;
  onSaved: () => void;
  /** When true, marks content verified and moves to dispatch (deduped). */
  verifyOnSave?: boolean;
};

export function AddContentLinkModal({
  open,
  row,
  channel,
  supabase,
  onClose,
  onSaved,
  verifyOnSave = false,
}: Props) {
  const [link, setLink] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const existing = row?.verifications?.find((v) => v.channel === channel);

  useEffect(() => {
    if (open) {
      setLink(existing?.content_link ?? "");
      setError(null);
    }
  }, [open, existing?.content_link]);

  if (!open || !row || !channel) return null;

  const display =
    row.candidates?.full_name?.trim() ||
    row.candidates?.email?.trim() ||
    "Candidate";

  async function moveToDispatchDeduped(candidateId: string): Promise<string | null> {
    const { data: existingDispatch } = await supabase
      .from("dispatch")
      .select("id")
      .eq("candidate_id", candidateId)
      .maybeSingle();
    if (!existingDispatch) {
      const { error: dErr } = await supabase.from("dispatch").insert({
        candidate_id: candidateId,
        dispatch_status: "pending",
      });
      if (dErr) return dErr.message;
    }
    const { error: stageErr } = await supabase
      .from("gwc_testing")
      .update({ workflow_stage: "dispatch" })
      .eq("id", row!.id);
    return stageErr?.message ?? null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = link.trim();
    if (!trimmed) {
      setError("Please enter a link.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const actor = await getUserSafe(supabase);
    const verifiedBy = actor ? displayNameFromUser(actor) : "Unknown";
    const now = new Date().toISOString();

    const payload = {
      gwc_testing_id: row!.id,
      channel,
      content_link: trimmed,
      verified: verifyOnSave,
      verified_at: verifyOnSave ? now : null,
      verified_by: verifyOnSave ? verifiedBy : null,
      updated_at: now,
    };

    const { error: upsertErr } = await supabase
      .from("gwc_content_verification")
      .upsert(payload, { onConflict: "gwc_testing_id,channel" });

    if (upsertErr) {
      setError(upsertErr.message);
      setSubmitting(false);
      return;
    }

    if (verifyOnSave) {
      const dispatchErr = await moveToDispatchDeduped(row!.candidate_id);
      if (dispatchErr) {
        setError(dispatchErr);
        setSubmitting(false);
        return;
      }
    }

    if (actor) {
      await logActivity({
        supabase,
        user: actor,
        action_type: "dispatch",
        entity_type: "candidate",
        entity_id: row!.candidate_id,
        candidate_name: display,
        description: verifyOnSave
          ? `Verified ${channelLabel(channel!)} content for ${display} and moved to dispatch`
          : `Added ${channelLabel(channel!)} link for ${display}`,
        metadata: { channel, link: trimmed },
      });
    }

    setSubmitting(false);
    onSaved();
    onClose();
  }

  return (
    <div className={modalOverlayClass}>
      <div className={modalPanelClass}>
        <h2 className="text-lg font-semibold text-[#1d1d1f]">
          {verifyOnSave ? "Verify content" : "Add link"}
        </h2>
        <p className="mt-1 text-sm text-[#6e6e73]">
          {display} · {channelLabel(channel)}
        </p>
        <form className="mt-4 space-y-4" onSubmit={(e) => void handleSubmit(e)}>
          <div>
            <label className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
              Content link
            </label>
            <input
              type="url"
              className="mt-1 w-full rounded-xl border border-[#e5e5e5] px-3 py-2.5 text-sm"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://"
              required
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
              {submitting
                ? "Saving…"
                : verifyOnSave
                  ? "Verify & dispatch"
                  : "Save link"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

import type { SupabaseClient } from "@supabase/supabase-js";

import { logActivity } from "@/lib/activity-logger";
import {
  channelLabel,
  gwcEntryDisplayName,
  gwcEntryEntityId,
  isProjectGwcRow,
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

  const display = gwcEntryDisplayName(row);

  async function moveToDispatchDeduped(): Promise<string | null> {
    if (!row) return "Missing GWC entry.";
    if (isProjectGwcRow(row) && row.project_candidate_id) {
      const { data: existingDispatch } = await supabase
        .from("project_dispatch")
        .select("id")
        .eq("project_candidate_id", row.project_candidate_id)
        .maybeSingle();
      if (!existingDispatch) {
        const { error: dErr } = await supabase.from("project_dispatch").insert({
          project_candidate_id: row.project_candidate_id,
          dispatch_status: "pending",
        });
        if (dErr) return dErr.message;
      }
    } else if (row.candidate_id) {
      const { data: existingDispatch } = await supabase
        .from("dispatch")
        .select("id")
        .eq("candidate_id", row.candidate_id)
        .maybeSingle();
      if (!existingDispatch) {
        const { error: dErr } = await supabase.from("dispatch").insert({
          candidate_id: row.candidate_id,
          dispatch_status: "pending",
        });
        if (dErr) return dErr.message;
      }
    }
    const { error: stageErr } = await supabase
      .from("gwc_testing")
      .update({ workflow_stage: "dispatch" })
      .eq("id", row!.id);
    return stageErr?.message ?? null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!row || !channel) return;
    const entry = row;
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
      gwc_testing_id: entry.id,
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
      const dispatchErr = await moveToDispatchDeduped();
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
        entity_id: gwcEntryEntityId(entry),
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

  const title = verifyOnSave ? "Verify content" : "Add link";
  const submitLabel = submitting
    ? "Saving…"
    : verifyOnSave
      ? "Verify & dispatch"
      : "Save link";

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
        aria-labelledby="gwc-content-link-title"
      >
        <div className="flex shrink-0 items-start justify-between border-b border-[#f0f0f0] px-6 py-4">
          <div>
            <h2
              id="gwc-content-link-title"
              className="text-lg font-semibold text-[#1d1d1f]"
            >
              {title}
            </h2>
            <p className="mt-1 text-sm text-[#6e6e73]">
              {display} · {channelLabel(channel)}
            </p>
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
              <label className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                Content link
              </label>
              <input
                type="url"
                className="mt-1 w-full rounded-xl border border-[#e5e5e5] px-3 py-2.5 text-sm text-[#1d1d1f] focus:border-[#3b82f6] focus:outline-none focus:ring-0"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://"
                required
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
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

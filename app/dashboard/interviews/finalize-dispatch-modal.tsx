"use client";

import { useEffect, useState } from "react";

import type { SupabaseClient } from "@supabase/supabase-js";

import { logActivity } from "@/lib/activity-logger";
import { modalOverlayClass, modalPanelClass } from "@/lib/modal-responsive";
import { getUserSafe } from "@/lib/supabase-auth";

import {
  type InterviewWithCandidate,
  type ProjectInterviewWithProjectCandidate,
  isProjectInterviewRow,
} from "./types";

const REWARD_NO_DISPATCH = "No Dispatch";

type Props = {
  open: boolean;
  interview: InterviewWithCandidate | ProjectInterviewWithProjectCandidate | null;
  supabase: SupabaseClient;
  onClose: () => void;
  onSaved: () => void;
};

function displayName(
  interview: InterviewWithCandidate | ProjectInterviewWithProjectCandidate,
): string {
  if (isProjectInterviewRow(interview)) {
    const pc = interview.project_candidates;
    return (
      pc?.full_name?.trim() ||
      pc?.project_title?.trim() ||
      pc?.email ||
      "Candidate"
    );
  }
  const c = interview.candidates;
  return c?.full_name?.trim() || c?.email || "Candidate";
}

export function FinalizeDispatchModal({
  open,
  interview,
  supabase,
  onClose,
  onSaved,
}: Props) {
  const [shippingAddress, setShippingAddress] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isProject = interview ? isProjectInterviewRow(interview) : false;
  const rewardItem = interview?.reward_item?.trim() || null;

  useEffect(() => {
    if (!open || !interview) return;
    setError(null);
    void (async () => {
      try {
        if (isProjectInterviewRow(interview)) {
          const { data } = await supabase
            .from("project_dispatch")
            .select("shipping_address")
            .eq("project_candidate_id", interview.project_candidate_id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          setShippingAddress(data?.shipping_address?.trim() ?? "");
        } else {
          const { data } = await supabase
            .from("dispatch")
            .select("shipping_address")
            .eq("candidate_id", interview.candidate_id)
            .maybeSingle();
          setShippingAddress(data?.shipping_address?.trim() ?? "");
        }
      } catch {
        setShippingAddress("");
      }
    })();
  }, [open, interview, supabase]);

  if (!open || !interview) return null;

  const label = displayName(interview);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const address = shippingAddress.trim();
    if (!address) {
      setError("Shipping address is required.");
      return;
    }
    if (!rewardItem || rewardItem === REWARD_NO_DISPATCH) {
      setError("No dispatch reward configured for this interview.");
      return;
    }

    setSubmitting(true);
    setError(null);

    const dispatchFields = {
      shipping_address: address,
      reward_item: rewardItem,
      dispatch_status: "pending" as const,
    };

    if (isProjectInterviewRow(interview)) {
      const pcId = interview.project_candidate_id;
      const { data: existing } = await supabase
        .from("project_dispatch")
        .select("id")
        .eq("project_candidate_id", pcId)
        .maybeSingle();

      const dErr = existing?.id
        ? (
            await supabase
              .from("project_dispatch")
              .update(dispatchFields)
              .eq("id", existing.id)
          ).error
        : (
            await supabase.from("project_dispatch").insert({
              project_candidate_id: pcId,
              ...dispatchFields,
            })
          ).error;

      if (dErr) {
        setError(dErr.message);
        setSubmitting(false);
        return;
      }
    } else {
      const candId = (interview as InterviewWithCandidate).candidate_id;
      const { data: existing } = await supabase
        .from("dispatch")
        .select("id")
        .eq("candidate_id", candId)
        .maybeSingle();

      const dErr = existing?.id
        ? (
            await supabase
              .from("dispatch")
              .update(dispatchFields)
              .eq("id", existing.id)
          ).error
        : (
            await supabase.from("dispatch").insert({
              candidate_id: candId,
              ...dispatchFields,
            })
          ).error;

      if (dErr) {
        setError(dErr.message);
        setSubmitting(false);
        return;
      }
    }

    const table = isProject ? "project_interviews" : "interviews";
    const { error: upErr } = await supabase
      .from(table)
      .update({ post_content_status: "dispatch_ready" })
      .eq("id", interview.id);

    if (upErr) {
      setError(upErr.message);
      setSubmitting(false);
      return;
    }

    const actor = await getUserSafe(supabase);
    if (actor) {
      await logActivity({
        supabase,
        user: actor,
        action_type: "interviews",
        entity_type: isProject ? "project_interview" : "interview",
        entity_id: interview.id,
        candidate_name: label,
        description: `Finalized dispatch for ${label} — ${rewardItem}`,
      });
    }

    setSubmitting(false);
    onSaved();
    onClose();
  };

  return (
    <div className={modalOverlayClass}>
      <div className={modalPanelClass} role="dialog" aria-labelledby="finalize-dispatch-title">
        <h2 id="finalize-dispatch-title" className="text-lg font-semibold text-foreground">
          Finalize &amp; move to dispatch
        </h2>
        <p className="mt-1 text-sm text-muted">
          {label} — reward: <strong>{rewardItem ?? "—"}</strong>
        </p>
        <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 space-y-4">
          <label className="block text-sm">
            <span className="text-xs font-medium uppercase tracking-widest text-muted/80">
              Shipping address <span className="text-[#dc2626]">*</span>
            </span>
            <textarea
              className="mt-1 w-full resize-y rounded-xl border border-border px-3 py-2.5 text-sm text-foreground focus:border-[#3b82f6] focus:outline-none"
              rows={4}
              value={shippingAddress}
              onChange={(e) => setShippingAddress(e.target.value)}
              required
            />
          </label>
          {error ? (
            <p className="text-sm text-[#dc2626]">{error}</p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-muted hover:bg-background"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
              disabled={submitting}
            >
              {submitting ? "Saving…" : "Create dispatch"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

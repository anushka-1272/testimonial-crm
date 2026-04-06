"use client";

import { useState } from "react";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { InterviewWithCandidate } from "./types";

type Props = {
  open: boolean;
  interview: InterviewWithCandidate | null;
  supabase: SupabaseClient;
  onClose: () => void;
  onSaved: () => void;
};

export function PostInterviewDrawer({
  open,
  interview,
  supabase,
  onClose,
  onSaved,
}: Props) {
  const [eligible, setEligible] = useState<boolean | null>(null);
  const [category, setCategory] = useState("");
  const [funnel, setFunnel] = useState("");
  const [comments, setComments] = useState("");
  const [shippingAddress, setShippingAddress] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open || !interview) return null;

  const email = interview.candidates?.email;
  const name = interview.candidates?.full_name;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (eligible === null) {
      setError("Please select whether the candidate is post-interview eligible.");
      return;
    }
    if (eligible && !shippingAddress.trim()) {
      setError("Shipping address is required when marking eligible.");
      return;
    }

    setSubmitting(true);
    try {
      const { error: upErr } = await supabase
        .from("interviews")
        .update({
          interview_status: "completed",
          post_interview_eligible: eligible,
          category: category.trim() || null,
          funnel: funnel.trim() || null,
          comments: comments.trim() || null,
        })
        .eq("id", interview.id);

      if (upErr) {
        setError(upErr.message);
        setSubmitting(false);
        return;
      }

      if (eligible && shippingAddress.trim()) {
        const { error: dErr } = await supabase.from("dispatch").insert({
          candidate_id: interview.candidate_id,
          shipping_address: shippingAddress.trim(),
          dispatch_status: "pending",
        });
        if (dErr) {
          setError(dErr.message);
          setSubmitting(false);
          return;
        }
      }

      if (email) {
        await fetch("/api/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "interview_thankyou",
            to: email,
            name,
          }),
        });
      }

      setEligible(null);
      setCategory("");
      setFunnel("");
      setComments("");
      setShippingAddress("");
      onSaved();
      onClose();
    } catch {
      setError("Something went wrong.");
    }
    setSubmitting(false);
  };

  const inp =
    "mt-1 w-full rounded-xl border border-[#e5e5e5] px-3 py-2.5 text-sm text-[#1d1d1f] focus:border-[#3b82f6] focus:outline-none focus:ring-0";

  return (
    <div className="fixed inset-0 z-[70] flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-[#1d1d1f]/25 backdrop-blur-[1px]"
        aria-label="Close"
        onClick={onClose}
      />
      <aside className="relative flex h-full w-full max-w-md flex-col border-l border-[#f0f0f0] bg-white shadow-[0_4px_16px_rgba(0,0,0,0.08)]">
        <div className="flex items-start justify-between border-b border-[#f5f5f5] px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-[#1d1d1f]">
              Complete interview
            </h2>
            <p className="text-sm text-[#6e6e73]">
              {name ?? "Candidate"} · Post-interview details
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

        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="flex flex-1 flex-col overflow-hidden text-sm text-[#1d1d1f]"
        >
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {error && (
              <p className="rounded-xl border border-[#f0f0f0] bg-[#f5f5f7] px-3 py-2 text-sm text-[#1d1d1f]">
                {error}
              </p>
            )}

            <fieldset>
              <legend className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                Post-interview eligible?
              </legend>
              <div className="mt-2 flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="eligible"
                    checked={eligible === true}
                    onChange={() => setEligible(true)}
                  />
                  Yes
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="eligible"
                    checked={eligible === false}
                    onChange={() => setEligible(false)}
                  />
                  No
                </label>
              </div>
            </fieldset>

            <label className="block text-sm">
              <span className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                Category
              </span>
              <input
                type="text"
                className={inp}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </label>

            <label className="block text-sm">
              <span className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                Funnel
              </span>
              <input
                type="text"
                className={inp}
                value={funnel}
                onChange={(e) => setFunnel(e.target.value)}
              />
            </label>

            <label className="block text-sm">
              <span className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                Comments
              </span>
              <textarea
                rows={3}
                className={inp}
                value={comments}
                onChange={(e) => setComments(e.target.value)}
              />
            </label>

            {eligible === true && (
              <label className="block text-sm">
                <span className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                  Shipping address
                </span>
                <textarea
                  required={eligible === true}
                  rows={3}
                  placeholder="Full mailing address for dispatch"
                  className={inp}
                  value={shippingAddress}
                  onChange={(e) => setShippingAddress(e.target.value)}
                />
              </label>
            )}
          </div>

          <div className="border-t border-[#f5f5f5] px-5 py-3">
            <div className="flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-xl border border-[#f0f0f0] bg-white py-2.5 text-sm font-medium text-[#1d1d1f] transition-all hover:bg-[#fafafa]"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 rounded-xl bg-[#1d1d1f] py-2.5 text-sm font-medium text-white transition-all hover:bg-[#2d2d2f] disabled:opacity-50"
              >
                {submitting ? "Saving…" : "Save & mark completed"}
              </button>
            </div>
          </div>
        </form>
      </aside>
    </div>
  );
}

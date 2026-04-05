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

  return (
    <div className="fixed inset-0 z-[70] flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]"
        aria-label="Close"
        onClick={onClose}
      />
      <aside className="relative flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Complete interview
            </h2>
            <p className="text-sm text-slate-500">
              {name ?? "Candidate"} · Post-interview details
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="flex flex-1 flex-col overflow-hidden"
        >
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}

            <fieldset>
              <legend className="text-sm font-medium text-slate-700">
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
              <span className="font-medium text-slate-700">Category</span>
              <input
                type="text"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </label>

            <label className="block text-sm">
              <span className="font-medium text-slate-700">Funnel</span>
              <input
                type="text"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                value={funnel}
                onChange={(e) => setFunnel(e.target.value)}
              />
            </label>

            <label className="block text-sm">
              <span className="font-medium text-slate-700">Comments</span>
              <textarea
                rows={3}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                value={comments}
                onChange={(e) => setComments(e.target.value)}
              />
            </label>

            {eligible === true && (
              <label className="block text-sm">
                <span className="font-medium text-slate-700">
                  Shipping address
                </span>
                <textarea
                  required={eligible === true}
                  rows={3}
                  placeholder="Full mailing address for dispatch"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  value={shippingAddress}
                  onChange={(e) => setShippingAddress(e.target.value)}
                />
              </label>
            )}
          </div>

          <div className="border-t border-slate-100 px-5 py-3">
            <div className="flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-lg border border-slate-200 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 rounded-lg bg-slate-900 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
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

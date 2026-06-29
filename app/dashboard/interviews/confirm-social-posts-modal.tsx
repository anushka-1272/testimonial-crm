"use client";

import { useEffect, useState } from "react";

import type { SupabaseClient } from "@supabase/supabase-js";

import { logActivity } from "@/lib/activity-logger";
import { hasSocialPostLink } from "@/lib/post-interview-content";
import { modalOverlayClass, modalPanelClass } from "@/lib/modal-responsive";
import { getUserSafe } from "@/lib/supabase-auth";

import {
  type InterviewWithCandidate,
  type ProjectInterviewWithProjectCandidate,
  isProjectInterviewRow,
} from "./types";

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

export function ConfirmSocialPostsModal({
  open,
  interview,
  supabase,
  onClose,
  onSaved,
}: Props) {
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [blogUrl, setBlogUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && interview) {
      setLinkedinUrl(interview.linkedin_post_url?.trim() ?? "");
      setBlogUrl(interview.blog_post_url?.trim() ?? "");
      setError(null);
    }
  }, [open, interview?.id, interview?.linkedin_post_url, interview?.blog_post_url]);

  if (!open || !interview) return null;

  const isProject = isProjectInterviewRow(interview);
  const label = displayName(interview);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const linkedin = linkedinUrl.trim();
    const blog = blogUrl.trim();
    if (!hasSocialPostLink({ linkedinPostUrl: linkedin, blogPostUrl: blog })) {
      setError("Provide at least one of LinkedIn post URL or blog post URL.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const table = isProject ? "project_interviews" : "interviews";
    const now = new Date().toISOString();
    const { error: upErr } = await supabase
      .from(table)
      .update({
        linkedin_post_url: linkedin || null,
        blog_post_url: blog || null,
        posts_confirmed_at: now,
        post_content_status: "posts_confirmed",
      })
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
        description: `Confirmed social posts for ${label}`,
      });
    }

    setSubmitting(false);
    onSaved();
    onClose();
  };

  return (
    <div className={modalOverlayClass}>
      <div className={modalPanelClass} role="dialog" aria-labelledby="confirm-posts-title">
        <h2 id="confirm-posts-title" className="text-lg font-semibold text-foreground">
          Confirm social posts
        </h2>
        <p className="mt-1 text-sm text-muted">
          {label} — add at least one post link (LinkedIn or blog).
        </p>
        <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 space-y-4">
          <label className="block text-sm">
            <span className="text-xs font-medium uppercase tracking-widest text-muted/80">
              LinkedIn post URL
            </span>
            <input
              type="url"
              className="mt-1 w-full rounded-xl border border-border px-3 py-2.5 text-sm text-foreground focus:border-[#3b82f6] focus:outline-none"
              value={linkedinUrl}
              onChange={(e) => setLinkedinUrl(e.target.value)}
              placeholder="https://linkedin.com/…"
            />
          </label>
          <label className="block text-sm">
            <span className="text-xs font-medium uppercase tracking-widest text-muted/80">
              Blog post URL
            </span>
            <input
              type="url"
              className="mt-1 w-full rounded-xl border border-border px-3 py-2.5 text-sm text-foreground focus:border-[#3b82f6] focus:outline-none"
              value={blogUrl}
              onChange={(e) => setBlogUrl(e.target.value)}
              placeholder="https://…"
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
              {submitting ? "Saving…" : "Confirm posts"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

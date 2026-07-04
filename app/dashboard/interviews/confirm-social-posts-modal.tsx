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
  const subtitle = isProject
    ? `${interview.project_candidates?.project_title?.trim() || "Project"} · ${interview.project_candidates?.email ?? ""}`
    : `${interview.candidates?.full_name ?? "Candidate"} · ${interview.candidates?.email ?? ""}`;

  const inp =
    "mt-1 w-full rounded-xl border border-border px-3 py-2.5 text-sm text-foreground focus:border-[#3b82f6] focus:outline-none focus:ring-0";
  const lab = "text-xs font-medium uppercase tracking-widest text-muted/80";

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
      <button
        type="button"
        className="absolute inset-0"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        className={`${modalPanelClass} p-6 shadow-card`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-posts-title"
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 id="confirm-posts-title" className="text-lg font-semibold text-foreground">
              Confirm social posts
            </h2>
            <p className="text-sm text-muted">{subtitle}</p>
          </div>
          <button
            type="button"
            className="rounded-xl p-2 text-muted/80 transition-all hover:bg-background hover:text-foreground"
            aria-label="Close dialog"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <p className="text-sm text-muted">
          Add at least one post link for {label} — LinkedIn or blog.
        </p>

        <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 space-y-4 text-sm">
          {error ? (
            <p className="rounded-xl border border-border-subtle bg-background px-3 py-2 text-sm text-foreground">
              {error}
            </p>
          ) : null}

          <label className="block text-sm">
            <span className={lab}>LinkedIn post URL</span>
            <input
              type="url"
              className={inp}
              value={linkedinUrl}
              onChange={(e) => setLinkedinUrl(e.target.value)}
              placeholder="https://linkedin.com/…"
            />
          </label>

          <label className="block text-sm">
            <span className={lab}>Blog post URL</span>
            <input
              type="url"
              className={inp}
              value={blogUrl}
              onChange={(e) => setBlogUrl(e.target.value)}
              placeholder="https://…"
            />
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="rounded-xl border border-border-subtle bg-elevated px-4 py-2 text-sm font-medium text-foreground transition-all hover:bg-background/80"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background transition-all hover:opacity-90 disabled:opacity-50"
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

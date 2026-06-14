"use client";

import { X } from "lucide-react";

import type { ProjectCandidateRow } from "@/app/dashboard/interviews/types";
import { modalPanelClass } from "@/lib/modal-responsive";

function nameFromEmailPrefix(pc: ProjectCandidateRow): string {
  const fn = pc.full_name?.trim();
  if (fn) return fn;
  const e = pc.email?.trim();
  if (!e) return "—";
  const local = e.split("@")[0] ?? "";
  if (!local) return "—";
  return local.charAt(0).toUpperCase() + local.slice(1);
}

function dialogTitle(pc: ProjectCandidateRow): string {
  const t = pc.project_title?.trim();
  if (t) return t;
  return nameFromEmailPrefix(pc);
}

type Props = {
  open: boolean;
  candidate: ProjectCandidateRow | null;
  onClose: () => void;
};

export function ProjectCandidateDetailModal({
  open,
  candidate,
  onClose,
}: Props) {
  if (!open || !candidate) return null;

  const demo = candidate.demo_link?.trim();

  return (
    <div className="fixed inset-0 z-[80] flex min-h-0 items-center justify-center bg-foreground/60 p-0 backdrop-blur-sm sm:p-4">
      <button
        type="button"
        className="absolute inset-0"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={`${modalPanelClass} shadow-[0_8px_32px_rgba(0,0,0,0.12)]`}
      >
        <div className="flex items-start justify-between border-b border-[#f5f5f5] px-6 py-4">
          <h2 className="pr-8 text-lg font-semibold text-foreground">
            {dialogTitle(candidate)}
          </h2>
          <button
            type="button"
            className="rounded-lg p-2 text-muted/80 transition-colors hover:bg-background hover:text-foreground"
            aria-label="Close"
            onClick={onClose}
          >
            <X className="h-5 w-5" strokeWidth={2} />
          </button>
        </div>
        <div className="space-y-4 px-6 py-5 text-sm text-foreground">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-muted/80">
              Name
            </p>
            <p className="mt-1">{nameFromEmailPrefix(candidate)}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-muted/80">
              Phone
            </p>
            <p className="mt-1">
              {candidate.whatsapp_number?.trim() || (
                <span className="text-muted">—</span>
              )}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-muted/80">
              Email
            </p>
            <p className="mt-1 break-all">{candidate.email}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-muted/80">
              Project title
            </p>
            <p className="mt-1 whitespace-pre-wrap">
              {candidate.project_title?.trim() || (
                <span className="text-muted">—</span>
              )}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-muted/80">
              Problem statement
            </p>
            <p className="mt-1 whitespace-pre-wrap">
              {candidate.problem_statement?.trim() || (
                <span className="text-muted">—</span>
              )}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-muted/80">
              Target user
            </p>
            <p className="mt-1 whitespace-pre-wrap">
              {candidate.target_user?.trim() || (
                <span className="text-muted">—</span>
              )}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-muted/80">
              AI usage
            </p>
            <p className="mt-1 whitespace-pre-wrap">
              {candidate.ai_usage?.trim() || (
                <span className="text-muted">—</span>
              )}
            </p>
          </div>
          {demo ? (
            <a
              href={demo}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex rounded-xl bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-colors hover:opacity-90"
            >
              View Demo
            </a>
          ) : (
            <p className="text-xs text-muted">No demo link provided</p>
          )}
        </div>
      </div>
    </div>
  );
}

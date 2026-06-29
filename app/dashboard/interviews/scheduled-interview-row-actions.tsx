"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  canEdit: boolean;
  showAssignInterviewer: boolean;
  canRevert: boolean;
  revertBusy?: boolean;
  canReschedule: boolean;
  canNoShow: boolean;
  canMarkCompleted: boolean;
  markCompletedTitle?: string;
  revertTitle?: string;
  blockedTitle?: string;
  onEdit: () => void;
  onAssignInterviewer: () => void;
  onRevert: () => void;
  onReschedule: () => void;
  onNoShow: () => void;
  onMarkCompleted: () => void;
};

function menuBtn(disabled: boolean, danger = false) {
  const base =
    "w-full rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";
  if (danger) {
    return `${base} text-[#dc2626] hover:bg-[#fef2f2] disabled:hover:bg-transparent`;
  }
  return `${base} text-foreground hover:bg-background/80`;
}

export function ScheduledInterviewRowActions({
  canEdit,
  showAssignInterviewer,
  canRevert,
  revertBusy = false,
  canReschedule,
  canNoShow,
  canMarkCompleted,
  markCompletedTitle,
  revertTitle,
  blockedTitle,
  onEdit,
  onAssignInterviewer,
  onRevert,
  onReschedule,
  onNoShow,
  onMarkCompleted,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  const viewOnlyTitle = !canEdit ? "View only" : undefined;
  const closeMenu = () => setMenuOpen(false);

  return (
    <div
      ref={rootRef}
      className="relative flex items-center justify-end gap-1.5"
      data-scheduled-actions-root
    >
      {showAssignInterviewer ? (
        <button
          type="button"
          disabled={!canEdit}
          title={viewOnlyTitle}
          className="rounded-lg bg-[#2563eb] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => {
            if (!canEdit) return;
            onAssignInterviewer();
          }}
        >
          Assign
        </button>
      ) : (
        <button
          type="button"
          disabled={!canEdit || !canMarkCompleted}
          title={viewOnlyTitle ?? markCompletedTitle ?? blockedTitle}
          className="rounded-lg bg-[#16a34a] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#15803d] disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => {
            if (!canEdit || !canMarkCompleted) return;
            onMarkCompleted();
          }}
        >
          Complete
        </button>
      )}

      <button
        type="button"
        disabled={!canEdit}
        title={viewOnlyTitle ?? "More actions"}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        className="rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-xs font-medium text-muted hover:bg-background/80 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (!canEdit) return;
          setMenuOpen((open) => !open);
        }}
      >
        More
      </button>

      {menuOpen ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1.5 min-w-[11rem] rounded-xl border border-border-subtle bg-elevated p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            className={menuBtn(!canEdit)}
            disabled={!canEdit}
            title={viewOnlyTitle}
            onClick={() => {
              if (!canEdit) return;
              closeMenu();
              onEdit();
            }}
          >
            Edit details
          </button>

          {showAssignInterviewer ? (
            <button
              type="button"
              role="menuitem"
              className={menuBtn(!canEdit)}
              disabled={!canEdit}
              title={viewOnlyTitle}
              onClick={() => {
                if (!canEdit) return;
                closeMenu();
                onAssignInterviewer();
              }}
            >
              Assign interviewer
            </button>
          ) : null}

          <button
            type="button"
            role="menuitem"
            className={menuBtn(!canEdit || !canRevert || revertBusy)}
            disabled={!canEdit || !canRevert || revertBusy}
            title={viewOnlyTitle ?? revertTitle}
            onClick={() => {
              if (!canEdit || !canRevert || revertBusy) return;
              closeMenu();
              onRevert();
            }}
          >
            {revertBusy ? "Reverting…" : "Revert to callings"}
          </button>

          <button
            type="button"
            role="menuitem"
            className={menuBtn(!canEdit || !canReschedule)}
            disabled={!canEdit || !canReschedule}
            title={viewOnlyTitle ?? blockedTitle}
            onClick={() => {
              if (!canEdit || !canReschedule) return;
              closeMenu();
              onReschedule();
            }}
          >
            Reschedule
          </button>

          <button
            type="button"
            role="menuitem"
            className={menuBtn(!canEdit || !canNoShow, true)}
            disabled={!canEdit || !canNoShow}
            title={viewOnlyTitle ?? blockedTitle}
            onClick={() => {
              if (!canEdit || !canNoShow) return;
              closeMenu();
              onNoShow();
            }}
          >
            Mark as no show
          </button>

          {!showAssignInterviewer ? (
            <button
              type="button"
              role="menuitem"
              className={menuBtn(!canEdit || !canMarkCompleted)}
              disabled={!canEdit || !canMarkCompleted}
              title={viewOnlyTitle ?? markCompletedTitle ?? blockedTitle}
              onClick={() => {
                if (!canEdit || !canMarkCompleted) return;
                closeMenu();
                onMarkCompleted();
              }}
            >
              Mark completed
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

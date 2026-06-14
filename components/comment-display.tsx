"use client";

import { useState } from "react";

type StoredCommentTextProps = {
  value: string | null | undefined;
  emptyLabel?: string;
  /** When set, long text can be expanded (table previews). Omit to show full text. */
  collapseAfter?: number;
  className?: string;
};

/** Read-only display for saved comments, notes, or remarks. */
export function StoredCommentText({
  value,
  emptyLabel = "—",
  collapseAfter,
  className = "",
}: StoredCommentTextProps) {
  const text = value?.trim() ?? "";
  const [expanded, setExpanded] = useState(false);

  if (!text) {
    return (
      <span className={`text-muted/80 ${className}`.trim()}>{emptyLabel}</span>
    );
  }

  const limit = collapseAfter ?? 0;
  const needsCollapse = limit > 0 && text.length > limit;
  const shown =
    needsCollapse && !expanded ? `${text.slice(0, limit)}…` : text;

  return (
    <div className={`min-w-0 ${className}`.trim()}>
      <p className="whitespace-pre-wrap break-words text-foreground">{shown}</p>
      {needsCollapse ? (
        <button
          type="button"
          className="mt-1 text-xs font-medium text-[#3b82f6] hover:underline"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}

/** Scrollable comment cell for data tables — full saved text stays visible. */
export function CommentTableCell({
  value,
  className = "",
}: {
  value: string | null | undefined;
  className?: string;
}) {
  const text = value?.trim() ?? "";
  if (!text) {
    return <span className="text-muted/80">—</span>;
  }
  return (
    <div
      className={`max-h-28 min-w-[8rem] max-w-[20rem] overflow-y-auto whitespace-pre-wrap break-words text-xs leading-snug text-foreground ${className}`.trim()}
      title={text}
    >
      {text}
    </div>
  );
}

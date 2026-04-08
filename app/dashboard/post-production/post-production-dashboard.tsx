"use client";

import { format, parseISO } from "date-fns";
import { Loader2, Pencil, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CandidateDetailModal } from "@/components/candidate-detail-modal";
import { logActivity } from "@/lib/activity-logger";
import {
  effectiveInterviewLanguage,
  formatInterviewLanguageLabel,
  interviewLanguageBadgeClass,
  matchesInterviewLanguageFilter,
  type InterviewLanguageFilter,
} from "@/lib/interview-language";
import { createBrowserSupabaseClient } from "@/lib/supabase-browser";

const TEAM = ["Harika", "Anushka", "Gargi", "Mudit"] as const;

type YoutubeStatus = "private" | "unlisted" | "live";
type ReviewState = "done" | "not_done";

export type PostProductionRow = {
  id: string;
  created_at: string;
  candidate_id: string | null;
  candidate_name: string | null;
  raw_video_link: string | null;
  edited_video_link: string | null;
  pre_edit_review: ReviewState;
  pre_edit_review_by: string | null;
  post_edit_review: ReviewState;
  post_edit_review_by: string | null;
  edited_by: string | null;
  youtube_link: string | null;
  youtube_status: YoutubeStatus;
  summary: string | null;
  cx_mail_sent: boolean;
  cx_mail_sent_at: string | null;
  updated_at: string;
  interview_language: string | null;
};

type LinkField = "raw_video_link" | "edited_video_link" | "youtube_link";

const PP_SELECT =
  "id, created_at, candidate_id, candidate_name, raw_video_link, edited_video_link, pre_edit_review, pre_edit_review_by, post_edit_review, post_edit_review_by, edited_by, youtube_link, youtube_status, summary, cx_mail_sent, cx_mail_sent_at, updated_at, interview_language";

const cardChrome =
  "rounded-2xl bg-white shadow-[0_4px_16px_rgba(0,0,0,0.08)] border border-[#f0f0f0]";

function youtubeStatusBadge(status: YoutubeStatus) {
  if (status === "live") {
    return (
      <span className="inline-flex rounded-full bg-[#f0fdf4] px-2.5 py-1 text-xs font-medium text-[#16a34a]">
        Live
      </span>
    );
  }
  if (status === "unlisted") {
    return (
      <span className="inline-flex rounded-full bg-[#fef9c3] px-2.5 py-1 text-xs font-medium text-[#854d0e]">
        Unlisted
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full bg-[#f4f4f5] px-2.5 py-1 text-xs font-medium text-[#52525b]">
      Private
    </span>
  );
}

type CompletedPick = {
  candidate_id: string;
  full_name: string | null;
  email: string;
};

export function PostProductionDashboard() {
  const supabase = useMemo(() => {
    try {
      return createBrowserSupabaseClient();
    } catch {
      return null;
    }
  }, []);

  const [rows, setRows] = useState<PostProductionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [ytFilter, setYtFilter] = useState<YoutubeStatus | "all">("all");
  const [preFilter, setPreFilter] = useState<ReviewState | "all">("all");
  const [postFilter, setPostFilter] = useState<ReviewState | "all">("all");

  const [detailCandidateId, setDetailCandidateId] = useState<string | null>(
    null,
  );
  const [summaryModalText, setSummaryModalText] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [completedPicks, setCompletedPicks] = useState<CompletedPick[]>([]);
  const [addLoading, setAddLoading] = useState(false);
  const [selectedAdd, setSelectedAdd] = useState<CompletedPick | null>(null);
  const [addSubmitting, setAddSubmitting] = useState(false);

  const [linkEdit, setLinkEdit] = useState<{
    rowId: string;
    field: LinkField;
    value: string;
  } | null>(null);

  const [reviewPopover, setReviewPopover] = useState<{
    rowId: string;
    kind: "pre" | "post";
  } | null>(null);
  const [reviewBy, setReviewBy] = useState<(typeof TEAM)[number]>("Harika");
  const reviewRootRef = useRef<HTMLDivElement>(null);

  const loadRows = useCallback(async () => {
    if (!supabase) return;
    const { data, error: e } = await supabase
      .from("post_production")
      .select(PP_SELECT)
      .order("created_at", { ascending: false });
    if (e) {
      setError(e.message);
      return;
    }
    setRows((data ?? []) as PostProductionRow[]);
    setError(null);
  }, [supabase]);

  useEffect(() => {
    if (!supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }
    void (async () => {
      setLoading(true);
      await loadRows();
      setLoading(false);
    })();
  }, [supabase, loadRows]);

  useEffect(() => {
    if (!supabase) return;
    const ch = supabase
      .channel("post-production")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "post_production" },
        () => {
          void loadRows();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [supabase, loadRows]);

  useEffect(() => {
    if (!reviewPopover) return;
    const onDoc = (e: MouseEvent) => {
      const el = reviewRootRef.current;
      if (el && !el.contains(e.target as Node)) setReviewPopover(null);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [reviewPopover]);

  const stats = useMemo(() => {
    const total = rows.length;
    const prePending = rows.filter((r) => r.pre_edit_review === "not_done")
      .length;
    const postPending = rows.filter((r) => r.post_edit_review === "not_done")
      .length;
    const live = rows.filter((r) => r.youtube_status === "live").length;
    return { total, prePending, postPending, live };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const name = (r.candidate_name ?? "").toLowerCase();
      if (q && !name.includes(q)) return false;
      if (ytFilter !== "all" && r.youtube_status !== ytFilter) return false;
      if (preFilter !== "all" && r.pre_edit_review !== preFilter) return false;
      if (postFilter !== "all" && r.post_edit_review !== postFilter)
        return false;
      return true;
    });
  }, [rows, search, ytFilter, preFilter, postFilter]);

  const openAddModal = async () => {
    if (!supabase) return;
    setAddOpen(true);
    setAddSearch("");
    setSelectedAdd(null);
    setAddLoading(true);
    const [{ data: inv }, { data: existing }] = await Promise.all([
      supabase
        .from("interviews")
        .select("candidate_id, candidates ( id, full_name, email )")
        .eq("interview_status", "completed"),
      supabase.from("post_production").select("candidate_id"),
    ]);
    setAddLoading(false);
    const inPost = new Set(
      (existing ?? [])
        .map((r) => r.candidate_id as string | null)
        .filter(Boolean) as string[],
    );
    const map = new Map<string, CompletedPick>();
    for (const row of inv ?? []) {
      const r = row as {
        candidate_id: string;
        candidates:
          | { id: string; full_name: string | null; email: string }
          | { id: string; full_name: string | null; email: string }[]
          | null;
      };
      const cid = r.candidate_id;
      if (!cid || inPost.has(cid)) continue;
      const c = r.candidates;
      const cand = Array.isArray(c) ? c[0] : c;
      if (!cand) continue;
      map.set(cid, {
        candidate_id: cid,
        full_name: cand.full_name,
        email: cand.email,
      });
    }
    setCompletedPicks([...map.values()]);
  };

  const addFiltered = useMemo(() => {
    const q = addSearch.trim().toLowerCase();
    if (!q) return completedPicks;
    return completedPicks.filter(
      (p) =>
        (p.full_name ?? "").toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q),
    );
  }, [completedPicks, addSearch]);

  const confirmAdd = async () => {
    if (!supabase || !selectedAdd) return;
    setAddSubmitting(true);
    const name =
      selectedAdd.full_name?.trim() ||
      selectedAdd.email.split("@")[0] ||
      "Candidate";
    const { data: ins, error: e } = await supabase
      .from("post_production")
      .insert({
        candidate_id: selectedAdd.candidate_id,
        candidate_name: name,
      })
      .select("id")
      .single();
    setAddSubmitting(false);
    if (e) {
      setError(
        e.code === "23505"
          ? "This candidate is already in post production."
          : e.message,
      );
      return;
    }
    const { data: auth } = await supabase.auth.getUser();
    if (auth.user) {
      await logActivity({
        supabase,
        user: auth.user,
        action_type: "post_production",
        entity_type: "post_production",
        entity_id: ins?.id ?? null,
        candidate_name: name,
        description: `Added ${name} to post production`,
      });
    }
    setAddOpen(false);
    void loadRows();
  };

  const patchRow = async (
    id: string,
    patch: Record<string, unknown>,
    log?: { description: string; candidateName: string },
  ) => {
    if (!supabase) return;
    setSavingId(id);
    const { error: e } = await supabase
      .from("post_production")
      .update(patch)
      .eq("id", id);
    setSavingId(null);
    if (e) {
      setError(e.message);
      return;
    }
    if (log) {
      const { data: auth } = await supabase.auth.getUser();
      if (auth.user) {
        await logActivity({
          supabase,
          user: auth.user,
          action_type: "post_production",
          entity_type: "post_production",
          entity_id: id,
          candidate_name: log.candidateName,
          description: log.description,
        });
      }
    }
    void loadRows();
  };

  const saveLink = async (row: PostProductionRow, field: LinkField) => {
    if (!linkEdit || linkEdit.rowId !== row.id || linkEdit.field !== field)
      return;
    const v = linkEdit.value.trim() || null;
    await patchRow(row.id, { [field]: v });
    setLinkEdit(null);
  };

  const confirmReviewDone = async () => {
    if (!supabase || !reviewPopover) return;
    const row = rows.find((r) => r.id === reviewPopover.rowId);
    if (!row) return;
    const name = row.candidate_name?.trim() || "Candidate";
    if (reviewPopover.kind === "pre") {
      await patchRow(
        row.id,
        {
          pre_edit_review: "done",
          pre_edit_review_by: reviewBy,
        },
        {
          description: `Marked pre-edit review done for ${name} by ${reviewBy}`,
          candidateName: name,
        },
      );
    } else {
      await patchRow(
        row.id,
        {
          post_edit_review: "done",
          post_edit_review_by: reviewBy,
        },
        {
          description: `Marked post-edit review done for ${name} by ${reviewBy}`,
          candidateName: name,
        },
      );
    }
    setReviewPopover(null);
  };

  const onYoutubeStatusChange = async (
    row: PostProductionRow,
    next: YoutubeStatus,
  ) => {
    if (row.youtube_status === next) return;
    const name = row.candidate_name?.trim() || "Candidate";
    const label =
      next === "live" ? "Live" : next === "unlisted" ? "Unlisted" : "Private";
    await patchRow(
      row.id,
      { youtube_status: next },
      {
        description: `Updated YouTube status to ${label} for ${name}`,
        candidateName: name,
      },
    );
  };

  const generateSummary = async (row: PostProductionRow) => {
    if (!supabase) return;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setError("You must be signed in to generate a summary.");
      return;
    }
    setSavingId(row.id);
    try {
      const res = await fetch("/api/generate-summary", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ post_production_id: row.id }),
      });
      const j = (await res.json()) as { error?: string; summary?: string };
      if (!res.ok) {
        setError(j.error ?? "Summary generation failed");
        return;
      }
      void loadRows();
    } catch {
      setError("Summary request failed");
    } finally {
      setSavingId(null);
    }
  };

  const sendCxMail = async (row: PostProductionRow) => {
    if (!supabase || row.cx_mail_sent) return;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setError("You must be signed in to send CX mail.");
      return;
    }
    setSavingId(row.id);
    try {
      const res = await fetch("/api/post-production-cx-mail", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ post_production_id: row.id }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(j.error ?? "Failed to send CX mail");
        return;
      }
      void loadRows();
    } catch {
      setError("CX mail request failed");
    } finally {
      setSavingId(null);
    }
  };

  const renderLinkCell = (row: PostProductionRow, field: LinkField) => {
    const raw = row[field]?.trim() ?? "";
    const editing =
      linkEdit?.rowId === row.id && linkEdit.field === field;
    const busy = savingId === row.id;

    if (editing) {
      return (
        <div className="flex max-w-[200px] flex-col gap-1">
          <input
            type="url"
            className="w-full rounded-lg border border-[#e5e5e5] px-2 py-1 text-xs"
            placeholder="https://..."
            value={linkEdit.value}
            onChange={(e) =>
              setLinkEdit((prev) =>
                prev ? { ...prev, value: e.target.value } : prev,
              )
            }
            autoFocus
          />
          <div className="flex gap-1">
            <button
              type="button"
              disabled={busy}
              className="rounded bg-[#1d1d1f] px-2 py-0.5 text-[11px] text-white disabled:opacity-50"
              onClick={() => void saveLink(row, field)}
            >
              Save
            </button>
            <button
              type="button"
              className="text-[11px] text-[#6e6e73] underline"
              onClick={() => setLinkEdit(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      );
    }

    if (!raw) {
      return (
        <button
          type="button"
          disabled={busy}
          className="rounded-lg border border-[#e5e5e5] bg-[#fafafa] px-2 py-1 text-xs font-medium text-[#6e6e73] hover:bg-[#f0f0f0] disabled:opacity-50"
          onClick={() =>
            setLinkEdit({ rowId: row.id, field, value: "" })
          }
        >
          Add link
        </button>
      );
    }

    return (
      <div className="flex flex-wrap items-center gap-1">
        <a
          href={raw}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg bg-[#1d1d1f] px-2 py-1 text-xs font-medium text-white hover:bg-[#2d2d2f]"
        >
          View
        </a>
        <button
          type="button"
          disabled={busy}
          className="rounded p-1 text-[#3b82f6] hover:bg-[#eff6ff] disabled:opacity-50"
          aria-label="Edit link"
          onClick={() =>
            setLinkEdit({ rowId: row.id, field, value: raw })
          }
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  };

  const renderReviewCell = (
    row: PostProductionRow,
    kind: "pre" | "post",
  ) => {
    const done =
      kind === "pre"
        ? row.pre_edit_review === "done"
        : row.post_edit_review === "done";
    const by =
      kind === "pre" ? row.pre_edit_review_by : row.post_edit_review_by;
    const busy = savingId === row.id;
    const open =
      reviewPopover?.rowId === row.id && reviewPopover.kind === kind;

    if (done) {
      return (
        <div className="space-y-0.5">
          <span className="inline-flex rounded-full bg-[#f0fdf4] px-2 py-0.5 text-xs font-medium text-[#16a34a]">
            ✓ Done
          </span>
          {by ? (
            <p className="text-[11px] text-[#6e6e73]">by {by}</p>
          ) : null}
        </div>
      );
    }

    return (
      <div className="relative" ref={open ? reviewRootRef : null}>
        <div className="space-y-1">
          <span className="inline-flex rounded-full bg-[#fef2f2] px-2 py-0.5 text-xs font-medium text-[#dc2626]">
            ✗ Not Done
          </span>
          <div>
            <button
              type="button"
              disabled={busy}
              className="text-xs font-medium text-[#3b82f6] hover:underline disabled:opacity-50"
              onClick={() => {
                setReviewBy("Harika");
                setReviewPopover({ rowId: row.id, kind });
              }}
            >
              Mark Done
            </button>
          </div>
        </div>
        {open ? (
          <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-xl border border-[#f0f0f0] bg-white p-3 shadow-lg">
            <p className="text-xs font-medium text-[#1d1d1f]">Done by</p>
            <select
              className="mt-2 w-full rounded-lg border border-[#e5e5e5] px-2 py-1.5 text-xs"
              value={reviewBy}
              onChange={(e) =>
                setReviewBy(e.target.value as (typeof TEAM)[number])
              }
            >
              {TEAM.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                className="text-xs text-[#6e6e73]"
                onClick={() => setReviewPopover(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg bg-[#1d1d1f] px-3 py-1 text-xs text-white"
                onClick={() => void confirmReviewDone()}
              >
                Confirm
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  const th =
    "border-b border-gray-100 bg-[#fafafa] py-3 px-3 text-left text-xs font-semibold tracking-wider text-gray-400";
  const td =
    "border-b border-gray-100 px-3 py-3 text-sm align-top text-[#1d1d1f]";

  if (!supabase) {
    return (
      <div className="px-8 py-16 text-center text-sm text-[#6e6e73]">
        {error ?? "Cannot connect to Supabase."}
      </div>
    );
  }

  return (
    <>
      <header className="sticky top-0 z-30 bg-[#f5f5f7]/90 px-8 py-6 backdrop-blur-md">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[#1d1d1f]">
              Post Production
            </h1>
            <p className="mt-1 text-sm text-[#6e6e73]">
              Manage interview video editing and publishing pipeline
            </p>
          </div>
          <button
            type="button"
            onClick={() => void openAddModal()}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-[#1d1d1f] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#2d2d2f]"
          >
            <Plus className="h-4 w-4" />
            Add to Post Production
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1800px] px-8 pb-16 pt-2">
        {error ? (
          <div className="mb-4 rounded-2xl border border-[#f0f0f0] bg-white px-4 py-3 text-sm shadow-sm">
            {error}
            <button
              type="button"
              className="ml-2 font-medium text-[#3b82f6]"
              onClick={() => setError(null)}
            >
              Dismiss
            </button>
          </div>
        ) : null}

        {loading ? (
          <p className="text-sm text-[#6e6e73]">Loading…</p>
        ) : (
          <>
            <section className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {(
                [
                  ["Total entries", stats.total],
                  ["Pre-edit review pending", stats.prePending],
                  ["Post-edit review pending", stats.postPending],
                  ["Live on YouTube", stats.live],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className={`p-6 ${cardChrome}`}>
                  <p className="mb-2 text-xs font-medium text-[#6e6e73]">
                    {label}
                  </p>
                  <p className="text-3xl font-bold tabular-nums text-[#1d1d1f]">
                    {value}
                  </p>
                </div>
              ))}
            </section>

            <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-[#f0f0f0] bg-white p-4 shadow-sm lg:flex-row lg:flex-wrap lg:items-end">
              <label className="flex min-w-[160px] flex-1 flex-col gap-1">
                <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
                  Search
                </span>
                <input
                  type="search"
                  placeholder="Candidate name"
                  className="rounded-xl border border-[#e5e5e5] px-3 py-2 text-sm"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <label className="flex w-full flex-col gap-1 sm:w-40">
                <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
                  YouTube status
                </span>
                <select
                  className="rounded-xl border border-[#e5e5e5] px-3 py-2 text-sm"
                  value={ytFilter}
                  onChange={(e) =>
                    setYtFilter(e.target.value as YoutubeStatus | "all")
                  }
                >
                  <option value="all">All</option>
                  <option value="private">Private</option>
                  <option value="unlisted">Unlisted</option>
                  <option value="live">Live</option>
                </select>
              </label>
              <label className="flex w-full flex-col gap-1 sm:w-44">
                <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
                  Pre-edit review
                </span>
                <select
                  className="rounded-xl border border-[#e5e5e5] px-3 py-2 text-sm"
                  value={preFilter}
                  onChange={(e) =>
                    setPreFilter(e.target.value as ReviewState | "all")
                  }
                >
                  <option value="all">All</option>
                  <option value="done">Done</option>
                  <option value="not_done">Not Done</option>
                </select>
              </label>
              <label className="flex w-full flex-col gap-1 sm:w-44">
                <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
                  Post-edit review
                </span>
                <select
                  className="rounded-xl border border-[#e5e5e5] px-3 py-2 text-sm"
                  value={postFilter}
                  onChange={(e) =>
                    setPostFilter(e.target.value as ReviewState | "all")
                  }
                >
                  <option value="all">All</option>
                  <option value="done">Done</option>
                  <option value="not_done">Not Done</option>
                </select>
              </label>
              <button
                type="button"
                className="rounded-xl border border-[#e5e5e5] bg-white px-4 py-2 text-sm font-medium text-[#1d1d1f] hover:bg-[#fafafa] lg:mb-0.5"
                onClick={() => {
                  setSearch("");
                  setYtFilter("all");
                  setPreFilter("all");
                  setPostFilter("all");
                }}
              >
                Clear filters
              </button>
            </div>

            <div className="overflow-hidden rounded-2xl border border-[#f0f0f0] bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1400px] table-auto border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className={th}>Name</th>
                      <th className={th}>Raw video</th>
                      <th className={th}>Edited video</th>
                      <th className={th}>Pre-edit review</th>
                      <th className={th}>Post-edit review</th>
                      <th className={th}>Edited by</th>
                      <th className={th}>YouTube</th>
                      <th className={th}>Status</th>
                      <th className={th}>Summary</th>
                      <th className={`${th} text-right`}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr>
                        <td
                          className={`${td} py-16 text-center text-[#aeaeb2]`}
                          colSpan={10}
                        >
                          {rows.length === 0
                            ? "No entries yet. Add completed interviews to start the post production pipeline."
                            : "No rows match your filters."}
                        </td>
                      </tr>
                    ) : (
                      filtered.map((row) => {
                        const cid = row.candidate_id;
                        const busy = savingId === row.id;
                        return (
                          <tr key={row.id}>
                            <td className={td}>
                              {cid ? (
                                <button
                                  type="button"
                                  className="text-left font-medium text-[#3b82f6] hover:underline"
                                  onClick={() => setDetailCandidateId(cid)}
                                >
                                  {row.candidate_name?.trim() || "—"}
                                </button>
                              ) : (
                                <span>{row.candidate_name?.trim() || "—"}</span>
                              )}
                            </td>
                            <td className={td}>
                              {renderLinkCell(row, "raw_video_link")}
                            </td>
                            <td className={td}>
                              {renderLinkCell(row, "edited_video_link")}
                            </td>
                            <td className={td}>
                              {renderReviewCell(row, "pre")}
                            </td>
                            <td className={td}>
                              {renderReviewCell(row, "post")}
                            </td>
                            <td className={td}>
                              {row.edited_by?.trim() ? (
                                <div className="flex flex-col gap-1">
                                  <span className="inline-flex w-fit rounded-full bg-[#f5f5f7] px-2.5 py-1 text-xs font-medium text-[#6e6e73]">
                                    {row.edited_by}
                                  </span>
                                  <select
                                    disabled={busy}
                                    className="max-w-[160px] rounded-lg border border-[#e5e5e5] px-2 py-1 text-xs disabled:opacity-50"
                                    value={
                                      TEAM.includes(
                                        row.edited_by as (typeof TEAM)[number],
                                      )
                                        ? row.edited_by
                                        : "__custom__"
                                    }
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      if (v === "__custom__") return;
                                      void patchRow(row.id, {
                                        edited_by: v || null,
                                      });
                                    }}
                                  >
                                    {!TEAM.includes(
                                      row.edited_by as (typeof TEAM)[number],
                                    ) ? (
                                      <option value="__custom__">
                                        {row.edited_by}
                                      </option>
                                    ) : null}
                                    {TEAM.map((n) => (
                                      <option key={n} value={n}>
                                        {n}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              ) : (
                                <select
                                  disabled={busy}
                                  className="max-w-[130px] rounded-lg border border-[#e5e5e5] px-2 py-1 text-xs disabled:opacity-50"
                                  value=""
                                  onChange={(e) => {
                                    const v = e.target.value || null;
                                    if (v)
                                      void patchRow(row.id, { edited_by: v });
                                  }}
                                >
                                  <option value="">Assign…</option>
                                  {TEAM.map((n) => (
                                    <option key={n} value={n}>
                                      {n}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </td>
                            <td className={td}>
                              {renderLinkCell(row, "youtube_link")}
                            </td>
                            <td className={td}>
                              <div className="flex flex-col gap-1">
                                {youtubeStatusBadge(row.youtube_status)}
                                <select
                                  disabled={busy}
                                  className="max-w-[120px] rounded-lg border border-[#e5e5e5] px-2 py-1 text-xs disabled:opacity-50"
                                  value={row.youtube_status}
                                  onChange={(e) =>
                                    void onYoutubeStatusChange(
                                      row,
                                      e.target.value as YoutubeStatus,
                                    )
                                  }
                                >
                                  <option value="private">Private</option>
                                  <option value="unlisted">Unlisted</option>
                                  <option value="live">Live</option>
                                </select>
                              </div>
                            </td>
                            <td className={td}>
                              <div className="max-w-[180px] space-y-1">
                                {!row.summary?.trim() ? (
                                  <span className="text-[#aeaeb2]">—</span>
                                ) : (
                                  <button
                                    type="button"
                                    className="text-xs font-medium text-[#3b82f6] hover:underline"
                                    onClick={() =>
                                      setSummaryModalText(row.summary)
                                    }
                                  >
                                    View
                                  </button>
                                )}
                                {row.youtube_status === "live" ? (
                                  <div>
                                    <button
                                      type="button"
                                      disabled={busy}
                                      className="text-xs font-medium text-[#1d1d1f] underline decoration-[#d1d5db] disabled:opacity-50"
                                      onClick={() => void generateSummary(row)}
                                    >
                                      Generate
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            </td>
                            <td className={`${td} text-right`}>
                              {row.youtube_status === "live" ? (
                                <div className="flex flex-col items-end gap-1">
                                  <button
                                    type="button"
                                    disabled={busy || row.cx_mail_sent}
                                    className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                                      row.cx_mail_sent
                                        ? "cursor-default bg-[#f4f4f5] text-[#6e6e73]"
                                        : "bg-[#3b82f6] text-white hover:bg-[#2563eb]"
                                    } disabled:opacity-50`}
                                    onClick={() => void sendCxMail(row)}
                                  >
                                    Send CX Mail
                                  </button>
                                  {row.cx_mail_sent &&
                                  row.cx_mail_sent_at ? (
                                    <span className="text-[11px] text-[#16a34a]">
                                      Sent ✓{" "}
                                      {format(
                                        parseISO(row.cx_mail_sent_at),
                                        "MMM d, yyyy h:mm a",
                                      )}
                                    </span>
                                  ) : null}
                                </div>
                              ) : (
                                <span className="text-[#aeaeb2]">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>

      <CandidateDetailModal
        open={!!detailCandidateId}
        candidateId={detailCandidateId}
        supabase={supabase}
        onClose={() => setDetailCandidateId(null)}
      />

      {summaryModalText ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-[#1d1d1f]/40"
            aria-label="Close"
            onClick={() => setSummaryModalText(null)}
          />
          <div className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#f0f0f0] bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-[#1d1d1f]">Summary</h2>
            <p className="mt-4 whitespace-pre-wrap text-sm text-[#1d1d1f]">
              {summaryModalText}
            </p>
            <button
              type="button"
              className="mt-6 text-sm font-medium text-[#3b82f6]"
              onClick={() => setSummaryModalText(null)}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}

      {addOpen ? (
        <div className="fixed inset-0 z-[75] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-[#1d1d1f]/40"
            aria-label="Close"
            onClick={() => setAddOpen(false)}
          />
          <div className="relative w-full max-w-md rounded-2xl border border-[#f0f0f0] bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-[#1d1d1f]">
              Add to Post Production
            </h2>
            <p className="mt-1 text-sm text-[#6e6e73]">
              Only candidates with a completed interview are listed.
            </p>
            {addLoading ? (
              <p className="mt-4 flex items-center gap-2 text-sm text-[#6e6e73]">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </p>
            ) : (
              <>
                <input
                  type="search"
                  className="mt-4 w-full rounded-xl border border-[#e5e5e5] px-3 py-2 text-sm"
                  placeholder="Search by name or email"
                  value={addSearch}
                  onChange={(e) => setAddSearch(e.target.value)}
                />
                <ul className="mt-3 max-h-56 overflow-y-auto rounded-xl border border-[#f0f0f0]">
                  {addFiltered.length === 0 ? (
                    <li className="px-3 py-8 text-center text-sm text-[#aeaeb2]">
                      No candidates found
                    </li>
                  ) : (
                    addFiltered.map((p) => (
                      <li key={p.candidate_id}>
                        <button
                          type="button"
                          className={`w-full px-3 py-2.5 text-left text-sm ${
                            selectedAdd?.candidate_id === p.candidate_id
                              ? "bg-[#eff6ff]"
                              : "hover:bg-[#fafafa]"
                          }`}
                          onClick={() => setSelectedAdd(p)}
                        >
                          <span className="font-medium text-[#1d1d1f]">
                            {p.full_name?.trim() || p.email}
                          </span>
                          <span className="block text-xs text-[#6e6e73]">
                            {p.email}
                          </span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-xl border border-[#e5e5e5] px-4 py-2 text-sm"
                    onClick={() => setAddOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!selectedAdd || addSubmitting}
                    className="rounded-xl bg-[#1d1d1f] px-4 py-2 text-sm text-white disabled:opacity-50"
                    onClick={() => void confirmAdd()}
                  >
                    {addSubmitting ? "Adding…" : "Confirm"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

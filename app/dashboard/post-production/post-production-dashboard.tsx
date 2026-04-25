"use client";

import { format, parseISO } from "date-fns";
import { Loader2, Pencil, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { SupabaseClient } from "@supabase/supabase-js";

import { useAccessControl } from "@/components/access-control-context";
import { CandidateDetailModal } from "@/components/candidate-detail-modal";
import { ProjectCandidateDetailModal } from "@/components/project-candidate-detail-modal";
import type { ProjectCandidateRow } from "@/app/dashboard/interviews/types";
import { logActivity } from "@/lib/activity-logger";
import {
  modalOverlayZ75Class,
  modalOverlayZ80Class,
  modalPanelClass,
} from "@/lib/modal-responsive";
import {
  effectiveInterviewLanguage,
  formatInterviewLanguageLabel,
  interviewLanguageBadgeClass,
  matchesInterviewLanguageFilter,
  type InterviewLanguageFilter,
} from "@/lib/interview-language";
import { notifyPostProductionSlackAfterPatch } from "@/lib/post-production-slack-workflow";
import { getUserSafe } from "@/lib/supabase-auth";
import { createBrowserSupabaseClient } from "@/lib/supabase-browser";
import {
  canMoveToPostProduction,
  POST_PRODUCTION_NOT_ELIGIBLE_ERROR,
} from "@/lib/post-production-eligibility";
import {
  fetchTeamRosterNames,
  mergeRosterWithCurrent,
} from "@/lib/team-roster";

type YoutubeStatus = "private" | "unlisted" | "live";
type ReviewState = "done" | "not_done";
type SourceType = "testimonial" | "project";

const DOMAIN_FILTER_OPTIONS = [
  "Software Engineering",
  "Data (Analyst / Scientist / BA)",
  "Educators / Teaching",
  "Finance",
  "Marketing",
  "Sales",
  "Consulting",
  "Other",
] as const;

type DomainFilterValue = (typeof DOMAIN_FILTER_OPTIONS)[number] | "all";

function testimonialDomainBucket(
  raw: string | null | undefined,
): DomainFilterValue {
  const t = (raw ?? "").trim();
  if (!t) return "Other";
  const d = t.toLowerCase();
  const exact = DOMAIN_FILTER_OPTIONS.find((o) => o.toLowerCase() === d);
  if (exact) return exact;
  if (d === "educators" || d === "teaching") {
    return "Educators / Teaching";
  }
  if (
    d.includes("software") ||
    d.includes("engineering") ||
    d.includes("developer") ||
    d.includes("sde")
  ) {
    return "Software Engineering";
  }
  if (
    d.includes("data") ||
    d.includes("analyst") ||
    d.includes("scientist") ||
    /\bba\b/.test(d)
  ) {
    return "Data (Analyst / Scientist / BA)";
  }
  if (
    d.includes("educator") ||
    d.includes("professor") ||
    d.includes("faculty") ||
    d.includes("teach") ||
    d.includes("tutor") ||
    d.includes("instructor") ||
    d.includes("education")
  ) {
    return "Educators / Teaching";
  }
  if (d.includes("finance") || d.includes("banking") || d.includes("accounting")) {
    return "Finance";
  }
  if (d.includes("market")) return "Marketing";
  if (d.includes("sales")) return "Sales";
  if (d.includes("consult")) return "Consulting";
  return "Other";
}

export type PostProductionRow = {
  id: string;
  created_at: string;
  /** `interviews.id` for testimonial rows */
  interview_id: string | null;
  /** `project_interviews.id` for project rows */
  project_interview_id: string | null;
  candidate_id: string | null;
  project_candidate_id: string | null;
  source_type: SourceType;
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
  candidates?: {
    domain: string | null;
    job_role: string | null;
    is_deleted?: boolean | null;
  } | null;
  project_candidates?: ProjectCandidateRow | ProjectCandidateRow[] | null;
  interviews?:
    | {
        scheduled_date: string | null;
        completed_at: string | null;
        interviewer: string | null;
        zoom_account: string | null;
        interview_language: string | null;
        candidates?:
          | {
              full_name: string | null;
              email: string | null;
              domain: string | null;
              job_role: string | null;
              achievement_summary: string | null;
            }
          | {
              full_name: string | null;
              email: string | null;
              domain: string | null;
              job_role: string | null;
              achievement_summary: string | null;
            }[]
          | null;
      }
    | {
        scheduled_date: string | null;
        completed_at: string | null;
        interviewer: string | null;
        zoom_account: string | null;
        interview_language: string | null;
        candidates?:
          | {
              full_name: string | null;
              email: string | null;
              domain: string | null;
              job_role: string | null;
              achievement_summary: string | null;
            }
          | {
              full_name: string | null;
              email: string | null;
              domain: string | null;
              job_role: string | null;
              achievement_summary: string | null;
            }[]
          | null;
      }[]
    | null;
  project_interviews?:
    | {
        scheduled_date: string | null;
        completed_at: string | null;
        interviewer: string | null;
        zoom_account: string | null;
        project_candidates?:
          | {
              full_name: string | null;
              email: string | null;
              project_title: string | null;
              problem_statement: string | null;
              demo_link: string | null;
            }
          | {
              full_name: string | null;
              email: string | null;
              project_title: string | null;
              problem_statement: string | null;
              demo_link: string | null;
            }[]
          | null;
      }
    | {
        scheduled_date: string | null;
        completed_at: string | null;
        interviewer: string | null;
        zoom_account: string | null;
        project_candidates?:
          | {
              full_name: string | null;
              email: string | null;
              project_title: string | null;
              problem_statement: string | null;
              demo_link: string | null;
            }
          | {
              full_name: string | null;
              email: string | null;
              project_title: string | null;
              problem_statement: string | null;
              demo_link: string | null;
            }[]
          | null;
      }[]
    | null;
};

type LinkField = "raw_video_link" | "edited_video_link" | "youtube_link";

const PP_SELECT =
  "id, created_at, interview_id, project_interview_id, candidate_id, project_candidate_id, source_type, candidate_name, raw_video_link, edited_video_link, pre_edit_review, pre_edit_review_by, post_edit_review, post_edit_review_by, edited_by, youtube_link, youtube_status, summary, cx_mail_sent, cx_mail_sent_at, updated_at, interview_language, candidates ( domain, job_role, is_deleted ), project_candidates ( id, email, full_name, whatsapp_number, project_title, problem_statement, target_user, ai_usage, demo_link, status, poc_assigned, poc_assigned_at, interview_type, is_deleted ), interviews:interview_id ( scheduled_date, completed_at, interviewer, zoom_account, interview_language, candidates ( full_name, email, domain, job_role, achievement_summary ) ), project_interviews:project_interview_id ( scheduled_date, completed_at, interviewer, zoom_account, project_candidates ( full_name, email, project_title, problem_statement, demo_link ) )";

function chunkIds<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Hide rows whose linked interview is no longer eligible (per linked interview ids). */
async function filterPostProductionEligibleRows(
  supabase: SupabaseClient,
  rows: PostProductionRow[],
): Promise<PostProductionRow[]> {
  const staleTestimonialInterviewIds = new Set<string>();
  const staleProjectInterviewIds = new Set<string>();

  const tIvIds = [
    ...new Set(
      rows
        .filter(
          (r) =>
            r.source_type === "testimonial" &&
            r.interview_id &&
            String(r.interview_id).trim(),
        )
        .map((r) => r.interview_id as string),
    ),
  ];
  for (const batch of chunkIds(tIvIds, 80)) {
    if (batch.length === 0) continue;
    const { data: ivs } = await supabase
      .from("interviews")
      .select("id, post_interview_eligible")
      .in("id", batch)
      .eq("interview_status", "completed");
    const ok = new Set(
      (ivs ?? [])
        .filter((row) => row.post_interview_eligible === true)
        .map((row) => row.id as string),
    );
    for (const id of batch) {
      if (!ok.has(id)) staleTestimonialInterviewIds.add(id);
    }
  }

  const pIvIds = [
    ...new Set(
      rows
        .filter(
          (r) =>
            r.source_type === "project" &&
            (r.project_interview_id || r.interview_id) &&
            String(r.project_interview_id ?? r.interview_id).trim(),
        )
        .map((r) => String(r.project_interview_id ?? r.interview_id)),
    ),
  ];
  for (const batch of chunkIds(pIvIds, 80)) {
    if (batch.length === 0) continue;
    const { data: pivs } = await supabase
      .from("project_interviews")
      .select("id, post_interview_eligible")
      .in("id", batch)
      .eq("interview_status", "completed");
    const ok = new Set(
      (pivs ?? [])
        .filter((row) => row.post_interview_eligible === true)
        .map((row) => row.id as string),
    );
    for (const id of batch) {
      if (!ok.has(id)) staleProjectInterviewIds.add(id);
    }
  }

  return rows.filter((r) => {
    if (r.source_type === "project") {
      const pid = (r.project_interview_id ?? r.interview_id ?? "").trim();
      if (!pid) return false;
      return !staleProjectInterviewIds.has(pid);
    }
    const iid = (r.interview_id ?? "").trim();
    if (!iid) return false;
    return !staleTestimonialInterviewIds.has(iid);
  });
}

function normalizePostProductionRow(
  r: Record<string, unknown>,
): PostProductionRow {
  const st = r.source_type;
  const source_type: SourceType =
    st === "project" ? "project" : "testimonial";
  return {
    ...r,
    source_type,
    interview_id: (r.interview_id as string | null | undefined) ?? null,
    project_interview_id:
      (r.project_interview_id as string | null | undefined) ?? null,
    project_candidate_id:
      (r.project_candidate_id as string | null | undefined) ?? null,
  } as PostProductionRow;
}

function formatInterviewDateLabel(iso: string | null): string {
  if (!iso?.trim()) return "—";
  try {
    return format(parseISO(iso.trim()), "MMM d, yyyy");
  } catch {
    return "—";
  }
}

function formatInterviewDateTimeIst(iso: string | null): string {
  if (!iso?.trim()) return "—";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(iso.trim()));
  } catch {
    return "—";
  }
}

function trimOrNull(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : null;
}

function truncateText(value: string, max: number): { text: string; truncated: boolean } {
  if (value.length <= max) return { text: value, truncated: false };
  return { text: `${value.slice(0, max)}...`, truncated: true };
}

function sourceBadge(sourceType: SourceType) {
  const label = sourceType === "project" ? "Project" : "Testimonial";
  if (sourceType === "project") {
    return (
      <span className="inline-flex rounded-full bg-[#eff6ff] px-2.5 py-1 text-xs font-medium text-[#2563eb]">
        {label}
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full bg-[#f0fdf4] px-2.5 py-1 text-xs font-medium text-[#16a34a]">
      {label}
    </span>
  );
}

function projectCandidateFromRow(
  row: PostProductionRow,
): ProjectCandidateRow | null {
  const p = row.project_candidates;
  const one = Array.isArray(p) ? p[0] : p;
  return one ?? null;
}

const cardChrome =
  "rounded-2xl bg-white shadow-[0_4px_16px_rgba(0,0,0,0.08)] border border-[#f0f0f0]";

type TestimonialPick = {
  interview_id: string;
  candidate_id: string;
  full_name: string | null;
  email: string;
  interview_date: string | null;
  interviewer: string;
  post_interview_eligible: boolean;
};

type ProjectPick = {
  project_interview_id: string;
  project_candidate_id: string;
  display_name: string;
  email: string;
  project_title: string | null;
  interview_date: string | null;
  post_interview_eligible: boolean;
};

type AddSelection =
  | { kind: "testimonial"; pick: TestimonialPick }
  | { kind: "project"; pick: ProjectPick };

const POST_PRODUCTION_KEYS_PAGE = 1000;

/**
 * Load all candidate / project-candidate ids already in post production.
 * Paginates past the default 1000-row cap so we do not wrongly hide addable rows.
 */
async function fetchPostProductionExistingKeys(supabase: SupabaseClient): Promise<{
  candidateIds: Set<string>;
  projectCandidateIds: Set<string>;
  interviewIds: Set<string>;
  projectInterviewIds: Set<string>;
}> {
  const candidateIds = new Set<string>();
  const projectCandidateIds = new Set<string>();
  const interviewIds = new Set<string>();
  const projectInterviewIds = new Set<string>();
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("post_production")
      .select(
        "source_type, candidate_id, project_candidate_id, interview_id, project_interview_id",
      )
      .order("id", { ascending: true })
      .range(from, from + POST_PRODUCTION_KEYS_PAGE - 1);
    if (error) throw error;
    const batch = data ?? [];
    for (const r of batch) {
      const cid = r.candidate_id as string | null;
      const pid = r.project_candidate_id as string | null;
      const iid = r.interview_id as string | null | undefined;
      const piid = r.project_interview_id as string | null | undefined;
      const source = (r.source_type as string | null | undefined) ?? null;
      if (cid) candidateIds.add(cid);
      if (pid) projectCandidateIds.add(pid);
      if (iid && source !== "project") interviewIds.add(iid);
      if (piid) projectInterviewIds.add(piid);
      if (!piid && iid && source === "project") projectInterviewIds.add(iid);
    }
    if (batch.length < POST_PRODUCTION_KEYS_PAGE) break;
    from += POST_PRODUCTION_KEYS_PAGE;
  }
  return { candidateIds, projectCandidateIds, interviewIds, projectInterviewIds };
}

function escapeCsvCell(v: unknown): string {
  const s = String(v ?? "");
  if (s.includes("\"") || s.includes(",") || s.includes("\n")) {
    return `"${s.replace(/"/g, "\"\"")}"`;
  }
  return s;
}

export function PostProductionDashboard() {
  const { canEditCurrentPage, showViewOnlyBadge } = useAccessControl();
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
  const [sourceFilter, setSourceFilter] = useState<SourceType | "all">("all");
  const [domainFilter, setDomainFilter] = useState<DomainFilterValue>("all");
  const [jobRoleFilter, setJobRoleFilter] = useState<string>("all");

  const [detailCandidateId, setDetailCandidateId] = useState<string | null>(
    null,
  );
  const [projectDetailCandidate, setProjectDetailCandidate] =
    useState<ProjectCandidateRow | null>(null);
  const [summaryModalText, setSummaryModalText] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addTab, setAddTab] = useState<"testimonial" | "project">(
    "testimonial",
  );
  const [addSearch, setAddSearch] = useState("");
  const [testimonialPicks, setTestimonialPicks] = useState<TestimonialPick[]>(
    [],
  );
  const [projectPicks, setProjectPicks] = useState<ProjectPick[]>([]);
  const [addLoading, setAddLoading] = useState(false);
  const [selectedAdd, setSelectedAdd] = useState<AddSelection | null>(null);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [existingInterviewIds, setExistingInterviewIds] = useState<
    Set<string>
  >(() => new Set());
  const [existingProjectInterviewIds, setExistingProjectInterviewIds] = useState<
    Set<string>
  >(() => new Set());
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [linkEdit, setLinkEdit] = useState<{
    rowId: string;
    field: LinkField;
    value: string;
  } | null>(null);

  const [reviewPopover, setReviewPopover] = useState<{
    rowId: string;
    kind: "pre" | "post";
  } | null>(null);
  const [detailModalRow, setDetailModalRow] = useState<PostProductionRow | null>(
    null,
  );
  const [interviewDetailsByRow, setInterviewDetailsByRow] = useState<
    Record<
      string,
      {
        loading: boolean;
        date: string | null;
        interviewer: string | null;
        zoomAccount: string | null;
        name: string | null;
        email: string | null;
        domain: string | null;
        role: string | null;
        language: string | null;
        projectTitle: string | null;
        problemStatement: string | null;
        demoLink: string | null;
        achievement: string | null;
      }
    >
  >({});
  const [expandedTextKeys, setExpandedTextKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [postProductionTeam, setPostProductionTeam] = useState<string[]>([]);
  const [reviewBy, setReviewBy] = useState("");
  const reviewRootRef = useRef<HTMLDivElement>(null);

  const loadRows = useCallback(async (): Promise<boolean> => {
    if (!supabase) return false;
    const { data, error: e } = await supabase
      .from("post_production")
      .select(PP_SELECT)
      .order("created_at", { ascending: false });
    if (e) {
      setError(e.message);
      return false;
    }
    const base = (data ?? [])
      .map((row) =>
        normalizePostProductionRow(row as Record<string, unknown>),
      )
      .filter((row) => {
        if (row.source_type === "testimonial" && row.candidate_id) {
          const c = row.candidates;
          const one = c == null ? null : Array.isArray(c) ? c[0] ?? null : c;
          if (one?.is_deleted) return false;
        }
        if (row.source_type === "project" && row.project_candidate_id) {
          const p = row.project_candidates;
          const one = p == null ? null : Array.isArray(p) ? p[0] ?? null : p;
          if (one && "is_deleted" in one && one.is_deleted) return false;
        }
        return true;
      });
    const seenIv = new Set<string>();
    const deduped = base.filter((r) => {
      const linkedId =
        r.source_type === "project"
          ? (r.project_interview_id ?? r.interview_id ?? "").trim()
          : (r.interview_id ?? "").trim();
      const k = `${r.source_type}:${linkedId || r.id}`;
      if (seenIv.has(k)) return false;
      seenIv.add(k);
      return true;
    });
    setRows(await filterPostProductionEligibleRows(supabase, deduped));
    setError(null);
    return true;
  }, [supabase]);

  const loadRoster = useCallback(async () => {
    if (!supabase) return;
    const names = await fetchTeamRosterNames(supabase, "post_production", true);
    setPostProductionTeam(names);
    setReviewBy((prev) => prev || names[0] || "");
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
    void loadRoster();
  }, [loadRoster]);

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
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "interviews" },
        () => {
          void loadRows();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "project_interviews" },
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

  useEffect(() => {
    if (!toastMessage) return;
    const t = window.setTimeout(() => setToastMessage(null), 4000);
    return () => window.clearTimeout(t);
  }, [toastMessage]);

  const stats = useMemo(() => {
    const total = rows.length;
    const prePending = rows.filter((r) => r.pre_edit_review === "not_done")
      .length;
    const postPending = rows.filter((r) => r.post_edit_review === "not_done")
      .length;
    const live = rows.filter((r) => r.youtube_status === "live").length;
    return { total, prePending, postPending, live };
  }, [rows]);

  const distinctJobRoles = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.source_type !== "testimonial") continue;
      const c = r.candidates;
      const one = Array.isArray(c) ? c[0] : c;
      const jr = one?.job_role?.trim();
      if (jr) set.add(jr);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const name = (r.candidate_name ?? "").toLowerCase();
      if (q && !name.includes(q)) return false;
      if (sourceFilter !== "all" && r.source_type !== sourceFilter)
        return false;
      if (domainFilter !== "all") {
        if (r.source_type === "testimonial") {
          const c = r.candidates;
          const one = Array.isArray(c) ? c[0] : c;
          if (testimonialDomainBucket(one?.domain) !== domainFilter)
            return false;
        }
      }
      if (jobRoleFilter !== "all") {
        if (r.source_type === "testimonial") {
          const c = r.candidates;
          const one = Array.isArray(c) ? c[0] : c;
          const jr = one?.job_role?.trim() ?? "";
          if (jr !== jobRoleFilter) return false;
        }
      }
      if (ytFilter !== "all" && r.youtube_status !== ytFilter) return false;
      if (preFilter !== "all" && r.pre_edit_review !== preFilter) return false;
      if (postFilter !== "all" && r.post_edit_review !== postFilter)
        return false;
      return true;
    });
  }, [
    rows,
    search,
    sourceFilter,
    domainFilter,
    jobRoleFilter,
    ytFilter,
    preFilter,
    postFilter,
  ]);

  const exportCsv = useCallback(() => {
    if (filtered.length === 0) return;
    const headers = [
      "Candidate Name",
      "Source",
      "Raw Video Link",
      "Edited Video Link",
      "Pre-Edit Review",
      "Pre-Edit Review By",
      "Post-Edit Review",
      "Post-Edit Review By",
      "Edited By",
      "YouTube Link",
      "YouTube Status",
      "Language",
      "Summary",
      "CX Mail Sent",
      "CX Mail Sent At",
    ];
    const body = filtered.map((r) =>
      [
        r.candidate_name ?? "",
        r.source_type === "project" ? "Project" : "Testimonial",
        r.raw_video_link ?? "",
        r.edited_video_link ?? "",
        r.pre_edit_review,
        r.pre_edit_review_by ?? "",
        r.post_edit_review,
        r.post_edit_review_by ?? "",
        r.edited_by ?? "",
        r.youtube_link ?? "",
        r.youtube_status,
        r.interview_language ?? "",
        r.summary ?? "",
        r.cx_mail_sent ? "Yes" : "No",
        r.cx_mail_sent_at ? format(parseISO(r.cx_mail_sent_at), "MMM d, yyyy h:mm a") : "",
      ]
        .map(escapeCsvCell)
        .join(","),
    );
    const csv = [headers.map(escapeCsvCell).join(","), ...body].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `post-production-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filtered]);

  const openAddModal = async () => {
    if (!supabase) return;
    setAddOpen(true);
    setAddTab("testimonial");
    setAddSearch("");
    setSelectedAdd(null);
    setAddLoading(true);
    let invT: unknown[] | null = null;
    let invP: unknown[] | null = null;
    let inPostInterview = new Set<string>();
    let inPostProjectInterview = new Set<string>();
    try {
      const [tRes, pRes, keys] = await Promise.all([
        supabase
          .from("interviews")
          .select(
            "id, candidate_id, completed_at, scheduled_date, interviewer, post_interview_eligible, candidates!inner ( id, full_name, email )",
          )
          .eq("interview_status", "completed")
          .eq("post_interview_eligible", true)
          .eq("candidates.is_deleted", false),
        supabase
          .from("project_interviews")
          .select(
            "id, project_candidate_id, completed_at, scheduled_date, post_interview_eligible, project_candidates!inner ( id, email, full_name, project_title )",
          )
          .eq("interview_status", "completed")
          .eq("post_interview_eligible", true)
          .eq("project_candidates.is_deleted", false),
        fetchPostProductionExistingKeys(supabase),
      ]);
      invT = tRes.data ?? null;
      invP = pRes.data ?? null;
      if (tRes.error) throw tRes.error;
      if (pRes.error) throw pRes.error;
      inPostInterview = keys.interviewIds;
      inPostProjectInterview = keys.projectInterviewIds;
      setExistingInterviewIds(keys.interviewIds);
      setExistingProjectInterviewIds(keys.projectInterviewIds);
    } catch (e) {
      setAddLoading(false);
      setError(
        e instanceof Error
          ? e.message
          : "Could not load candidates for post production.",
      );
      setTestimonialPicks([]);
      setProjectPicks([]);
      setExistingInterviewIds(new Set());
      setExistingProjectInterviewIds(new Set());
      return;
    }

    const tMap = new Map<string, TestimonialPick>();
    for (const row of invT ?? []) {
      const r = row as {
        id: string;
        candidate_id: string;
        completed_at: string | null;
        scheduled_date: string | null;
        interviewer: string | null;
        post_interview_eligible: boolean | null;
        candidates:
          | { id: string; full_name: string | null; email: string }
          | { id: string; full_name: string | null; email: string }[]
          | null;
      };
      const cid = r.candidate_id;
      if (!cid || inPostInterview.has(r.id)) continue;
      if (!canMoveToPostProduction(r)) continue;
      const c = r.candidates;
      const cand = Array.isArray(c) ? c[0] : c;
      if (!cand) continue;
      const dateIso =
        r.completed_at?.trim() || r.scheduled_date?.trim() || null;
      const interviewer = String(r.interviewer ?? "").trim() || "—";
      const prev = tMap.get(cid);
      if (
        !prev ||
        (dateIso &&
          (!prev.interview_date || dateIso > prev.interview_date))
      ) {
        tMap.set(cid, {
          interview_id: r.id,
          candidate_id: cid,
          full_name: cand.full_name,
          email: cand.email,
          interview_date: dateIso,
          interviewer,
          post_interview_eligible: r.post_interview_eligible === true,
        });
      }
    }
    setTestimonialPicks([...tMap.values()]);

    const pMap = new Map<string, ProjectPick>();
    for (const row of invP ?? []) {
      const r = row as {
        id: string;
        project_candidate_id: string;
        completed_at: string | null;
        scheduled_date: string | null;
        post_interview_eligible: boolean | null;
        project_candidates:
          | {
              id: string;
              email: string;
              full_name: string | null;
              project_title: string | null;
            }
          | {
              id: string;
              email: string;
              full_name: string | null;
              project_title: string | null;
            }[]
          | null;
      };
      const pcid = r.project_candidate_id;
      if (!pcid || inPostProjectInterview.has(r.id)) continue;
      if (!canMoveToPostProduction(r)) continue;
      const c = r.project_candidates;
      const cand = Array.isArray(c) ? c[0] : c;
      if (!cand) continue;
      const email = cand.email ?? "";
      const local = email.split("@")[0] ?? "";
      const display_name =
        cand.full_name?.trim() ||
        (local.length > 0
          ? local.charAt(0).toUpperCase() + local.slice(1)
          : "—");
      const dateIso =
        r.completed_at?.trim() || r.scheduled_date?.trim() || null;
      const prev = pMap.get(pcid);
      if (
        !prev ||
        (dateIso &&
          (!prev.interview_date || dateIso > prev.interview_date))
      ) {
        pMap.set(pcid, {
          project_interview_id: r.id,
          project_candidate_id: pcid,
          display_name,
          email,
          project_title: cand.project_title,
          interview_date: dateIso,
          post_interview_eligible: r.post_interview_eligible === true,
        });
      }
    }
    setProjectPicks([...pMap.values()]);
    setError(null);
    setAddLoading(false);
  };

  const addFilteredTestimonial = useMemo(() => {
    const q = addSearch.trim().toLowerCase();
    if (!q) return testimonialPicks;
    return testimonialPicks.filter(
      (p) =>
        (p.full_name ?? "").toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q) ||
        p.interviewer.toLowerCase().includes(q),
    );
  }, [testimonialPicks, addSearch]);

  const addFilteredProject = useMemo(() => {
    const q = addSearch.trim().toLowerCase();
    if (!q) return projectPicks;
    return projectPicks.filter(
      (p) =>
        p.display_name.toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q) ||
        (p.project_title ?? "").toLowerCase().includes(q),
    );
  }, [projectPicks, addSearch]);

  const selectedAddIsEligible =
    selectedAdd?.pick.post_interview_eligible === true;

  const selectedInterviewAlreadyInPost = useMemo(() => {
    if (!selectedAdd) return false;
    if (selectedAdd.kind === "testimonial") {
      return existingInterviewIds.has(selectedAdd.pick.interview_id);
    }
    return existingProjectInterviewIds.has(selectedAdd.pick.project_interview_id);
  }, [selectedAdd, existingInterviewIds, existingProjectInterviewIds]);

  const confirmAdd = async () => {
    if (!canEditCurrentPage) {
      setToastMessage("You don't have permission to add entries.");
      return;
    }
    if (!supabase || !selectedAdd) return;
    if (!selectedAddIsEligible) {
      const msg = "Not eligible for post production";
      setError(msg);
      setToastMessage(msg);
      return;
    }

    const selectedInterviewId =
      selectedAdd.kind === "testimonial"
        ? selectedAdd.pick.interview_id
        : selectedAdd.pick.project_interview_id;
    const existingLookup = supabase
      .from("post_production")
      .select("id")
      .eq(
        selectedAdd.kind === "testimonial"
          ? "interview_id"
          : "project_interview_id",
        selectedInterviewId,
      );
    const { data: existingRow } = await existingLookup.maybeSingle();
    if (existingRow) {
      const msg = "This interview is already in post production.";
      setError(msg);
      setToastMessage(msg);
      return;
    }

    const selectedForLog =
      selectedAdd.kind === "testimonial"
        ? {
            kind: "testimonial" as const,
            interview_id: selectedAdd.pick.interview_id,
            candidate_id: selectedAdd.pick.candidate_id,
            name: selectedAdd.pick.full_name ?? selectedAdd.pick.email,
          }
        : {
            kind: "project" as const,
            project_interview_id: selectedAdd.pick.project_interview_id,
            project_candidate_id: selectedAdd.pick.project_candidate_id,
            name: selectedAdd.pick.display_name,
          };
    console.log("Adding to post production:", selectedForLog);

    setAddSubmitting(true);
    setError(null);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      setAddSubmitting(false);
      const msg = "You must be signed in to add entries.";
      setError(msg);
      setToastMessage(msg);
      return;
    }

    const savedSelection = selectedAdd;
    const body =
      savedSelection.kind === "testimonial"
        ? {
            source: "testimonial" as const,
            interview_id: savedSelection.pick.interview_id,
          }
        : {
            source: "project" as const,
            project_interview_id: savedSelection.pick.project_interview_id,
          };

    let res: Response;
    try {
      res = await fetch("/api/post-production/create-entry", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      console.error("Post production insert failed:", err);
      setAddSubmitting(false);
      const msg = "Network error while adding to post production.";
      setError(msg);
      setToastMessage(msg);
      return;
    }

    const json = (await res.json().catch(() => ({}))) as {
      error?: string;
      ok?: boolean;
    };
    setAddSubmitting(false);

    if (!res.ok) {
      console.error("Post production insert failed:", res.status, json);
      const msg =
        json.error ??
        (res.status === 409
          ? "This interview is already in post production."
          : POST_PRODUCTION_NOT_ELIGIBLE_ERROR);
      setError(msg);
      setToastMessage(msg);
      return;
    }

    const addedInterviewId =
      savedSelection.kind === "testimonial"
        ? savedSelection.pick.interview_id
        : savedSelection.pick.project_interview_id;
    if (savedSelection.kind === "testimonial") {
      setExistingInterviewIds((prev) => new Set(prev).add(addedInterviewId));
    } else {
      setExistingProjectInterviewIds((prev) => new Set(prev).add(addedInterviewId));
    }

    const refreshed = await loadRows();
    if (!refreshed) {
      setToastMessage(
        "Added to post production, but the list could not be refreshed. Try reloading the page.",
      );
      return;
    }

    if (savedSelection.kind === "testimonial") {
      setTestimonialPicks((prev) =>
        prev.filter((p) => p.interview_id !== savedSelection.pick.interview_id),
      );
    } else {
      setProjectPicks((prev) =>
        prev.filter(
          (p) =>
            p.project_interview_id !==
            savedSelection.pick.project_interview_id,
        ),
      );
    }

    setAddOpen(false);
    setSelectedAdd(null);
    setAddSearch("");
    setToastMessage("Added to post production");
  };

  const openNameDetail = (row: PostProductionRow) => {
    setDetailModalRow(row);
    if (interviewDetailsByRow[row.id]) return;
    const ivRaw = row.interviews;
    const interview = Array.isArray(ivRaw) ? (ivRaw[0] ?? null) : (ivRaw ?? null);
    const ivCandRaw = interview?.candidates;
    const interviewCandidate = Array.isArray(ivCandRaw)
      ? (ivCandRaw[0] ?? null)
      : (ivCandRaw ?? null);

    const pivRaw = row.project_interviews;
    const projectInterview = Array.isArray(pivRaw)
      ? (pivRaw[0] ?? null)
      : (pivRaw ?? null);
    const piCandRaw = projectInterview?.project_candidates;
    const projectInterviewCandidate = Array.isArray(piCandRaw)
      ? (piCandRaw[0] ?? null)
      : (piCandRaw ?? null);
    const projectCandidateFallback = Array.isArray(row.project_candidates)
      ? (row.project_candidates[0] ?? null)
      : (row.project_candidates ?? null);

    const isProject = row.source_type === "project";
    setInterviewDetailsByRow((prev) => ({
      ...prev,
      [row.id]: {
        loading: false,
        date: isProject
          ? trimOrNull(projectInterview?.completed_at) ??
            trimOrNull(projectInterview?.scheduled_date)
          : trimOrNull(interview?.completed_at) ??
            trimOrNull(interview?.scheduled_date),
        interviewer: isProject
          ? trimOrNull(projectInterview?.interviewer)
          : trimOrNull(interview?.interviewer),
        zoomAccount: isProject
          ? trimOrNull(projectInterview?.zoom_account)
          : trimOrNull(interview?.zoom_account),
        name: isProject
          ? trimOrNull(projectInterviewCandidate?.full_name) ??
            trimOrNull(projectCandidateFallback?.full_name) ??
            trimOrNull(row.candidate_name)
          : trimOrNull(interviewCandidate?.full_name) ??
            trimOrNull(row.candidate_name),
        email: isProject
          ? trimOrNull(projectInterviewCandidate?.email) ??
            trimOrNull(projectCandidateFallback?.email)
          : trimOrNull(interviewCandidate?.email),
        domain: isProject ? null : trimOrNull(interviewCandidate?.domain),
        role: isProject ? null : trimOrNull(interviewCandidate?.job_role),
        language: isProject
          ? null
          : trimOrNull(interview?.interview_language) ??
            trimOrNull(row.interview_language),
        projectTitle: isProject
          ? trimOrNull(projectInterviewCandidate?.project_title) ??
            trimOrNull(projectCandidateFallback?.project_title)
          : null,
        problemStatement: isProject
          ? trimOrNull(projectInterviewCandidate?.problem_statement) ??
            trimOrNull(projectCandidateFallback?.problem_statement)
          : null,
        demoLink: isProject
          ? trimOrNull(projectInterviewCandidate?.demo_link) ??
            trimOrNull(projectCandidateFallback?.demo_link)
          : null,
        achievement: isProject
          ? null
          : trimOrNull(interviewCandidate?.achievement_summary),
      },
    }));
  };

  const closeDetailModal = () => {
    setDetailModalRow(null);
    setExpandedTextKeys(new Set());
  };

  const toggleExpandedText = (key: string) => {
    setExpandedTextKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  useEffect(() => {
    if (!detailModalRow) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") closeDetailModal();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [detailModalRow]);

  const patchRow = async (
    id: string,
    patch: Record<string, unknown>,
    log?: { description: string; candidateName: string },
    /** When set, Slack workflow compares this row to `patch` so notifications fire only on real transitions */
    slackBefore?: PostProductionRow,
  ) => {
    if (!canEditCurrentPage) return;
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
    if (slackBefore) {
      notifyPostProductionSlackAfterPatch(supabase, {
        candidate_name: slackBefore.candidate_name,
        raw_video_link: slackBefore.raw_video_link,
        edited_video_link: slackBefore.edited_video_link,
        pre_edit_review: slackBefore.pre_edit_review,
        post_edit_review: slackBefore.post_edit_review,
        youtube_link: slackBefore.youtube_link,
      }, patch);
    }
    if (log) {
      const auth = await getUserSafe(supabase);
      if (auth) {
        await logActivity({
          supabase,
          user: auth,
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
    await patchRow(row.id, { [field]: v }, undefined, row);
    setLinkEdit(null);
  };

  const confirmReviewDone = async () => {
    if (!supabase || !reviewPopover) return;
    if (!reviewBy.trim()) {
      setError("No active post-production member available.");
      return;
    }
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
        row,
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
        row,
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
        <div className="flex w-full min-w-0 max-w-full flex-col gap-1">
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
          className="rounded border border-[#e5e5e5] bg-[#fafafa] px-2 py-1 text-xs font-medium text-[#6e6e73] hover:bg-[#f0f0f0] disabled:opacity-50"
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
          className="rounded bg-[#1d1d1f] px-2 py-1 text-xs font-medium text-white hover:bg-[#2d2d2f]"
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
        <div className="flex flex-col items-start gap-1">
          <span className="inline-flex rounded-full bg-[#fef2f2] px-2 py-0.5 text-xs font-medium text-[#dc2626]">
            ✗ Not Done
          </span>
          <button
            type="button"
            disabled={busy}
            className="text-left text-xs font-medium text-[#3b82f6] hover:underline disabled:opacity-50"
            onClick={() => {
              setReviewBy(postProductionTeam[0] ?? "");
              setReviewPopover({ rowId: row.id, kind });
            }}
          >
            Mark Done
          </button>
        </div>
        {open ? (
          <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-xl border border-[#f0f0f0] bg-white p-3 shadow-lg">
            <p className="text-xs font-medium text-[#1d1d1f]">Done by</p>
            <select
              className="mt-2 w-full rounded-lg border border-[#e5e5e5] px-2 py-1.5 text-xs"
              value={reviewBy}
              onChange={(e) => setReviewBy(e.target.value)}
            >
              {postProductionTeam.length === 0 ? (
                <option value="">No active members</option>
              ) : (
                postProductionTeam.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))
              )}
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
    "border-b border-gray-100 bg-[#fafafa] py-2 px-2 text-left text-xs font-semibold tracking-wider text-gray-400";
  const td =
    "border-b border-gray-100 px-2 py-2 text-sm align-top text-[#1d1d1f]";
  const ppCol = {
    name: "w-[140px] max-w-[140px]",
    source: "w-[110px] max-w-[110px]",
    raw: "w-[100px] max-w-[100px]",
    edited: "w-[100px] max-w-[100px]",
    pre: "w-[130px] max-w-[130px]",
    post: "w-[130px] max-w-[130px]",
    editedBy: "w-[120px] max-w-[120px]",
    youtube: "w-[100px] max-w-[100px]",
    status: "w-[120px] max-w-[120px]",
    summary: "w-[90px] max-w-[90px]",
    actions: "w-[90px] max-w-[90px]",
  } as const;

  const modalRow = detailModalRow;
  const modalDetails = modalRow ? interviewDetailsByRow[modalRow.id] : undefined;
  const modalProblemKey = modalRow ? `${modalRow.id}:problem` : "";
  const modalAchievementKey = modalRow ? `${modalRow.id}:achievement` : "";
  const modalExpandedProblem =
    Boolean(modalRow) && expandedTextKeys.has(modalProblemKey);
  const modalExpandedAchievement =
    Boolean(modalRow) && expandedTextKeys.has(modalAchievementKey);
  const modalProblemText = modalDetails?.problemStatement?.trim() ?? "";
  const modalAchievementText = modalDetails?.achievement?.trim() ?? "";
  const modalProblemPreview = truncateText(modalProblemText, 120);
  const modalAchievementPreview = truncateText(modalAchievementText, 170);

  if (!supabase) {
    return (
      <div className="px-8 py-16 text-center text-sm text-[#6e6e73]">
        {error ?? "Cannot connect to Supabase."}
      </div>
    );
  }

  return (
    <>
      {toastMessage ? (
        <div
          className="fixed bottom-6 left-1/2 z-[90] max-w-md -translate-x-1/2 rounded-xl border border-[#e5e5e5] bg-[#1d1d1f] px-4 py-3 text-center text-sm font-medium text-white shadow-lg"
          role="status"
        >
          {toastMessage}
        </div>
      ) : null}

      <header className="sticky top-14 z-30 bg-[#f5f5f7]/90 px-4 py-4 backdrop-blur-md sm:px-6 sm:py-5 lg:top-0 lg:px-8 lg:py-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[#1d1d1f] sm:text-2xl">
              Post Production
            </h1>
            <p className="mt-1 text-sm text-[#6e6e73]">
              Manage interview video editing and publishing pipeline
            </p>
            {showViewOnlyBadge ? (
              <span className="mt-2 inline-flex rounded-full bg-[#f3f4f6] px-3 py-1 text-xs font-medium text-[#6b7280]">
                View only
              </span>
            ) : null}
          </div>
          {canEditCurrentPage ? (
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3">
              <button
                type="button"
                onClick={exportCsv}
                disabled={filtered.length === 0}
                className="w-full py-2 text-center text-sm font-medium text-[#3b82f6] transition-all hover:text-[#2563eb] disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto sm:py-0 sm:text-left"
              >
                Export CSV ({filtered.length} rows)
              </button>
              <button
                type="button"
                onClick={() => void openAddModal()}
                className="inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-[#1d1d1f] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#2d2d2f] sm:w-auto"
              >
                <Plus className="h-4 w-4" />
                Add to Post Production
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={exportCsv}
              disabled={filtered.length === 0}
              className="w-full py-2 text-sm font-medium text-[#3b82f6] transition-all hover:text-[#2563eb] disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto sm:py-0"
            >
              Export CSV ({filtered.length} rows)
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-[1800px] px-4 pb-12 pt-2 sm:px-6 lg:px-8 lg:pb-16">
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

            <div className="mb-4 flex flex-col gap-4 rounded-2xl border border-[#f0f0f0] bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
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
                    setSourceFilter("all");
                    setDomainFilter("all");
                    setJobRoleFilter("all");
                    setYtFilter("all");
                    setPreFilter("all");
                    setPostFilter("all");
                  }}
                >
                  Clear filters
                </button>
              </div>
              <div className="border-t border-[#f0f0f0] pt-3">
                <p className="mb-2 text-[11px] text-[#aeaeb2]">
                  Domain and job role apply to testimonial rows only.
                </p>
                <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
                  <label className="flex w-full flex-col gap-1 sm:w-36">
                    <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
                      Source
                    </span>
                    <select
                      className="rounded-xl border border-[#e5e5e5] px-3 py-2 text-sm"
                      value={sourceFilter}
                      onChange={(e) =>
                        setSourceFilter(e.target.value as SourceType | "all")
                      }
                    >
                      <option value="all">All</option>
                      <option value="testimonial">Testimonial</option>
                      <option value="project">Project</option>
                    </select>
                  </label>
                  <label className="flex w-full min-w-[220px] flex-col gap-1 sm:min-w-[260px] sm:flex-1">
                    <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
                      Domain
                    </span>
                    <select
                      className="rounded-xl border border-[#e5e5e5] px-3 py-2 text-sm"
                      value={domainFilter}
                      onChange={(e) =>
                        setDomainFilter(e.target.value as DomainFilterValue)
                      }
                    >
                      <option value="all">All</option>
                      {DOMAIN_FILTER_OPTIONS.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex w-full min-w-[160px] flex-col gap-1 sm:w-52">
                    <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
                      Job role
                    </span>
                    <select
                      className="rounded-xl border border-[#e5e5e5] px-3 py-2 text-sm"
                      value={jobRoleFilter}
                      onChange={(e) => setJobRoleFilter(e.target.value)}
                    >
                      <option value="all">All</option>
                      {distinctJobRoles.map((jr) => (
                        <option key={jr} value={jr}>
                          {jr}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-[#f0f0f0] bg-white shadow-sm">
              <div className="w-full min-w-0 max-w-full overflow-x-auto">
                <table className="w-full min-w-[1240px] table-fixed border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className={`${th} ${ppCol.name}`}>Name</th>
                      <th className={`${th} ${ppCol.source}`}>SOURCE</th>
                      <th className={`${th} ${ppCol.raw}`}>Raw video</th>
                      <th className={`${th} ${ppCol.edited}`}>Edited video</th>
                      <th className={`${th} ${ppCol.pre}`}>Pre-edit review</th>
                      <th className={`${th} ${ppCol.post}`}>
                        Post-edit review
                      </th>
                      <th className={`${th} ${ppCol.editedBy}`}>Edited by</th>
                      <th className={`${th} ${ppCol.youtube}`}>YouTube</th>
                      <th className={`${th} ${ppCol.status}`}>Status</th>
                      <th className={`${th} ${ppCol.summary}`}>Summary</th>
                      <th className={`${th} ${ppCol.actions} text-right`}>
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr>
                        <td
                          className={`${td} py-16 text-center text-[#aeaeb2]`}
                          colSpan={11}
                        >
                          {rows.length === 0
                            ? "No entries yet. Add completed interviews to start the post production pipeline."
                            : "No rows match your filters."}
                        </td>
                      </tr>
                    ) : (
                      filtered.map((row) => {
                        const busy = savingId === row.id;
                        const nameClickable = Boolean(row.candidate_name?.trim());
                        return (
                          <tr key={row.id}>
                            <td className={`${td} ${ppCol.name}`}>
                              {nameClickable ? (
                                <button
                                  type="button"
                                  className="block max-w-full truncate text-left font-medium text-[#3b82f6] hover:underline"
                                  title={row.candidate_name?.trim() || undefined}
                                  onClick={() => void openNameDetail(row)}
                                >
                                  {row.candidate_name?.trim() || "—"}
                                </button>
                              ) : (
                                <span className="block max-w-full truncate">
                                  {row.candidate_name?.trim() || "—"}
                                </span>
                              )}
                            </td>
                            <td className={`${td} ${ppCol.source}`}>
                              {sourceBadge(row.source_type)}
                            </td>
                            <td className={`${td} ${ppCol.raw}`}>
                              {renderLinkCell(row, "raw_video_link")}
                            </td>
                            <td className={`${td} ${ppCol.edited}`}>
                              {renderLinkCell(row, "edited_video_link")}
                            </td>
                            <td className={`${td} ${ppCol.pre}`}>
                              {renderReviewCell(row, "pre")}
                            </td>
                            <td className={`${td} ${ppCol.post}`}>
                              {renderReviewCell(row, "post")}
                            </td>
                            <td className={`${td} ${ppCol.editedBy}`}>
                              <select
                                disabled={busy}
                                className="max-w-[112px] rounded-lg border border-[#e5e5e5] px-2 py-1 text-xs disabled:opacity-50"
                                value={
                                  row.edited_by?.trim()
                                    ? mergeRosterWithCurrent(
                                        postProductionTeam,
                                        row.edited_by,
                                      ).includes(row.edited_by ?? "")
                                      ? row.edited_by
                                      : "__custom__"
                                    : ""
                                }
                                onChange={(e) => {
                                  const v = e.target.value;
                                  if (v === "__custom__") return;
                                  void patchRow(row.id, { edited_by: v || null });
                                }}
                              >
                                <option value="">Assign…</option>
                                {row.edited_by?.trim() &&
                                !mergeRosterWithCurrent(
                                  postProductionTeam,
                                  row.edited_by,
                                ).includes(row.edited_by ?? "") ? (
                                  <option value="__custom__">
                                    {row.edited_by}
                                  </option>
                                ) : null}
                                {mergeRosterWithCurrent(
                                  postProductionTeam,
                                  row.edited_by,
                                ).map((n) => (
                                  <option key={n} value={n}>
                                    {n}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className={`${td} ${ppCol.youtube}`}>
                              {renderLinkCell(row, "youtube_link")}
                            </td>
                            <td className={`${td} ${ppCol.status}`}>
                              <select
                                disabled={busy}
                                className="max-w-[100px] rounded-lg border border-[#e5e5e5] px-2 py-1 text-xs disabled:opacity-50"
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
                            </td>
                            <td className={`${td} ${ppCol.summary}`}>
                              <div className="max-w-[90px] space-y-1">
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
                            <td className={`${td} ${ppCol.actions} text-right`}>
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

      {modalRow ? (
        <div className={modalOverlayZ80Class}>
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Close"
            onClick={closeDetailModal}
          />
          <div
            role="dialog"
            aria-modal="true"
            className={`${modalPanelClass} max-h-[85vh] max-w-[600px] scale-100 overflow-y-auto p-6 shadow-xl transition-all duration-200`}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-[#1d1d1f]">
                  {modalDetails?.name?.trim() || modalRow.candidate_name?.trim() || "—"}
                </h2>
                <p className="mt-1 text-sm text-[#6e6e73]">
                  {modalRow.source_type === "project" ? "Project" : "Testimonial"}
                </p>
              </div>
              <button
                type="button"
                onClick={closeDetailModal}
                className="rounded-lg px-2 py-1 text-sm font-medium text-[#6e6e73] hover:bg-[#f5f5f7] hover:text-[#1d1d1f]"
              >
                Close
              </button>
            </div>

            {modalDetails ? (
              <div className="space-y-3 text-sm">
                <section className="rounded-lg border border-[#e5e7eb] bg-white p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6b7280]">
                    Interview Details
                  </p>
                  <p>
                    <span className="font-medium text-[#374151]">Date:</span>{" "}
                    {formatInterviewDateTimeIst(modalDetails.date ?? null)}
                  </p>
                  <p>
                    <span className="font-medium text-[#374151]">Interviewer:</span>{" "}
                    {modalDetails.interviewer?.trim() || "—"}
                  </p>
                  <p>
                    <span className="font-medium text-[#374151]">Zoom Account:</span>{" "}
                    {modalDetails.zoomAccount?.trim() || "—"}
                  </p>
                </section>

                <section className="rounded-lg border border-[#e5e7eb] bg-white p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6b7280]">
                    Candidate Details
                  </p>
                  <p>
                    <span className="font-medium text-[#374151]">Email:</span>{" "}
                    {modalDetails.email?.trim() || "—"}
                  </p>

                  {modalRow.source_type === "testimonial" ? (
                    <>
                      <p>
                        <span className="font-medium text-[#374151]">Domain:</span>{" "}
                        {modalDetails.domain?.trim() || "—"}
                      </p>
                      <p>
                        <span className="font-medium text-[#374151]">Role:</span>{" "}
                        {modalDetails.role?.trim() || "—"}
                      </p>
                      <p>
                        <span className="font-medium text-[#374151]">Language:</span>{" "}
                        {modalDetails.language?.trim() || modalRow.interview_language?.trim() || "—"}
                      </p>
                      {modalAchievementText ? (
                        <div className="mt-2 rounded border-l-2 border-[#60a5fa] bg-[#eff6ff] px-3 py-2 italic text-[#1f2937]">
                          <span className="not-italic font-medium text-[#1e3a8a]">
                            Achievement:
                          </span>{" "}
                          {modalExpandedAchievement
                            ? modalAchievementText
                            : modalAchievementPreview.text}
                          {modalAchievementPreview.truncated ? (
                            <button
                              type="button"
                              className="ml-1 font-medium text-[#2563eb] not-italic hover:underline"
                              onClick={() => toggleExpandedText(modalAchievementKey)}
                            >
                              {modalExpandedAchievement ? "View less" : "View more"}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <p>
                        <span className="font-medium text-[#374151]">Project Title:</span>{" "}
                        {modalDetails.projectTitle?.trim() || "—"}
                      </p>
                      <p>
                        <span className="font-medium text-[#374151]">
                          Problem Statement:
                        </span>{" "}
                        {modalProblemText
                          ? modalExpandedProblem
                            ? modalProblemText
                            : modalProblemPreview.text
                          : "—"}
                        {modalProblemText && modalProblemPreview.truncated ? (
                          <button
                            type="button"
                            className="ml-1 font-medium text-[#2563eb] hover:underline"
                            onClick={() => toggleExpandedText(modalProblemKey)}
                          >
                            {modalExpandedProblem ? "View less" : "View more"}
                          </button>
                        ) : null}
                      </p>
                      <p>
                        <span className="font-medium text-[#374151]">Demo Link:</span>{" "}
                        {modalDetails.demoLink ? (
                          <a
                            href={modalDetails.demoLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#2563eb] hover:underline"
                          >
                            Open demo
                          </a>
                        ) : (
                          "—"
                        )}
                      </p>
                    </>
                  )}
                </section>
              </div>
            ) : (
              <p className="text-sm text-[#6e6e73]">Loading details...</p>
            )}
          </div>
        </div>
      ) : null}

      <CandidateDetailModal
        open={!!detailCandidateId}
        candidateId={detailCandidateId}
        supabase={supabase}
        onClose={() => setDetailCandidateId(null)}
      />

      <ProjectCandidateDetailModal
        open={!!projectDetailCandidate}
        candidate={projectDetailCandidate}
        onClose={() => setProjectDetailCandidate(null)}
      />

      {summaryModalText ? (
        <div className={modalOverlayZ80Class}>
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Close"
            onClick={() => setSummaryModalText(null)}
          />
          <div
            className={`${modalPanelClass} max-h-[85vh] p-6 shadow-xl`}
          >
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
        <div className={modalOverlayZ75Class}>
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Close"
            onClick={() => setAddOpen(false)}
          />
          <div
            className={`${modalPanelClass} max-h-[min(90vh,100dvh-2rem)] p-6 shadow-xl`}
          >
            <h2 className="text-lg font-semibold text-[#1d1d1f]">
              Add to Post Production
            </h2>
            <p className="mt-1 text-sm text-[#6e6e73]">
              Completed interviews only. Already-added candidates are hidden.
            </p>
            <div className="mt-4 flex gap-1 rounded-xl bg-[#f5f5f7] p-1">
              <button
                type="button"
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  addTab === "testimonial"
                    ? "bg-white text-[#1d1d1f] shadow-sm"
                    : "text-[#6e6e73] hover:text-[#1d1d1f]"
                }`}
                onClick={() => {
                  setAddTab("testimonial");
                  setSelectedAdd(null);
                }}
              >
                Testimonial
              </button>
              <button
                type="button"
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  addTab === "project"
                    ? "bg-white text-[#1d1d1f] shadow-sm"
                    : "text-[#6e6e73] hover:text-[#1d1d1f]"
                }`}
                onClick={() => {
                  setAddTab("project");
                  setSelectedAdd(null);
                }}
              >
                Project
              </button>
            </div>
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
                  placeholder={
                    addTab === "testimonial"
                      ? "Search name, email, or interviewer"
                      : "Search name, email, or project"
                  }
                  value={addSearch}
                  onChange={(e) => setAddSearch(e.target.value)}
                />
                {addTab === "testimonial" ? (
                  <ul className="mt-3 max-h-64 overflow-y-auto rounded-xl border border-[#f0f0f0]">
                    {addFilteredTestimonial.length === 0 ? (
                      <li className="px-3 py-8 text-center text-sm text-[#aeaeb2]">
                        No completed testimonial interviews to add
                      </li>
                    ) : (
                      addFilteredTestimonial.map((p) => (
                        <li key={p.candidate_id}>
                          <button
                            type="button"
                            className={`w-full px-3 py-2.5 text-left text-sm ${
                              selectedAdd?.kind === "testimonial" &&
                              selectedAdd.pick.candidate_id === p.candidate_id
                                ? "bg-[#eff6ff]"
                                : "hover:bg-[#fafafa]"
                            }`}
                            onClick={() => {
                              setAddTab("testimonial");
                              setSelectedAdd({ kind: "testimonial", pick: p });
                            }}
                          >
                            <span className="font-medium text-[#1d1d1f]">
                              {p.full_name?.trim() || p.email}
                            </span>
                            <span className="mt-0.5 block text-xs text-[#6e6e73]">
                              {formatInterviewDateLabel(p.interview_date)} ·{" "}
                              {p.interviewer}
                            </span>
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                ) : (
                  <ul className="mt-3 max-h-64 overflow-y-auto rounded-xl border border-[#f0f0f0]">
                    {addFilteredProject.length === 0 ? (
                      <li className="px-3 py-8 text-center text-sm text-[#aeaeb2]">
                        No completed project interviews to add
                      </li>
                    ) : (
                      addFilteredProject.map((p) => (
                        <li key={p.project_candidate_id}>
                          <button
                            type="button"
                            className={`w-full px-3 py-2.5 text-left text-sm ${
                              selectedAdd?.kind === "project" &&
                              selectedAdd.pick.project_candidate_id ===
                                p.project_candidate_id
                                ? "bg-[#eff6ff]"
                                : "hover:bg-[#fafafa]"
                            }`}
                            onClick={() => {
                              setAddTab("project");
                              setSelectedAdd({ kind: "project", pick: p });
                            }}
                          >
                            <span className="block font-medium text-[#1d1d1f]">
                              {(p.project_title ?? "").trim() ||
                                "Untitled project"}
                            </span>
                            <span className="mt-0.5 block text-xs text-[#6e6e73]">
                              {p.display_name} · Interview{" "}
                              {formatInterviewDateLabel(p.interview_date)}
                            </span>
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                )}
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
                    disabled={
                      addSubmitting ||
                      !selectedAdd ||
                      !selectedAddIsEligible ||
                      selectedInterviewAlreadyInPost
                    }
                    title={
                      selectedInterviewAlreadyInPost
                        ? "This interview is already in post production."
                        : selectedAdd && !selectedAddIsEligible
                          ? "Not eligible for post production"
                          : undefined
                    }
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

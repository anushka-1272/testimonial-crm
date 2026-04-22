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
import { getUserSafe } from "@/lib/supabase-auth";
import { SLACK_PRKHRVV_EMAIL } from "@/lib/slack-contacts";
import { voidSlackNotify } from "@/lib/slack-client";
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
  /** Latest completed interview is no longer marked post-interview eligible. */
  eligibility_mismatch?: boolean;
};

type LinkField = "raw_video_link" | "edited_video_link" | "youtube_link";

const PP_SELECT =
  "id, created_at, candidate_id, project_candidate_id, source_type, candidate_name, raw_video_link, edited_video_link, pre_edit_review, pre_edit_review_by, post_edit_review, post_edit_review_by, edited_by, youtube_link, youtube_status, summary, cx_mail_sent, cx_mail_sent_at, updated_at, interview_language, candidates ( domain, job_role, is_deleted ), project_candidates ( id, email, full_name, whatsapp_number, project_title, problem_statement, target_user, ai_usage, demo_link, status, poc_assigned, poc_assigned_at, interview_type, is_deleted )";

async function attachPostProductionEligibilityMismatch(
  supabase: SupabaseClient,
  rows: PostProductionRow[],
): Promise<PostProductionRow[]> {
  const staleCand = new Set<string>();
  const staleProj = new Set<string>();

  const tCids = [
    ...new Set(
      rows
        .filter((r) => r.candidate_id && r.source_type === "testimonial")
        .map((r) => r.candidate_id as string),
    ),
  ];
  if (tCids.length) {
    const { data: ivs } = await supabase
      .from("interviews")
      .select("candidate_id, post_interview_eligible, completed_at")
      .in("candidate_id", tCids)
      .eq("interview_status", "completed");
    const byCand = new Map<
      string,
      { completed_at: string; eligible: boolean }[]
    >();
    for (const row of ivs ?? []) {
      const cid = row.candidate_id as string;
      const arr = byCand.get(cid) ?? [];
      arr.push({
        completed_at: String(row.completed_at ?? ""),
        eligible: row.post_interview_eligible === true,
      });
      byCand.set(cid, arr);
    }
    for (const cid of tCids) {
      const arr = byCand.get(cid) ?? [];
      if (!arr.length) {
        staleCand.add(cid);
        continue;
      }
      const latest = arr.reduce((a, b) =>
        a.completed_at >= b.completed_at ? a : b,
      );
      if (!latest.eligible) staleCand.add(cid);
    }
  }

  const pIds = [
    ...new Set(
      rows
        .filter((r) => r.project_candidate_id && r.source_type === "project")
        .map((r) => r.project_candidate_id as string),
    ),
  ];
  if (pIds.length) {
    const { data: pivs } = await supabase
      .from("project_interviews")
      .select("project_candidate_id, post_interview_eligible, completed_at")
      .in("project_candidate_id", pIds)
      .eq("interview_status", "completed");
    const byPc = new Map<
      string,
      { completed_at: string; eligible: boolean }[]
    >();
    for (const row of pivs ?? []) {
      const pid = row.project_candidate_id as string;
      const arr = byPc.get(pid) ?? [];
      arr.push({
        completed_at: String(row.completed_at ?? ""),
        eligible: row.post_interview_eligible === true,
      });
      byPc.set(pid, arr);
    }
    for (const pid of pIds) {
      const arr = byPc.get(pid) ?? [];
      if (!arr.length) {
        staleProj.add(pid);
        continue;
      }
      const latest = arr.reduce((a, b) =>
        a.completed_at >= b.completed_at ? a : b,
      );
      if (!latest.eligible) staleProj.add(pid);
    }
  }

  return rows.map((r) => ({
    ...r,
    eligibility_mismatch:
      Boolean(
        r.candidate_id &&
          r.source_type === "testimonial" &&
          staleCand.has(r.candidate_id),
      ) ||
      Boolean(
        r.project_candidate_id &&
          r.source_type === "project" &&
          staleProj.has(r.project_candidate_id),
      ),
  }));
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

type TestimonialPick = {
  interview_id: string;
  candidate_id: string;
  full_name: string | null;
  email: string;
  interview_date: string | null;
  interviewer: string;
};

type ProjectPick = {
  project_interview_id: string;
  project_candidate_id: string;
  display_name: string;
  email: string;
  project_title: string | null;
  interview_date: string | null;
};

type AddSelection =
  | { kind: "testimonial"; pick: TestimonialPick }
  | { kind: "project"; pick: ProjectPick };

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

  const [linkEdit, setLinkEdit] = useState<{
    rowId: string;
    field: LinkField;
    value: string;
  } | null>(null);

  const [reviewPopover, setReviewPopover] = useState<{
    rowId: string;
    kind: "pre" | "post";
  } | null>(null);
  const [postProductionTeam, setPostProductionTeam] = useState<string[]>([]);
  const [reviewBy, setReviewBy] = useState("");
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
    setRows(await attachPostProductionEligibilityMismatch(supabase, base));
    setError(null);
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
    const [{ data: invT }, { data: invP }, { data: existing }] =
      await Promise.all([
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
        supabase.from("post_production").select("candidate_id, project_candidate_id"),
      ]);
    setAddLoading(false);

    const inPostCand = new Set(
      (existing ?? [])
        .map((r) => r.candidate_id as string | null)
        .filter(Boolean) as string[],
    );
    const inPostProj = new Set(
      (existing ?? [])
        .map((r) => r.project_candidate_id as string | null)
        .filter(Boolean) as string[],
    );

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
      if (!cid || inPostCand.has(cid)) continue;
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
      if (!pcid || inPostProj.has(pcid)) continue;
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
        });
      }
    }
    setProjectPicks([...pMap.values()]);
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

  const confirmAdd = async () => {
    if (!canEditCurrentPage) return;
    if (!supabase || !selectedAdd) return;
    setAddSubmitting(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      setAddSubmitting(false);
      setError("You must be signed in to add entries.");
      return;
    }

    const body =
      selectedAdd.kind === "testimonial"
        ? {
            source: "testimonial" as const,
            interview_id: selectedAdd.pick.interview_id,
          }
        : {
            source: "project" as const,
            project_interview_id: selectedAdd.pick.project_interview_id,
          };

    const name =
      selectedAdd.kind === "testimonial"
        ? selectedAdd.pick.full_name?.trim() ||
          selectedAdd.pick.email.split("@")[0] ||
          "Candidate"
        : selectedAdd.pick.project_title?.trim() ||
          selectedAdd.pick.display_name ||
          selectedAdd.pick.email.split("@")[0] ||
          "Candidate";

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
    } catch {
      setAddSubmitting(false);
      setError("Network error while adding to post production.");
      return;
    }

    const json = (await res.json().catch(() => ({}))) as {
      error?: string;
      ok?: boolean;
    };
    setAddSubmitting(false);
    if (!res.ok) {
      setError(
        json.error ??
          (res.status === 409
            ? "This candidate is already in post production."
            : POST_PRODUCTION_NOT_ELIGIBLE_ERROR),
      );
      return;
    }

    const ppSlack =
      selectedAdd.kind === "testimonial"
        ? `🎥 New post production entry added!\n` +
          `*Candidate:* ${name}\n` +
          `*Source:* Testimonial\n` +
          `Please begin the editing process in the CRM.`
        : `🎥 New post production entry added!\n` +
          `*Candidate:* ${name}\n` +
          `*Source:* Project\n` +
          `Please begin the editing process in the CRM.`;
    voidSlackNotify(supabase, SLACK_PRKHRVV_EMAIL, ppSlack);

    setAddOpen(false);
    void loadRows();
  };

  const openNameDetail = async (row: PostProductionRow) => {
    if (row.source_type === "project" && row.project_candidate_id) {
      const nested = projectCandidateFromRow(row);
      if (nested) {
        setProjectDetailCandidate(nested);
        return;
      }
      if (!supabase) return;
      const { data } = await supabase
        .from("project_candidates")
        .select(
          "id, email, full_name, whatsapp_number, project_title, problem_statement, target_user, ai_usage, demo_link, status, poc_assigned, poc_assigned_at, interview_type",
        )
        .eq("id", row.project_candidate_id)
        .eq("is_deleted", false)
        .maybeSingle();
      if (data) setProjectDetailCandidate(data as ProjectCandidateRow);
      return;
    }
    if (row.candidate_id) setDetailCandidateId(row.candidate_id);
  };

  const patchRow = async (
    id: string,
    patch: Record<string, unknown>,
    log?: { description: string; candidateName: string },
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
    await patchRow(row.id, { [field]: v });
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

  if (!supabase) {
    return (
      <div className="px-8 py-16 text-center text-sm text-[#6e6e73]">
        {error ?? "Cannot connect to Supabase."}
      </div>
    );
  }

  return (
    <>
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
                        const cid = row.candidate_id;
                        const pcid = row.project_candidate_id;
                        const busy = savingId === row.id;
                        const nameClickable =
                          (row.source_type === "testimonial" && !!cid) ||
                          (row.source_type === "project" && !!pcid);
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
                              {row.eligibility_mismatch ? (
                                <p className="mt-1 max-w-[130px] text-[11px] font-medium leading-snug text-amber-800">
                                  Interview record is no longer marked
                                  post-interview eligible — review before
                                  continuing.
                                </p>
                              ) : null}
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
                              {row.edited_by?.trim() ? (
                                <div className="flex flex-col gap-1">
                                  <span className="inline-flex w-fit rounded-full bg-[#f5f5f7] px-2.5 py-1 text-xs font-medium text-[#6e6e73]">
                                    {row.edited_by}
                                  </span>
                                  <select
                                    disabled={busy}
                                    className="max-w-[112px] rounded-lg border border-[#e5e5e5] px-2 py-1 text-xs disabled:opacity-50"
                                    value={
                                      mergeRosterWithCurrent(
                                        postProductionTeam,
                                        row.edited_by,
                                      ).includes(row.edited_by ?? "")
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
                                    {!mergeRosterWithCurrent(
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
                                </div>
                              ) : (
                                <select
                                  disabled={busy}
                                  className="max-w-[112px] rounded-lg border border-[#e5e5e5] px-2 py-1 text-xs disabled:opacity-50"
                                  value=""
                                  onChange={(e) => {
                                    const v = e.target.value || null;
                                    if (v)
                                      void patchRow(row.id, { edited_by: v });
                                  }}
                                >
                                  <option value="">Assign…</option>
                                  {postProductionTeam.map((n) => (
                                    <option key={n} value={n}>
                                      {n}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </td>
                            <td className={`${td} ${ppCol.youtube}`}>
                              {renderLinkCell(row, "youtube_link")}
                            </td>
                            <td className={`${td} ${ppCol.status}`}>
                              <div className="flex flex-col gap-1">
                                {youtubeStatusBadge(row.youtube_status)}
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
                              </div>
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
                            onClick={() =>
                              setSelectedAdd({ kind: "testimonial", pick: p })
                            }
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
                            onClick={() =>
                              setSelectedAdd({ kind: "project", pick: p })
                            }
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
                      selectedAdd.kind !== addTab
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

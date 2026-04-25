"use client";

import { parseISO } from "date-fns";
import { Download, ExternalLink, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { modalOverlayClass, modalPanelClass } from "@/lib/modal-responsive";
import { createBrowserSupabaseClient } from "@/lib/supabase-browser";

const TIMEZONE_IST = "Asia/Kolkata";
const FETCH_CAP = 4000;
const SUMMARY_PREVIEW = 120;

export type LibraryRow = {
  key: string;
  interviewId: string;
  candidateId: string | null;
  projectCandidateId: string | null;
  post_interview_eligible: boolean;
  source: "testimonial" | "project";
  name: string;
  email: string;
  interviewType: "testimonial" | "project";
  domain: string | null;
  role: string | null;
  completedAt: string | null;
  summary: string | null;
  /** Non-empty YouTube URL from post production */
  youtubeLink: string;
  /** `post_production.updated_at` (proxy for link activity; DB has no youtube_link_added_at) */
  youtubeLinkSortAt: string;
};

type LibraryDetailData =
  | {
      source: "testimonial";
      name: string | null;
      phone: string | null;
      email: string | null;
      role: string | null;
      salary: string | null;
      achievementType: string | null;
      achievementTitle: string | null;
      quantifiedResult: string | null;
      howProgramHelped: string | null;
      proofLink: string | null;
      linkedin: string | null;
      instagram: string | null;
      aiScore: number | null;
      aiReason: string | null;
    }
  | {
      source: "project";
      name: string | null;
      email: string | null;
      projectTitle: string | null;
      problemStatement: string | null;
      demoLink: string | null;
    };

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** `<input type="date">` value as IST civil day → [start, next day start). */
function istDateInputBounds(ymd: string): { startIso: string; endExclusiveIso: string } | null {
  const t = ymd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const [y, m, d] = t.split("-").map(Number);
  const start = new Date(`${y}-${pad2(m)}-${pad2(d)}T00:00:00+05:30`);
  const end = new Date(start.getTime() + 86400000);
  return { startIso: start.toISOString(), endExclusiveIso: end.toISOString() };
}

function librarySafetyFilter(item: LibraryRow): boolean {
  return (
    item.post_interview_eligible === true &&
    Boolean(item.youtubeLink?.trim())
  );
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

type InterviewCandRow = {
  id: string;
  candidate_id: string;
  completed_at: string | null;
  post_interview_eligible: boolean | null;
  interview_type: string | null;
  candidates:
    | {
        full_name: string | null;
        email: string;
        domain: string | null;
        job_role: string | null;
        role_before_program: string | null;
        achievement_type: string | null;
        achievement_title: string | null;
        quantified_result: string | null;
        how_program_helped: string | null;
      }
    | Array<{
        full_name: string | null;
        email: string;
        domain: string | null;
        job_role: string | null;
        role_before_program: string | null;
        achievement_type: string | null;
        achievement_title: string | null;
        quantified_result: string | null;
        how_program_helped: string | null;
      }>;
};

type ProjectInterviewRow = {
  id: string;
  project_candidate_id: string;
  completed_at: string | null;
  post_interview_eligible: boolean | null;
  interview_type: string | null;
  project_candidates:
    | { full_name: string | null; email: string }
    | Array<{ full_name: string | null; email: string }>;
};

async function fetchTestimonialInterviewsByIds(
  supabase: ReturnType<typeof createBrowserSupabaseClient>,
  interviewIds: string[],
): Promise<Map<string, InterviewCandRow>> {
  const map = new Map<string, InterviewCandRow>();
  for (const batch of chunk(interviewIds, 80)) {
    if (batch.length === 0) continue;
    const { data, error } = await supabase
      .from("interviews")
      .select(
        "id, candidate_id, completed_at, post_interview_eligible, interview_type, candidates!inner ( full_name, email, domain, job_role, role_before_program, achievement_type, achievement_title, quantified_result, how_program_helped, is_deleted )",
      )
      .in("id", batch)
      .eq("post_interview_eligible", true)
      .not("completed_at", "is", null)
      .or("interview_status.eq.completed,completed_at.not.is.null")
      .eq("candidates.is_deleted", false);
    if (error) throw error;
    for (const raw of data ?? []) {
      const r = raw as InterviewCandRow;
      map.set(r.id, r);
    }
  }
  return map;
}

async function fetchProjectInterviewsByIds(
  supabase: ReturnType<typeof createBrowserSupabaseClient>,
  interviewIds: string[],
): Promise<Map<string, ProjectInterviewRow>> {
  const map = new Map<string, ProjectInterviewRow>();
  for (const batch of chunk(interviewIds, 80)) {
    if (batch.length === 0) continue;
    const { data, error } = await supabase
      .from("project_interviews")
      .select(
        "id, project_candidate_id, completed_at, post_interview_eligible, interview_type, project_candidates!inner ( full_name, email, is_deleted )",
      )
      .in("id", batch)
      .eq("post_interview_eligible", true)
      .not("completed_at", "is", null)
      .or("interview_status.eq.completed,completed_at.not.is.null")
      .eq("project_candidates.is_deleted", false);
    if (error) throw error;
    for (const raw of data ?? []) {
      const r = raw as ProjectInterviewRow;
      map.set(r.id, r);
    }
  }
  return map;
}

function dedupePostProductionByInterviewId<
  T extends {
    interview_id: string | null;
    project_interview_id?: string | null;
    source_type?: string | null;
    updated_at: string;
  },
>(rows: T[]): T[] {
  const m = new Map<string, T>();
  for (const r of rows) {
    const linkedId =
      r.source_type === "project"
        ? (r.project_interview_id ?? r.interview_id ?? "").trim()
        : (r.interview_id ?? r.project_interview_id ?? "").trim();
    if (!linkedId) continue;
    const key = `${r.source_type ?? "testimonial"}:${linkedId}`;
    const prev = m.get(key);
    if (
      !prev ||
      new Date(r.updated_at).getTime() > new Date(prev.updated_at).getTime()
    ) {
      m.set(key, r);
    }
  }
  return [...m.values()];
}

function formatCompletedAt(iso: string | null): string {
  if (!iso?.trim()) return "—";
  try {
    const d = parseISO(iso.trim());
    return new Intl.DateTimeFormat("en-US", {
      timeZone: TIMEZONE_IST,
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(d);
  } catch {
    return "—";
  }
}

export function InterviewLibraryDashboard() {
  const supabase = useMemo(() => {
    try {
      return createBrowserSupabaseClient();
    } catch {
      return null;
    }
  }, []);

  const [rows, setRows] = useState<LibraryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "testimonial" | "project">("all");
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [expandedSummary, setExpandedSummary] = useState<Set<string>>(() => new Set());
  const [detailRow, setDetailRow] = useState<LibraryRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<LibraryDetailData | null>(null);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [expandedTextKeys, setExpandedTextKeys] = useState<Set<string>>(
    () => new Set(),
  );

  const load = useCallback(async () => {
    if (!supabase) {
      setError("Cannot connect to Supabase.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data: ppRows, error: ppErr } = await supabase
        .from("post_production")
        .select(
          "id, interview_id, project_interview_id, candidate_id, project_candidate_id, source_type, summary, youtube_link, youtube_status, updated_at",
        )
        .not("youtube_link", "is", null)
        .neq("youtube_link", "")
        .order("updated_at", { ascending: false })
        .limit(FETCH_CAP * 2);

      if (ppErr) throw ppErr;

      type PpRow = {
        id: string;
        interview_id: string | null;
        project_interview_id: string | null;
        candidate_id: string | null;
        project_candidate_id: string | null;
        source_type: string | null;
        summary: string | null;
        youtube_link: string;
        youtube_status: string | null;
        updated_at: string;
      };

      const ppListRaw = (ppRows ?? []).filter((r) => {
        const yt = String((r as PpRow).youtube_link ?? "").trim();
        return yt.length > 0;
      }) as PpRow[];

      const ppList = dedupePostProductionByInterviewId(ppListRaw);

      const ppTestimonial = ppList.filter(
        (r) =>
          Boolean(r.interview_id) &&
          Boolean(r.candidate_id) &&
          String(r.source_type ?? "testimonial") !== "project",
      );
      const ppProject = ppList.filter(
        (r) =>
          Boolean(r.project_interview_id ?? r.interview_id) &&
          Boolean(r.project_candidate_id) &&
          r.source_type === "project",
      );

      const tIvIds = [
        ...new Set(
          ppTestimonial.map((r) => r.interview_id as string),
        ),
      ];
      const pIvIds = [
        ...new Set(
          ppProject.map((r) => (r.project_interview_id ?? r.interview_id) as string),
        ),
      ];

      const interviewById =
        tIvIds.length > 0
          ? await fetchTestimonialInterviewsByIds(supabase, tIvIds)
          : new Map<string, InterviewCandRow>();
      const projectInterviewById =
        pIvIds.length > 0
          ? await fetchProjectInterviewsByIds(supabase, pIvIds)
          : new Map<string, ProjectInterviewRow>();

      const out: LibraryRow[] = [];

      for (const pp of ppTestimonial) {
        const yt = pp.youtube_link.trim();
        if (!yt) continue;
        const iid = pp.interview_id as string;
        const iv = interviewById.get(iid);
        if (!iv || iv.post_interview_eligible !== true) continue;
        const c = Array.isArray(iv.candidates) ? iv.candidates[0] : iv.candidates;
        if (!c) continue;
        const mappedSummary =
          pp.summary?.trim() ||
          c.how_program_helped?.trim() ||
          c.quantified_result?.trim() ||
          c.achievement_title?.trim() ||
          null;
        out.push({
          key: `t-${iid}`,
          interviewId: iid,
          candidateId: iv.candidate_id,
          projectCandidateId: null,
          post_interview_eligible: true,
          source: "testimonial",
          name: c.full_name?.trim() || c.email,
          email: c.email,
          interviewType: "testimonial",
          domain: c.domain?.trim() || null,
          role: c.job_role?.trim() || c.role_before_program?.trim() || null,
          completedAt: iv.completed_at,
          summary: mappedSummary,
          youtubeLink: yt,
          youtubeLinkSortAt: pp.updated_at,
        });
      }

      for (const pp of ppProject) {
        const yt = pp.youtube_link.trim();
        if (!yt) continue;
        const iid = (pp.project_interview_id ?? pp.interview_id) as string;
        const piv = projectInterviewById.get(iid);
        if (!piv || piv.post_interview_eligible !== true) continue;
        const c = Array.isArray(piv.project_candidates)
          ? piv.project_candidates[0]
          : piv.project_candidates;
        if (!c) continue;
        out.push({
          key: `p-${iid}`,
          interviewId: iid,
          candidateId: null,
          projectCandidateId: piv.project_candidate_id,
          post_interview_eligible: true,
          source: "project",
          name: c.full_name?.trim() || c.email,
          email: c.email,
          interviewType: "project",
          domain: null,
          role: null,
          completedAt: piv.completed_at,
          summary: pp.summary?.trim() || null,
          youtubeLink: yt,
          youtubeLinkSortAt: pp.updated_at,
        });
      }

      const uniqueOut = [...new Map(out.map((r) => [r.key, r])).values()];
      uniqueOut.sort((a, b) => {
        const sa = new Date(a.youtubeLinkSortAt).getTime();
        const sb = new Date(b.youtubeLinkSortAt).getTime();
        if (sb !== sa) return sb - sa;
        const ca = a.completedAt ? new Date(a.completedAt).getTime() : 0;
        const cb = b.completedAt ? new Date(b.completedAt).getTime() : 0;
        return cb - ca;
      });

      setRows(uniqueOut.filter(librarySafetyFilter));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load interview library.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!detailRow || !supabase) return;
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    setDetailData(null);

    void (async () => {
      if (detailRow.source === "testimonial") {
        if (!detailRow.candidateId) {
          if (!cancelled) {
            setDetailError("Candidate details unavailable.");
            setDetailLoading(false);
          }
          return;
        }
        const { data, error } = await supabase
          .from("candidates")
          .select(
            "full_name, email, whatsapp_number, role_before_program, salary_before_program, achievement_type, achievement_title, quantified_result, how_program_helped, proof_document_url, linkedin_url, instagram_url, ai_eligibility_score, ai_eligibility_reason, is_deleted",
          )
          .eq("id", detailRow.candidateId)
          .eq("is_deleted", false)
          .maybeSingle();

        if (cancelled) return;
        setDetailLoading(false);
        if (error) {
          setDetailError(error.message);
          return;
        }
        setDetailData({
          source: "testimonial",
          name: (data?.full_name as string | null | undefined) ?? detailRow.name,
          phone: (data?.whatsapp_number as string | null | undefined) ?? null,
          email: (data?.email as string | null | undefined) ?? detailRow.email,
          role: (data?.role_before_program as string | null | undefined) ?? detailRow.role,
          salary: (data?.salary_before_program as string | null | undefined) ?? null,
          achievementType:
            (data?.achievement_type as string | null | undefined) ?? null,
          achievementTitle:
            (data?.achievement_title as string | null | undefined) ?? null,
          quantifiedResult:
            (data?.quantified_result as string | null | undefined) ?? null,
          howProgramHelped:
            (data?.how_program_helped as string | null | undefined) ?? null,
          proofLink: (data?.proof_document_url as string | null | undefined) ?? null,
          linkedin: (data?.linkedin_url as string | null | undefined) ?? null,
          instagram: (data?.instagram_url as string | null | undefined) ?? null,
          aiScore: (data?.ai_eligibility_score as number | null | undefined) ?? null,
          aiReason: (data?.ai_eligibility_reason as string | null | undefined) ?? null,
        });
        return;
      }

      if (!detailRow.projectCandidateId) {
        if (!cancelled) {
          setDetailError("Project candidate details unavailable.");
          setDetailLoading(false);
        }
        return;
      }

      const { data, error } = await supabase
        .from("project_candidates")
        .select(
          "full_name, email, project_title, problem_statement, demo_link, is_deleted",
        )
        .eq("id", detailRow.projectCandidateId)
        .eq("is_deleted", false)
        .maybeSingle();

      if (cancelled) return;
      setDetailLoading(false);
      if (error) {
        setDetailError(error.message);
        return;
      }
      setDetailData({
        source: "project",
        name: (data?.full_name as string | null | undefined) ?? detailRow.name,
        email: (data?.email as string | null | undefined) ?? detailRow.email,
        projectTitle:
          (data?.project_title as string | null | undefined) ?? null,
        problemStatement:
          (data?.problem_statement as string | null | undefined) ?? null,
        demoLink: (data?.demo_link as string | null | undefined) ?? null,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [detailRow, supabase]);

  useEffect(() => {
    if (!detailRow) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        setDetailRow(null);
        setExpandedTextKeys(new Set());
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [detailRow]);

  const domainOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      if (r.source !== "testimonial") continue;
      const d = r.domain?.trim();
      if (d) s.add(d);
    }
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const fromB = dateFrom ? istDateInputBounds(dateFrom) : null;
    const toB = dateTo ? istDateInputBounds(dateTo) : null;

    return rows.filter(librarySafetyFilter).filter((r) => {
      if (typeFilter !== "all" && r.interviewType !== typeFilter) return false;
      if (domainFilter !== "all" && typeFilter !== "project") {
        if (r.source === "testimonial") {
          if ((r.domain ?? "").trim() !== domainFilter) return false;
        }
      }
      if (q) {
        const name = r.name.toLowerCase();
        const email = r.email.toLowerCase();
        if (!name.includes(q) && !email.includes(q)) return false;
      }
      if (fromB && r.completedAt) {
        if (r.completedAt < fromB.startIso) return false;
      } else if (fromB && !r.completedAt) {
        return false;
      }
      if (toB && r.completedAt) {
        if (r.completedAt >= toB.endExclusiveIso) return false;
      } else if (toB && !r.completedAt) {
        return false;
      }
      return true;
    });
  }, [rows, search, typeFilter, domainFilter, dateFrom, dateTo]);

  const toggleSummary = (key: string) => {
    setExpandedSummary((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleExportCsv = async () => {
    if (!supabase || exportingCsv) return;
    setExportingCsv(true);
    setError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setError("You must be signed in to export.");
        setExportingCsv(false);
        return;
      }

      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (typeFilter !== "all") params.set("type", typeFilter);
      if (domainFilter !== "all") params.set("domain", domainFilter);
      if (dateFrom.trim()) params.set("from", dateFrom.trim());
      if (dateTo.trim()) params.set("to", dateTo.trim());

      const res = await fetch(`/api/interview-library/export?${params.toString()}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const message = await res.text().catch(() => "");
        throw new Error(message || "Failed to export CSV.");
      }

      const blob = await res.blob();
      const dlUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = dlUrl;
      a.download = "interview-library.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(dlUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to export CSV.");
    } finally {
      setExportingCsv(false);
    }
  };

  if (!supabase) {
    return (
      <div className="py-16 text-center text-sm text-[#6e6e73]">
        {error ?? "Cannot connect to Supabase."}
      </div>
    );
  }

  const th =
    "border-b border-gray-100 bg-[#fafafa] py-2.5 px-3 text-left text-xs font-semibold tracking-wider text-gray-500";
  const td = "border-b border-gray-100 px-3 py-2.5 text-sm align-top text-[#1d1d1f]";

  return (
    <>
      <header className="sticky top-14 z-30 bg-[#f5f5f7]/90 px-4 py-4 backdrop-blur-md sm:px-6 sm:py-5 lg:top-0 lg:px-8 lg:py-6">
        <div className="mx-auto max-w-[1600px]">
          <h1 className="text-xl font-semibold tracking-tight text-[#1d1d1f] sm:text-2xl">
            Interview Library
          </h1>
          <p className="mt-1 text-sm text-[#6e6e73]">
            Post-interview eligible, completed, with a YouTube link · read-only ·
            dates in IST ({TIMEZONE_IST})
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 pb-12 pt-2 sm:px-6 lg:px-8 lg:pb-16">
        {error ? (
          <div className="mb-4 rounded-2xl border border-red-100 bg-red-50/80 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-[#f0f0f0] bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
            <label className="flex min-w-[200px] flex-1 flex-col gap-1">
              <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
                Search
              </span>
              <input
                type="search"
                placeholder="Name or email"
                className="rounded-xl border border-[#e5e5e5] px-3 py-2 text-sm"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label className="flex w-full flex-col gap-1 sm:w-44">
              <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
                Type
              </span>
              <select
                className="rounded-xl border border-[#e5e5e5] px-3 py-2 text-sm"
                value={typeFilter}
                onChange={(e) =>
                  setTypeFilter(e.target.value as typeof typeFilter)
                }
              >
                <option value="all">All</option>
                <option value="testimonial">Testimonial</option>
                <option value="project">Project</option>
              </select>
            </label>
            <label className="flex w-full min-w-[180px] flex-col gap-1 sm:w-52">
              <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
                Domain
              </span>
              <select
                className="rounded-xl border border-[#e5e5e5] px-3 py-2 text-sm"
                value={domainFilter}
                onChange={(e) => setDomainFilter(e.target.value)}
              >
                <option value="all">All</option>
                {domainOptions.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex w-full flex-col gap-1 sm:w-40">
              <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
                From (IST)
              </span>
              <input
                type="date"
                className="rounded-xl border border-[#e5e5e5] px-3 py-2 text-sm"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </label>
            <label className="flex w-full flex-col gap-1 sm:w-40">
              <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
                To (IST)
              </span>
              <input
                type="date"
                className="rounded-xl border border-[#e5e5e5] px-3 py-2 text-sm"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </label>
            <div className="flex items-center gap-2 lg:mb-0.5 lg:ml-auto">
              <button
                type="button"
                disabled={exportingCsv}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#1d1d1f] bg-[#1d1d1f] px-4 py-2 text-sm font-medium text-white hover:bg-[#2c2c2e] disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => void handleExportCsv()}
              >
                {exportingCsv ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Export CSV
              </button>
              <button
                type="button"
                className="rounded-xl border border-[#e5e5e5] bg-white px-4 py-2 text-sm font-medium text-[#1d1d1f] hover:bg-[#fafafa]"
                onClick={() => {
                  setSearch("");
                  setTypeFilter("all");
                  setDomainFilter("all");
                  setDateFrom("");
                  setDateTo("");
                }}
              >
                Clear filters
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-[#6e6e73]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </p>
        ) : filtered.length === 0 ? (
          <p className="rounded-2xl border border-[#f0f0f0] bg-white py-16 text-center text-sm text-[#6e6e73] shadow-sm">
            {rows.length === 0
              ? "No completed & approved interviews with YouTube link yet."
              : "No interviews match your filters."}
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-[#f0f0f0] bg-white shadow-sm">
            <div className="w-full overflow-x-auto">
              <table className="w-full min-w-[980px] table-fixed border-collapse text-sm">
                <thead>
                  <tr>
                    <th className={`${th} w-[140px]`}>Name</th>
                    <th className={`${th} w-[200px]`}>Email</th>
                    <th className={`${th} w-[100px]`}>Type</th>
                    <th className={`${th} w-[140px]`}>Domain</th>
                    <th className={`${th} w-[120px]`}>Role</th>
                    <th className={`${th} w-[110px]`}>Completed</th>
                    <th className={`${th} min-w-[200px]`}>Summary</th>
                    <th className={`${th} w-[100px]`}>YouTube</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const sum = r.summary ?? "";
                    const expanded = expandedSummary.has(r.key);
                    const showExpand = sum.length > SUMMARY_PREVIEW;
                    const preview = showExpand && !expanded
                      ? `${sum.slice(0, SUMMARY_PREVIEW)}…`
                      : sum;
                    return (
                      <tr key={r.key}>
                        <td className={`${td} font-medium`}>
                          <button
                            type="button"
                            className="max-w-full truncate text-left text-[#3b82f6] hover:underline"
                            onClick={() => setDetailRow(r)}
                            title={r.name}
                          >
                            {r.name}
                          </button>
                        </td>
                        <td className={`${td} break-all text-[#6e6e73]`}>{r.email}</td>
                        <td className={td}>
                          <span
                            className={
                              r.interviewType === "project"
                                ? "inline-flex rounded-full bg-[#eff6ff] px-2 py-0.5 text-xs font-medium text-[#2563eb]"
                                : "inline-flex rounded-full bg-[#f0fdf4] px-2 py-0.5 text-xs font-medium text-[#16a34a]"
                            }
                          >
                            {r.interviewType === "project" ? "Project" : "Testimonial"}
                          </span>
                        </td>
                        <td className={`${td} text-[#6e6e73]`}>
                          {r.domain?.trim() || "—"}
                        </td>
                        <td className={`${td} text-[#6e6e73]`}>
                          {r.role?.trim() || "—"}
                        </td>
                        <td className={`${td} whitespace-nowrap text-[#6e6e73]`}>
                          {formatCompletedAt(r.completedAt)}
                        </td>
                        <td className={td}>
                          {sum ? (
                            <div className="max-w-md">
                              <p className="whitespace-pre-wrap text-[#1d1d1f]">
                                {preview}
                              </p>
                              {showExpand ? (
                                <button
                                  type="button"
                                  className="mt-1 text-xs font-medium text-[#3b82f6] hover:underline"
                                  onClick={() => toggleSummary(r.key)}
                                >
                                  {expanded ? "Show less" : "Show more"}
                                </button>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-[#aeaeb2]">—</span>
                          )}
                        </td>
                        <td className={td}>
                          <a
                            href={r.youtubeLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-medium text-[#3b82f6] hover:underline"
                          >
                            Open
                            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {detailRow ? (
        <div className={modalOverlayClass}>
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Close"
            onClick={() => {
              setDetailRow(null);
              setExpandedTextKeys(new Set());
            }}
          />
          <div
            className={`${modalPanelClass} max-h-[85vh] max-w-[720px] overflow-y-auto p-6 shadow-xl`}
            role="dialog"
            aria-modal="true"
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-[#1d1d1f]">
                  {detailData?.name?.trim() || detailRow.name || "—"}
                </h2>
                <p className="mt-1 text-sm text-[#6e6e73]">
                  {detailRow.source === "project" ? "Project" : "Testimonial"}
                </p>
              </div>
              <button
                type="button"
                className="rounded-lg px-2 py-1 text-sm font-medium text-[#6e6e73] hover:bg-[#f5f5f7] hover:text-[#1d1d1f]"
                onClick={() => {
                  setDetailRow(null);
                  setExpandedTextKeys(new Set());
                }}
              >
                Close
              </button>
            </div>

            {detailLoading ? (
              <p className="text-sm text-[#6e6e73]">Loading details...</p>
            ) : detailError ? (
              <p className="rounded-xl border border-[#f0f0f0] bg-[#f5f5f7] px-3 py-2 text-sm text-[#1d1d1f]">
                {detailError}
              </p>
            ) : detailData ? (
              <div className="space-y-4 text-sm">
                <section className="rounded-xl border border-[#f0f0f0] bg-white p-4">
                  <h3 className="mb-3 text-sm font-semibold text-[#1d1d1f]">
                    Basic Info
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <p><span className="font-medium">Name:</span> {detailData.name?.trim() || "—"}</p>
                    {detailData.source === "testimonial" ? (
                      <p><span className="font-medium">Phone:</span> {detailData.phone?.trim() || "—"}</p>
                    ) : null}
                    <p><span className="font-medium">Email:</span> {detailData.email?.trim() || "—"}</p>
                    {detailData.source === "testimonial" ? (
                      <p><span className="font-medium">Role:</span> {detailData.role?.trim() || "—"}</p>
                    ) : null}
                    {detailData.source === "testimonial" ? (
                      <p className="sm:col-span-2"><span className="font-medium">Salary:</span> {detailData.salary?.trim() || "—"}</p>
                    ) : null}
                    {detailData.source === "project" ? (
                      <p className="sm:col-span-2"><span className="font-medium">Project Title:</span> {detailData.projectTitle?.trim() || "—"}</p>
                    ) : null}
                  </div>
                </section>

                {detailData.source === "testimonial" ? (
                  <>
                    <section className="rounded-xl border border-[#f0f0f0] bg-white p-4">
                      <h3 className="mb-3 text-sm font-semibold text-[#1d1d1f]">
                        Achievement
                      </h3>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <p><span className="font-medium">Achievement Type:</span> {detailData.achievementType?.trim() || "—"}</p>
                        <p><span className="font-medium">Achievement Title:</span> {detailData.achievementTitle?.trim() || "—"}</p>
                        <p className="sm:col-span-2"><span className="font-medium">Quantified Result:</span> {detailData.quantifiedResult?.trim() || "—"}</p>
                      </div>
                    </section>

                    <section className="rounded-xl border border-[#f0f0f0] bg-white p-4">
                      <h3 className="mb-3 text-sm font-semibold text-[#1d1d1f]">
                        Program Impact
                      </h3>
                      <p className="whitespace-pre-wrap">
                        {detailData.howProgramHelped?.trim() || "—"}
                      </p>
                    </section>

                    <section className="rounded-xl border border-[#f0f0f0] bg-white p-4">
                      <h3 className="mb-3 text-sm font-semibold text-[#1d1d1f]">Links</h3>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <p className="font-medium">Proof</p>
                          {detailData.proofLink?.trim() ? (
                            <a
                              href={detailData.proofLink.trim()}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-1 inline-flex rounded-xl bg-[#1d1d1f] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#2d2d2f]"
                            >
                              View Proof
                            </a>
                          ) : (
                            <p className="text-[#6e6e73]">—</p>
                          )}
                        </div>
                        <div>
                          <p className="font-medium">LinkedIn</p>
                          {detailData.linkedin?.trim() ? (
                            <a href={detailData.linkedin.trim()} target="_blank" rel="noopener noreferrer" className="text-[#3b82f6] hover:underline">
                              Open profile
                            </a>
                          ) : <p className="text-[#6e6e73]">—</p>}
                        </div>
                        <div>
                          <p className="font-medium">Instagram</p>
                          {detailData.instagram?.trim() ? (
                            <a href={detailData.instagram.trim()} target="_blank" rel="noopener noreferrer" className="text-[#3b82f6] hover:underline">
                              Open profile
                            </a>
                          ) : <p className="text-[#6e6e73]">—</p>}
                        </div>
                      </div>
                    </section>

                    <section className="rounded-xl border border-[#f0f0f0] bg-white p-4">
                      <h3 className="mb-3 text-sm font-semibold text-[#1d1d1f]">
                        AI Evaluation
                      </h3>
                      <p>
                        <span className="font-medium">AI Score:</span>{" "}
                        {detailData.aiScore == null ? "—" : detailData.aiScore}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-[#4b5563]">
                        <span className="font-medium text-[#1d1d1f]">AI Reason:</span>{" "}
                        {detailData.aiReason?.trim() || "—"}
                      </p>
                    </section>
                  </>
                ) : (
                  <>
                    <section className="rounded-xl border border-[#f0f0f0] bg-white p-4">
                      <h3 className="mb-3 text-sm font-semibold text-[#1d1d1f]">
                        Candidate Details
                      </h3>
                      <p>
                        <span className="font-medium">Problem Statement:</span>{" "}
                        {(() => {
                          const full = detailData.problemStatement?.trim() ?? "";
                          if (!full) return "—";
                          const key = `${detailRow.key}:problem`;
                          const expanded = expandedTextKeys.has(key);
                          if (expanded || full.length <= 120) return full;
                          return (
                            <>
                              {full.slice(0, 120)}...
                              <button
                                type="button"
                                className="ml-1 font-medium text-[#2563eb] hover:underline"
                                onClick={() =>
                                  setExpandedTextKeys((prev) => new Set(prev).add(key))
                                }
                              >
                                View more
                              </button>
                            </>
                          );
                        })()}
                      </p>
                      <p className="mt-2">
                        <span className="font-medium">Demo Link:</span>{" "}
                        {detailData.demoLink?.trim() ? (
                          <a
                            href={detailData.demoLink.trim()}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#3b82f6] hover:underline"
                          >
                            Open demo
                          </a>
                        ) : (
                          "—"
                        )}
                      </p>
                    </section>
                  </>
                )}
              </div>
            ) : (
              <p className="text-sm text-[#6e6e73]">Details unavailable.</p>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

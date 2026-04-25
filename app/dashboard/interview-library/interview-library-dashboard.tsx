"use client";

import { parseISO } from "date-fns";
import { ExternalLink, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { createBrowserSupabaseClient } from "@/lib/supabase-browser";

const TIMEZONE_IST = "Asia/Kolkata";
const FETCH_CAP = 4000;
const SUMMARY_PREVIEW = 120;

type PostProductionLite = {
  candidate_id: string | null;
  project_candidate_id: string | null;
  summary: string | null;
  youtube_link: string | null;
  youtube_status: string | null;
  edited_video_link: string | null;
  raw_video_link: string | null;
};

export type LibraryStatus = "Draft" | "Edited" | "Uploaded";

export type LibraryRow = {
  key: string;
  source: "testimonial" | "project";
  name: string;
  email: string;
  interviewType: "testimonial" | "project";
  domain: string | null;
  role: string | null;
  completedAt: string | null;
  summary: string | null;
  youtubeLink: string | null;
  status: LibraryStatus;
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

function statusFromPostProduction(pp: PostProductionLite | undefined): LibraryStatus {
  if (!pp) return "Draft";
  const yt = (pp.youtube_link ?? "").trim();
  if (yt || pp.youtube_status === "live") return "Uploaded";
  if ((pp.edited_video_link ?? "").trim()) return "Edited";
  return "Draft";
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchPostProductionMap(
  supabase: ReturnType<typeof createBrowserSupabaseClient>,
  candidateIds: string[],
  projectCandidateIds: string[],
): Promise<Map<string, PostProductionLite>> {
  const map = new Map<string, PostProductionLite>();

  for (const batch of chunk(candidateIds, 150)) {
    if (batch.length === 0) continue;
    const { data, error } = await supabase
      .from("post_production")
      .select(
        "candidate_id, project_candidate_id, summary, youtube_link, youtube_status, edited_video_link, raw_video_link",
      )
      .in("candidate_id", batch);
    if (error) throw error;
    for (const row of data ?? []) {
      const cid = row.candidate_id as string | null;
      if (cid) map.set(`c:${cid}`, row as PostProductionLite);
    }
  }

  for (const batch of chunk(projectCandidateIds, 150)) {
    if (batch.length === 0) continue;
    const { data, error } = await supabase
      .from("post_production")
      .select(
        "candidate_id, project_candidate_id, summary, youtube_link, youtube_status, edited_video_link, raw_video_link",
      )
      .in("project_candidate_id", batch);
    if (error) throw error;
    for (const row of data ?? []) {
      const pid = row.project_candidate_id as string | null;
      if (pid) map.set(`p:${pid}`, row as PostProductionLite);
    }
  }

  return map;
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

  const load = useCallback(async () => {
    if (!supabase) {
      setError("Cannot connect to Supabase.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data: tRows, error: tErr } = await supabase
        .from("interviews")
        .select(
          "id, candidate_id, completed_at, interview_type, candidates!inner ( full_name, email, domain, job_role, is_deleted )",
        )
        .or("interview_status.eq.completed,completed_at.not.is.null")
        .not("completed_at", "is", null)
        .eq("candidates.is_deleted", false)
        .order("completed_at", { ascending: false })
        .limit(FETCH_CAP);

      if (tErr) throw tErr;

      const { data: pRows, error: pErr } = await supabase
        .from("project_interviews")
        .select(
          "id, project_candidate_id, completed_at, interview_type, project_candidates!inner ( full_name, email, is_deleted )",
        )
        .or("interview_status.eq.completed,completed_at.not.is.null")
        .not("completed_at", "is", null)
        .eq("project_candidates.is_deleted", false)
        .order("completed_at", { ascending: false })
        .limit(FETCH_CAP);

      if (pErr) throw pErr;

      const testimonialCandidateIds = [
        ...new Set(
          (tRows ?? [])
            .map((r) => (r as { candidate_id: string }).candidate_id)
            .filter(Boolean),
        ),
      ];
      const projectCandidateIds = [
        ...new Set(
          (pRows ?? [])
            .map((r) => (r as { project_candidate_id: string }).project_candidate_id)
            .filter(Boolean),
        ),
      ];

      const ppMap = await fetchPostProductionMap(
        supabase,
        testimonialCandidateIds,
        projectCandidateIds,
      );

      const out: LibraryRow[] = [];

      for (const raw of tRows ?? []) {
        const r = raw as {
          id: string;
          candidate_id: string;
          completed_at: string | null;
          interview_type: string | null;
          candidates:
            | {
                full_name: string | null;
                email: string;
                domain: string | null;
                job_role: string | null;
              }
            | Array<{
                full_name: string | null;
                email: string;
                domain: string | null;
                job_role: string | null;
              }>;
        };
        const c = Array.isArray(r.candidates) ? r.candidates[0] : r.candidates;
        if (!c) continue;
        const pp = ppMap.get(`c:${r.candidate_id}`);
        out.push({
          key: `t-${r.id}`,
          source: "testimonial",
          name: c.full_name?.trim() || c.email,
          email: c.email,
          interviewType: "testimonial",
          domain: c.domain?.trim() || null,
          role: c.job_role?.trim() || null,
          completedAt: r.completed_at,
          summary: pp?.summary?.trim() || null,
          youtubeLink: pp?.youtube_link?.trim() || null,
          status: statusFromPostProduction(pp),
        });
      }

      for (const raw of pRows ?? []) {
        const r = raw as {
          id: string;
          project_candidate_id: string;
          completed_at: string | null;
          interview_type: string | null;
          project_candidates:
            | { full_name: string | null; email: string }
            | Array<{ full_name: string | null; email: string }>;
        };
        const c = Array.isArray(r.project_candidates)
          ? r.project_candidates[0]
          : r.project_candidates;
        if (!c) continue;
        const pp = ppMap.get(`p:${r.project_candidate_id}`);
        out.push({
          key: `p-${r.id}`,
          source: "project",
          name: c.full_name?.trim() || c.email,
          email: c.email,
          interviewType: "project",
          domain: null,
          role: null,
          completedAt: r.completed_at,
          summary: pp?.summary?.trim() || null,
          youtubeLink: pp?.youtube_link?.trim() || null,
          status: statusFromPostProduction(pp),
        });
      }

      out.sort((a, b) => {
        const ta = a.completedAt ? new Date(a.completedAt).getTime() : 0;
        const tb = b.completedAt ? new Date(b.completedAt).getTime() : 0;
        return tb - ta;
      });

      setRows(out);
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

    return rows.filter((r) => {
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
            Completed interviews only · read-only · dates shown in IST (
            {TIMEZONE_IST})
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
            <button
              type="button"
              className="rounded-xl border border-[#e5e5e5] bg-white px-4 py-2 text-sm font-medium text-[#1d1d1f] hover:bg-[#fafafa] lg:mb-0.5"
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

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-[#6e6e73]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </p>
        ) : filtered.length === 0 ? (
          <p className="rounded-2xl border border-[#f0f0f0] bg-white py-16 text-center text-sm text-[#6e6e73] shadow-sm">
            {rows.length === 0
              ? "No completed interviews found"
              : "No interviews match your filters."}
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-[#f0f0f0] bg-white shadow-sm">
            <div className="w-full overflow-x-auto">
              <table className="w-full min-w-[1100px] table-fixed border-collapse text-sm">
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
                    <th className={`${th} w-[100px]`}>Status</th>
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
                        <td className={`${td} font-medium`}>{r.name}</td>
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
                          {r.youtubeLink ? (
                            <a
                              href={r.youtubeLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 font-medium text-[#3b82f6] hover:underline"
                            >
                              Open
                              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                            </a>
                          ) : (
                            <span className="text-[#aeaeb2]">—</span>
                          )}
                        </td>
                        <td className={td}>
                          <span
                            className={
                              r.status === "Uploaded"
                                ? "inline-flex rounded-full bg-[#f0fdf4] px-2 py-0.5 text-xs font-medium text-[#15803d]"
                                : r.status === "Edited"
                                  ? "inline-flex rounded-full bg-[#fef9c3] px-2 py-0.5 text-xs font-medium text-[#854d0e]"
                                  : "inline-flex rounded-full bg-[#f4f4f5] px-2 py-0.5 text-xs font-medium text-[#52525b]"
                            }
                          >
                            {r.status}
                          </span>
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
    </>
  );
}

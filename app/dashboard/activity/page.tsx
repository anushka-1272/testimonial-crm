"use client";

import {
  endOfDay,
  format,
  formatDistanceToNow,
  parseISO,
  startOfDay,
} from "date-fns";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { ActivityCategory } from "@/lib/activity-logger";
import { createBrowserSupabaseClient } from "@/lib/supabase-browser";

const PAGE_SIZE = 50;

const CATEGORIES: { value: ActivityCategory | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "eligibility", label: "Eligibility" },
  { value: "interviews", label: "Interviews" },
  { value: "dispatch", label: "Dispatch" },
  { value: "post_production", label: "Post production" },
  { value: "settings", label: "Settings" },
];

type ActivityLogRow = {
  id: string;
  created_at: string;
  user_id: string | null;
  user_name: string | null;
  action_type: string;
  entity_type: string;
  entity_id: string | null;
  candidate_name: string | null;
  description: string;
  metadata: Record<string, unknown>;
};

const cardChrome =
  "rounded-2xl bg-white shadow-[0_4px_16px_rgba(0,0,0,0.08)] border border-[#f0f0f0]";

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function avatarHue(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 65% 42%)`;
}

function categoryBadgeClass(cat: string): string {
  switch (cat) {
    case "eligibility":
      return "bg-[#f3e8ff] text-[#6b21a8]";
    case "interviews":
      return "bg-[#eff6ff] text-[#1d4ed8]";
    case "dispatch":
      return "bg-[#fff7ed] text-[#c2410c]";
    case "post_production":
      return "bg-[#ecfeff] text-[#0e7490]";
    case "settings":
      return "bg-[#f4f4f5] text-[#52525b]";
    default:
      return "bg-[#f4f4f5] text-[#52525b]";
  }
}

function categoryLabel(cat: string): string {
  if (!cat) return "—";
  if (cat === "post_production") return "Post production";
  return cat.charAt(0).toUpperCase() + cat.slice(1);
}

export default function ActivityPage() {
  const supabase = useMemo(() => {
    try {
      return createBrowserSupabaseClient();
    } catch {
      return null;
    }
  }, []);

  const [rows, setRows] = useState<ActivityLogRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [candidateSearch, setCandidateSearch] = useState("");
  const [userFilter, setUserFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] =
    useState<ActivityCategory | "all">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [teamUsers, setTeamUsers] = useState<string[]>([]);

  const loadTeamUsers = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase
      .from("activity_log")
      .select("user_name")
      .order("created_at", { ascending: false })
      .limit(3000);
    const seen = new Set<string>();
    const list: string[] = [];
    for (const r of data ?? []) {
      const n = r.user_name?.trim();
      if (n && !seen.has(n)) {
        seen.add(n);
        list.push(n);
      }
    }
    list.sort((a, b) => a.localeCompare(b));
    setTeamUsers(list);
  }, [supabase]);

  const loadLogs = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);

    let q = supabase
      .from("activity_log")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false });

    const search = candidateSearch.trim();
    if (search) {
      q = q.ilike("candidate_name", `%${search}%`);
    }
    if (userFilter !== "all") {
      q = q.eq("user_name", userFilter);
    }
    if (categoryFilter !== "all") {
      q = q.eq("action_type", categoryFilter);
    }
    if (dateFrom) {
      try {
        q = q.gte("created_at", startOfDay(parseISO(dateFrom)).toISOString());
      } catch {
        /* ignore invalid */
      }
    }
    if (dateTo) {
      try {
        q = q.lte("created_at", endOfDay(parseISO(dateTo)).toISOString());
      } catch {
        /* ignore invalid */
      }
    }

    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, count, error: qErr } = await q.range(from, to);

    if (qErr) {
      setError(qErr.message);
      setRows([]);
      setTotalCount(0);
    } else {
      setRows((data ?? []) as ActivityLogRow[]);
      setTotalCount(count ?? 0);
    }
    setLoading(false);
  }, [
    supabase,
    page,
    candidateSearch,
    userFilter,
    categoryFilter,
    dateFrom,
    dateTo,
  ]);

  useEffect(() => {
    void loadTeamUsers();
  }, [loadTeamUsers]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    if (!supabase) return;
    const ch = supabase
      .channel("activity-log-page")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "activity_log" },
        () => {
          void loadLogs();
          void loadTeamUsers();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [supabase, loadLogs, loadTeamUsers]);

  useEffect(() => {
    setPage(0);
  }, [candidateSearch, userFilter, categoryFilter, dateFrom, dateTo]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const clearFilters = () => {
    setCandidateSearch("");
    setUserFilter("all");
    setCategoryFilter("all");
    setDateFrom("");
    setDateTo("");
    setPage(0);
  };

  if (!supabase) {
    return (
      <div className="mx-auto max-w-lg px-8 py-16 text-center text-sm text-[#6e6e73]">
        Cannot connect to Supabase.
      </div>
    );
  }

  return (
    <>
      <header className="sticky top-14 z-30 bg-[#f5f5f7]/90 px-4 py-4 backdrop-blur-md sm:px-6 sm:py-5 lg:top-0 lg:px-8 lg:py-6">
        <h1 className="text-xl font-semibold tracking-tight text-[#1d1d1f] sm:text-2xl">
          Activity log
        </h1>
        <p className="mt-1 text-sm text-[#6e6e73]">
          Track all changes made by your team
        </p>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 pb-10 pt-2 text-sm text-[#1d1d1f] sm:px-6 lg:px-8 lg:pb-12">
        {error ? (
          <div className={`mb-4 px-4 py-3 ${cardChrome}`}>
            <p className="text-[#dc2626]">{error}</p>
          </div>
        ) : null}

        <div
          className={`mb-6 flex flex-col gap-4 p-4 sm:flex-row sm:flex-wrap sm:items-end ${cardChrome}`}
        >
          <label className="block min-w-[160px] flex-1">
            <span className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
              Search candidate
            </span>
            <input
              type="search"
              value={candidateSearch}
              onChange={(e) => setCandidateSearch(e.target.value)}
              placeholder="Name…"
              className="mt-1 w-full rounded-xl border border-[#e5e5e5] px-3 py-2 text-sm focus:border-[#3b82f6] focus:outline-none"
            />
          </label>
          <label className="block min-w-[160px] flex-1">
            <span className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
              User
            </span>
            <select
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
              className="mt-1 w-full rounded-xl border border-[#e5e5e5] px-3 py-2 text-sm focus:border-[#3b82f6] focus:outline-none"
            >
              <option value="all">All</option>
              {teamUsers.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-[160px] flex-1">
            <span className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
              Action type
            </span>
            <select
              value={categoryFilter}
              onChange={(e) =>
                setCategoryFilter(e.target.value as ActivityCategory | "all")
              }
              className="mt-1 w-full rounded-xl border border-[#e5e5e5] px-3 py-2 text-sm focus:border-[#3b82f6] focus:outline-none"
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-[140px]">
            <span className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
              From
            </span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="mt-1 w-full rounded-xl border border-[#e5e5e5] px-3 py-2 text-sm focus:border-[#3b82f6] focus:outline-none"
            />
          </label>
          <label className="block min-w-[140px]">
            <span className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
              To
            </span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="mt-1 w-full rounded-xl border border-[#e5e5e5] px-3 py-2 text-sm focus:border-[#3b82f6] focus:outline-none"
            />
          </label>
          <button
            type="button"
            onClick={clearFilters}
            className="rounded-xl border border-[#e5e5e5] bg-white px-4 py-2 text-sm font-medium text-[#1d1d1f] hover:bg-[#f5f5f7]"
          >
            Clear filters
          </button>
        </div>

        <div className={`overflow-hidden ${cardChrome}`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] table-auto border-collapse text-left">
              <thead>
                <tr className="border-b border-[#f0f0f0] bg-[#fafafa]">
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                    Time
                  </th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                    User
                  </th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                    Action
                  </th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                    Candidate
                  </th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-12 text-center text-[#6e6e73]"
                    >
                      Loading…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-12 text-center text-[#6e6e73]"
                    >
                      No activity yet
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => {
                    const uname = r.user_name?.trim() || "Unknown";
                    const created = parseISO(r.created_at);
                    return (
                      <tr
                        key={r.id}
                        className="border-b border-[#f5f5f5] last:border-0"
                      >
                        <td className="whitespace-nowrap px-4 py-3 align-top text-[#1d1d1f]">
                          <span
                            title={format(created, "PPpp")}
                            className="cursor-default border-b border-dotted border-[#aeaeb2]"
                          >
                            {formatDistanceToNow(created, { addSuffix: true })}
                          </span>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="flex items-center gap-2">
                            <div
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium text-white"
                              style={{ backgroundColor: avatarHue(uname) }}
                            >
                              {initialsFromName(uname)}
                            </div>
                            <span className="font-medium text-[#1d1d1f]">
                              {uname}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium capitalize ${categoryBadgeClass(r.action_type)}`}
                          >
                            {categoryLabel(r.action_type)}
                          </span>
                        </td>
                        <td className="max-w-[180px] px-4 py-3 align-top text-[#1d1d1f]">
                          {r.candidate_name?.trim() ? (
                            <span className="line-clamp-2">
                              {r.candidate_name}
                            </span>
                          ) : (
                            <span className="text-[#6e6e73]">—</span>
                          )}
                        </td>
                        <td className="max-w-[480px] px-4 py-3 align-top text-[#1d1d1f]">
                          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                            {r.description}
                          </p>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {!loading && totalCount > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#f0f0f0] bg-[#fafafa] px-4 py-3 text-xs text-[#6e6e73]">
              <span>
                Showing {page * PAGE_SIZE + 1}–
                {Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 0}
                  className="rounded-lg border border-[#e5e5e5] bg-white px-3 py-1.5 font-medium text-[#1d1d1f] hover:bg-[#f5f5f7] disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages - 1}
                  className="rounded-lg border border-[#e5e5e5] bg-white px-3 py-1.5 font-medium text-[#1d1d1f] hover:bg-[#f5f5f7] disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() =>
                    setPage((p) => Math.min(totalPages - 1, p + 1))
                  }
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </main>
    </>
  );
}

"use client";

import { endOfDay, format, parse, parseISO, startOfDay } from "date-fns";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CandidateDetailModal } from "@/components/candidate-detail-modal";
import {
  PhysicalInterviewPipelineBadge,
  PhysicalInterviewSourceBadge,
} from "@/components/physical-interview-badges";
import { ProjectCandidateDetailModal } from "@/components/project-candidate-detail-modal";
import { useAccessControl } from "@/components/access-control-context";
import type { ProjectCandidateRow } from "@/app/dashboard/interviews/types";
import { logActivity } from "@/lib/activity-logger";
import {
  PHYSICAL_INTERVIEW_CITY_OPTIONS,
  type PhysicalInterviewCity,
  type PhysicalInterviewStatus,
} from "@/lib/physical-interview-track";
import { getUserSafe } from "@/lib/supabase-auth";
import { createBrowserSupabaseClient } from "@/lib/supabase-browser";
import { tableWrap, thBase, tdBase } from "@/lib/ui-theme-classes";

const PAGE_SIZE = 25;

export type PhysicalInterviewEntry = {
  source: "testimonial" | "project";
  id: string;
  name: string;
  email: string;
  projectTitle: string | null;
  city: string | null;
  status: PhysicalInterviewStatus;
  addedAt: string | null;
  sheetUpdated: boolean;
  projectCandidate?: ProjectCandidateRow;
};

type Filters = {
  search: string;
  city: "" | PhysicalInterviewCity;
  addedFrom: string;
  addedTo: string;
  page: number;
};

const defaultFilters: Filters = {
  search: "",
  city: "",
  addedFrom: "",
  addedTo: "",
  page: 0,
};

function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "MMM d, yyyy h:mm a");
  } catch {
    return "—";
  }
}

function matchesSearch(row: PhysicalInterviewEntry, q: string) {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return (
    row.name.toLowerCase().includes(s) ||
    row.email.toLowerCase().includes(s) ||
    (row.projectTitle?.toLowerCase().includes(s) ?? false)
  );
}

export function PhysicalInterviewsDashboard() {
  const { canEditCurrentPage, showViewOnlyBadge } = useAccessControl();
  const [rows, setRows] = useState<PhysicalInterviewEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [detailTestimonialId, setDetailTestimonialId] = useState<string | null>(
    null,
  );
  const [detailProjectCandidate, setDetailProjectCandidate] =
    useState<ProjectCandidateRow | null>(null);

  const supabase = useMemo(() => {
    try {
      return createBrowserSupabaseClient();
    } catch {
      return null;
    }
  }, []);

  const loadRows = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const [tRes, pRes] = await Promise.all([
      supabase
        .from("candidates")
        .select(
          "id, full_name, email, physical_interview_city, physical_interview_status, physical_interview_added_at, physical_interview_sheet_updated",
        )
        .eq("is_deleted", false)
        .eq("physical_interview_track", true)
        .order("physical_interview_added_at", {
          ascending: false,
          nullsFirst: false,
        }),
      supabase
        .from("project_candidates")
        .select(
          "id, full_name, email, whatsapp_number, project_title, problem_statement, target_user, ai_usage, demo_link, status, physical_interview_city, physical_interview_status, physical_interview_added_at, physical_interview_sheet_updated",
        )
        .eq("is_deleted", false)
        .eq("physical_interview_track", true)
        .order("physical_interview_added_at", {
          ascending: false,
          nullsFirst: false,
        }),
    ]);

    if (tRes.error || pRes.error) {
      setError(tRes.error?.message ?? pRes.error?.message ?? "Failed to load");
      setRows([]);
      setLoading(false);
      return;
    }

    const combined: PhysicalInterviewEntry[] = [
      ...(tRes.data ?? []).map((r) => ({
        source: "testimonial" as const,
        id: r.id as string,
        name: (r.full_name as string | null)?.trim() || (r.email as string),
        email: r.email as string,
        projectTitle: null,
        city: (r.physical_interview_city as string | null) ?? null,
        status: (r.physical_interview_status as PhysicalInterviewStatus) ?? "pending",
        addedAt: (r.physical_interview_added_at as string | null) ?? null,
        sheetUpdated: Boolean(r.physical_interview_sheet_updated),
      })),
      ...(pRes.data ?? []).map((r) => ({
        source: "project" as const,
        id: r.id as string,
        name:
          (r.full_name as string | null)?.trim() ||
          (r.project_title as string | null)?.trim() ||
          (r.email as string),
        email: r.email as string,
        projectTitle: (r.project_title as string | null) ?? null,
        city: (r.physical_interview_city as string | null) ?? null,
        status: (r.physical_interview_status as PhysicalInterviewStatus) ?? "pending",
        addedAt: (r.physical_interview_added_at as string | null) ?? null,
        sheetUpdated: Boolean(r.physical_interview_sheet_updated),
        projectCandidate: r as ProjectCandidateRow,
      })),
    ].sort((a, b) => {
      const ta = a.addedAt ? Date.parse(a.addedAt) : 0;
      const tb = b.addedAt ? Date.parse(b.addedAt) : 0;
      return tb - ta;
    });

    setRows(combined);
    setError(null);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (!supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }
    void loadRows();
  }, [supabase, loadRows]);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (!matchesSearch(row, filters.search)) return false;
      if (filters.city && row.city !== filters.city) return false;
      if (filters.addedFrom) {
        const from = startOfDay(
          parse(filters.addedFrom, "yyyy-MM-dd", new Date()),
        );
        if (!row.addedAt || parseISO(row.addedAt) < from) return false;
      }
      if (filters.addedTo) {
        const to = endOfDay(parse(filters.addedTo, "yyyy-MM-dd", new Date()));
        if (!row.addedAt || parseISO(row.addedAt) > to) return false;
      }
      return true;
    });
  }, [rows, filters.search, filters.city, filters.addedFrom, filters.addedTo]);

  const pageData = useMemo(() => {
    const start = filters.page * PAGE_SIZE;
    return {
      slice: filtered.slice(start, start + PAGE_SIZE),
      total: filtered.length,
      totalPages: Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)),
    };
  }, [filtered, filters.page]);

  useEffect(() => {
    setFilters((f) => ({ ...f, page: 0 }));
  }, [filters.search, filters.city, filters.addedFrom, filters.addedTo]);

  const rowKey = (row: PhysicalInterviewEntry) => `${row.source}-${row.id}`;

  const updateSheetFlag = async (row: PhysicalInterviewEntry, checked: boolean) => {
    if (!supabase || !canEditCurrentPage) return;
    setBusyId(rowKey(row));
    const table = row.source === "testimonial" ? "candidates" : "project_candidates";
    const { error: upErr } = await supabase
      .from(table)
      .update({ physical_interview_sheet_updated: checked })
      .eq("id", row.id)
      .eq("is_deleted", false);
    setBusyId(null);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    setRows((prev) =>
      prev.map((r) =>
        r.source === row.source && r.id === row.id
          ? { ...r, sheetUpdated: checked }
          : r,
      ),
    );
  };

  const markCompleted = async (row: PhysicalInterviewEntry) => {
    if (!supabase || !canEditCurrentPage) return;
    setBusyId(rowKey(row));
    const table = row.source === "testimonial" ? "candidates" : "project_candidates";
    const { error: upErr } = await supabase
      .from(table)
      .update({ physical_interview_status: "completed" })
      .eq("id", row.id)
      .eq("is_deleted", false);
    setBusyId(null);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    const authUser = await getUserSafe(supabase);
    if (authUser) {
      await logActivity({
        supabase,
        user: authUser,
        action_type: "interviews",
        entity_type: row.source === "testimonial" ? "candidate" : "project_candidate",
        entity_id: row.id,
        candidate_name: row.name,
        description: `Physical interview track: marked ${row.name} as completed`,
      });
    }
    void loadRows();
  };

  const revokeTrack = async (row: PhysicalInterviewEntry) => {
    if (!supabase || !canEditCurrentPage) return;
    const confirmed = window.confirm(
      "Revoke physical interview track for this candidate?\n\nThey will move back to the meeting interview scheduling queue.",
    );
    if (!confirmed) return;
    setBusyId(rowKey(row));
    const table = row.source === "testimonial" ? "candidates" : "project_candidates";
    const { error: upErr } = await supabase
      .from(table)
      .update({
        physical_interview_track: false,
        physical_interview_status: "pending",
        physical_interview_city: null,
        physical_interview_added_at: null,
        physical_interview_sheet_updated: false,
      })
      .eq("id", row.id)
      .eq("is_deleted", false);
    setBusyId(null);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    const authUser = await getUserSafe(supabase);
    if (authUser) {
      await logActivity({
        supabase,
        user: authUser,
        action_type: "interviews",
        entity_type: row.source === "testimonial" ? "candidate" : "project_candidate",
        entity_id: row.id,
        candidate_name: row.name,
        description: `Physical interview track: revoked ${row.name} back to interview queue`,
      });
    }
    void loadRows();
  };

  const tdName = `${tdBase} min-w-[160px] text-left`;
  const tdEmail = `${tdBase} min-w-[200px] text-left text-muted`;
  const tdSource = `${tdBase} min-w-[120px] text-left`;
  const tdProject = `${tdBase} min-w-[160px] text-left text-muted`;
  const tdCity = `${tdBase} min-w-[100px] text-left text-muted`;
  const tdAdded = `${tdBase} min-w-[170px] text-left text-muted`;
  const tdStatus = `${tdBase} min-w-[140px] text-left`;
  const tdSheet = `${tdBase} min-w-[120px] text-center`;
  const tdActions = `${tdBase} min-w-[200px] text-right`;
  const filterInp =
    "w-full rounded-xl border border-border bg-elevated px-3 py-2 text-sm text-foreground focus:border-[#3b82f6] focus:outline-none focus:ring-0";

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-4 sm:p-6 lg:p-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          Physical Interviews
        </h1>
        <p className="mt-1 text-sm text-muted">
          In-person interview track. Update the Google Sheet, then mark
          completion here. Reward dispatch is handled via the sheet, not this
          page.
        </p>
        {showViewOnlyBadge ? (
          <p className="mt-2 inline-flex rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900">
            View only
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground">
          {error}
        </p>
      ) : null}

      <div className="rounded-2xl border border-border bg-elevated p-4 shadow-card">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-xs uppercase tracking-widest text-muted/80">
              Name / email
            </span>
            <input
              className={filterInp}
              value={filters.search}
              onChange={(e) =>
                setFilters((f) => ({ ...f, search: e.target.value }))
              }
              placeholder="Search…"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-widest text-muted/80">
              City
            </span>
            <select
              className={filterInp}
              value={filters.city}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  city: e.target.value as Filters["city"],
                }))
              }
            >
              <option value="">All cities</option>
              {PHYSICAL_INTERVIEW_CITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-widest text-muted/80">
              Added from
            </span>
            <input
              type="date"
              className={filterInp}
              value={filters.addedFrom}
              onChange={(e) =>
                setFilters((f) => ({ ...f, addedFrom: e.target.value }))
              }
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-widest text-muted/80">
              Added to
            </span>
            <input
              type="date"
              className={filterInp}
              value={filters.addedTo}
              onChange={(e) =>
                setFilters((f) => ({ ...f, addedTo: e.target.value }))
              }
            />
          </label>
        </div>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            className="text-sm font-medium text-[#3b82f6] hover:text-[#2563eb]"
            onClick={() => setFilters(defaultFilters)}
          >
            Clear filters
          </button>
        </div>
      </div>

      <div className={tableWrap}>
        <div className="w-full min-w-0 max-w-full overflow-x-auto">
          <table className="w-full min-w-[1100px] table-auto border-collapse">
            <thead>
              <tr>
                <th className={`${thBase} min-w-[160px] text-left`}>Name</th>
                <th className={`${thBase} min-w-[200px] text-left`}>Email</th>
                <th className={`${thBase} min-w-[120px] text-left`}>Source</th>
                <th className={`${thBase} min-w-[160px] text-left`}>Project</th>
                <th className={`${thBase} min-w-[100px] text-left`}>City</th>
                <th className={`${thBase} min-w-[170px] text-left`}>
                  Added to track
                </th>
                <th className={`${thBase} min-w-[140px] text-left`}>Status</th>
                <th className={`${thBase} min-w-[120px] text-center`}>
                  Update in sheet
                </th>
                <th className={`${thBase} min-w-[200px] text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className={tdBase} colSpan={9}>
                    Loading…
                  </td>
                </tr>
              ) : pageData.slice.length === 0 ? (
                <tr>
                  <td className={tdBase} colSpan={9}>
                    No physical interview entries
                  </td>
                </tr>
              ) : (
                pageData.slice.map((row) => {
                  const busy = busyId === rowKey(row);
                  return (
                    <tr key={rowKey(row)}>
                      <td className={tdName}>
                        <button
                          type="button"
                          className="text-left font-medium text-[#3b82f6] hover:underline"
                          onClick={() =>
                            row.source === "testimonial"
                              ? setDetailTestimonialId(row.id)
                              : setDetailProjectCandidate(
                                  row.projectCandidate ?? null,
                                )
                          }
                        >
                          {row.name}
                        </button>
                      </td>
                      <td className={tdEmail}>{row.email}</td>
                      <td className={tdSource}>
                        <PhysicalInterviewSourceBadge source={row.source} />
                      </td>
                      <td className={tdProject}>
                        {row.projectTitle?.trim() || "—"}
                      </td>
                      <td className={tdCity}>{row.city?.trim() || "—"}</td>
                      <td className={tdAdded}>{formatDateTime(row.addedAt)}</td>
                      <td className={tdStatus}>
                        <PhysicalInterviewPipelineBadge status={row.status} />
                      </td>
                      <td className={tdSheet}>
                        <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={row.sheetUpdated}
                            disabled={busy || !canEditCurrentPage}
                            className="rounded border-border text-[#7c3aed] focus:ring-[#7c3aed]"
                            onChange={(e) =>
                              void updateSheetFlag(row, e.target.checked)
                            }
                          />
                          <span className="sr-only">Update in sheet</span>
                        </label>
                      </td>
                      <td className={tdActions}>
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {row.status === "pending" ? (
                            <button
                              type="button"
                              disabled={busy || !canEditCurrentPage}
                              className="rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-background disabled:opacity-50"
                              onClick={() => void markCompleted(row)}
                            >
                              Mark as completed
                            </button>
                          ) : null}
                          <button
                            type="button"
                            disabled={busy || !canEditCurrentPage}
                            className="rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-xs font-medium text-muted hover:bg-background disabled:opacity-50"
                            onClick={() => void revokeTrack(row)}
                          >
                            Revoke
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {pageData.total > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle bg-background/60 px-4 py-3 text-xs text-muted">
            <span>
              Showing {filters.page * PAGE_SIZE + 1}–
              {Math.min((filters.page + 1) * PAGE_SIZE, pageData.total)} of{" "}
              {pageData.total}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={filters.page <= 0}
                className="rounded-lg border border-border bg-elevated px-3 py-1.5 font-medium text-foreground hover:bg-background disabled:opacity-40"
                onClick={() =>
                  setFilters((f) => ({ ...f, page: Math.max(0, f.page - 1) }))
                }
              >
                Previous
              </button>
              <button
                type="button"
                disabled={filters.page >= pageData.totalPages - 1}
                className="rounded-lg border border-border bg-elevated px-3 py-1.5 font-medium text-foreground hover:bg-background disabled:opacity-40"
                onClick={() =>
                  setFilters((f) => ({
                    ...f,
                    page: Math.min(pageData.totalPages - 1, f.page + 1),
                  }))
                }
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <CandidateDetailModal
        open={!!detailTestimonialId}
        candidateId={detailTestimonialId}
        supabase={supabase}
        onClose={() => setDetailTestimonialId(null)}
      />
      <ProjectCandidateDetailModal
        open={!!detailProjectCandidate}
        candidate={detailProjectCandidate}
        onClose={() => setDetailProjectCandidate(null)}
      />
    </div>
  );
}

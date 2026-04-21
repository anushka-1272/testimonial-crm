"use client";

import { format, parseISO } from "date-fns";
import { Loader2, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ProjectCandidateDetailModal } from "@/components/project-candidate-detail-modal";
import { logActivity } from "@/lib/activity-logger";
import { displayNameFromUser, getUserSafe } from "@/lib/supabase-auth";
import {
  fetchTeamRosterNames,
  mergeRosterWithCurrent,
} from "@/lib/team-roster";

import { AddZoomDetailsModal } from "./add-zoom-details-modal";
import { AssignInterviewerModal } from "./assign-interviewer-modal";
import type { ScheduleProjectCandidate } from "./schedule-interview-modal";
import type {
  ProjectCandidateRow,
  ProjectInterviewWithProjectCandidate,
} from "./types";

const PAGE_SIZE = 20;

/** Interview rows only — join `project_candidates` client-side so a failed embed never blocks loading candidates. */
const PROJECT_INTERVIEW_COLUMNS = `id, created_at, project_candidate_id, scheduled_date, previous_scheduled_date, reschedule_reason, completed_at, interviewer, interviewer_assigned_at, zoom_link, zoom_account, language, invitation_sent, poc, remarks, reminder_count, interview_status, post_interview_eligible, reward_item, category, funnel, comments, interview_type`;

type ProjectSubTab = "pending" | "scheduled" | "rescheduled" | "completed";

type TabFilters = { search: string; page: number };

function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "MMM d, yyyy h:mm a");
  } catch {
    return "—";
  }
}

function projectDisplayName(pc: ProjectCandidateRow): string {
  const fn = pc.full_name?.trim();
  if (fn) return fn;
  const e = pc.email?.trim();
  if (!e) return "—";
  const local = e.split("@")[0] ?? "";
  if (!local) return "—";
  return local.charAt(0).toUpperCase() + local.slice(1);
}

function matchesPendingSearch(pc: ProjectCandidateRow, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return (
    projectDisplayName(pc).toLowerCase().includes(s) ||
    (pc.full_name ?? "").toLowerCase().includes(s) ||
    (pc.email ?? "").toLowerCase().includes(s) ||
    (pc.whatsapp_number ?? "").toLowerCase().includes(s) ||
    (pc.project_title ?? "").toLowerCase().includes(s)
  );
}

function matchesInterviewSearch(
  i: ProjectInterviewWithProjectCandidate,
  q: string,
): boolean {
  const pc = i.project_candidates;
  if (!pc) return false;
  return matchesPendingSearch(pc, q);
}

function compareProjectCandidateCreatedAsc(
  a: ProjectCandidateRow,
  b: ProjectCandidateRow,
): number {
  const sa = a.created_at ?? "";
  const sb = b.created_at ?? "";
  const c = sa.localeCompare(sb);
  return c !== 0 ? c : a.id.localeCompare(b.id);
}

function compareProjectInterviewScheduledAsc(
  a: ProjectInterviewWithProjectCandidate,
  b: ProjectInterviewWithProjectCandidate,
): number {
  const sa = a.scheduled_date ?? "";
  const sb = b.scheduled_date ?? "";
  if (!sa && !sb) return a.id.localeCompare(b.id);
  if (!sa) return 1;
  if (!sb) return -1;
  const c = sa.localeCompare(sb);
  return c !== 0 ? c : a.id.localeCompare(b.id);
}

function compareProjectInterviewCompletedDesc(
  a: ProjectInterviewWithProjectCandidate,
  b: ProjectInterviewWithProjectCandidate,
): number {
  const sa = a.completed_at ?? "";
  const sb = b.completed_at ?? "";
  if (!sa && !sb) return a.id.localeCompare(b.id);
  if (!sa) return 1;
  if (!sb) return -1;
  const c = sb.localeCompare(sa);
  return c !== 0 ? c : a.id.localeCompare(b.id);
}

function pocOptionsFor(pc: ProjectCandidateRow, pocRoster: string[]): string[] {
  return mergeRosterWithCurrent(pocRoster, pc.poc_assigned);
}

function normalizeProjectInterviewRow(
  row: Record<string, unknown>,
): ProjectInterviewWithProjectCandidate {
  const r = row as Record<string, unknown> & {
    project_candidates: ProjectCandidateRow | ProjectCandidateRow[] | null;
  };
  const c = r.project_candidates;
  const pc = c == null ? null : Array.isArray(c) ? (c[0] ?? null) : c;
  return {
    ...(r as object),
    previous_scheduled_date:
      (r.previous_scheduled_date as string | null) ?? null,
    reschedule_reason: (r.reschedule_reason as string | null) ?? null,
    completed_at: (r.completed_at as string | null) ?? null,
    interviewer_assigned_at:
      (r.interviewer_assigned_at as string | null) ?? null,
    zoom_account: (r.zoom_account as string | null) ?? null,
    reward_item: (r.reward_item as string | null) ?? null,
    category: (r.category as string | null) ?? null,
    funnel: (r.funnel as string | null) ?? null,
    comments: (r.comments as string | null) ?? null,
    project_candidates: pc,
  } as ProjectInterviewWithProjectCandidate;
}

const REWARD_NO_DISPATCH = "No Dispatch";

function postInterviewEligibleBadge(
  v: boolean | null,
  rewardItem: string | null | undefined,
) {
  if (v === true && rewardItem?.trim() === REWARD_NO_DISPATCH) {
    return (
      <span className="inline-flex rounded-full bg-[#fef9c3] px-3 py-1 text-xs font-medium text-[#854d0e]">
        No Dispatch
      </span>
    );
  }
  if (v === true) {
    return (
      <span className="inline-flex rounded-full bg-[#f0fdf4] px-3 py-1 text-xs font-medium text-[#16a34a]">
        Eligible
      </span>
    );
  }
  if (v === false) {
    return (
      <span className="inline-flex rounded-full bg-[#fef2f2] px-3 py-1 text-xs font-medium text-[#dc2626]">
        Not Eligible
      </span>
    );
  }
  return <span className="text-[#6e6e73]">—</span>;
}

function truncateWithTooltip(text: string | null | undefined, maxLen: number) {
  const t = text?.trim() ?? "";
  if (!t) return { display: "—" as string, title: undefined as string | undefined };
  if (t.length <= maxLen) return { display: t, title: undefined };
  return { display: `${t.slice(0, maxLen)}…`, title: t };
}

type Props = {
  supabase: SupabaseClient;
  isAdmin: boolean;
  onError: (msg: string | null) => void;
  onPipelineChanged: () => void;
  onToast?: (message: string) => void;
  onScheduleProject: (c: ScheduleProjectCandidate) => void;
  onPostProjectInterview: (i: ProjectInterviewWithProjectCandidate) => void;
  onRescheduleProjectInterview: (
    i: ProjectInterviewWithProjectCandidate,
    mode: "from_scheduled" | "from_rescheduled",
  ) => void;
};

const defaultFilters = (): Record<ProjectSubTab, TabFilters> => ({
  pending: { search: "", page: 0 },
  scheduled: { search: "", page: 0 },
  rescheduled: { search: "", page: 0 },
  completed: { search: "", page: 0 },
});

function hasAssignedProjectInterviewer(
  i: ProjectInterviewWithProjectCandidate,
): boolean {
  return Boolean(i.interviewer?.trim());
}

export function ProjectInterviewsPanel({
  supabase,
  isAdmin,
  onError,
  onPipelineChanged,
  onToast,
  onScheduleProject,
  onPostProjectInterview,
  onRescheduleProjectInterview,
}: Props) {
  const [candidates, setCandidates] = useState<ProjectCandidateRow[]>([]);
  const [interviews, setInterviews] = useState<
    ProjectInterviewWithProjectCandidate[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [subTab, setSubTab] = useState<ProjectSubTab>("pending");
  const [filters, setFilters] = useState(defaultFilters);
  const [pocSavingId, setPocSavingId] = useState<string | null>(null);
  const [pocEditingId, setPocEditingId] = useState<string | null>(null);
  const [pocRoster, setPocRoster] = useState<string[]>([]);
  const [detail, setDetail] = useState<ProjectCandidateRow | null>(null);
  const [completedPopoverId, setCompletedPopoverId] = useState<string | null>(
    null,
  );
  const [sheetSyncBusy, setSheetSyncBusy] = useState(false);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [addZoomFor, setAddZoomFor] =
    useState<ProjectInterviewWithProjectCandidate | null>(null);
  const [assignInterviewerFor, setAssignInterviewerFor] =
    useState<ProjectInterviewWithProjectCandidate | null>(null);

  const loadProjectData = useCallback(async () => {
    const { data: pc, error: eCandidates } = await supabase
      .from("project_candidates")
      .select(
        "id, created_at, email, full_name, whatsapp_number, project_title, problem_statement, target_user, ai_usage, demo_link, status, poc_assigned, poc_assigned_at, interview_type",
      )
      .eq("is_deleted", false)
      .order("created_at", { ascending: true });

    let candidateList: ProjectCandidateRow[] = [];
    if (eCandidates) {
      console.log(
        "[ProjectInterviewsPanel] project_candidates load error:",
        eCandidates,
      );
      setCandidates([]);
    } else {
      candidateList = (pc ?? []) as ProjectCandidateRow[];
      console.log(
        `[ProjectInterviewsPanel] Loaded ${candidateList.length} project_candidates from DB`,
      );
      setCandidates(candidateList);
    }

    const candidateById = new Map(
      candidateList.map((c) => [c.id, c] as const),
    );

    const { data: pi, error: eInterviews } = await supabase
      .from("project_interviews")
      .select(PROJECT_INTERVIEW_COLUMNS)
      .order("created_at", { ascending: true });

    if (eInterviews) {
      console.log(
        "[ProjectInterviewsPanel] project_interviews load error:",
        eInterviews,
      );
      setInterviews([]);
    } else {
      const rows = (pi ?? []) as Record<string, unknown>[];
      console.log(
        `[ProjectInterviewsPanel] Loaded ${rows.length} project_interviews from DB (merged with candidates client-side)`,
      );
      const merged = rows
        .map((row) => {
          const pid = row.project_candidate_id as string;
          return normalizeProjectInterviewRow({
            ...row,
            project_candidates: candidateById.get(pid) ?? null,
          });
        })
        .filter((i) => i.project_candidates != null);
      setInterviews(merged);
    }

    if (eCandidates && eInterviews) {
      onError(
        `${eCandidates.message} · ${eInterviews.message}`,
      );
    } else if (eCandidates) {
      onError(eCandidates.message);
    } else if (eInterviews) {
      onError(
        `Could not load project interviews: ${eInterviews.message}. Pending list still uses candidates.`,
      );
    } else {
      onError(null);
    }
  }, [supabase, onError]);

  const loadPocRoster = useCallback(async () => {
    const names = await fetchTeamRosterNames(supabase, "poc", true);
    setPocRoster(names);
  }, [supabase]);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      await loadProjectData();
      setLoading(false);
    })();
  }, [loadProjectData]);

  useEffect(() => {
    void loadPocRoster();
  }, [loadPocRoster]);

  useEffect(() => {
    const ch = supabase
      .channel("project-interviews-panel")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "project_candidates" },
        () => {
          void loadProjectData();
          onPipelineChanged();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "project_interviews" },
        () => {
          void loadProjectData();
          onPipelineChanged();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [supabase, loadProjectData, onPipelineChanged]);

  useEffect(() => {
    if (subTab !== "completed") setCompletedPopoverId(null);
  }, [subTab]);

  useEffect(() => {
    if (!completedPopoverId) return;
    const onDocClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest("[data-project-completed-popover-root]")) return;
      setCompletedPopoverId(null);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [completedPopoverId]);

  const byStatus = useMemo(() => {
    const m = {
      scheduled: [] as ProjectInterviewWithProjectCandidate[],
      rescheduled: [] as ProjectInterviewWithProjectCandidate[],
      completed: [] as ProjectInterviewWithProjectCandidate[],
    };
    for (const i of interviews) {
      switch (i.interview_status) {
        case "draft":
        case "scheduled":
          m.scheduled.push(i);
          break;
        case "rescheduled":
          m.rescheduled.push(i);
          break;
        case "completed":
          m.completed.push(i);
          break;
        default:
          break;
      }
    }
    return m;
  }, [interviews]);

  /** Any interview row linked to this candidate (draft, scheduled, etc.). */
  const candidateIdsWithInterview = useMemo(
    () => new Set(interviews.map((i) => i.project_candidate_id)),
    [interviews],
  );

  /** Candidates currently in Scheduled or Rescheduled tabs — hide from Pending. */
  const activePipelineCandidateIds = useMemo(
    () =>
      new Set(
        interviews
          .filter(
            (i) =>
              i.interview_status === "scheduled" ||
              i.interview_status === "rescheduled" ||
              i.interview_status === "draft",
          )
          .map((i) => i.project_candidate_id),
      ),
    [interviews],
  );

  const pendingQueue = useMemo(() => {
    const q = filters.pending.search;
    const rows = candidates.filter((c) => {
      if (activePipelineCandidateIds.has(c.id)) return false;
      const statusNorm = (c.status ?? "pending").trim() || "pending";
      const hasInterview = candidateIdsWithInterview.has(c.id);
      const qualifiesPending =
        statusNorm === "pending" || !hasInterview;
      return qualifiesPending && matchesPendingSearch(c, q);
    });
    return [...rows].sort(compareProjectCandidateCreatedAsc);
  }, [
    candidates,
    candidateIdsWithInterview,
    activePipelineCandidateIds,
    filters.pending.search,
  ]);

  const scheduledFiltered = useMemo(
    () =>
      [...byStatus.scheduled.filter((i) =>
        matchesInterviewSearch(i, filters.scheduled.search),
      )].sort(compareProjectInterviewScheduledAsc),
    [byStatus.scheduled, filters.scheduled.search],
  );

  const rescheduledFiltered = useMemo(
    () =>
      [...byStatus.rescheduled.filter((i) =>
        matchesInterviewSearch(i, filters.rescheduled.search),
      )].sort(compareProjectInterviewScheduledAsc),
    [byStatus.rescheduled, filters.rescheduled.search],
  );

  const completedFiltered = useMemo(
    () =>
      [...byStatus.completed.filter((i) =>
        matchesInterviewSearch(i, filters.completed.search),
      )].sort(compareProjectInterviewCompletedDesc),
    [byStatus.completed, filters.completed.search],
  );

  const paginate = <T,>(rows: T[], page: number) => {
    const start = page * PAGE_SIZE;
    return {
      slice: rows.slice(start, start + PAGE_SIZE),
      totalPages: Math.max(1, Math.ceil(rows.length / PAGE_SIZE)),
      total: rows.length,
    };
  };

  const pendingPage = useMemo(
    () => paginate(pendingQueue, filters.pending.page),
    [pendingQueue, filters.pending.page],
  );
  const scheduledPage = useMemo(
    () => paginate(scheduledFiltered, filters.scheduled.page),
    [scheduledFiltered, filters.scheduled.page],
  );
  const rescheduledPage = useMemo(
    () => paginate(rescheduledFiltered, filters.rescheduled.page),
    [rescheduledFiltered, filters.rescheduled.page],
  );
  const completedPage = useMemo(
    () => paginate(completedFiltered, filters.completed.page),
    [completedFiltered, filters.completed.page],
  );

  const patchFilter = (tab: ProjectSubTab, patch: Partial<TabFilters>) => {
    setFilters((prev) => ({
      ...prev,
      [tab]: {
        ...prev[tab],
        ...patch,
        ...(patch.search !== undefined ? { page: 0 } : {}),
      },
    }));
  };

  const setPage = (tab: ProjectSubTab, page: number) => {
    setFilters((prev) => ({ ...prev, [tab]: { ...prev[tab], page } }));
  };

  const deleteProjectCandidate = async (pc: ProjectCandidateRow) => {
    if (!isAdmin) return;
    const displayName = projectDisplayName(pc);
    const nameForMsg =
      displayName === "—"
        ? pc.email?.trim() || "this project candidate"
        : displayName;
    const ok = window.confirm(
      `Are you sure you want to delete ${nameForMsg}? They will be removed from active views; restore anytime from Settings → Deleted Entries.`,
    );
    if (!ok) return;
    setDeleteBusyId(pc.id);
    const actor = await getUserSafe(supabase);
    const deletedBy = actor ? displayNameFromUser(actor) : "Unknown";
    const { error: dErr } = await supabase
      .from("project_candidates")
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: deletedBy,
      })
      .eq("id", pc.id)
      .eq("is_deleted", false);
    setDeleteBusyId(null);
    if (dErr) {
      onError(dErr.message);
      return;
    }
    onError(null);
    if (actor) {
      await logActivity({
        supabase,
        user: actor,
        action_type: "interviews",
        entity_type: "project_candidate",
        entity_id: pc.id,
        candidate_name: nameForMsg,
        description: `Deleted project candidate ${nameForMsg}`,
      });
    }
    setDetail((prev) => (prev?.id === pc.id ? null : prev));
    setPocEditingId((prev) => (prev === pc.id ? null : prev));
    await loadProjectData();
    onPipelineChanged();
  };

  const handlePocChange = async (pc: ProjectCandidateRow, value: string) => {
    const name = value.trim() || null;
    setPocSavingId(pc.id);
    const { error: uErr } = await supabase
      .from("project_candidates")
      .update({
        poc_assigned: name,
        poc_assigned_at: name ? new Date().toISOString() : null,
      })
      .eq("id", pc.id)
      .eq("is_deleted", false);
    setPocSavingId(null);
    if (uErr) {
      onError(uErr.message);
      return;
    }
    if (name) {
      const display =
        pc.project_title?.trim() || pc.email || "Project candidate";
      const authPoc = await getUserSafe(supabase);
      if (authPoc) {
        await logActivity({
          supabase,
          user: authPoc,
          action_type: "interviews",
          entity_type: "project_candidate",
          entity_id: pc.id,
          candidate_name: display,
          description: `Assigned ${name} as POC for ${display} (project)`,
        });
      }
    }
    setPocEditingId((prev) => (prev === pc.id ? null : prev));
    await loadProjectData();
    onPipelineChanged();
  };

  const syncProjectSheet = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      onError("You must be signed in to sync.");
      return;
    }
    setSheetSyncBusy(true);
    onError(null);
    try {
      const res = await fetch("/api/sync-project-sheet", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const j = (await res.json()) as {
        error?: string;
        total_rows?: number;
        upserted?: number;
        errors?: string[];
      };
      if (!res.ok) {
        onError(j.error ?? "Project sheet sync failed.");
        return;
      }
      const up = j.upserted ?? 0;
      const total = j.total_rows ?? 0;
      alert(`✅ Synced project sheet — ${up} upserted (${total} rows)`);
      if (j.errors?.length) {
        onError(j.errors.slice(0, 5).join(" · "));
      }
      await loadProjectData();
      onPipelineChanged();
    } catch {
      onError("Project sheet sync request failed.");
    } finally {
      setSheetSyncBusy(false);
    }
  };

  const tableWrap =
    "overflow-hidden rounded-2xl border border-[#f0f0f0] bg-white shadow-sm";
  const thBase =
    "border-b border-gray-100 bg-[#fafafa] py-3 px-4 text-xs font-semibold tracking-wider text-gray-400";
  const tdBase =
    "border-b border-gray-100 py-4 px-4 text-sm align-middle text-[#1d1d1f]";
  const thName = `${thBase} min-w-[160px] text-left`;
  const tdName = `${tdBase} min-w-[160px] text-left`;
  const thPhone = `${thBase} min-w-[130px] text-left`;
  const tdPhone = `${tdBase} min-w-[130px] text-left text-[#6e6e73]`;
  const thProjTitle = `${thBase} min-w-[180px] text-left`;
  const tdProjTitle = `${tdBase} min-w-[180px] text-left text-[#6e6e73]`;
  const thPoc = `${thBase} min-w-[160px] text-left`;
  const tdPoc = `${tdBase} min-w-[160px] text-left`;
  const thActions = `${thBase} min-w-[120px] text-right`;
  const tdActions = `${tdBase} min-w-[120px] text-right`;
  const thDateTime = `${thBase} min-w-[170px] text-left`;
  const tdDateTime = `${tdBase} min-w-[170px] text-left`;
  const thInterviewer = `${thBase} min-w-[120px] text-left`;
  const tdInterviewer = `${tdBase} min-w-[120px] text-left`;
  const thReason = `${thBase} min-w-[180px] text-left`;
  const tdReason = `${tdBase} min-w-[180px] text-left text-[#6e6e73]`;
  const thZoomStatus = `${thBase} min-w-[150px] text-left`;
  const tdZoomStatus = `${tdBase} min-w-[150px] text-left align-top`;
  const thCompletedOn = `${thBase} min-w-[170px] text-left`;
  const tdCompletedOn = `${tdBase} min-w-[170px] text-left`;
  const thPostInterview = `${thBase} min-w-[160px] text-left`;
  const tdPostInterview = `${tdBase} min-w-[160px] text-left`;
  const thFunnelCol = `${thBase} min-w-[120px] text-left`;
  const tdFunnelCol = `${tdBase} min-w-[120px] text-left text-[#6e6e73]`;
  const thCommentsCol = `${thBase} min-w-[160px] text-left`;
  const tdCommentsCol = `${tdBase} min-w-[160px] text-left text-[#6e6e73]`;
  const filterInp =
    "w-full rounded-xl border border-[#e5e5e5] bg-white px-3 py-2 text-sm text-[#1d1d1f] focus:border-[#3b82f6] focus:outline-none focus:ring-0";
  const nameLinkBtn =
    "max-w-full min-w-0 truncate text-left font-medium text-[#3b82f6] hover:underline focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/25 rounded-sm";

  const emptyState = (
    <div className="py-16 text-center text-sm text-[#aeaeb2]">
      No entries here yet
    </div>
  );

  const renderPagination = (
    tab: ProjectSubTab,
    totalPages: number,
    total: number,
  ) => {
    const page = filters[tab].page;
    if (total === 0) return null;
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#f0f0f0] bg-[#fafafa] px-4 py-3 text-xs text-[#6e6e73]">
        <span>
          Showing {page * PAGE_SIZE + 1}–
          {Math.min((page + 1) * PAGE_SIZE, total)} of {total}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 0}
            className="rounded-lg border border-[#e5e5e5] bg-white px-3 py-1.5 font-medium text-[#1d1d1f] transition-colors hover:bg-[#f5f5f7] disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => setPage(tab, page - 1)}
          >
            Previous
          </button>
          <button
            type="button"
            disabled={page >= totalPages - 1}
            className="rounded-lg border border-[#e5e5e5] bg-white px-3 py-1.5 font-medium text-[#1d1d1f] transition-colors hover:bg-[#f5f5f7] disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => setPage(tab, page + 1)}
          >
            Next
          </button>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <p className="text-sm text-[#6e6e73]">Loading project interviews…</p>
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2 border-b border-[#e5e5e5] pb-1 sm:border-0 sm:pb-0">
          {(
            [
              ["pending", "Pending", pendingQueue.length],
              ["scheduled", "Scheduled", scheduledFiltered.length],
              ["rescheduled", "Rescheduled", rescheduledFiltered.length],
              ["completed", "Completed", completedFiltered.length],
            ] as const
          ).map(([id, label, n]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSubTab(id)}
              className={
                subTab === id
                  ? "rounded-full bg-[#1d1d1f] px-4 py-2 text-sm font-medium text-white"
                  : "rounded-full px-4 py-2 text-sm font-medium text-[#6e6e73] transition-colors hover:text-[#1d1d1f]"
              }
            >
              {label}{" "}
              <span className={subTab === id ? "text-white/80" : ""}>({n})</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={sheetSyncBusy}
          onClick={() => void syncProjectSheet()}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-[#e5e5e5] bg-white px-4 py-2 text-sm font-medium text-[#1d1d1f] transition-all hover:bg-[#f5f5f7] disabled:opacity-50"
        >
          {sheetSyncBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="h-4 w-4" aria-hidden />
          )}
          Sync Project Sheet
        </button>
      </div>

      {subTab === "pending" && (
        <section className="space-y-4">
          <label className="flex max-w-md flex-col gap-1">
            <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
              Search
            </span>
            <input
              type="search"
              placeholder="Name, email, phone, or title"
              className={filterInp}
              value={filters.pending.search}
              onChange={(e) => patchFilter("pending", { search: e.target.value })}
            />
          </label>
          <div className={tableWrap}>
            <div className="w-full overflow-x-auto">
              <table className="w-full min-w-[900px] table-auto border-collapse">
                <thead>
                  <tr>
                    <th className={thName}>Name</th>
                    <th className={thPhone}>Phone</th>
                    <th className={thProjTitle}>Project title</th>
                    <th className={thPoc}>POC assigned</th>
                    <th className={thActions}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingPage.slice.length === 0 ? (
                    <tr>
                      <td className={tdBase} colSpan={5}>
                        {emptyState}
                      </td>
                    </tr>
                  ) : (
                    pendingPage.slice.map((c) => {
                      const hasPoc = Boolean(c.poc_assigned?.trim());
                      const showPocDropdown = !hasPoc || pocEditingId === c.id;
                      return (
                        <tr key={c.id}>
                          <td className={tdName}>
                            <button
                              type="button"
                              className={nameLinkBtn}
                              onClick={() => setDetail(c)}
                            >
                              {projectDisplayName(c)}
                            </button>
                          </td>
                          <td className={tdPhone}>
                            {c.whatsapp_number?.trim() || "—"}
                          </td>
                          <td className={tdProjTitle}>
                            {c.project_title?.trim() || "—"}
                          </td>
                          <td className={tdPoc}>
                            {showPocDropdown ? (
                              <div className="flex flex-wrap items-center gap-2">
                                <select
                                  disabled={pocSavingId === c.id}
                                  className="max-w-[180px] rounded-lg border border-[#e5e5e5] bg-white px-2 py-1.5 text-xs text-[#1d1d1f] focus:border-[#3b82f6] focus:outline-none disabled:opacity-50"
                                  value={c.poc_assigned ?? ""}
                                  onChange={(e) =>
                                    void handlePocChange(c, e.target.value)
                                  }
                                  aria-label={
                                    hasPoc
                                      ? "Change POC assignment"
                                      : "Assign POC"
                                  }
                                >
                                  <option value="">Assign POC...</option>
                                  {pocOptionsFor(c, pocRoster).map((n) => (
                                    <option key={n} value={n}>
                                      {n}
                                    </option>
                                  ))}
                                </select>
                                {hasPoc ? (
                                  <button
                                    type="button"
                                    className="text-xs font-medium text-[#6e6e73] underline decoration-[#d1d5db] underline-offset-2 hover:text-[#1d1d1f]"
                                    onClick={() => setPocEditingId(null)}
                                  >
                                    Cancel
                                  </button>
                                ) : null}
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <span className="inline-flex rounded-full bg-[#f5f5f7] px-2.5 py-1 text-xs font-medium text-[#6e6e73]">
                                  {c.poc_assigned}
                                </span>
                                <button
                                  type="button"
                                  className="inline-flex items-center justify-center rounded-lg p-1 text-[#3b82f6] transition-colors hover:bg-[#eff6ff] hover:text-[#2563eb]"
                                  onClick={() => setPocEditingId(c.id)}
                                  aria-label="Change POC"
                                >
                                  <Pencil
                                    className="h-3.5 w-3.5 shrink-0"
                                    aria-hidden
                                  />
                                </button>
                              </div>
                            )}
                          </td>
                          <td className={tdActions}>
                            <div className="flex flex-wrap justify-end gap-2">
                              <button
                                type="button"
                                disabled={
                                  !hasPoc ||
                                  deleteBusyId === c.id ||
                                  pocSavingId === c.id
                                }
                                title={
                                  hasPoc ? undefined : "Assign a POC first"
                                }
                                className="rounded-lg bg-[#1d1d1f] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#2d2d2f] disabled:cursor-not-allowed disabled:bg-[#d1d5db] disabled:text-[#6b7280]"
                                onClick={() =>
                                  onScheduleProject({
                                    id: c.id,
                                    email: c.email,
                                    whatsapp_number: c.whatsapp_number,
                                    project_title: c.project_title,
                                    poc_assigned: c.poc_assigned,
                                  })
                                }
                              >
                                Schedule
                              </button>
                              {isAdmin ? (
                                <button
                                  type="button"
                                  disabled={
                                    deleteBusyId === c.id ||
                                    pocSavingId === c.id
                                  }
                                  title="Delete project candidate"
                                  aria-label="Delete project candidate"
                                  className="inline-flex items-center justify-center rounded-lg border border-[#fecaca] bg-[#fef2f2] p-2 text-[#dc2626] transition-colors hover:bg-[#fee2e2] disabled:opacity-50"
                                  onClick={() =>
                                    void deleteProjectCandidate(c)
                                  }
                                >
                                  <Trash2
                                    className="h-4 w-4"
                                    strokeWidth={2}
                                    aria-hidden
                                  />
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {renderPagination(
              "pending",
              pendingPage.totalPages,
              pendingPage.total,
            )}
          </div>
        </section>
      )}

      {subTab === "scheduled" && (
        <section className="space-y-4">
          <label className="flex max-w-md flex-col gap-1">
            <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
              Search
            </span>
            <input
              type="search"
              placeholder="Name, email, phone, or title"
              className={filterInp}
              value={filters.scheduled.search}
              onChange={(e) =>
                patchFilter("scheduled", { search: e.target.value })
              }
            />
          </label>
          <div className={tableWrap}>
            <div className="w-full overflow-x-auto">
              <table className="w-full min-w-[1100px] table-auto border-collapse">
                <thead>
                  <tr>
                    <th className={thName}>Name</th>
                    <th className={thPhone}>Phone</th>
                    <th className={thProjTitle}>Project title</th>
                    <th className={thDateTime}>Date &amp; time</th>
                    <th className={thInterviewer}>Interviewer</th>
                    <th className={thZoomStatus}>Zoom status</th>
                    <th className={thPoc}>POC</th>
                    <th className={thActions}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {scheduledPage.slice.length === 0 ? (
                    <tr>
                      <td className={tdBase} colSpan={8}>
                        {emptyState}
                      </td>
                    </tr>
                  ) : (
                    scheduledPage.slice.map((i) => {
                      const pc = i.project_candidates;
                      if (!pc) return null;
                      const isDraftRow = i.interview_status === "draft";
                      const isScheduledRow = i.interview_status === "scheduled";
                      const hasIv = hasAssignedProjectInterviewer(i);
                      const hasZoom = Boolean(i.zoom_link?.trim());
                      const awaitingIv = isDraftRow && !hasIv;
                      const awaitingZoom =
                        !hasZoom &&
                        ((isDraftRow && hasIv) || isScheduledRow);
                      const zoomAdded = isScheduledRow && hasZoom;
                      const needsZoom = !hasZoom;
                      const zoomLink = i.zoom_link?.trim();
                      return (
                        <tr key={i.id}>
                          <td className={tdName}>
                            <button
                              type="button"
                              className={nameLinkBtn}
                              onClick={() => setDetail(pc)}
                            >
                              {projectDisplayName(pc)}
                            </button>
                          </td>
                          <td className={tdPhone}>
                            {pc.whatsapp_number?.trim() || "—"}
                          </td>
                          <td className={tdProjTitle}>
                            {pc.project_title?.trim() || "—"}
                          </td>
                          <td className={tdDateTime}>
                            <div className="flex flex-col items-start gap-2">
                              <span>{formatDateTime(i.scheduled_date)}</span>
                              {i.previous_scheduled_date ? (
                                <span className="inline-flex rounded-full bg-[#fff7ed] px-2.5 py-1 text-xs font-medium text-[#c2410c]">
                                  Rescheduled
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className={tdInterviewer}>
                            {i.interviewer?.trim() || "—"}
                          </td>
                          <td className={tdZoomStatus}>
                            <div className="flex flex-col items-start gap-2">
                              {awaitingIv ? (
                                <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
                                  Awaiting Interviewer
                                </span>
                              ) : awaitingZoom ? (
                                <span className="inline-flex rounded-full bg-[#fff7ed] px-2.5 py-1 text-xs font-medium text-[#c2410c]">
                                  Awaiting Zoom
                                </span>
                              ) : zoomAdded ? (
                                <span className="inline-flex rounded-full bg-[#f0fdf4] px-2.5 py-1 text-xs font-medium text-[#15803d]">
                                  Zoom Added
                                </span>
                              ) : (
                                <span className="text-[#6e6e73]">—</span>
                              )}
                              {isScheduledRow &&
                              i.zoom_account?.trim() ? (
                                <p className="text-xs text-[#6e6e73]">
                                  Account: {i.zoom_account.trim()}
                                </p>
                              ) : null}
                            </div>
                          </td>
                          <td className={tdPoc}>
                            {i.poc?.trim() ||
                              pc.poc_assigned?.trim() ||
                              "—"}
                          </td>
                          <td className={tdActions}>
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              {isDraftRow && !hasIv ? (
                                <button
                                  type="button"
                                  className="rounded-lg bg-[#2563eb] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1d4ed8]"
                                  onClick={() => setAssignInterviewerFor(i)}
                                >
                                  Assign Interviewer
                                </button>
                              ) : null}
                              {needsZoom &&
                              (isDraftRow || isScheduledRow) ? (
                                <button
                                  type="button"
                                  disabled={isDraftRow && !hasIv}
                                  title={
                                    isDraftRow && !hasIv
                                      ? "Assign interviewer first"
                                      : undefined
                                  }
                                  className="rounded-lg border border-[#1d1d1f] bg-white px-3 py-1.5 text-xs font-medium text-[#1d1d1f] hover:bg-[#fafafa] disabled:cursor-not-allowed disabled:border-[#d1d5db] disabled:text-[#9ca3af]"
                                  onClick={() =>
                                    !isDraftRow || hasIv
                                      ? setAddZoomFor(i)
                                      : undefined
                                  }
                                >
                                  Add Zoom Details
                                </button>
                              ) : null}
                              {isScheduledRow && zoomLink ? (
                                <a
                                  href={zoomLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex rounded-lg border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#1d1d1f] transition-colors hover:bg-[#f5f5f7]"
                                >
                                  Join
                                </a>
                              ) : null}
                              <button
                                type="button"
                                className="rounded-lg bg-[#ea580c] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#c2410c] disabled:cursor-not-allowed disabled:bg-[#d1d5db] disabled:text-[#6b7280]"
                                onClick={() =>
                                  onRescheduleProjectInterview(
                                    i,
                                    "from_scheduled",
                                  )
                                }
                                disabled={!isScheduledRow}
                                title={
                                  !isScheduledRow
                                    ? "Disabled until Zoom is added"
                                    : undefined
                                }
                              >
                                Reschedule
                              </button>
                              <button
                                type="button"
                                className="rounded-lg bg-[#16a34a] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#15803d] disabled:cursor-not-allowed disabled:bg-[#d1d5db] disabled:text-[#6b7280]"
                                onClick={() => onPostProjectInterview(i)}
                                disabled={!isScheduledRow}
                                title={
                                  !isScheduledRow
                                    ? "Disabled until Zoom is added"
                                    : undefined
                                }
                              >
                                Mark completed
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
            {renderPagination(
              "scheduled",
              scheduledPage.totalPages,
              scheduledPage.total,
            )}
          </div>
        </section>
      )}

      {subTab === "rescheduled" && (
        <section className="space-y-4">
          <label className="flex max-w-md flex-col gap-1">
            <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
              Search
            </span>
            <input
              type="search"
              placeholder="Name, email, phone, or title"
              className={filterInp}
              value={filters.rescheduled.search}
              onChange={(e) =>
                patchFilter("rescheduled", { search: e.target.value })
              }
            />
          </label>
          <div className={tableWrap}>
            <div className="w-full overflow-x-auto">
              <table className="w-full min-w-[1280px] table-auto border-collapse">
                <thead>
                  <tr>
                    <th className={thName}>Name</th>
                    <th className={thPhone}>Phone</th>
                    <th className={thProjTitle}>Project title</th>
                    <th className={thDateTime}>Original date</th>
                    <th className={thReason}>Reason</th>
                    <th className={thDateTime}>New date</th>
                    <th className={thInterviewer}>Interviewer</th>
                    <th className={thActions}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rescheduledPage.slice.length === 0 ? (
                    <tr>
                      <td className={tdBase} colSpan={8}>
                        {emptyState}
                      </td>
                    </tr>
                  ) : (
                    rescheduledPage.slice.map((i) => {
                      const pc = i.project_candidates;
                      if (!pc) return null;
                      return (
                        <tr key={i.id}>
                          <td className={tdName}>
                            <button
                              type="button"
                              className={nameLinkBtn}
                              onClick={() => setDetail(pc)}
                            >
                              {projectDisplayName(pc)}
                            </button>
                          </td>
                          <td className={tdPhone}>
                            {pc.whatsapp_number?.trim() || "—"}
                          </td>
                          <td className={tdProjTitle}>
                            {pc.project_title?.trim() || "—"}
                          </td>
                          <td className={tdDateTime}>
                            {formatDateTime(i.previous_scheduled_date)}
                          </td>
                          <td
                            className={`${tdReason} max-w-[220px] truncate`}
                            title={i.reschedule_reason ?? undefined}
                          >
                            {i.reschedule_reason?.trim() || "—"}
                          </td>
                          <td className={tdDateTime}>
                            {formatDateTime(i.scheduled_date)}
                          </td>
                          <td className={tdInterviewer}>{i.interviewer}</td>
                          <td className={tdActions}>
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              <button
                                type="button"
                                className="rounded-lg bg-[#1d1d1f] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#2d2d2f]"
                                onClick={() =>
                                  onRescheduleProjectInterview(
                                    i,
                                    "from_rescheduled",
                                  )
                                }
                              >
                                Schedule again
                              </button>
                              <button
                                type="button"
                                className="rounded-lg bg-[#16a34a] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#15803d]"
                                onClick={() => onPostProjectInterview(i)}
                              >
                                Mark completed
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
            {renderPagination(
              "rescheduled",
              rescheduledPage.totalPages,
              rescheduledPage.total,
            )}
          </div>
        </section>
      )}

      {subTab === "completed" && (
        <section className="space-y-4">
          <label className="flex max-w-md flex-col gap-1">
            <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
              Search
            </span>
            <input
              type="search"
              placeholder="Name, email, phone, or title"
              className={filterInp}
              value={filters.completed.search}
              onChange={(e) =>
                patchFilter("completed", { search: e.target.value })
              }
            />
          </label>
          <div className={tableWrap}>
            <div className="w-full overflow-x-auto">
              <table className="w-full min-w-[1200px] table-auto border-collapse">
                <thead>
                  <tr>
                    <th className={thName}>Name</th>
                    <th className={thPhone}>Phone</th>
                    <th className={thProjTitle}>Project title</th>
                    <th className={thInterviewer}>Interviewer</th>
                    <th className={thCompletedOn}>Completed on</th>
                    <th className={thPostInterview}>
                      Post-interview eligible
                    </th>
                    <th className={thFunnelCol}>Funnel</th>
                    <th className={thCommentsCol}>Comments</th>
                    <th className={thActions}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {completedPage.slice.length === 0 ? (
                    <tr>
                      <td className={tdBase} colSpan={9}>
                        {emptyState}
                      </td>
                    </tr>
                  ) : (
                    completedPage.slice.map((i) => {
                      const pc = i.project_candidates;
                      if (!pc) return null;
                      const commentsPreview = truncateWithTooltip(
                        i.comments,
                        40,
                      );
                      return (
                        <tr key={i.id}>
                          <td className={tdName}>
                            <button
                              type="button"
                              className={nameLinkBtn}
                              onClick={() => setDetail(pc)}
                            >
                              {projectDisplayName(pc)}
                            </button>
                          </td>
                          <td className={tdPhone}>
                            {pc.whatsapp_number?.trim() || "—"}
                          </td>
                          <td className={tdProjTitle}>
                            {pc.project_title?.trim() || "—"}
                          </td>
                          <td className={tdInterviewer}>{i.interviewer}</td>
                          <td className={tdCompletedOn}>
                            {formatDateTime(i.completed_at)}
                          </td>
                          <td className={tdPostInterview}>
                            {postInterviewEligibleBadge(
                              i.post_interview_eligible,
                              i.reward_item,
                            )}
                          </td>
                          <td className={tdFunnelCol}>
                            {i.funnel?.trim() || "—"}
                          </td>
                          <td
                            className={tdCommentsCol}
                            title={commentsPreview.title}
                          >
                            <span className="block max-w-[200px] truncate">
                              {commentsPreview.display}
                            </span>
                          </td>
                          <td className={`${tdActions} relative`}>
                            <div
                              className="relative flex justify-end"
                              data-project-completed-popover-root
                            >
                              <button
                                type="button"
                                className="text-sm font-medium text-[#3b82f6] hover:text-[#2563eb]"
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCompletedPopoverId((id) =>
                                    id === i.id ? null : i.id,
                                  );
                                }}
                              >
                                View details
                              </button>
                              {completedPopoverId === i.id ? (
                                <div
                                  className="absolute right-0 top-full z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] max-w-sm rounded-xl border border-[#f0f0f0] bg-white p-4 text-left shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
                                  onMouseDown={(e) => e.stopPropagation()}
                                  role="dialog"
                                  aria-label="Post-interview details"
                                >
                                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                                    Post-interview details
                                  </p>
                                  <dl className="mt-3 space-y-3 text-sm">
                                    <div>
                                      <dt className="text-xs text-[#aeaeb2]">
                                        Post-interview eligible
                                      </dt>
                                      <dd className="mt-0.5 text-[#1d1d1f]">
                                        {i.post_interview_eligible === true
                                          ? i.reward_item?.trim() ===
                                            REWARD_NO_DISPATCH
                                            ? "Eligible — no physical dispatch"
                                            : "Eligible"
                                          : i.post_interview_eligible === false
                                            ? "Not eligible"
                                            : "—"}
                                      </dd>
                                    </div>
                                    <div>
                                      <dt className="text-xs text-[#aeaeb2]">
                                        Reward item
                                      </dt>
                                      <dd className="mt-0.5 text-[#1d1d1f]">
                                        {i.reward_item?.trim() || "—"}
                                      </dd>
                                    </div>
                                    <div>
                                      <dt className="text-xs text-[#aeaeb2]">
                                        Funnel
                                      </dt>
                                      <dd className="mt-0.5 whitespace-pre-wrap break-words text-[#1d1d1f]">
                                        {i.funnel?.trim() || "—"}
                                      </dd>
                                    </div>
                                    <div>
                                      <dt className="text-xs text-[#aeaeb2]">
                                        Comments
                                      </dt>
                                      <dd className="mt-0.5 whitespace-pre-wrap break-words text-[#1d1d1f]">
                                        {i.comments?.trim() || "—"}
                                      </dd>
                                    </div>
                                    <div>
                                      <dt className="text-xs text-[#aeaeb2]">
                                        Completed on
                                      </dt>
                                      <dd className="mt-0.5 text-[#1d1d1f]">
                                        {formatDateTime(i.completed_at)}
                                      </dd>
                                    </div>
                                  </dl>
                                  <button
                                    type="button"
                                    className="mt-4 text-xs font-medium text-[#3b82f6] hover:text-[#2563eb]"
                                    onClick={() => setCompletedPopoverId(null)}
                                  >
                                    Close
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {renderPagination(
              "completed",
              completedPage.totalPages,
              completedPage.total,
            )}
          </div>
        </section>
      )}

      <ProjectCandidateDetailModal
        open={!!detail}
        candidate={detail}
        onClose={() => setDetail(null)}
      />

      <AssignInterviewerModal
        key={assignInterviewerFor?.id ?? "project-assign-iv-closed"}
        open={!!assignInterviewerFor}
        interview={assignInterviewerFor}
        supabase={supabase}
        onClose={() => setAssignInterviewerFor(null)}
        onSaved={() => {
          setAssignInterviewerFor(null);
          void loadProjectData();
          onPipelineChanged();
        }}
      />

      <AddZoomDetailsModal
        key={addZoomFor?.id ?? "project-add-zoom-closed"}
        open={!!addZoomFor}
        interview={addZoomFor}
        supabase={supabase}
        onClose={() => setAddZoomFor(null)}
        onSaved={() => {
          setAddZoomFor(null);
          void loadProjectData();
          onPipelineChanged();
        }}
        onToast={(msg) => {
          if (onToast) onToast(msg);
          else onError(msg);
        }}
      />
    </>
  );
}

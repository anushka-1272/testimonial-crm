"use client";

import { format, parseISO } from "date-fns";
import { Loader2, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { SupabaseClient } from "@supabase/supabase-js";

import { CommentTableCell } from "@/components/comment-display";
import { useAccessControl } from "@/components/access-control-context";
import { ProjectCandidateDetailModal } from "@/components/project-candidate-detail-modal";
import { ZoomDetailsModal } from "@/components/ZoomDetailsModal";
import { logActivity } from "@/lib/activity-logger";
import { buildNoShowRevertPatch } from "@/lib/interview-no-show";
import {
  normalizePhysicalInterviewStatus,
  PHYSICAL_INTERVIEW_DISPATCH_COMMENT,
  PHYSICAL_INTERVIEW_REWARD_ITEM,
  physicalInterviewStatusLabel,
  type PhysicalInterviewCity,
  type PhysicalInterviewStatus,
} from "@/lib/physical-interview-track";
import { requestRevertInterview } from "@/lib/revert-interview-client";
import { displayNameFromUser, getUserSafe } from "@/lib/supabase-auth";
import {
  buildInterviewerSelectOptions,
  formatInterviewerStoredForUi,
  interviewerRowMatchesFilter,
  type InterviewerSelectOption,
} from "@/lib/interviewer-enum";
import {
  canConfirmSocialPosts,
  canFinalizeDispatch,
  isDispatchAlreadyFinalized,
  matchesPostContentStageFilter,
  postContentStatusBadgeClass,
  postContentStatusLabel,
  POST_CONTENT_STAGE_FILTER_OPTIONS,
  type PostContentStageFilter,
} from "@/lib/post-interview-content";
import {
  canMoveToPostProduction,
  POST_PRODUCTION_ELIGIBILITY_TOOLTIP,
} from "@/lib/post-production-eligibility";
import { syncAutoNotInterestedFollowups } from "@/lib/sync-auto-not-interested-followups";
import {
  fetchTeamRosterNames,
  mergeRosterWithCurrent,
} from "@/lib/team-roster";

import { AssignInterviewerModal } from "./assign-interviewer-modal";
import { ConfirmSocialPostsModal } from "./confirm-social-posts-modal";
import { EditInterviewDetailsModal } from "./edit-interview-details-modal";
import { FinalizeDispatchModal } from "./finalize-dispatch-modal";
import { MarkNoShowModal } from "./mark-no-show-modal";
import { ScheduledInterviewRowActions } from "./scheduled-interview-row-actions";
import { PhysicalInterviewCityModal } from "./physical-interview-city-modal";
import { isPostRescheduleDraftRow } from "./interview-reschedule-workflow";
import {
  followupStatusBadgeFromSnapshot,
  getFollowUpStatus,
  type FollowupLogStatusRow,
} from "./followup-status";
import { LogFollowupCallModal } from "./log-followup-call-modal";
import type { ScheduleProjectCandidate } from "./schedule-interview-modal";
import type {
  FollowupStatus,
  ProjectCandidateRow,
  ProjectInterviewWithProjectCandidate,
  ProjectLogFollowupRow,
} from "./types";

const PAGE_SIZE = 20;

/** Interview rows only — join `project_candidates` client-side so a failed embed never blocks loading candidates. */
const PROJECT_INTERVIEW_COLUMNS = `id, created_at, project_candidate_id, scheduled_date, previous_scheduled_date, reschedule_reason, completed_at, interviewer, interviewer_assigned_at, zoom_link, zoom_account, not_eligible_recording_link, language, invitation_sent, poc, remarks, reminder_count, interview_status, post_interview_eligible, reward_item, category, funnel, comments, interview_type, post_content_status, linkedin_post_url, blog_post_url, posts_confirmed_at, skip_social_posts, no_show_reason, no_show_at`;
const PROJECT_INTERVIEW_COLUMNS_LEGACY = `id, created_at, project_candidate_id, scheduled_date, previous_scheduled_date, reschedule_reason, completed_at, interviewer, interviewer_assigned_at, zoom_link, zoom_account, language, invitation_sent, poc, remarks, reminder_count, interview_status, post_interview_eligible, reward_item, category, funnel, comments, interview_type`;

type ProjectSubTab = "pending" | "scheduled" | "completed" | "notEligible" | "noShow";

/** Sentinel for POC filter dropdown (rows with no POC). */
const POC_FILTER_UNASSIGNED = "__poc_unassigned__";

function effectivePocForProjectInterview(
  i: ProjectInterviewWithProjectCandidate,
): string {
  return (
    i.poc?.trim() || i.project_candidates?.poc_assigned?.trim() || ""
  );
}

function pocMatchesFilter(
  filter: string,
  rowPoc: string | null | undefined,
): boolean {
  if (filter === "all") return true;
  if (filter === POC_FILTER_UNASSIGNED) return !rowPoc?.trim();
  return interviewerRowMatchesFilter(filter, rowPoc);
}

const INTERVIEWER_FILTER_UNASSIGNED = "__interviewer_unassigned__";

function interviewerMatchesFilter(
  filter: string,
  rowInterviewer: string | null | undefined,
): boolean {
  if (filter === "all") return true;
  if (filter === INTERVIEWER_FILTER_UNASSIGNED) return !rowInterviewer?.trim();
  return interviewerRowMatchesFilter(filter, rowInterviewer);
}

type TabFilters = {
  search: string;
  page: number;
  poc: string;
  interviewer: string;
};

function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "MMM d, yyyy h:mm a");
  } catch {
    return "—";
  }
}

function formatAssignedOnIst(iso: string | null | undefined) {
  if (!iso?.trim()) return "--";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(iso.trim()));
  } catch {
    return "--";
  }
}

function formatDateOnly(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "MMM d, yyyy");
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

function compareProjectInterviewScheduledDesc(
  a: ProjectInterviewWithProjectCandidate,
  b: ProjectInterviewWithProjectCandidate,
): number {
  const sa = a.scheduled_date ?? "";
  const sb = b.scheduled_date ?? "";
  if (!sa && !sb) return a.id.localeCompare(b.id);
  if (!sa) return 1;
  if (!sb) return -1;
  const c = sb.localeCompare(sa);
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

function normalizeProjectCandidateFromDb(
  raw: Record<string, unknown>,
): ProjectCandidateRow {
  return {
    ...(raw as ProjectCandidateRow),
    followup_status:
      (raw.followup_status as FollowupStatus | undefined) ?? "pending",
    followup_count: Number(raw.followup_count ?? 0),
    callback_datetime:
      (raw.callback_datetime as string | null | undefined) ?? null,
    not_interested_reason:
      (raw.not_interested_reason as string | null | undefined) ?? null,
    not_interested_at:
      (raw.not_interested_at as string | null | undefined) ?? null,
    physical_interview_track: Boolean(raw.physical_interview_track),
    physical_interview_status: raw.physical_interview_track
      ? normalizePhysicalInterviewStatus(
          raw.physical_interview_status as string | null | undefined,
        )
      : null,
    physical_interview_city:
      (raw.physical_interview_city as string | null | undefined) ?? null,
  };
}

function projectCandidateForLogModal(pc: ProjectCandidateRow): ProjectLogFollowupRow {
  return {
    id: pc.id,
    full_name: pc.full_name,
    email: pc.email,
    whatsapp_number: pc.whatsapp_number,
    poc_assigned: pc.poc_assigned,
    followup_status: pc.followup_status ?? "pending",
    followup_count: pc.followup_count ?? 0,
    callback_datetime: pc.callback_datetime ?? null,
    not_interested_reason: pc.not_interested_reason ?? null,
    not_interested_at: pc.not_interested_at ?? null,
  };
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
    not_eligible_recording_link:
      (r.not_eligible_recording_link as string | null | undefined) ?? null,
    reward_item: (r.reward_item as string | null) ?? null,
    category: (r.category as string | null) ?? null,
    funnel: (r.funnel as string | null) ?? null,
    comments: (r.comments as string | null) ?? null,
    post_content_status:
      (r.post_content_status as ProjectInterviewWithProjectCandidate["post_content_status"]) ??
      null,
    linkedin_post_url: (r.linkedin_post_url as string | null) ?? null,
    blog_post_url: (r.blog_post_url as string | null) ?? null,
    posts_confirmed_at: (r.posts_confirmed_at as string | null) ?? null,
    skip_social_posts: Boolean(r.skip_social_posts),
    no_show_reason: (r.no_show_reason as string | null) ?? null,
    no_show_at: (r.no_show_at as string | null) ?? null,
    project_candidates: pc,
  } as ProjectInterviewWithProjectCandidate;
}

function isProjectInterviewRecordComplete(
  i: ProjectInterviewWithProjectCandidate,
): boolean {
  return (
    i.interview_status === "completed" || Boolean(i.completed_at?.trim())
  );
}

function isProjectCandidateFollowupDone(
  pc: ProjectCandidateRow | null | undefined,
): boolean {
  const fs = pc?.followup_status;
  return fs === "already_completed" || fs === "not_eligible" || fs === "not_interested";
}

function projectCandidateIdsMarkedAlreadyCompleted(
  candidates: ProjectCandidateRow[],
  followupLogs: FollowupLogStatusRow[],
): Set<string> {
  const ids = new Set<string>();
  for (const c of candidates) {
    if (c.followup_status === "already_completed") ids.add(c.id);
  }
  for (const log of followupLogs) {
    if (
      log.status === "already_completed" &&
      log.project_candidate_id?.trim()
    ) {
      ids.add(log.project_candidate_id.trim());
    }
  }
  return ids;
}

/** Active row kept only when it is a real post-reschedule draft, not a stale duplicate. */
function isStaleActiveProjectInterview(
  i: ProjectInterviewWithProjectCandidate,
  completedCandidateIds: Set<string>,
  alreadyCompletedCandidateIds: Set<string>,
): boolean {
  if (isProjectInterviewRecordComplete(i)) return false;
  if (alreadyCompletedCandidateIds.has(i.project_candidate_id)) return true;
  if (!completedCandidateIds.has(i.project_candidate_id)) return false;
  return !isPostRescheduleDraftRow(i);
}

function projectInterviewIsDoneForTabs(
  i: ProjectInterviewWithProjectCandidate,
  alreadyCompletedCandidateIds: Set<string>,
): boolean {
  if (isProjectInterviewRecordComplete(i)) return true;
  if (alreadyCompletedCandidateIds.has(i.project_candidate_id)) return true;
  if (isProjectCandidateFollowupDone(i.project_candidates)) return true;
  return false;
}

async function repairInconsistentProjectInterviews(
  supabase: SupabaseClient,
  rows: ProjectInterviewWithProjectCandidate[],
  candidates: ProjectCandidateRow[],
  followupLogs: FollowupLogStatusRow[],
): Promise<number> {
  const alreadyCompletedIds = projectCandidateIdsMarkedAlreadyCompleted(
    candidates,
    followupLogs,
  );
  const completedAtByCandidate = new Map<string, string>();
  for (const i of rows) {
    if (!isProjectInterviewRecordComplete(i)) continue;
    const at = i.completed_at?.trim() || new Date().toISOString();
    const prev = completedAtByCandidate.get(i.project_candidate_id);
    if (!prev || at > prev) {
      completedAtByCandidate.set(i.project_candidate_id, at);
    }
  }

  const idsToRepair = new Set<string>(alreadyCompletedIds);
  const completedCandidateIds = new Set(completedAtByCandidate.keys());
  for (const i of rows) {
    if (
      isStaleActiveProjectInterview(
        i,
        completedCandidateIds,
        alreadyCompletedIds,
      )
    ) {
      idsToRepair.add(i.project_candidate_id);
    }
  }

  if (idsToRepair.size === 0) return 0;

  const completedAtIso = new Date().toISOString();
  let repaired = 0;
  for (const candidateId of idsToRepair) {
    const completedAt =
      completedAtByCandidate.get(candidateId) ?? completedAtIso;
    const { data: staleRows, error: selErr } = await supabase
      .from("project_interviews")
      .select("id, interview_status, completed_at")
      .eq("project_candidate_id", candidateId)
      .neq("interview_status", "cancelled");
    if (selErr) {
      console.error(
        "[ProjectInterviewsPanel] repair select:",
        selErr.message,
        candidateId,
      );
      continue;
    }
    const toUpdate = (staleRows ?? []).filter(
      (r) =>
        (r.interview_status as string) !== "completed" ||
        !(r.completed_at as string | null)?.trim(),
    );
    if (!toUpdate.length) continue;
    const { error: upErr } = await supabase
      .from("project_interviews")
      .update({
        interview_status: "completed",
        completed_at: completedAt,
      })
      .in(
        "id",
        toUpdate.map((r) => r.id as string),
      );
    if (upErr) {
      console.error(
        "[ProjectInterviewsPanel] repair update:",
        upErr.message,
        candidateId,
      );
      continue;
    }
    repaired += toUpdate.length;
  }
  return repaired;
}

function projectInterviewDuplicateKey(
  i: ProjectInterviewWithProjectCandidate,
): string {
  const scheduledAt = (i.scheduled_date ?? "").trim();
  const type = (i.interview_type ?? "project").trim();
  const bucket =
    i.interview_status === "completed" || i.completed_at
      ? "completed"
      : "active";
  return `${i.project_candidate_id}|${scheduledAt}|${type}|${bucket}`;
}

function projectInterviewQualityScore(
  i: ProjectInterviewWithProjectCandidate,
): number {
  let score = 0;
  if (i.interviewer?.trim()) score += 1000;
  if (i.interviewer_assigned_at) score += 100;
  if ((i.zoom_link ?? "").trim() || (i.zoom_account ?? "").trim())
    score += 10;
  if (i.interview_status === "scheduled") score += 5;
  if (i.interview_status === "rescheduled") score += 3;
  if (i.interview_status === "draft") score += 1;
  if ((i.comments ?? "").trim()) score += 50;
  if ((i.remarks ?? "").trim()) score += 25;
  return score;
}

function dedupeProjectInterviewRows(
  rows: ProjectInterviewWithProjectCandidate[],
): ProjectInterviewWithProjectCandidate[] {
  const completedCandidateIds = new Set(
    rows
      .filter(isProjectInterviewRecordComplete)
      .map((i) => i.project_candidate_id),
  );
  const withoutStaleDuplicates = rows.filter((i) => {
    if (isProjectInterviewRecordComplete(i)) return true;
    if (!completedCandidateIds.has(i.project_candidate_id)) return true;
    return isPostRescheduleDraftRow(i);
  });

  const byKey = new Map<string, ProjectInterviewWithProjectCandidate>();
  for (const row of withoutStaleDuplicates) {
    const key = projectInterviewDuplicateKey(row);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, row);
      continue;
    }
    const prevScore = projectInterviewQualityScore(prev);
    const nextScore = projectInterviewQualityScore(row);
    if (nextScore > prevScore) {
      byKey.set(key, row);
      continue;
    }
    if (nextScore < prevScore) continue;
    const prevTime = new Date(
      prev.interviewer_assigned_at ??
        prev.completed_at ??
        prev.scheduled_date ??
        0,
    ).getTime();
    const nextTime = new Date(
      row.interviewer_assigned_at ??
        row.completed_at ??
        row.scheduled_date ??
        0,
    ).getTime();
    if (nextTime >= prevTime) byKey.set(key, row);
  }
  return [...byKey.values()];
}

const REWARD_NO_DISPATCH = "No Dispatch";

function physicalInterviewPipelineBadge(status: PhysicalInterviewStatus | null) {
  if (!status) return <span className="text-muted">—</span>;
  switch (status) {
    case "pending":
      return (
        <span className="inline-flex rounded-full bg-[#f3e8ff] px-2.5 py-1 text-xs font-medium text-[#7c3aed]">
          {physicalInterviewStatusLabel(status)}
        </span>
      );
    case "completed":
      return (
        <span className="inline-flex rounded-full bg-[#dbeafe] px-2.5 py-1 text-xs font-medium text-[#1d4ed8]">
          {physicalInterviewStatusLabel(status)}
        </span>
      );
    case "eligible":
      return (
        <span className="inline-flex rounded-full bg-[#f0fdf4] px-2.5 py-1 text-xs font-medium text-[#16a34a]">
          {physicalInterviewStatusLabel(status)}
        </span>
      );
    case "not_eligible":
      return (
        <span className="inline-flex rounded-full bg-[#fef2f2] px-2.5 py-1 text-xs font-medium text-[#dc2626]">
          {physicalInterviewStatusLabel(status)}
        </span>
      );
    default:
      return <span className="text-muted">—</span>;
  }
}

function physicalInterviewTrackColumnBadge(city: string | null | undefined) {
  return (
    <div className="flex flex-col gap-1">
      <span className="inline-flex w-fit rounded-full bg-[#f3e8ff] px-2.5 py-1 text-xs font-medium text-[#7c3aed]">
        Physical interview
      </span>
      {city?.trim() ? (
        <span className="text-xs text-muted">{city.trim()}</span>
      ) : null}
    </div>
  );
}


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
  return <span className="text-muted">—</span>;
}

function alreadyCompletedFollowupBadge(
  followupStatus: FollowupStatus | undefined,
) {
  if (followupStatus === "already_completed") {
    return (
      <span className="mt-1 inline-flex w-fit rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-800">
        Already Completed
      </span>
    );
  }
  if (followupStatus === "not_eligible") {
    return (
      <span className="mt-1 inline-flex w-fit rounded-full bg-[#fef2f2] px-2 py-0.5 text-[11px] font-medium text-[#b91c1c]">
        Not Eligible
      </span>
    );
  }
  return null;
}

function postProductionGateBadgeProject(
  i: ProjectInterviewWithProjectCandidate,
) {
  if (canMoveToPostProduction(i)) {
    return (
      <span className="inline-flex rounded-full bg-[#f0fdf4] px-2.5 py-1 text-xs font-medium text-[#15803d]">
        Eligible
      </span>
    );
  }
  if (i.post_interview_eligible === false) {
    return (
      <span className="inline-flex rounded-full bg-[#fef2f2] px-2.5 py-1 text-xs font-medium text-[#dc2626]">
        Not eligible
      </span>
    );
  }
  return <span className="text-muted">—</span>;
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
  pending: { search: "", page: 0, poc: "all", interviewer: "all" },
  scheduled: { search: "", page: 0, poc: "all", interviewer: "all" },
  completed: { search: "", page: 0, poc: "all", interviewer: "all" },
  notEligible: { search: "", page: 0, poc: "all", interviewer: "all" },
  noShow: { search: "", page: 0, poc: "all", interviewer: "all" },
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
  const [followupLogs, setFollowupLogs] = useState<FollowupLogStatusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [subTab, setSubTab] = useState<ProjectSubTab>("pending");
  const [filters, setFilters] = useState(defaultFilters);
  const [pocSavingId, setPocSavingId] = useState<string | null>(null);
  const [pocEditingId, setPocEditingId] = useState<string | null>(null);
  const [pocRoster, setPocRoster] = useState<string[]>([]);
  const [interviewerRoster, setInterviewerRoster] = useState<
    InterviewerSelectOption[]
  >([]);
  const [detail, setDetail] = useState<ProjectCandidateRow | null>(null);
  const [completedPopoverId, setCompletedPopoverId] = useState<string | null>(
    null,
  );
  const [postProdBusyId, setPostProdBusyId] = useState<string | null>(null);
  const [notEligibleRecordingBusyId, setNotEligibleRecordingBusyId] = useState<
    string | null
  >(null);
  const [notEligibleRecordingEdit, setNotEligibleRecordingEdit] = useState<{
    id: string;
    value: string;
  } | null>(null);
  const [sheetSyncBusy, setSheetSyncBusy] = useState(false);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [physicalInterviewBusyId, setPhysicalInterviewBusyId] = useState<
    string | null
  >(null);
  const [physicalInterviewCityFor, setPhysicalInterviewCityFor] =
    useState<ProjectCandidateRow | null>(null);
  const [physicalInterviewListPage, setPhysicalInterviewListPage] = useState(0);
  const [revertBusyId, setRevertBusyId] = useState<string | null>(null);
  const [addZoomFor, setAddZoomFor] =
    useState<ProjectInterviewWithProjectCandidate | null>(null);
  const [assignInterviewerFor, setAssignInterviewerFor] =
    useState<ProjectInterviewWithProjectCandidate | null>(null);
  const [editInterviewFor, setEditInterviewFor] =
    useState<ProjectInterviewWithProjectCandidate | null>(null);
  const [logFollowupFor, setLogFollowupFor] =
    useState<ProjectLogFollowupRow | null>(null);
  const [dispatchProjectCandidateIds, setDispatchProjectCandidateIds] =
    useState<Set<string>>(() => new Set());
  const [completedPostContentStage, setCompletedPostContentStage] =
    useState<PostContentStageFilter>("all");
  const [noShowFor, setNoShowFor] =
    useState<ProjectInterviewWithProjectCandidate | null>(null);
  const [confirmPostsFor, setConfirmPostsFor] =
    useState<ProjectInterviewWithProjectCandidate | null>(null);
  const [finalizeDispatchFor, setFinalizeDispatchFor] =
    useState<ProjectInterviewWithProjectCandidate | null>(null);
  const [noShowRevertBusyId, setNoShowRevertBusyId] = useState<string | null>(
    null,
  );
  const [notInterestedOpen, setNotInterestedOpen] = useState(false);
  const [restoringNotInterestedId, setRestoringNotInterestedId] = useState<
    string | null
  >(null);

  const { role, canEditCurrentPage } = useAccessControl();
  const canEditScheduledTab =
    canEditCurrentPage &&
    (role === "admin" || role === "interviewer" || role === "operations");

  const loadProjectData = useCallback(async () => {
    await syncAutoNotInterestedFollowups(supabase);
    const { data: pc, error: eCandidates } = await supabase
      .from("project_candidates")
      .select(
        "id, created_at, email, full_name, whatsapp_number, project_title, problem_statement, target_user, ai_usage, demo_link, status, poc_assigned, poc_assigned_at, assigned_at, interview_type, followup_status, followup_count, callback_datetime, not_interested_reason, not_interested_at, physical_interview_track, physical_interview_status, physical_interview_city",
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
      candidateList = ((pc ?? []) as Record<string, unknown>[]).map(
        normalizeProjectCandidateFromDb,
      );
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
    let projectInterviewRows = pi;
    let projectInterviewError = eInterviews;
    if (
      projectInterviewError?.message?.includes(
        "column project_interviews.not_eligible_recording_link does not exist",
      ) ||
      projectInterviewError?.message?.includes("post_content_status")
    ) {
      const { data: legacyPi, error: legacyErr } = await supabase
        .from("project_interviews")
        .select(PROJECT_INTERVIEW_COLUMNS_LEGACY)
        .order("created_at", { ascending: true });
      projectInterviewRows =
        legacyPi?.map((row) => ({
          ...row,
          not_eligible_recording_link: null,
          post_content_status: null,
          linkedin_post_url: null,
          blog_post_url: null,
          posts_confirmed_at: null,
          skip_social_posts: false,
          no_show_reason: null,
          no_show_at: null,
        })) ?? null;
      projectInterviewError = legacyErr;
    }
    const { data: fl, error: eFollowup } = await supabase
      .from("followup_log")
      .select(
        "created_at, project_candidate_id, status, attempt_number, callback_datetime",
      )
      .not("project_candidate_id", "is", null)
      .order("created_at", { ascending: true });

    if (projectInterviewError) {
      console.log(
        "[ProjectInterviewsPanel] project_interviews load error:",
        projectInterviewError,
      );
      setInterviews([]);
    } else {
      const rows = (projectInterviewRows ?? []) as Record<string, unknown>[];
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

      const followupRows = (fl ?? []) as FollowupLogStatusRow[];
      const repaired = await repairInconsistentProjectInterviews(
        supabase,
        merged,
        candidateList,
        followupRows,
      );
      if (repaired > 0) {
        const { data: refreshed, error: refreshErr } = await supabase
          .from("project_interviews")
          .select(PROJECT_INTERVIEW_COLUMNS)
          .order("created_at", { ascending: true });
        if (!refreshErr && refreshed) {
          const remerged = (refreshed as Record<string, unknown>[])
            .map((row) => {
              const pid = row.project_candidate_id as string;
              return normalizeProjectInterviewRow({
                ...row,
                project_candidates: candidateById.get(pid) ?? null,
              });
            })
            .filter((i) => i.project_candidates != null);
          setInterviews(dedupeProjectInterviewRows(remerged));
        } else {
          setInterviews(dedupeProjectInterviewRows(merged));
        }
      } else {
        setInterviews(dedupeProjectInterviewRows(merged));
      }
    }
    if (eFollowup) {
      console.log(
        "[ProjectInterviewsPanel] followup_log load error:",
        eFollowup,
      );
      setFollowupLogs([]);
    } else {
      setFollowupLogs((fl ?? []) as FollowupLogStatusRow[]);
    }

    const { data: dispatchRows } = await supabase
      .from("project_dispatch")
      .select("project_candidate_id");
    setDispatchProjectCandidateIds(
      new Set(
        (dispatchRows ?? [])
          .map((d) => String(d.project_candidate_id ?? "").trim())
          .filter(Boolean),
      ),
    );

    if (eCandidates && projectInterviewError) {
      onError(
        `${eCandidates.message} · ${projectInterviewError.message}`,
      );
    } else if (eCandidates) {
      onError(eCandidates.message);
    } else if (projectInterviewError) {
      onError(
        `Could not load project interviews: ${projectInterviewError.message}. Pending list still uses candidates.`,
      );
    } else if (eFollowup) {
      onError(`Could not load follow-up logs: ${eFollowup.message}.`);
    } else {
      onError(null);
    }
  }, [supabase, onError]);

  const addProjectCompletedToPostProduction = useCallback(
    async (i: ProjectInterviewWithProjectCandidate) => {
      if (!canMoveToPostProduction(i)) return;
      setPostProdBusyId(i.id);
      onError(null);
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setPostProdBusyId(null);
        onError("You must be signed in.");
        return;
      }
      let res: Response;
      try {
        res = await fetch("/api/post-production/create-entry", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            source: "project",
            project_interview_id: i.id,
          }),
        });
      } catch (e) {
        console.error("Post production insert failed", e);
        setPostProdBusyId(null);
        onError("Network error while adding to post production.");
        return;
      }
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      setPostProdBusyId(null);
      if (!res.ok) {
        console.error("Post production insert failed", {
          status: res.status,
          body: json,
          project_interview_id: i.id,
        });
        onError(json.error ?? "Could not add to post production.");
        return;
      }
      onToast?.("Added to post production.");
      await loadProjectData();
      onPipelineChanged();
    },
    [supabase, loadProjectData, onPipelineChanged, onError, onToast],
  );

  const saveNotEligibleRecordingLink = useCallback(
    async (interviewId: string, rawValue: string) => {
      if (!canEditScheduledTab) return;
      const next = rawValue.trim() || null;
      setNotEligibleRecordingBusyId(interviewId);
      const { error: updateErr } = await supabase
        .from("project_interviews")
        .update({ not_eligible_recording_link: next })
        .eq("id", interviewId);
      setNotEligibleRecordingBusyId(null);
      if (updateErr) {
        onError(updateErr.message);
        return;
      }
      setInterviews((prev) =>
        prev.map((row) =>
          row.id === interviewId
            ? { ...row, not_eligible_recording_link: next }
            : row,
        ),
      );
      setNotEligibleRecordingEdit((prev) =>
        prev?.id === interviewId ? null : prev,
      );
      onToast?.("Not eligible recording saved");
      onError(null);
    },
    [canEditScheduledTab, supabase, onError, onToast],
  );

  const handleRevertProjectInterview = useCallback(
    async (i: ProjectInterviewWithProjectCandidate) => {
      const pc = Array.isArray(i.project_candidates)
        ? i.project_candidates[0] ?? null
        : i.project_candidates;
      const display =
        pc?.project_title?.trim() ||
        pc?.full_name?.trim() ||
        pc?.email ||
        "Candidate";
      const confirmed = window.confirm(
        `Revert ${display} from scheduled back to callings?\n\nThe interview will be deleted. The candidate stays with the same POC and can be called again.`,
      );
      if (!confirmed) return;

      setRevertBusyId(i.id);
      const { error: revertErr } = await requestRevertInterview(supabase, {
        interviewId: i.id,
        candidateId: i.project_candidate_id,
        isProject: true,
        candidateName: display,
      });
      setRevertBusyId(null);
      if (revertErr) {
        onError(revertErr);
        return;
      }
      onToast?.(`${display} reverted to callings.`);
      onError(null);
      setSubTab("pending");
      await loadProjectData();
      onPipelineChanged();
    },
    [supabase, loadProjectData, onError, onPipelineChanged, onToast],
  );

  const loadRosters = useCallback(async () => {
    const [pocNames, interviewerNames] = await Promise.all([
      fetchTeamRosterNames(supabase, "poc", true),
      fetchTeamRosterNames(supabase, "interviewer", true),
    ]);
    setPocRoster(pocNames);
    setInterviewerRoster(buildInterviewerSelectOptions(interviewerNames, null));
  }, [supabase]);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      await loadProjectData();
      setLoading(false);
    })();
  }, [loadProjectData]);

  useEffect(() => {
    void loadRosters();
  }, [loadRosters]);

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
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "followup_log" },
        () => {
          void loadProjectData();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "team_members" },
        () => {
          void loadRosters();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [supabase, loadProjectData, onPipelineChanged, loadRosters]);

  useEffect(() => {
    if (subTab !== "completed") setCompletedPopoverId(null);
  }, [subTab]);

  useEffect(() => {
    if (subTab !== "notEligible") setNotEligibleRecordingEdit(null);
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

  const alreadyCompletedCandidateIds = useMemo(
    () =>
      projectCandidateIdsMarkedAlreadyCompleted(candidates, followupLogs),
    [candidates, followupLogs],
  );

  const completedProjectCandidateIds = useMemo(
    () =>
      new Set(
        interviews
          .filter(isProjectInterviewRecordComplete)
          .map((i) => i.project_candidate_id),
      ),
    [interviews],
  );

  const byStatus = useMemo(() => {
    const m = {
      scheduled: [] as ProjectInterviewWithProjectCandidate[],
      completed: [] as ProjectInterviewWithProjectCandidate[],
      notEligible: [] as ProjectInterviewWithProjectCandidate[],
      noShow: [] as ProjectInterviewWithProjectCandidate[],
    };
    for (const i of interviews) {
      if (i.interview_status === "no_show") {
        m.noShow.push(i);
        continue;
      }
      if (
        isStaleActiveProjectInterview(
          i,
          completedProjectCandidateIds,
          alreadyCompletedCandidateIds,
        )
      ) {
        continue;
      }
      const done = projectInterviewIsDoneForTabs(
        i,
        alreadyCompletedCandidateIds,
      );
      if (done) {
        if (i.post_interview_eligible === false) {
          m.notEligible.push(i);
        } else {
          m.completed.push(i);
        }
        continue;
      }
      const st = (i.interview_status ?? "").trim().toLowerCase();
      if (st === "cancelled") continue;
      m.scheduled.push(i);
    }
    return m;
  }, [
    interviews,
    alreadyCompletedCandidateIds,
    completedProjectCandidateIds,
  ]);

  /** Any interview row linked to this candidate (draft, scheduled, etc.). */
  const candidateIdsWithInterview = useMemo(
    () => new Set(interviews.map((i) => i.project_candidate_id)),
    [interviews],
  );

  /** Candidates currently in the interview pipeline — hide from Pending. */
  const activePipelineCandidateIds = useMemo(
    () =>
      new Set(
        interviews
          .filter(
            (i) =>
              i.interview_status === "scheduled" ||
              i.interview_status === "rescheduled" ||
              i.interview_status === "draft" ||
              i.interview_status === "no_show",
          )
          .map((i) => i.project_candidate_id),
      ),
    [interviews],
  );

  /** Candidates already completed at least one project interview — never show in Pending. */
  const completedCandidateIds = useMemo(
    () =>
      new Set([
        ...interviews
          .filter(isProjectInterviewRecordComplete)
          .map((i) => i.project_candidate_id),
        ...alreadyCompletedCandidateIds,
      ]),
    [interviews, alreadyCompletedCandidateIds],
  );

  const followupLogsByProjectCandidateId = useMemo(() => {
    const map = new Map<string, FollowupLogStatusRow[]>();
    for (const log of followupLogs) {
      const id = log.project_candidate_id?.trim();
      if (!id) continue;
      const list = map.get(id);
      if (list) list.push(log);
      else map.set(id, [log]);
    }
    return map;
  }, [followupLogs]);

  const candidateById = useMemo(
    () => new Map(candidates.map((c) => [c.id, c] as const)),
    [candidates],
  );

  const followupBadgeForProjectCandidate = useCallback(
    (
      c: Pick<
        ProjectCandidateRow,
        "id" | "followup_status" | "followup_count" | "callback_datetime"
      >,
    ) => {
      if (c.followup_status === "not_interested") {
        return followupStatusBadgeFromSnapshot({
          followup_status: "not_interested",
          followup_count: c.followup_count ?? 0,
          callback_datetime: null,
        });
      }
      const logs = followupLogsByProjectCandidateId.get(c.id) ?? [];
      const summary = getFollowUpStatus(logs);
      if (!summary) return <span className="text-muted">—</span>;
      return followupStatusBadgeFromSnapshot(summary);
    },
    [followupLogsByProjectCandidateId],
  );

  const followupBadgeForProjectCandidateId = useCallback(
    (projectCandidateId: string) => {
      const c = candidateById.get(projectCandidateId);
      if (!c) return <span className="text-muted">—</span>;
      return followupBadgeForProjectCandidate(c);
    },
    [candidateById, followupBadgeForProjectCandidate],
  );

  const pendingQueue = useMemo(() => {
    const q = filters.pending.search;
    const pocF = filters.pending.poc;
    const rows = candidates.filter((c) => {
      if (c.physical_interview_track) return false;
      if (c.followup_status === "not_interested") return false;
      if (activePipelineCandidateIds.has(c.id)) return false;
      if (completedCandidateIds.has(c.id)) return false;
      const statusNorm = (c.status ?? "pending").trim() || "pending";
      const hasInterview = candidateIdsWithInterview.has(c.id);
      const qualifiesPending =
        statusNorm === "pending" || !hasInterview;
      return (
        qualifiesPending &&
        matchesPendingSearch(c, q) &&
        pocMatchesFilter(pocF, c.poc_assigned) &&
        interviewerMatchesFilter(filters.pending.interviewer, null)
      );
    });
    return [...rows].sort(compareProjectCandidateCreatedAsc);
  }, [
    candidates,
    candidateIdsWithInterview,
    activePipelineCandidateIds,
    completedCandidateIds,
    filters.pending.search,
    filters.pending.poc,
    filters.pending.interviewer,
  ]);

  const notInterestedProjectFiltered = useMemo(
    () =>
      candidates.filter(
        (c) =>
          !c.physical_interview_track && c.followup_status === "not_interested",
      ),
    [candidates],
  );

  const scheduledFiltered = useMemo(
    () =>
      [...byStatus.scheduled.filter((i) => {
        if (!matchesInterviewSearch(i, filters.scheduled.search))
          return false;
        if (
          !pocMatchesFilter(
            filters.scheduled.poc,
            effectivePocForProjectInterview(i),
          )
        )
          return false;
        return interviewerMatchesFilter(
          filters.scheduled.interviewer,
          i.interviewer,
        );
      })].sort(compareProjectInterviewScheduledDesc),
    [
      byStatus.scheduled,
      filters.scheduled.search,
      filters.scheduled.poc,
      filters.scheduled.interviewer,
    ],
  );

  const completedFiltered = useMemo(
    () =>
      [...byStatus.completed.filter((i) => {
        if (
          !matchesPostContentStageFilter(
            i,
            completedPostContentStage,
            dispatchProjectCandidateIds,
            true,
          )
        )
          return false;
        if (!matchesInterviewSearch(i, filters.completed.search))
          return false;
        if (
          !pocMatchesFilter(
            filters.completed.poc,
            effectivePocForProjectInterview(i),
          )
        )
          return false;
        return interviewerMatchesFilter(
          filters.completed.interviewer,
          i.interviewer,
        );
      })].sort(compareProjectInterviewCompletedDesc),
    [
      byStatus.completed,
      filters.completed.search,
      filters.completed.poc,
      filters.completed.interviewer,
      completedPostContentStage,
      dispatchProjectCandidateIds,
    ],
  );

  const noShowFiltered = useMemo(
    () =>
      [...byStatus.noShow.filter((i) => {
        if (!matchesInterviewSearch(i, filters.noShow.search)) return false;
        if (
          !pocMatchesFilter(
            filters.noShow.poc,
            effectivePocForProjectInterview(i),
          )
        )
          return false;
        return interviewerMatchesFilter(
          filters.noShow.interviewer,
          i.interviewer,
        );
      })].sort((a, b) => {
        const dateA = new Date(a.no_show_at || a.scheduled_date || 0).getTime();
        const dateB = new Date(b.no_show_at || b.scheduled_date || 0).getTime();
        return dateB - dateA;
      }),
    [
      byStatus.noShow,
      filters.noShow.search,
      filters.noShow.poc,
      filters.noShow.interviewer,
    ],
  );

  const notEligibleFiltered = useMemo(
    () =>
      [...byStatus.notEligible.filter((i) => {
        if (!matchesInterviewSearch(i, filters.notEligible.search))
          return false;
        if (
          !pocMatchesFilter(
            filters.notEligible.poc,
            effectivePocForProjectInterview(i),
          )
        )
          return false;
        return interviewerMatchesFilter(
          filters.notEligible.interviewer,
          i.interviewer,
        );
      })].sort(compareProjectInterviewCompletedDesc),
    [
      byStatus.notEligible,
      filters.notEligible.search,
      filters.notEligible.poc,
      filters.notEligible.interviewer,
    ],
  );

  const physicalInterviewTrackFiltered = useMemo(
    () => candidates.filter((c) => Boolean(c.physical_interview_track)),
    [candidates],
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
  const physicalInterviewPage = useMemo(
    () => paginate(physicalInterviewTrackFiltered, physicalInterviewListPage),
    [physicalInterviewTrackFiltered, physicalInterviewListPage],
  );
  const scheduledPage = useMemo(
    () => paginate(scheduledFiltered, filters.scheduled.page),
    [scheduledFiltered, filters.scheduled.page],
  );
  const completedPage = useMemo(
    () => paginate(completedFiltered, filters.completed.page),
    [completedFiltered, filters.completed.page],
  );
  const noShowPage = useMemo(
    () => paginate(noShowFiltered, filters.noShow.page),
    [noShowFiltered, filters.noShow.page],
  );
  const notEligiblePage = useMemo(
    () => paginate(notEligibleFiltered, filters.notEligible.page),
    [notEligibleFiltered, filters.notEligible.page],
  );

  const pocFilterNames = useMemo(() => {
    const set = new Set<string>(pocRoster);
    for (const c of candidates) {
      const p = c.poc_assigned?.trim();
      if (p) set.add(p);
    }
    for (const i of interviews) {
      const p = effectivePocForProjectInterview(i);
      if (p) set.add(p);
    }
    return [...set].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [pocRoster, candidates, interviews]);

  const interviewerFilterOptions = useMemo(() => {
    const set = new Set<string>();
    for (const o of interviewerRoster) {
      if (o.value.trim()) set.add(o.value);
    }
    for (const i of interviews) {
      const v = i.interviewer?.trim();
      if (v) set.add(v);
    }
    return [...set].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [interviewerRoster, interviews]);

  const patchFilter = (tab: ProjectSubTab, patch: Partial<TabFilters>) => {
    setFilters((prev) => ({
      ...prev,
      [tab]: {
        ...prev[tab],
        ...patch,
        ...(patch.search !== undefined ||
        patch.poc !== undefined ||
        patch.interviewer !== undefined
          ? { page: 0 }
          : {}),
      },
    }));
  };

  const setPage = (tab: ProjectSubTab, page: number) => {
    setFilters((prev) => ({ ...prev, [tab]: { ...prev[tab], page } }));
  };

  const handleRevertNoShowToScheduled = async (
    i: ProjectInterviewWithProjectCandidate,
  ) => {
    if (!i.scheduled_date?.trim()) {
      onError("Cannot revert — this interview has no scheduled date/time.");
      return;
    }
    const pc = i.project_candidates;
    const display = pc ? projectDisplayName(pc) : "Candidate";
    const when = formatDateTime(i.scheduled_date);
    const confirmed = window.confirm(
      `Revert ${display} back to Scheduled?\n\nOriginal slot: ${when}`,
    );
    if (!confirmed) return;

    setNoShowRevertBusyId(i.id);
    const patch = buildNoShowRevertPatch(i);
    const { error: upErr } = await supabase
      .from("project_interviews")
      .update(patch)
      .eq("id", i.id);

    if (upErr) {
      setNoShowRevertBusyId(null);
      onError(upErr.message);
      return;
    }

    const auth = await getUserSafe(supabase);
    if (auth) {
      await logActivity({
        supabase,
        user: auth,
        action_type: "interviews",
        entity_type: "project_interview",
        entity_id: i.id,
        candidate_name: display,
        description: `Reverted no show to scheduled for ${display} (${when})`,
      });
    }

    setNoShowRevertBusyId(null);
    onToast?.(`${display} moved back to Scheduled.`);
    setSubTab("scheduled");
    void loadProjectData();
    onPipelineChanged();
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

  const handleMarkProjectNotInterestedActive = async (pc: ProjectCandidateRow) => {
    if (!canEditScheduledTab) return;
    setRestoringNotInterestedId(pc.id);
    const { error: uErr } = await supabase
      .from("project_candidates")
      .update({
        followup_status: "pending",
        followup_count: 0,
        callback_datetime: null,
        not_interested_reason: null,
        not_interested_at: null,
      })
      .eq("id", pc.id)
      .eq("is_deleted", false);
    setRestoringNotInterestedId(null);
    if (uErr) {
      onError(uErr.message);
      return;
    }
    const display = projectDisplayName(pc);
    const authUser = await getUserSafe(supabase);
    if (authUser) {
      await logActivity({
        supabase,
        user: authUser,
        action_type: "eligibility",
        entity_type: "project_candidate",
        entity_id: pc.id,
        candidate_name: display === "—" ? pc.email : display,
        description: `Marked ${display === "—" ? pc.email : display} active again (follow-up pipeline)`,
        metadata: { followup: true, project: true },
      });
    }
    void loadProjectData();
    onPipelineChanged();
  };

  const moveProjectCandidateToPhysicalInterviewTrack = async (
    pc: ProjectCandidateRow,
    city: PhysicalInterviewCity,
  ) => {
    if (!canEditScheduledTab) return;
    setPhysicalInterviewBusyId(pc.id);
    const { error: uErr } = await supabase
      .from("project_candidates")
      .update({
        physical_interview_track: true,
        physical_interview_status: "pending",
        physical_interview_city: city,
      })
      .eq("id", pc.id)
      .eq("is_deleted", false);
    setPhysicalInterviewBusyId(null);
    if (uErr) {
      onError(uErr.message);
      return;
    }
    onError(null);
    const actor = await getUserSafe(supabase);
    const display = projectDisplayName(pc);
    const label = display === "—" ? pc.email : display;
    if (actor) {
      await logActivity({
        supabase,
        user: actor,
        action_type: "interviews",
        entity_type: "project_candidate",
        entity_id: pc.id,
        candidate_name: label,
        description: `Moved ${label} to physical interview track in ${city} (pending)`,
      });
    }
    setPhysicalInterviewCityFor(null);
    await loadProjectData();
    onPipelineChanged();
  };

  const setProjectPhysicalInterviewStatus = async (
    pc: ProjectCandidateRow,
    next: PhysicalInterviewStatus,
    logDescription: string,
  ) => {
    if (!canEditScheduledTab) return;
    setPhysicalInterviewBusyId(pc.id);
    const { error: uErr } = await supabase
      .from("project_candidates")
      .update({ physical_interview_status: next })
      .eq("id", pc.id)
      .eq("is_deleted", false);
    setPhysicalInterviewBusyId(null);
    if (uErr) {
      onError(uErr.message);
      return;
    }
    onError(null);
    const actor = await getUserSafe(supabase);
    const display = projectDisplayName(pc);
    const label = display === "—" ? pc.email : display;
    if (actor) {
      await logActivity({
        supabase,
        user: actor,
        action_type: "interviews",
        entity_type: "project_candidate",
        entity_id: pc.id,
        candidate_name: label,
        description: logDescription,
      });
    }
    await loadProjectData();
    onPipelineChanged();
  };

  const revokeProjectPhysicalInterviewTrack = async (pc: ProjectCandidateRow) => {
    if (!canEditScheduledTab) return;
    const confirmed = window.confirm(
      "Revoke physical interview track for this candidate?\n\nThey will move back to the meeting interview scheduling queue.",
    );
    if (!confirmed) return;
    setPhysicalInterviewBusyId(pc.id);
    const { error: uErr } = await supabase
      .from("project_candidates")
      .update({
        physical_interview_track: false,
        physical_interview_status: "pending",
        physical_interview_city: null,
      })
      .eq("id", pc.id)
      .eq("is_deleted", false);
    setPhysicalInterviewBusyId(null);
    if (uErr) {
      onError(uErr.message);
      return;
    }
    onError(null);
    const actor = await getUserSafe(supabase);
    const display = projectDisplayName(pc);
    const label = display === "—" ? pc.email : display;
    if (actor) {
      await logActivity({
        supabase,
        user: actor,
        action_type: "interviews",
        entity_type: "project_candidate",
        entity_id: pc.id,
        candidate_name: label,
        description: `Physical interview track: revoked ${label} back to interview queue`,
      });
    }
    await loadProjectData();
    onPipelineChanged();
  };

  const markProjectPhysicalInterviewEligibleWithDispatch = async (
    pc: ProjectCandidateRow,
  ) => {
    if (!canEditScheduledTab) return;
    if (pc.physical_interview_status === "eligible") return;
    setPhysicalInterviewBusyId(pc.id);
    const prevStatus: PhysicalInterviewStatus =
      pc.physical_interview_status ?? "pending";
    const { error: uErr } = await supabase
      .from("project_candidates")
      .update({ physical_interview_status: "eligible" })
      .eq("id", pc.id)
      .eq("is_deleted", false);
    if (uErr) {
      setPhysicalInterviewBusyId(null);
      onError(uErr.message);
      return;
    }
    const { error: dErr } = await supabase.from("project_dispatch").insert({
      project_candidate_id: pc.id,
      shipping_address: null,
      dispatch_status: "pending",
      reward_item: PHYSICAL_INTERVIEW_REWARD_ITEM,
      special_comments: PHYSICAL_INTERVIEW_DISPATCH_COMMENT,
    });
    if (dErr) {
      await supabase
        .from("project_candidates")
        .update({ physical_interview_status: prevStatus })
        .eq("id", pc.id)
        .eq("is_deleted", false);
      setPhysicalInterviewBusyId(null);
      onError(dErr.message);
      return;
    }
    onError(null);
    const actor = await getUserSafe(supabase);
    const display = projectDisplayName(pc);
    const label = display === "—" ? pc.email : display;
    if (actor) {
      await logActivity({
        supabase,
        user: actor,
        action_type: "interviews",
        entity_type: "project_candidate",
        entity_id: pc.id,
        candidate_name: label,
        description: `Physical interview track: marked ${label} eligible — ${PHYSICAL_INTERVIEW_REWARD_ITEM} dispatch created`,
      });
    }
    setPhysicalInterviewBusyId(null);
    await loadProjectData();
    onPipelineChanged();
    onToast?.("Dispatch created for physical interview reward");
  };

  const handlePocChange = async (pc: ProjectCandidateRow, value: string) => {
    const name = value.trim() || null;
    setPocSavingId(pc.id);
    const { error: uErr } = await supabase
      .from("project_candidates")
      .update({
        poc_assigned: name,
        poc_assigned_at: name ? new Date().toISOString() : null,
        assigned_at: name ? new Date().toISOString() : null,
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
        phones_updated?: number;
        errors?: string[];
      };
      if (!res.ok) {
        onError(j.error ?? "Project sheet sync failed.");
        return;
      }
      const up = j.upserted ?? 0;
      const total = j.total_rows ?? 0;
      const phones = j.phones_updated ?? 0;
      alert(
        `✅ Synced project sheet — ${up} upserted (${total} rows)${phones > 0 ? `, ${phones} phone numbers updated` : ""}`,
      );
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
    "overflow-hidden rounded-2xl border border-border-subtle bg-elevated shadow-sm";
  const thBase =
    "border-b border-border bg-background/80 py-3 px-4 text-xs font-semibold tracking-wider text-muted";
  const tdBase =
    "border-b border-border py-4 px-4 text-sm align-middle text-foreground";
  const thName = `${thBase} min-w-[160px] text-left`;
  const tdName = `${tdBase} min-w-[160px] text-left`;
  const thEmail = `${thBase} min-w-[220px] text-left`;
  const tdEmail = `${tdBase} min-w-[220px] text-left text-muted`;
  const thProjTitle = `${thBase} min-w-[180px] text-left`;
  const tdProjTitle = `${tdBase} min-w-[180px] text-left text-muted`;
  const thTrack = `${thBase} min-w-[130px] text-left`;
  const tdTrack = `${tdBase} min-w-[130px] text-left align-top`;
  const thPhysicalInterviewStatus = `${thBase} min-w-[160px] text-left`;
  const tdPhysicalInterviewStatus = `${tdBase} min-w-[160px] text-left align-top`;
  const thCity = `${thBase} min-w-[100px] text-left`;
  const tdCity = `${tdBase} min-w-[100px] text-left text-muted`;
  const thPoc = `${thBase} min-w-[160px] text-left`;
  const thAssignedOn = `${thBase} min-w-[140px] text-left`;
  const tdPoc = `${tdBase} min-w-[160px] text-left`;
  const tdAssignedOn = `${tdBase} min-w-[140px] text-left text-muted`;
  const thFollowUp = `${thBase} min-w-[150px] text-left`;
  const tdFollowUp = `${tdBase} min-w-[150px] text-left`;
  const thActions = `${thBase} min-w-[120px] text-right`;
  const tdActions = `${tdBase} relative min-w-[120px] text-right`;
  const thDateTime = `${thBase} min-w-[170px] text-left`;
  const tdDateTime = `${tdBase} min-w-[170px] text-left`;
  const thInterviewer = `${thBase} min-w-[120px] text-left`;
  const tdInterviewer = `${tdBase} min-w-[120px] text-left`;
  const thReason = `${thBase} min-w-[180px] text-left`;
  const tdReason = `${tdBase} min-w-[180px] text-left text-muted`;
  const thDateOnly = `${thBase} min-w-[120px] text-left`;
  const tdDateOnly = `${tdBase} min-w-[120px] text-left text-muted`;
  const thZoomStatus = `${thBase} min-w-[150px] text-left`;
  const tdZoomStatus = `${tdBase} min-w-[150px] text-left align-top`;
  const thCompletedOn = `${thBase} min-w-[170px] text-left`;
  const tdCompletedOn = `${tdBase} min-w-[170px] text-left`;
  const thPostInterview = `${thBase} min-w-[160px] text-left`;
  const tdPostInterview = `${tdBase} min-w-[160px] text-left`;
  const thPostProdGate = `${thBase} min-w-[120px] text-left`;
  const tdPostProdGate = `${tdBase} min-w-[120px] text-left align-top`;
  const thFunnelCol = `${thBase} min-w-[120px] text-left`;
  const tdFunnelCol = `${tdBase} min-w-[120px] text-left text-muted`;
  const thCommentsCol = `${thBase} min-w-[160px] text-left`;
  const tdCommentsCol = `${tdBase} min-w-[160px] text-left text-muted`;
  const filterInp =
    "w-full rounded-xl border border-border bg-elevated px-3 py-2 text-sm text-foreground focus:border-[#3b82f6] focus:outline-none focus:ring-0";
  const nameLinkBtn =
    "max-w-full min-w-0 truncate text-left font-medium text-[#3b82f6] hover:underline focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/25 rounded-sm";

  const emptyState = (
    <div className="py-16 text-center text-sm text-muted/80">
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
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle bg-background/80 px-4 py-3 text-xs text-muted">
        <span>
          Showing {page * PAGE_SIZE + 1}–
          {Math.min((page + 1) * PAGE_SIZE, total)} of {total}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 0}
            className="rounded-lg border border-border bg-elevated px-3 py-1.5 font-medium text-foreground transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => setPage(tab, page - 1)}
          >
            Previous
          </button>
          <button
            type="button"
            disabled={page >= totalPages - 1}
            className="rounded-lg border border-border bg-elevated px-3 py-1.5 font-medium text-foreground transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-40"
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
      <p className="text-sm text-muted">Loading project interviews…</p>
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2 border-b border-border pb-1 sm:border-0 sm:pb-0">
          {(
            [
              ["pending", "Pending", pendingQueue.length],
              ["scheduled", "Scheduled", scheduledFiltered.length],
              ["completed", "Completed", completedFiltered.length],
              ["noShow", "No show", noShowFiltered.length],
              ["notEligible", "Not eligible", notEligibleFiltered.length],
            ] as const
          ).map(([id, label, n]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSubTab(id)}
              className={
                subTab === id
                  ? "rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background"
                  : "rounded-full px-4 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground"
              }
            >
              {label}{" "}
              <span className={subTab === id ? "text-background/80" : ""}>({n})</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={sheetSyncBusy}
          onClick={() => void syncProjectSheet()}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-border bg-elevated px-4 py-2 text-sm font-medium text-foreground transition-all hover:bg-background disabled:opacity-50"
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
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <label className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-md">
              <span className="text-xs uppercase tracking-widest text-muted/80">
                Search
              </span>
              <input
                type="search"
                placeholder="Name, email, or title"
                className={filterInp}
                value={filters.pending.search}
                onChange={(e) =>
                  patchFilter("pending", { search: e.target.value })
                }
              />
            </label>
            <label className="flex w-full flex-col gap-1 sm:w-48 sm:shrink-0">
              <span className="text-xs uppercase tracking-widest text-muted/80">
                POC
              </span>
              <select
                className={filterInp}
                value={filters.pending.poc}
                onChange={(e) =>
                  patchFilter("pending", { poc: e.target.value })
                }
              >
                <option value="all">All</option>
                <option value={POC_FILTER_UNASSIGNED}>Unassigned</option>
                {pocFilterNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex w-full flex-col gap-1 sm:w-48 sm:shrink-0">
              <span className="text-xs uppercase tracking-widest text-muted/80">
                Interviewer
              </span>
              <select
                className={filterInp}
                value={filters.pending.interviewer}
                onChange={(e) =>
                  patchFilter("pending", { interviewer: e.target.value })
                }
              >
                <option value="all">All</option>
                <option value={INTERVIEWER_FILTER_UNASSIGNED}>
                  Unassigned
                </option>
                {interviewerFilterOptions.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className={tableWrap}>
            <div className="w-full overflow-x-auto">
              <table className="w-full min-w-[1160px] table-auto border-collapse">
                <thead>
                  <tr>
                    <th className={thName}>Name</th>
                    <th className={thEmail}>Email</th>
                    <th className={thProjTitle}>Project title</th>
                    <th className={thTrack}>Track</th>
                    <th className={thPoc}>POC assigned</th>
                    <th className={thAssignedOn}>Assigned On</th>
                    <th className={thFollowUp}>Follow-up</th>
                    <th className={thActions}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingPage.slice.length === 0 ? (
                    <tr>
                      <td className={tdBase} colSpan={8}>
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
                            <div className="flex min-w-0 flex-col items-start">
                              <button
                                type="button"
                                className={nameLinkBtn}
                                onClick={() => setDetail(c)}
                              >
                                {projectDisplayName(c)}
                              </button>
                              {alreadyCompletedFollowupBadge(c.followup_status)}
                            </div>
                          </td>
                          <td className={tdEmail}>
                            {c.email?.trim() || "—"}
                          </td>
                          <td className={tdProjTitle}>
                            {c.project_title?.trim() || "—"}
                          </td>
                          <td className={tdTrack}>
                            <button
                              type="button"
                              disabled={
                                !canEditScheduledTab ||
                                physicalInterviewBusyId === c.id
                              }
                              className="w-fit text-left text-xs font-medium text-[#7c3aed] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                              onClick={() => setPhysicalInterviewCityFor(c)}
                            >
                              → Physical interview
                            </button>
                          </td>
                          <td className={tdPoc}>
                            {showPocDropdown ? (
                              <div className="flex flex-wrap items-center gap-2">
                                <select
                                  disabled={pocSavingId === c.id}
                                  className="max-w-[180px] rounded-lg border border-border bg-elevated px-2 py-1.5 text-xs text-foreground focus:border-[#3b82f6] focus:outline-none disabled:opacity-50"
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
                                    className="text-xs font-medium text-muted underline decoration-[#d1d5db] underline-offset-2 hover:text-foreground"
                                    onClick={() => setPocEditingId(null)}
                                  >
                                    Cancel
                                  </button>
                                ) : null}
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <span className="inline-flex rounded-full bg-background px-2.5 py-1 text-xs font-medium text-muted">
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
                          <td className={tdAssignedOn}>
                            {formatAssignedOnIst(
                              c.assigned_at ?? c.poc_assigned_at ?? null,
                            )}
                          </td>
                          <td className={tdFollowUp}>
                            {followupBadgeForProjectCandidate(c)}
                          </td>
                          <td className={tdActions}>
                            <div className="flex flex-wrap justify-end gap-2">
                              <button
                                type="button"
                                disabled={
                                  !canEditScheduledTab ||
                                  deleteBusyId === c.id ||
                                  pocSavingId === c.id
                                }
                                title={
                                  !canEditScheduledTab
                                    ? "View only"
                                    : undefined
                                }
                                className="rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-background/80 disabled:cursor-not-allowed disabled:opacity-50"
                                onClick={() =>
                                  canEditScheduledTab
                                    ? setLogFollowupFor(
                                        projectCandidateForLogModal(c),
                                      )
                                    : undefined
                                }
                              >
                                Log Call
                              </button>
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
                                className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 disabled:text-muted"
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

          {notInterestedProjectFiltered.length > 0 ? (
            <div className="mt-8 space-y-2">
              <button
                type="button"
                onClick={() => setNotInterestedOpen((o) => !o)}
                className="flex w-full items-center justify-between rounded-xl border border-border-subtle bg-background/80 px-4 py-3 text-left text-sm font-semibold text-foreground transition-colors hover:bg-background"
              >
                <span>
                  Not Interested ({notInterestedProjectFiltered.length})
                </span>
                <span className="text-muted">
                  {notInterestedOpen ? "▼" : "▶"}
                </span>
              </button>
              {notInterestedOpen ? (
                <div className={tableWrap}>
                  <div className="w-full min-w-0 max-w-full overflow-x-auto">
                    <table className="w-full min-w-[900px] table-auto border-collapse">
                      <thead>
                        <tr>
                          <th className={thName}>Name</th>
                          <th className={thProjTitle}>Project title</th>
                          <th className={thReason}>Reason</th>
                          <th className={thDateOnly}>Date</th>
                          <th className={thActions}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {notInterestedProjectFiltered.map((c) => {
                          const label = projectDisplayName(c);
                          return (
                            <tr key={c.id}>
                              <td className={tdName}>{label}</td>
                              <td className={tdProjTitle}>
                                {c.project_title?.trim() || "—"}
                              </td>
                              <td className={tdReason}>
                                {c.not_interested_reason?.trim() || "—"}
                              </td>
                              <td className={tdDateOnly}>
                                {c.not_interested_at
                                  ? formatDateOnly(c.not_interested_at)
                                  : "—"}
                              </td>
                              <td className={tdActions}>
                                <button
                                  type="button"
                                  disabled={
                                    !canEditScheduledTab ||
                                    restoringNotInterestedId === c.id
                                  }
                                  className="rounded-lg border border-foreground bg-elevated px-3 py-1.5 text-xs font-medium text-foreground hover:bg-background/80 disabled:cursor-not-allowed disabled:opacity-50"
                                  onClick={() =>
                                    void handleMarkProjectNotInterestedActive(c)
                                  }
                                >
                                  {restoringNotInterestedId === c.id
                                    ? "Saving…"
                                    : "Mark as Active"}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {physicalInterviewTrackFiltered.length > 0 ? (
            <div className="space-y-3">
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  Physical interview track
                </h2>
                <p className="mt-1 text-xs text-muted">
                  These candidates are no longer in the meeting scheduling queue.
                  Conduct the in-person interview, then mark completion and
                  reward eligibility below.
                </p>
              </div>
              <div className={tableWrap}>
                <div className="w-full overflow-x-auto">
                  <table className="w-full min-w-[980px] table-auto border-collapse">
                    <thead>
                      <tr>
                        <th className={thName}>Name</th>
                        <th className={thEmail}>Email</th>
                        <th className={thProjTitle}>Project title</th>
                        <th className={thTrack}>Track</th>
                        <th className={thCity}>City</th>
                        <th className={thPhysicalInterviewStatus}>
                          Interview status
                        </th>
                        <th className={thActions}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {physicalInterviewPage.slice.map((c) => {
                        const st = c.physical_interview_status ?? "pending";
                        const display = projectDisplayName(c);
                        const label = display === "—" ? c.email : display;
                        const busy = physicalInterviewBusyId === c.id;
                        return (
                          <tr key={c.id}>
                            <td className={tdName}>
                              <button
                                type="button"
                                className={nameLinkBtn}
                                onClick={() => setDetail(c)}
                              >
                                {display}
                              </button>
                            </td>
                            <td className={tdEmail}>{c.email}</td>
                            <td className={tdProjTitle}>
                              {c.project_title?.trim() || "—"}
                            </td>
                            <td className={tdTrack}>
                              {physicalInterviewTrackColumnBadge(
                                c.physical_interview_city,
                              )}
                            </td>
                            <td className={tdCity}>
                              {c.physical_interview_city?.trim() || "—"}
                            </td>
                            <td className={tdPhysicalInterviewStatus}>
                              {physicalInterviewPipelineBadge(st)}
                            </td>
                            <td className={tdActions}>
                              <div className="flex flex-wrap items-center justify-end gap-1.5">
                                {st === "pending" ? (
                                  <button
                                    type="button"
                                    disabled={busy || !canEditScheduledTab}
                                    className="rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-background disabled:opacity-50"
                                    onClick={() =>
                                      void setProjectPhysicalInterviewStatus(
                                        c,
                                        "completed",
                                        `Physical interview track: marked ${label} interview completed`,
                                      )
                                    }
                                  >
                                    Mark interview completed
                                  </button>
                                ) : null}
                                {st === "completed" ? (
                                  <>
                                    <button
                                      type="button"
                                      disabled={busy || !canEditScheduledTab}
                                      className="rounded-lg bg-[#16a34a] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#15803d] disabled:opacity-50"
                                      onClick={() =>
                                        void markProjectPhysicalInterviewEligibleWithDispatch(
                                          c,
                                        )
                                      }
                                    >
                                      Mark eligible & dispatch
                                    </button>
                                    <button
                                      type="button"
                                      disabled={busy || !canEditScheduledTab}
                                      className="rounded-lg bg-[#dc2626] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#b91c1c] disabled:opacity-50"
                                      onClick={() =>
                                        void setProjectPhysicalInterviewStatus(
                                          c,
                                          "not_eligible",
                                          `Physical interview track: marked ${label} not eligible`,
                                        )
                                      }
                                    >
                                      Mark not eligible
                                    </button>
                                  </>
                                ) : null}
                                {st === "eligible" || st === "not_eligible" ? (
                                  <span className="text-xs text-muted/80">
                                    —
                                  </span>
                                ) : null}
                                <button
                                  type="button"
                                  disabled={busy || !canEditScheduledTab}
                                  className="rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-xs font-medium text-muted hover:bg-background disabled:opacity-50"
                                  onClick={() =>
                                    void revokeProjectPhysicalInterviewTrack(c)
                                  }
                                >
                                  Revoke
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {physicalInterviewPage.total > 0 ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle bg-background/60 px-4 py-3 text-xs text-muted">
                    <span>
                      Showing {physicalInterviewListPage * PAGE_SIZE + 1}–
                      {Math.min(
                        (physicalInterviewListPage + 1) * PAGE_SIZE,
                        physicalInterviewPage.total,
                      )}{" "}
                      of {physicalInterviewPage.total}
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={physicalInterviewListPage <= 0}
                        className="rounded-lg border border-border bg-elevated px-3 py-1.5 font-medium text-foreground transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() =>
                          setPhysicalInterviewListPage((p) =>
                            Math.max(0, p - 1),
                          )
                        }
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        disabled={
                          physicalInterviewListPage >=
                          physicalInterviewPage.totalPages - 1
                        }
                        className="rounded-lg border border-border bg-elevated px-3 py-1.5 font-medium text-foreground transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() =>
                          setPhysicalInterviewListPage((p) => p + 1)
                        }
                      >
                        Next
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>
      )}

      {subTab === "scheduled" && (
        <section className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <label className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-md">
              <span className="text-xs uppercase tracking-widest text-muted/80">
                Search
              </span>
              <input
                type="search"
                placeholder="Name, email, or title"
                className={filterInp}
                value={filters.scheduled.search}
                onChange={(e) =>
                  patchFilter("scheduled", { search: e.target.value })
                }
              />
            </label>
            <label className="flex w-full flex-col gap-1 sm:w-48 sm:shrink-0">
              <span className="text-xs uppercase tracking-widest text-muted/80">
                POC
              </span>
              <select
                className={filterInp}
                value={filters.scheduled.poc}
                onChange={(e) =>
                  patchFilter("scheduled", { poc: e.target.value })
                }
              >
                <option value="all">All</option>
                <option value={POC_FILTER_UNASSIGNED}>Unassigned</option>
                {pocFilterNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex w-full flex-col gap-1 sm:w-48 sm:shrink-0">
              <span className="text-xs uppercase tracking-widest text-muted/80">
                Interviewer
              </span>
              <select
                className={filterInp}
                value={filters.scheduled.interviewer}
                onChange={(e) =>
                  patchFilter("scheduled", { interviewer: e.target.value })
                }
              >
                <option value="all">All</option>
                <option value={INTERVIEWER_FILTER_UNASSIGNED}>
                  Unassigned
                </option>
                {interviewerFilterOptions.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className={tableWrap}>
            <div className="w-full overflow-x-auto">
              <table className="w-full min-w-[1280px] table-auto border-collapse">
                <thead>
                  <tr>
                    <th className={thName}>Name</th>
                    <th className={thEmail}>Email</th>
                    <th className={thProjTitle}>Project title</th>
                    <th className={thDateTime}>Date &amp; time</th>
                    <th className={thInterviewer}>Interviewer</th>
                    <th className={thZoomStatus}>Meeting status</th>
                    <th className={thPoc}>POC</th>
                    <th className={thCommentsCol}>Remarks</th>
                    <th className={thFollowUp}>Follow-up</th>
                    <th className={thActions}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {scheduledPage.slice.length === 0 ? (
                    <tr>
                      <td className={tdBase} colSpan={10}>
                        {emptyState}
                      </td>
                    </tr>
                  ) : (
                    scheduledPage.slice.map((i) => {
                      const pc = i.project_candidates;
                      if (!pc) return null;
                      const isDraftRow = i.interview_status === "draft";
                      const isScheduledRow = i.interview_status === "scheduled";
                      const followupAlreadyDone =
                        pc.followup_status === "already_completed";
                      const hasIv = hasAssignedProjectInterviewer(i);
                      const hasZoom = Boolean(i.zoom_link?.trim());
                      const awaitingIv = isDraftRow && !hasIv;
                      const awaitingZoom =
                        !hasZoom &&
                        ((isDraftRow && hasIv) || isScheduledRow);
                      const zoomAdded = hasZoom;
                      const zoomLink = i.zoom_link?.trim() ?? "";
                      const canEditZoom = canEditScheduledTab && !awaitingIv;
                      const canTakeInterviewActions =
                        followupAlreadyDone || (hasIv && hasZoom);
                      const blockedActionTitle = !canEditScheduledTab
                        ? "View only"
                        : !hasIv
                          ? "Assign interviewer first"
                          : !hasZoom
                            ? "Add meeting details first"
                            : undefined;
                      return (
                        <tr key={i.id}>
                          <td className={tdName}>
                            <div className="flex min-w-0 flex-col items-start">
                              <button
                                type="button"
                                className={nameLinkBtn}
                                onClick={() => setDetail(pc)}
                              >
                                {projectDisplayName(pc)}
                              </button>
                              {alreadyCompletedFollowupBadge(pc.followup_status)}
                            </div>
                          </td>
                          <td className={tdEmail}>{pc.email?.trim() || "—"}</td>
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
                            {formatInterviewerStoredForUi(i.interviewer)}
                          </td>
                          <td className={tdZoomStatus}>
                            <div className="flex flex-col items-start gap-2">
                              {followupAlreadyDone ? (
                                <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-800">
                                  Already completed
                                </span>
                              ) : awaitingIv ? (
                                <span className="inline-flex rounded-full bg-border/50 px-2.5 py-1 text-xs font-medium text-muted">
                                  Awaiting Interviewer
                                </span>
                              ) : awaitingZoom ? (
                                <span className="inline-flex rounded-full bg-[#fff7ed] px-2.5 py-1 text-xs font-medium text-[#c2410c]">
                                  Awaiting meeting
                                </span>
                              ) : zoomAdded ? (
                                <span className="inline-flex rounded-full bg-[#f0fdf4] px-2.5 py-1 text-xs font-medium text-[#15803d]">
                                  Meeting added
                                </span>
                              ) : (
                                <span className="text-muted">—</span>
                              )}
                              {zoomAdded && i.zoom_account?.trim() ? (
                                <p className="text-xs text-muted">
                                  Account: {i.zoom_account.trim()}
                                </p>
                              ) : null}
                              <div className="flex flex-wrap items-center gap-2">
                                {zoomLink ? (
                                  <a
                                    href={zoomLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex rounded-lg border border-border bg-elevated px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-background"
                                  >
                                    Join
                                  </a>
                                ) : (
                                  <button
                                    type="button"
                                    disabled
                                    className="inline-flex cursor-not-allowed rounded-lg border border-border bg-[#f9fafb] px-2.5 py-1 text-xs font-medium text-muted"
                                  >
                                    Join
                                  </button>
                                )}
                                <button
                                  type="button"
                                  disabled={!canEditZoom}
                                  title={
                                    !canEditScheduledTab
                                      ? "View only"
                                      : awaitingIv
                                        ? "Assign interviewer first"
                                        : undefined
                                  }
                                  className="rounded-lg border border-foreground bg-elevated px-2.5 py-1 text-xs font-medium text-foreground hover:bg-background/80 disabled:cursor-not-allowed disabled:border-border disabled:text-muted"
                                  onClick={() =>
                                    canEditZoom ? setAddZoomFor(i) : undefined
                                  }
                                >
                                  {hasZoom ? "Edit" : "Add meeting details"}
                                </button>
                              </div>
                            </div>
                          </td>
                          <td className={tdPoc}>
                            {i.poc?.trim() ||
                              pc.poc_assigned?.trim() ||
                              "—"}
                          </td>
                          <td className={tdCommentsCol}>
                            <CommentTableCell value={i.remarks} />
                          </td>
                          <td className={tdFollowUp}>
                            {followupBadgeForProjectCandidateId(i.project_candidate_id)}
                          </td>
                          <td className={tdActions}>
                            <ScheduledInterviewRowActions
                              canEdit={canEditScheduledTab}
                              showAssignInterviewer={
                                !hasIv &&
                                (isDraftRow ||
                                  Boolean(i.previous_scheduled_date?.trim()))
                              }
                              canRevert={
                                canTakeInterviewActions &&
                                revertBusyId !== i.id
                              }
                              revertBusy={revertBusyId === i.id}
                              canReschedule={canTakeInterviewActions}
                              canNoShow={canTakeInterviewActions}
                              canMarkCompleted={canTakeInterviewActions}
                              blockedTitle={blockedActionTitle}
                              revertTitle={
                                blockedActionTitle ??
                                "Send back to callings (same POC)"
                              }
                              onEdit={() => setEditInterviewFor(i)}
                              onAssignInterviewer={() =>
                                setAssignInterviewerFor(i)
                              }
                              onRevert={() =>
                                void handleRevertProjectInterview(i)
                              }
                              onReschedule={() =>
                                onRescheduleProjectInterview(
                                  i,
                                  i.previous_scheduled_date?.trim()
                                    ? "from_rescheduled"
                                    : "from_scheduled",
                                )
                              }
                              onNoShow={() => setNoShowFor(i)}
                              onMarkCompleted={() =>
                                onPostProjectInterview(i)
                              }
                            />
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

      {subTab === "completed" && (
        <section className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <label className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-md">
              <span className="text-xs uppercase tracking-widest text-muted/80">
                Search
              </span>
              <input
                type="search"
                placeholder="Name, email, or title"
                className={filterInp}
                value={filters.completed.search}
                onChange={(e) =>
                  patchFilter("completed", { search: e.target.value })
                }
              />
            </label>
            <label className="flex w-full flex-col gap-1 sm:w-48 sm:shrink-0">
              <span className="text-xs uppercase tracking-widest text-muted/80">
                POC
              </span>
              <select
                className={filterInp}
                value={filters.completed.poc}
                onChange={(e) =>
                  patchFilter("completed", { poc: e.target.value })
                }
              >
                <option value="all">All</option>
                <option value={POC_FILTER_UNASSIGNED}>Unassigned</option>
                {pocFilterNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex w-full flex-col gap-1 sm:w-48 sm:shrink-0">
              <span className="text-xs uppercase tracking-widest text-muted/80">
                Interviewer
              </span>
              <select
                className={filterInp}
                value={filters.completed.interviewer}
                onChange={(e) =>
                  patchFilter("completed", { interviewer: e.target.value })
                }
              >
                <option value="all">All</option>
                <option value={INTERVIEWER_FILTER_UNASSIGNED}>
                  Unassigned
                </option>
                {interviewerFilterOptions.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex w-full flex-col gap-1 sm:w-52 sm:shrink-0">
              <span className="text-xs uppercase tracking-widest text-muted/80">
                Content stage
              </span>
              <select
                className={filterInp}
                value={completedPostContentStage}
                onChange={(e) => {
                  setCompletedPostContentStage(
                    e.target.value as PostContentStageFilter,
                  );
                  patchFilter("completed", { page: 0 });
                }}
              >
                {POST_CONTENT_STAGE_FILTER_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className={tableWrap}>
            <div className="w-full overflow-x-auto">
              <table className="w-full min-w-[1320px] table-auto border-collapse">
                <thead>
                  <tr>
                    <th className={thName}>Name</th>
                    <th className={thEmail}>Email</th>
                    <th className={thProjTitle}>Project title</th>
                    <th className={thInterviewer}>Interviewer</th>
                    <th className={thCompletedOn}>Completed on</th>
                    <th className={thPostInterview}>
                      Post-interview eligible
                    </th>
                    <th className={thPostInterview}>Content stage</th>
                    <th
                      className={thPostProdGate}
                      title={POST_PRODUCTION_ELIGIBILITY_TOOLTIP}
                    >
                      Post production
                    </th>
                    <th className={thFunnelCol}>Funnel</th>
                    <th className={thCommentsCol}>Comments</th>
                    <th className={thFollowUp}>Follow-up</th>
                    <th className={thActions}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {completedPage.slice.length === 0 ? (
                    <tr>
                      <td className={tdBase} colSpan={11}>
                        {emptyState}
                      </td>
                    </tr>
                  ) : (
                    completedPage.slice.map((i) => {
                      const pc = i.project_candidates;
                      if (!pc) return null;
                      return (
                        <tr key={i.id}>
                          <td className={tdName}>
                            <div className="flex min-w-0 flex-col items-start">
                              <button
                                type="button"
                                className={nameLinkBtn}
                                onClick={() => setDetail(pc)}
                              >
                                {projectDisplayName(pc)}
                              </button>
                              {alreadyCompletedFollowupBadge(pc.followup_status)}
                            </div>
                          </td>
                          <td className={tdEmail}>
                            {pc.email?.trim() || "—"}
                          </td>
                          <td className={tdProjTitle}>
                            {pc.project_title?.trim() || "—"}
                          </td>
                          <td className={tdInterviewer}>
                            {formatInterviewerStoredForUi(i.interviewer)}
                          </td>
                          <td className={tdCompletedOn}>
                            {formatDateTime(i.completed_at)}
                          </td>
                          <td className={tdPostInterview}>
                            {postInterviewEligibleBadge(
                              i.post_interview_eligible,
                              i.reward_item,
                            )}
                          </td>
                          <td className={tdPostInterview}>
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${postContentStatusBadgeClass(i.post_content_status)}`}
                            >
                              {postContentStatusLabel(i.post_content_status)}
                            </span>
                          </td>
                          <td className={tdPostProdGate}>
                            {postProductionGateBadgeProject(i)}
                          </td>
                          <td className={tdFunnelCol}>
                            {i.funnel?.trim() || "—"}
                          </td>
                          <td className={tdCommentsCol}>
                            <CommentTableCell value={i.comments} />
                          </td>
                          <td className={tdFollowUp}>
                            {followupBadgeForProjectCandidateId(i.project_candidate_id)}
                          </td>
                          <td className={`${tdActions} relative`}>
                            <div
                              className="relative flex flex-wrap items-center justify-end gap-2"
                              data-project-completed-popover-root
                            >
                              <button
                                type="button"
                                disabled={
                                  !canEditScheduledTab ||
                                  postProdBusyId === i.id
                                }
                                title={
                                  !canEditScheduledTab
                                    ? "View only"
                                    : undefined
                                }
                                className="rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-background/80 disabled:cursor-not-allowed disabled:opacity-50"
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (canEditScheduledTab) {
                                    setLogFollowupFor(
                                      projectCandidateForLogModal(pc),
                                    );
                                  }
                                }}
                              >
                                Log Call (Post)
                              </button>
                              <button
                                type="button"
                                disabled={
                                  !canEditScheduledTab ||
                                  !canConfirmSocialPosts(i.post_content_status)
                                }
                                className="rounded-lg border border-[#bfdbfe] bg-[#eff6ff] px-2.5 py-1 text-xs font-medium text-[#2563eb] hover:bg-[#dbeafe] disabled:opacity-40"
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setConfirmPostsFor(i);
                                }}
                              >
                                Confirm posts
                              </button>
                              <button
                                type="button"
                                disabled={
                                  !canEditScheduledTab ||
                                  !canFinalizeDispatch(
                                    i.post_content_status,
                                    i.reward_item,
                                  ) ||
                                  isDispatchAlreadyFinalized(
                                    i.post_content_status,
                                    dispatchProjectCandidateIds.has(
                                      i.project_candidate_id,
                                    ),
                                  )
                                }
                                className="rounded-lg border border-[#bbf7d0] bg-[#f0fdf4] px-2.5 py-1 text-xs font-medium text-[#16a34a] hover:bg-[#dcfce7] disabled:opacity-40"
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setFinalizeDispatchFor(i);
                                }}
                              >
                                Finalize dispatch
                              </button>
                              <button
                                type="button"
                                disabled={
                                  !canMoveToPostProduction(i) ||
                                  postProdBusyId === i.id
                                }
                                title={
                                  !canMoveToPostProduction(i)
                                    ? POST_PRODUCTION_ELIGIBILITY_TOOLTIP
                                    : undefined
                                }
                                className="rounded-lg bg-foreground px-2.5 py-1 text-xs font-medium text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 disabled:text-muted"
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void addProjectCompletedToPostProduction(i);
                                }}
                              >
                                {postProdBusyId === i.id ? (
                                  <Loader2
                                    className="h-3.5 w-3.5 animate-spin"
                                    aria-hidden
                                  />
                                ) : null}{" "}
                                Add to Post Production
                              </button>
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
                                  className="absolute right-0 top-full z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] max-w-sm rounded-xl border border-border-subtle bg-elevated p-4 text-left shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
                                  onMouseDown={(e) => e.stopPropagation()}
                                  role="dialog"
                                  aria-label="Post-interview details"
                                >
                                  <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                                    Post-interview details
                                  </p>
                                  <dl className="mt-3 space-y-3 text-sm">
                                    <div>
                                      <dt className="text-xs text-muted/80">
                                        Post-interview eligible
                                      </dt>
                                      <dd className="mt-0.5 text-foreground">
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
                                      <dt className="text-xs text-muted/80">
                                        Reward item
                                      </dt>
                                      <dd className="mt-0.5 text-foreground">
                                        {i.reward_item?.trim() || "—"}
                                      </dd>
                                    </div>
                                    <div>
                                      <dt className="text-xs text-muted/80">
                                        Funnel
                                      </dt>
                                      <dd className="mt-0.5 whitespace-pre-wrap break-words text-foreground">
                                        {i.funnel?.trim() || "—"}
                                      </dd>
                                    </div>
                                    <div>
                                      <dt className="text-xs text-muted/80">
                                        Comments
                                      </dt>
                                      <dd className="mt-0.5 whitespace-pre-wrap break-words text-foreground">
                                        {i.comments?.trim() || "—"}
                                      </dd>
                                    </div>
                                    <div>
                                      <dt className="text-xs text-muted/80">
                                        Completed on
                                      </dt>
                                      <dd className="mt-0.5 text-foreground">
                                        {formatDateTime(i.completed_at)}
                                      </dd>
                                    </div>
                                  </dl>
                                  <div className="mt-4 flex flex-wrap items-center gap-2">
                                    <button
                                      type="button"
                                      disabled={!canEditScheduledTab}
                                      title={
                                        !canEditScheduledTab
                                          ? "View only"
                                          : undefined
                                      }
                                      className="rounded-lg border border-border bg-elevated px-2.5 py-1 text-xs font-medium text-foreground hover:bg-background/80 disabled:cursor-not-allowed disabled:border-border disabled:text-muted"
                                      onClick={() => {
                                        if (!canEditScheduledTab) return;
                                        setCompletedPopoverId(null);
                                        onPostProjectInterview(i);
                                      }}
                                    >
                                      Edit Details
                                    </button>
                                    <button
                                      type="button"
                                      className="text-xs font-medium text-[#3b82f6] hover:text-[#2563eb]"
                                      onClick={() => setCompletedPopoverId(null)}
                                    >
                                      Close
                                    </button>
                                  </div>
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

      {subTab === "noShow" && (
        <section className="space-y-4">
          <label className="flex min-w-0 max-w-md flex-col gap-1">
            <span className="text-xs uppercase tracking-widest text-muted/80">
              Search
            </span>
            <input
              type="search"
              placeholder="Name, email, or title"
              className={filterInp}
              value={filters.noShow.search}
              onChange={(e) =>
                patchFilter("noShow", { search: e.target.value })
              }
            />
          </label>
          <div className={tableWrap}>
            <div className="w-full overflow-x-auto">
              <table className="w-full min-w-[1000px] table-auto border-collapse">
                <thead>
                  <tr>
                    <th className={thName}>Name</th>
                    <th className={thEmail}>Email</th>
                    <th className={thCompletedOn}>Scheduled for</th>
                    <th className={thInterviewer}>Interviewer</th>
                    <th className={thCommentsCol}>No-show reason</th>
                    <th className={thCompletedOn}>Marked at</th>
                    <th className={thActions}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {noShowPage.slice.length === 0 ? (
                    <tr>
                      <td className={tdBase} colSpan={7}>
                        No entries here yet
                      </td>
                    </tr>
                  ) : (
                    noShowPage.slice.map((i) => {
                      const pc = i.project_candidates;
                      if (!pc) return null;
                      return (
                        <tr key={i.id}>
                          <td className={tdName}>{projectDisplayName(pc)}</td>
                          <td className={tdEmail}>{pc.email?.trim() || "—"}</td>
                          <td className={tdCompletedOn}>
                            {formatDateTime(i.scheduled_date)}
                          </td>
                          <td className={tdInterviewer}>
                            {formatInterviewerStoredForUi(i.interviewer)}
                          </td>
                          <td className={tdCommentsCol}>
                            <CommentTableCell value={i.no_show_reason} />
                          </td>
                          <td className={tdCompletedOn}>
                            {formatDateTime(i.no_show_at)}
                          </td>
                          <td className={tdActions}>
                            <div className="flex flex-wrap justify-end gap-2">
                              <button
                                type="button"
                                className="rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs font-medium text-foreground hover:bg-background disabled:opacity-40"
                                disabled={
                                  !canEditScheduledTab ||
                                  noShowRevertBusyId === i.id
                                }
                                onClick={() =>
                                  void handleRevertNoShowToScheduled(i)
                                }
                              >
                                {noShowRevertBusyId === i.id
                                  ? "Reverting…"
                                  : "Revert to schedule"}
                              </button>
                              <button
                                type="button"
                                className="rounded-lg bg-[#ea580c] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#c2410c] disabled:opacity-40"
                                disabled={!canEditScheduledTab}
                                onClick={() =>
                                  onRescheduleProjectInterview(
                                    i,
                                    "from_scheduled",
                                  )
                                }
                              >
                                Reschedule
                              </button>
                              <button
                                type="button"
                                className="rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs font-medium text-foreground hover:bg-background disabled:opacity-40"
                                disabled={!canEditScheduledTab}
                                onClick={() =>
                                  setLogFollowupFor(
                                    projectCandidateForLogModal(pc),
                                  )
                                }
                              >
                                Log follow-up
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
              "noShow",
              noShowPage.totalPages,
              noShowPage.total,
            )}
          </div>
        </section>
      )}

      {subTab === "notEligible" && (
        <section className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <label className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-md">
              <span className="text-xs uppercase tracking-widest text-muted/80">
                Search
              </span>
              <input
                type="search"
                placeholder="Name, email, or title"
                className={filterInp}
                value={filters.notEligible.search}
                onChange={(e) =>
                  patchFilter("notEligible", { search: e.target.value })
                }
              />
            </label>
            <label className="flex w-full flex-col gap-1 sm:w-48 sm:shrink-0">
              <span className="text-xs uppercase tracking-widest text-muted/80">
                POC
              </span>
              <select
                className={filterInp}
                value={filters.notEligible.poc}
                onChange={(e) =>
                  patchFilter("notEligible", { poc: e.target.value })
                }
              >
                <option value="all">All</option>
                <option value={POC_FILTER_UNASSIGNED}>Unassigned</option>
                {pocFilterNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex w-full flex-col gap-1 sm:w-48 sm:shrink-0">
              <span className="text-xs uppercase tracking-widest text-muted/80">
                Interviewer
              </span>
              <select
                className={filterInp}
                value={filters.notEligible.interviewer}
                onChange={(e) =>
                  patchFilter("notEligible", {
                    interviewer: e.target.value,
                  })
                }
              >
                <option value="all">All</option>
                <option value={INTERVIEWER_FILTER_UNASSIGNED}>
                  Unassigned
                </option>
                {interviewerFilterOptions.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className={tableWrap}>
            <div className="w-full overflow-x-auto">
              <table className="w-full min-w-[1480px] table-auto border-collapse">
                <thead>
                  <tr>
                    <th className={thName}>Name</th>
                    <th className={thEmail}>Email</th>
                    <th className={thProjTitle}>Project title</th>
                    <th className={thInterviewer}>Interviewer</th>
                    <th className={thCompletedOn}>Completed on</th>
                    <th className={thZoomStatus}>Meeting</th>
                    <th className={thCommentsCol}>Recording</th>
                    <th className={thCommentsCol}>Comments</th>
                    <th className={thFollowUp}>Follow-up</th>
                  </tr>
                </thead>
                <tbody>
                  {notEligiblePage.slice.length === 0 ? (
                    <tr>
                      <td className={tdBase} colSpan={9}>
                        {emptyState}
                      </td>
                    </tr>
                  ) : (
                    notEligiblePage.slice.map((i) => {
                      const pc = i.project_candidates;
                      if (!pc) return null;
                      const zoomLink = i.zoom_link?.trim() ?? "";
                      const zoomAccount = i.zoom_account?.trim() ?? "";
                      const recordingLink =
                        i.not_eligible_recording_link?.trim() ?? "";
                      const isEditingRecording =
                        notEligibleRecordingEdit?.id === i.id;
                      return (
                        <tr key={i.id}>
                          <td className={tdName}>
                            <div className="flex min-w-0 flex-col items-start">
                              <button
                                type="button"
                                className={nameLinkBtn}
                                onClick={() => setDetail(pc)}
                              >
                                {projectDisplayName(pc)}
                              </button>
                              {alreadyCompletedFollowupBadge(pc.followup_status)}
                            </div>
                          </td>
                          <td className={tdEmail}>{pc.email?.trim() || "—"}</td>
                          <td className={tdProjTitle}>
                            {pc.project_title?.trim() || "—"}
                          </td>
                          <td className={tdInterviewer}>
                            {formatInterviewerStoredForUi(i.interviewer)}
                          </td>
                          <td className={tdCompletedOn}>
                            {formatDateTime(i.completed_at)}
                          </td>
                          <td className={tdZoomStatus}>
                            <div className="flex flex-col items-start gap-2">
                              {zoomAccount ? (
                                <p className="text-xs text-muted">
                                  Account: {zoomAccount}
                                </p>
                              ) : (
                                <span className="text-muted">—</span>
                              )}
                              {zoomLink ? (
                                <a
                                  href={zoomLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex rounded-lg border border-border bg-elevated px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-background"
                                >
                                  Join
                                </a>
                              ) : null}
                            </div>
                          </td>
                          <td className={tdCommentsCol}>
                            {isEditingRecording ? (
                              <div className="flex w-full min-w-0 max-w-[260px] flex-col gap-2">
                                <input
                                  type="url"
                                  className="w-full rounded-lg border border-border px-2 py-1 text-xs"
                                  placeholder="Paste recording link"
                                  value={notEligibleRecordingEdit.value}
                                  onChange={(e) =>
                                    setNotEligibleRecordingEdit({
                                      id: i.id,
                                      value: e.target.value,
                                    })
                                  }
                                />
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    disabled={
                                      !canEditScheduledTab ||
                                      notEligibleRecordingBusyId === i.id
                                    }
                                    className="rounded bg-foreground px-2 py-0.5 text-[11px] font-medium text-background disabled:opacity-50"
                                    onClick={() =>
                                      void saveNotEligibleRecordingLink(
                                        i.id,
                                        notEligibleRecordingEdit.value,
                                      )
                                    }
                                  >
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    className="text-[11px] text-muted underline"
                                    onClick={() =>
                                      setNotEligibleRecordingEdit(null)
                                    }
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : recordingLink ? (
                              <div className="flex flex-wrap items-center gap-2">
                                <a
                                  href={recordingLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex rounded-lg border border-border bg-elevated px-2 py-1 text-xs font-medium text-foreground hover:bg-background"
                                >
                                  View
                                </a>
                                <button
                                  type="button"
                                  disabled={!canEditScheduledTab}
                                  className="text-xs font-medium text-[#3b82f6] hover:text-[#2563eb] disabled:opacity-50"
                                  onClick={() =>
                                    setNotEligibleRecordingEdit({
                                      id: i.id,
                                      value: recordingLink,
                                    })
                                  }
                                >
                                  Edit
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                disabled={!canEditScheduledTab}
                                className="rounded border border-border bg-background/80 px-2 py-1 text-xs font-medium text-muted hover:bg-background disabled:opacity-50"
                                onClick={() =>
                                  setNotEligibleRecordingEdit({
                                    id: i.id,
                                    value: "",
                                  })
                                }
                              >
                                Add recording
                              </button>
                            )}
                          </td>
                          <td className={tdCommentsCol}>
                            <CommentTableCell value={i.comments} />
                          </td>
                          <td className={tdFollowUp}>
                            {followupBadgeForProjectCandidateId(i.project_candidate_id)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {renderPagination(
              "notEligible",
              notEligiblePage.totalPages,
              notEligiblePage.total,
            )}
          </div>
        </section>
      )}

      <PhysicalInterviewCityModal
        open={!!physicalInterviewCityFor}
        candidateLabel={
          physicalInterviewCityFor
            ? (() => {
                const d = projectDisplayName(physicalInterviewCityFor);
                return d === "—"
                  ? physicalInterviewCityFor.email
                  : d;
              })()
            : ""
        }
        busy={
          physicalInterviewCityFor
            ? physicalInterviewBusyId === physicalInterviewCityFor.id
            : false
        }
        onClose={() => setPhysicalInterviewCityFor(null)}
        onConfirm={(city) => {
          if (physicalInterviewCityFor) {
            void moveProjectCandidateToPhysicalInterviewTrack(
              physicalInterviewCityFor,
              city,
            );
          }
        }}
      />

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

      <ZoomDetailsModal
        key={addZoomFor?.id ?? "project-add-zoom-closed"}
        open={!!addZoomFor}
        interviewId={addZoomFor?.id ?? ""}
        table="project_interviews"
        existingZoomLink={addZoomFor?.zoom_link ?? null}
        existingZoomAccount={addZoomFor?.zoom_account ?? null}
        onClose={() => setAddZoomFor(null)}
        onSuccess={({ zoomLink, zoomAccount }) => {
          const activeId = addZoomFor?.id;
          if (!activeId) return;
          setInterviews((prev) =>
            prev.map((row) =>
              row.id === activeId
                ? {
                    ...row,
                    zoom_link: zoomLink,
                    zoom_account: zoomAccount,
                  }
                : row,
            ),
          );
          onToast?.("Meeting details saved");
        }}
      />

      <EditInterviewDetailsModal
        key={editInterviewFor?.id ?? "project-edit-iv-closed"}
        open={!!editInterviewFor}
        interview={editInterviewFor}
        supabase={supabase}
        onClose={() => setEditInterviewFor(null)}
        onSaved={() => {
          void loadProjectData();
          onPipelineChanged();
        }}
        onToast={
          onToast
            ? (msg) => {
                onToast(msg);
              }
            : undefined
        }
      />

      <MarkNoShowModal
        open={!!noShowFor}
        interview={noShowFor}
        supabase={supabase}
        onClose={() => setNoShowFor(null)}
        onSaved={() => {
          void loadProjectData();
          onPipelineChanged();
        }}
      />

      <ConfirmSocialPostsModal
        open={!!confirmPostsFor}
        interview={confirmPostsFor}
        supabase={supabase}
        onClose={() => setConfirmPostsFor(null)}
        onSaved={() => {
          void loadProjectData();
          onPipelineChanged();
        }}
      />

      <FinalizeDispatchModal
        open={!!finalizeDispatchFor}
        interview={finalizeDispatchFor}
        supabase={supabase}
        onClose={() => setFinalizeDispatchFor(null)}
        onSaved={() => {
          void loadProjectData();
          onPipelineChanged();
        }}
      />

      <LogFollowupCallModal
        key={logFollowupFor?.id ?? "project-log-followup-closed"}
        open={!!logFollowupFor}
        candidate={null}
        projectCandidate={logFollowupFor}
        supabase={supabase}
        onClose={() => setLogFollowupFor(null)}
        onSaved={() => {
          void loadProjectData();
          onPipelineChanged();
        }}
      />
    </>
  );
}

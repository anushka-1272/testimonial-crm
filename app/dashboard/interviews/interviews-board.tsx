"use client";

import {
  endOfDay,
  format,
  parse,
  parseISO,
  startOfDay,
} from "date-fns";
import { Loader2, Pencil } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAccessControl } from "@/components/access-control-context";
import { CandidateDetailModal } from "@/components/candidate-detail-modal";
import { ZoomDetailsModal } from "@/components/ZoomDetailsModal";
import { logActivity } from "@/lib/activity-logger";
import {
  buildInterviewerSelectOptions,
  formatInterviewerStoredForUi,
  interviewerRowMatchesFilter,
  type InterviewerSelectOption,
} from "@/lib/interviewer-enum";
import {
  effectiveInterviewLanguage,
  formatInterviewLanguageLabel,
  interviewLanguageBadgeClass,
  matchesInterviewLanguageFilter,
  type InterviewLanguageFilter,
} from "@/lib/interview-language";
import { getUserSafe } from "@/lib/supabase-auth";
import { createBrowserSupabaseClient } from "@/lib/supabase-browser";
import { slackEmailForTeamMember } from "@/lib/slack-contacts";
import { voidSlackNotify } from "@/lib/slack-client";
import {
  canMoveToPostProduction,
  POST_PRODUCTION_ELIGIBILITY_TOOLTIP,
} from "@/lib/post-production-eligibility";
import {
  fetchTeamRosterNames,
  mergeRosterWithCurrent,
} from "@/lib/team-roster";

import { PostInterviewDrawer } from "./post-interview-drawer";
import { RescheduleInterviewModal } from "./reschedule-interview-modal";
import { AssignInterviewerModal } from "./assign-interviewer-modal";
import { EditInterviewDetailsModal } from "./edit-interview-details-modal";
import { followupStatusBadgeFromSnapshot } from "./followup-status";
import { FollowupHistoryModal } from "./followup-history-modal";
import { LogFollowupCallModal } from "./log-followup-call-modal";
import {
  ScheduleInterviewModal,
  type ScheduleCandidate,
  type ScheduleProjectCandidate,
} from "./schedule-interview-modal";
import type {
  EligibleCandidate,
  FollowupStatus,
  InterviewWithCandidate,
  LinkedInTrackStatus,
} from "./types";

const PAGE_SIZE = 20;

const INTERVIEW_SELECT = `id, candidate_id, scheduled_date, previous_scheduled_date, reschedule_reason, completed_at, interviewer, interviewer_assigned_at, zoom_link, zoom_account, language, interview_language, invitation_sent, poc, remarks, reminder_count, interview_status, post_interview_eligible, reward_item, category, funnel, comments, interview_type, candidates ( id, created_at, full_name, email, whatsapp_number, poc_assigned, is_deleted )`;

const cardChrome =
  "rounded-2xl bg-white shadow-[0_4px_16px_rgba(0,0,0,0.08)] border border-[#f0f0f0]";

type BoardTab =
  | "eligible"
  | "scheduled"
  | "rescheduled"
  | "completed";

type InterviewTypeFilter = "all" | "testimonial" | "project";

type ZoomStatusFilter =
  | "all"
  | "awaiting_interviewer"
  | "awaiting_zoom"
  | "zoom_added";

const LANGUAGE_FILTER_OPTIONS: {
  value: InterviewLanguageFilter;
  label: string;
}[] = [
  { value: "all", label: "All" },
  { value: "english", label: "English" },
  { value: "hindi", label: "Hindi" },
  { value: "kannada", label: "Kannada" },
  { value: "telugu", label: "Telugu" },
  { value: "marathi", label: "Marathi" },
  { value: "bengali", label: "Bengali" },
  { value: "other", label: "Other" },
];

const ZOOM_STATUS_FILTER_OPTIONS: { value: ZoomStatusFilter; label: string }[] =
  [
    { value: "all", label: "All" },
    { value: "awaiting_interviewer", label: "Awaiting Interviewer" },
    { value: "awaiting_zoom", label: "Awaiting Zoom" },
    { value: "zoom_added", label: "Zoom Added" },
  ];

type TableFilters = {
  search: string;
  interviewType: InterviewTypeFilter;
  language: InterviewLanguageFilter;
  zoomStatus: ZoomStatusFilter;
  page: number;
};

type PostInterviewEligibleFilter = "all" | "eligible" | "not_eligible";

type CompletedTabFilters = TableFilters & {
  postInterviewEligible: PostInterviewEligibleFilter;
  interviewer: string;
  completedFrom: string;
  completedTo: string;
  category: string;
};

type SimpleTab = Exclude<BoardTab, "completed">;

const emptyFilters = (): TableFilters => ({
  search: "",
  interviewType: "all",
  language: "all",
  zoomStatus: "all",
  page: 0,
});

const defaultCompletedFilters = (): CompletedTabFilters => ({
  ...emptyFilters(),
  postInterviewEligible: "all",
  interviewer: "all",
  completedFrom: "",
  completedTo: "",
  category: "",
});

function matchesRowSearch(
  name: string | null | undefined,
  email: string | null | undefined,
  q: string,
): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return (
    (name ?? "").toLowerCase().includes(s) ||
    (email ?? "").toLowerCase().includes(s)
  );
}

function hasAssignedInterviewer(i: InterviewWithCandidate): boolean {
  return Boolean(i.interviewer?.trim());
}

function isCompletedInterview(i: InterviewWithCandidate): boolean {
  return i.interview_status === "completed" || Boolean(i.completed_at);
}

function zoomPipelineFilterKey(
  i: InterviewWithCandidate,
): ZoomStatusFilter | null {
  if (i.interview_status === "scheduled") return "zoom_added";
  if (i.interview_status === "draft") {
    if (!hasAssignedInterviewer(i)) return "awaiting_interviewer";
    return "awaiting_zoom";
  }
  return null;
}

function interviewCategoryLines(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function filterCompletedInterviews(
  rows: InterviewWithCandidate[],
  f: CompletedTabFilters,
): InterviewWithCandidate[] {
  return rows.filter((i) => {
    if (
      f.interviewType !== "all" &&
      i.interview_type !== f.interviewType
    )
      return false;
    if (
      f.postInterviewEligible === "eligible" &&
      i.post_interview_eligible !== true
    )
      return false;
    if (
      f.postInterviewEligible === "not_eligible" &&
      i.post_interview_eligible !== false
    )
      return false;
    if (!interviewerRowMatchesFilter(f.interviewer, i.interviewer))
      return false;
    if (f.category) {
      const lines = interviewCategoryLines(i.category);
      if (!lines.includes(f.category)) return false;
    }
    if (f.completedFrom) {
      const from = startOfDay(
        parse(f.completedFrom, "yyyy-MM-dd", new Date()),
      );
      if (!i.completed_at || parseISO(i.completed_at) < from) return false;
    }
    if (f.completedTo) {
      const to = endOfDay(parse(f.completedTo, "yyyy-MM-dd", new Date()));
      if (!i.completed_at || parseISO(i.completed_at) > to) return false;
    }
    if (
      f.language !== "all" &&
      !matchesInterviewLanguageFilter(
        effectiveInterviewLanguage(i),
        f.language,
      )
    )
      return false;
    const q = f.search.trim().toLowerCase();
    if (q) {
      const name = (i.candidates?.full_name ?? "").toLowerCase();
      const email = (i.candidates?.email ?? "").toLowerCase();
      const phone = (i.candidates?.whatsapp_number ?? "").toLowerCase();
      const categoryBlob = interviewCategoryLines(i.category)
        .join(" ")
        .toLowerCase();
      if (
        !name.includes(q) &&
        !email.includes(q) &&
        !phone.includes(q) &&
        !categoryBlob.includes(q)
      )
        return false;
    }
    return true;
  });
}

function truncateWithTooltip(text: string | null | undefined, maxLen: number) {
  const t = text?.trim() ?? "";
  if (!t) return { display: "—" as string, title: undefined as string | undefined };
  if (t.length <= maxLen) return { display: t, title: undefined };
  return { display: `${t.slice(0, maxLen)}…`, title: t };
}

const REWARD_NO_DISPATCH = "No Dispatch";
const REWARD_JBL_CLIP = "JBL Clip 5";

const LINKEDIN_STATUSES: readonly LinkedInTrackStatus[] = [
  "pending_post",
  "posted",
  "verified",
  "eligible",
  "not_eligible",
] as const;

function normalizeLinkedInTrackStatus(
  raw: string | null | undefined,
): LinkedInTrackStatus {
  const s = raw?.trim() ?? "";
  return (LINKEDIN_STATUSES as readonly string[]).includes(s)
    ? (s as LinkedInTrackStatus)
    : "pending_post";
}

function linkedInPipelineBadge(status: LinkedInTrackStatus | null) {
  if (!status) return <span className="text-[#6e6e73]">—</span>;
  switch (status) {
    case "pending_post":
      return (
        <span className="inline-flex rounded-full bg-[#f3e8ff] px-2.5 py-1 text-xs font-medium text-[#7c3aed]">
          Pending Post
        </span>
      );
    case "posted":
      return (
        <span className="inline-flex rounded-full bg-[#dbeafe] px-2.5 py-1 text-xs font-medium text-[#1d4ed8]">
          Posted
        </span>
      );
    case "verified":
      return (
        <span className="inline-flex rounded-full bg-[#ccfbf1] px-2.5 py-1 text-xs font-medium text-[#0f766e]">
          Verified
        </span>
      );
    case "eligible":
      return (
        <span className="inline-flex rounded-full bg-[#f0fdf4] px-2.5 py-1 text-xs font-medium text-[#16a34a]">
          Eligible
        </span>
      );
    case "not_eligible":
      return (
        <span className="inline-flex rounded-full bg-[#fef2f2] px-2.5 py-1 text-xs font-medium text-[#dc2626]">
          Not Eligible
        </span>
      );
    default:
      return <span className="text-[#6e6e73]">—</span>;
  }
}

function linkedInTrackColumnBadge() {
  return (
    <span className="inline-flex rounded-full bg-[#f3e8ff] px-2.5 py-1 text-xs font-medium text-[#7c3aed]">
      LinkedIn
    </span>
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
  return <span className="text-[#6e6e73]">—</span>;
}

/** Post production intake: strict eligible / not eligible (no “No Dispatch” branch). */
function postProductionEligibilityGateBadge(i: InterviewWithCandidate) {
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
  return <span className="text-[#6e6e73]">—</span>;
}

function interviewTypeBadge(t: "testimonial" | "project" | null | undefined) {
  if (t === "testimonial") {
    return (
      <span className="inline-flex rounded-full bg-[#f0fdf4] px-3 py-1 text-xs font-medium text-[#16a34a]">
        Testimonial
      </span>
    );
  }
  if (t === "project") {
    return (
      <span className="inline-flex rounded-full bg-[#eff6ff] px-3 py-1 text-xs font-medium text-[#2563eb]">
        Project
      </span>
    );
  }
  return <span className="text-[#6e6e73]">—</span>;
}

function interviewLanguageBadge(i: InterviewWithCandidate) {
  const eff = effectiveInterviewLanguage(i);
  return (
    <span className={interviewLanguageBadgeClass(eff)}>
      {formatInterviewLanguageLabel(eff)}
    </span>
  );
}

function zoomStatusColumn(
  i: InterviewWithCandidate,
  opts: {
    canEditScheduledTab: boolean;
    onOpenZoomModal: (interview: InterviewWithCandidate) => void;
  },
) {
  const isDraft = i.interview_status === "draft";
  const link = i.zoom_link?.trim();
  const acct = i.zoom_account?.trim();
  const hasZoom = Boolean(link);
  const awaitingIv = isDraft && !hasAssignedInterviewer(i);
  const awaitingZoom = isDraft && hasAssignedInterviewer(i) && !hasZoom;
  const canOpenZoomModal = opts.canEditScheduledTab && !awaitingIv;
  return (
    <div className="flex flex-col items-start gap-2">
      {awaitingIv ? (
        <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
          Awaiting Interviewer
        </span>
      ) : awaitingZoom ? (
        <span className="inline-flex rounded-full bg-[#fff7ed] px-2.5 py-1 text-xs font-medium text-[#c2410c]">
          Awaiting Zoom
        </span>
      ) : hasZoom ? (
        <span className="inline-flex rounded-full bg-[#f0fdf4] px-2.5 py-1 text-xs font-medium text-[#15803d]">
          Zoom Added
        </span>
      ) : (
        <span className="text-[#6e6e73]">—</span>
      )}
      {hasZoom && acct ? (
        <p className="text-xs text-[#6e6e73]">Account: {acct}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {link ? (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            title={acct ? `Account: ${acct}` : "Join Zoom meeting"}
            className="inline-flex rounded-lg border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs font-medium text-[#1d1d1f] transition-colors hover:bg-[#f5f5f7]"
          >
            Join
          </a>
        ) : (
          <button
            type="button"
            disabled
            className="inline-flex cursor-not-allowed rounded-lg border border-[#d1d5db] bg-[#f9fafb] px-2.5 py-1 text-xs font-medium text-[#9ca3af]"
          >
            Join
          </button>
        )}
        <button
          type="button"
          disabled={!canOpenZoomModal}
          title={
            !opts.canEditScheduledTab
              ? "View only"
              : awaitingIv
                ? "Assign interviewer first"
                : undefined
          }
          className="rounded-lg border border-[#1d1d1f] bg-white px-2.5 py-1 text-xs font-medium text-[#1d1d1f] hover:bg-[#fafafa] disabled:cursor-not-allowed disabled:border-[#d1d5db] disabled:text-[#9ca3af]"
          onClick={() => (canOpenZoomModal ? opts.onOpenZoomModal(i) : undefined)}
        >
          {link ? "Edit" : "Add Zoom Details"}
        </button>
      </div>
    </div>
  );
}

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

function escapeCsvCell(v: unknown): string {
  const s = String(v ?? "");
  if (s.includes("\"") || s.includes(",") || s.includes("\n")) {
    return `"${s.replace(/"/g, "\"\"")}"`;
  }
  return s;
}

function pocOptionsFor(
  candidate: EligibleCandidate,
  pocRoster: string[],
): string[] {
  return mergeRosterWithCurrent(pocRoster, candidate.poc_assigned);
}

function normalizeFollowupStatus(v: unknown): FollowupStatus {
  const allowed: FollowupStatus[] = [
    "pending",
    "no_answer",
    "callback",
    "wrong_number",
    "not_interested",
    "scheduled",
    "interested",
    "already_completed",
    "not_eligible",
  ];
  if (typeof v === "string" && (allowed as string[]).includes(v)) {
    return v as FollowupStatus;
  }
  return "pending";
}

function canShowEligibleScheduleButton(c: EligibleCandidate): boolean {
  if (c.followup_status === "not_interested") return false;
  if (c.followup_status === "wrong_number") return false;
  if (c.followup_status === "already_completed") return false;
  if (c.followup_status === "not_eligible") return false;
  if (c.followup_status === "no_answer" && c.followup_count >= 3)
    return false;
  return true;
}

function eligibleScheduleDisabled(c: EligibleCandidate): boolean {
  return c.followup_status === "callback" && Boolean(c.callback_datetime);
}

function eligibleScheduleTooltip(c: EligibleCandidate): string | undefined {
  if (!canShowEligibleScheduleButton(c)) return undefined;
  if (eligibleScheduleDisabled(c) && c.callback_datetime) {
    try {
      return `Callback scheduled for ${format(parseISO(c.callback_datetime), "MMM d, yyyy h:mm a")}`;
    } catch {
      return "Callback scheduled";
    }
  }
  return undefined;
}

function normalizeInterviewRow(
  row: Record<string, unknown>,
): InterviewWithCandidate {
  const r = row as Record<string, unknown> & {
    candidates:
      | {
          id: string;
          full_name: string | null;
          email: string;
          whatsapp_number?: string | null;
          poc_assigned?: string | null;
        }
      | {
          id: string;
          full_name: string | null;
          email: string;
          whatsapp_number?: string | null;
          poc_assigned?: string | null;
        }[]
      | null;
  };
  const c = r.candidates;
  const candidate =
    c == null ? null : Array.isArray(c) ? (c[0] ?? null) : c;
  const ivRaw = r.interviewer as string | null | undefined;
  const ivTrim = typeof ivRaw === "string" ? ivRaw.trim() : "";
  return {
    ...r,
    previous_scheduled_date:
      (r.previous_scheduled_date as string | null) ?? null,
    reschedule_reason: (r.reschedule_reason as string | null) ?? null,
    completed_at: (r.completed_at as string | null) ?? null,
    interviewer: ivTrim || null,
    interviewer_assigned_at:
      (r.interviewer_assigned_at as string | null | undefined) ?? null,
    reward_item: (r.reward_item as string | null) ?? null,
    zoom_account: (r.zoom_account as string | null | undefined) ?? null,
    interview_language: (r.interview_language as string | null | undefined) ?? null,
    candidates: candidate,
  } as InterviewWithCandidate;
}

export function InterviewsBoard() {
  const { role, canEditCurrentPage, showViewOnlyBadge } = useAccessControl();
  const canEditEligibleTab =
    canEditCurrentPage &&
    (role === "admin" || role === "interviewer" || role === "poc");
  const canEditScheduledTab =
    canEditCurrentPage &&
    (role === "admin" || role === "interviewer" || role === "operations");
  const canEditRescheduledTab =
    canEditCurrentPage && (role === "admin" || role === "interviewer");
  const canEditCompletedTab =
    canEditCurrentPage && (role === "admin" || role === "interviewer");
  const [eligibleQueue, setEligibleQueue] = useState<EligibleCandidate[]>([]);
  const [interviews, setInterviews] = useState<InterviewWithCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<BoardTab>("eligible");
  const [scheduleFor, setScheduleFor] = useState<ScheduleCandidate | null>(
    null,
  );
  const [scheduleProjectFor, setScheduleProjectFor] =
    useState<ScheduleProjectCandidate | null>(null);
  const [isCompleteModalOpen, setIsCompleteModalOpen] = useState(false);
  const [selectedInterview, setSelectedInterview] =
    useState<InterviewWithCandidate | null>(null);
  const [rescheduleCtx, setRescheduleCtx] = useState<{
    interview: InterviewWithCandidate;
    mode: "from_scheduled" | "from_rescheduled";
  } | null>(null);
  const [addZoomFor, setAddZoomFor] = useState<InterviewWithCandidate | null>(
    null,
  );
  const [assignInterviewerFor, setAssignInterviewerFor] =
    useState<InterviewWithCandidate | null>(null);
  const [editInterviewFor, setEditInterviewFor] =
    useState<InterviewWithCandidate | null>(null);
  const [logFollowupFor, setLogFollowupFor] =
    useState<EligibleCandidate | null>(null);
  const [followupHistoryFor, setFollowupHistoryFor] = useState<{
    id: string;
    label: string;
  } | null>(null);
  const [notInterestedOpen, setNotInterestedOpen] = useState(false);
  const [restoringNotInterestedId, setRestoringNotInterestedId] = useState<
    string | null
  >(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [pocSavingId, setPocSavingId] = useState<string | null>(null);
  /** Eligible row id showing POC dropdown while a POC is already assigned (badge hidden). */
  const [pocEditingId, setPocEditingId] = useState<string | null>(null);
  const [detailCandidateId, setDetailCandidateId] = useState<string | null>(
    null,
  );

  const [filters, setFilters] = useState<Record<SimpleTab, TableFilters>>({
    eligible: emptyFilters(),
    scheduled: emptyFilters(),
    rescheduled: emptyFilters(),
  });
  const [completedFilters, setCompletedFilters] = useState<CompletedTabFilters>(
    defaultCompletedFilters,
  );
  const [completedPopoverId, setCompletedPopoverId] = useState<string | null>(
    null,
  );
  const [postProdBusyId, setPostProdBusyId] = useState<string | null>(null);
  const [incompleteBusyId, setIncompleteBusyId] = useState<string | null>(null);
  const [liBusyId, setLiBusyId] = useState<string | null>(null);
  const [linkedInListPage, setLinkedInListPage] = useState(0);
  const [pocRoster, setPocRoster] = useState<string[]>([]);
  const [interviewerRoster, setInterviewerRoster] = useState<
    InterviewerSelectOption[]
  >([]);

  const supabase = useMemo(() => {
    try {
      return createBrowserSupabaseClient();
    } catch {
      return null;
    }
  }, []);

  const loadData = useCallback(async () => {
    if (!supabase) return;
    const [{ data: elig, error: e1 }, { data: inv, error: e2 }] =
      await Promise.all([
        supabase
          .from("candidates")
          .select(
            "id, created_at, full_name, email, whatsapp_number, interview_type, poc_assigned, poc_assigned_at, assigned_at, linkedin_track, linkedin_track_status, followup_status, followup_count, callback_datetime, not_interested_reason, not_interested_at",
          )
          .eq("is_deleted", false)
          .eq("eligibility_status", "eligible")
          .order("created_at", { ascending: true }),
        supabase.from("interviews").select(INTERVIEW_SELECT),
      ]);

    if (e1 || e2) {
      setError(e1?.message ?? e2?.message ?? "Failed to load");
      return;
    }

    const list = (inv ?? [])
      .map((row) => normalizeInterviewRow(row as Record<string, unknown>))
      .filter((i) => {
        const c = i.candidates;
        const one = c == null ? null : Array.isArray(c) ? c[0] ?? null : c;
        return one != null && !one.is_deleted;
      });
    const busy = new Set(
      list
        .filter(
          (i) =>
            i.interview_status === "scheduled" ||
            i.interview_status === "rescheduled" ||
            i.interview_status === "draft",
        )
        .map((i) => i.candidate_id),
    );
    const completedByCandidate = new Map<string, InterviewWithCandidate>();
    for (const i of list) {
      if (!isCompletedInterview(i)) continue;
      const prev = completedByCandidate.get(i.candidate_id);
      if (!prev) {
        completedByCandidate.set(i.candidate_id, i);
        continue;
      }
      const prevTime = new Date(
        prev.completed_at ?? prev.scheduled_date ?? 0,
      ).getTime();
      const nextTime = new Date(i.completed_at ?? i.scheduled_date ?? 0).getTime();
      if (nextTime >= prevTime) completedByCandidate.set(i.candidate_id, i);
    }
    const completedCandidateIds = new Set(completedByCandidate.keys());

    const queue = (elig ?? [])
      .filter((c) => !busy.has(c.id) && !completedCandidateIds.has(c.id))
      .map((row) => {
        const r = row as Record<string, unknown>;
        const onTrack = Boolean(r.linkedin_track);
        return {
          id: r.id as string,
          created_at: r.created_at as string | undefined,
          full_name: r.full_name as string | null,
          email: r.email as string,
          whatsapp_number: r.whatsapp_number as string | null | undefined,
          interview_type: r.interview_type as EligibleCandidate["interview_type"],
          poc_assigned: r.poc_assigned as string | null,
          poc_assigned_at: r.poc_assigned_at as string | null,
          assigned_at: (r.assigned_at as string | null | undefined) ?? null,
          linkedin_track: onTrack,
          linkedin_track_status: onTrack
            ? normalizeLinkedInTrackStatus(
                r.linkedin_track_status as string | null,
              )
            : null,
          followup_status: normalizeFollowupStatus(r.followup_status),
          followup_count: Math.max(0, Number(r.followup_count ?? 0)),
          callback_datetime: (r.callback_datetime as string | null) ?? null,
          not_interested_reason:
            (r.not_interested_reason as string | null) ?? null,
          not_interested_at:
            (r.not_interested_at as string | null) ?? null,
        } satisfies EligibleCandidate;
      });
    const leaked = queue.find((c) => completedCandidateIds.has(c.id));
    if (leaked) {
      const sample = completedByCandidate.get(leaked.id);
      console.debug("[InterviewsBoard] Eligible leak check", {
        candidate_id: leaked.id,
        interview_status: sample?.interview_status ?? null,
        completed_at: sample?.completed_at ?? null,
      });
    }
    setEligibleQueue(queue);
    setInterviews(list);
    setError(null);
  }, [supabase]);

  const loadRoster = useCallback(async () => {
    if (!supabase) return;
    const [pocNames, interviewerNames] = await Promise.all([
      fetchTeamRosterNames(supabase, "poc", true),
      fetchTeamRosterNames(supabase, "interviewer", true),
    ]);
    setPocRoster(pocNames);
    setInterviewerRoster(
      buildInterviewerSelectOptions(interviewerNames, null),
    );
  }, [supabase]);

  useEffect(() => {
    if (!supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }

    const ch = supabase
      .channel("interviews-dashboard")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "interviews" },
        () => {
          void loadData();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "candidates" },
        () => {
          void loadData();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "team_members" },
        () => {
          void loadRoster();
        },
      )
      .subscribe();

    void (async () => {
      setLoading(true);
      await loadData();
      setLoading(false);
    })();

    return () => {
      void supabase.removeChannel(ch);
    };
  }, [supabase, loadData, loadRoster]);

  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  useEffect(() => {
    if (activeTab === "completed") void loadRoster();
  }, [activeTab, loadRoster]);

  useEffect(() => {
    if (activeTab !== "eligible") setPocEditingId(null);
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "completed") setCompletedPopoverId(null);
  }, [activeTab]);

  useEffect(() => {
    if (!completedPopoverId) return;
    const onDocClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest("[data-completed-popover-root]")) return;
      setCompletedPopoverId(null);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [completedPopoverId]);

  useEffect(() => {
    if (!toastMessage) return;
    const t = window.setTimeout(() => setToastMessage(null), 4000);
    return () => window.clearTimeout(t);
  }, [toastMessage]);

  const byStatus = useMemo(() => {
    const m = {
      scheduled: [] as InterviewWithCandidate[],
      rescheduled: [] as InterviewWithCandidate[],
      completed: [] as InterviewWithCandidate[],
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
          if (isCompletedInterview(i)) m.completed.push(i);
          break;
      }
    }
    return m;
  }, [interviews]);

  const counts = useMemo(
    () => ({
      eligible: eligibleQueue.length,
      scheduled: byStatus.scheduled.length,
      rescheduled: byStatus.rescheduled.length,
      completed: byStatus.completed.length,
    }),
    [eligibleQueue.length, byStatus],
  );

  const updateFilter = useCallback(
    (tab: SimpleTab, patch: Partial<Omit<TableFilters, "page">>) => {
      setFilters((prev) => ({
        ...prev,
        [tab]: {
          ...prev[tab],
          ...patch,
          page:
            "search" in patch ||
            "interviewType" in patch ||
            "language" in patch ||
            "zoomStatus" in patch
              ? 0
              : prev[tab].page,
        },
      }));
    },
    [],
  );

  const patchCompletedFilters = useCallback(
    (patch: Partial<CompletedTabFilters>) => {
      setCompletedFilters((prev) => {
        const keys = Object.keys(patch);
        const onlyPage =
          keys.length === 1 && keys[0] === "page" && patch.page !== undefined;
        if (onlyPage) {
          return { ...prev, page: patch.page! };
        }
        return {
          ...prev,
          ...patch,
          page: "page" in patch ? (patch.page ?? prev.page) : 0,
        };
      });
    },
    [],
  );

  const clearCompletedFilters = useCallback(() => {
    setCompletedPopoverId(null);
    setCompletedFilters(defaultCompletedFilters());
  }, []);

  const setPage = useCallback(
    (tab: BoardTab, page: number) => {
      if (tab === "completed") {
        patchCompletedFilters({ page });
        return;
      }
      setFilters((prev) => ({
        ...prev,
        [tab]: { ...prev[tab], page },
      }));
    },
    [patchCompletedFilters],
  );

  const filterEligible = useCallback(
    (rows: EligibleCandidate[], f: TableFilters) =>
      rows.filter((c) => {
        if (
          f.interviewType !== "all" &&
          c.interview_type !== f.interviewType
        )
          return false;
        return matchesRowSearch(c.full_name, c.email, f.search);
      }),
    [],
  );

  const filterInterviews = useCallback(
    (rows: InterviewWithCandidate[], f: TableFilters) =>
      rows.filter((i) => {
        if (f.interviewType !== "all" && i.interview_type !== f.interviewType)
          return false;
        if (
          f.language !== "all" &&
          !matchesInterviewLanguageFilter(
            effectiveInterviewLanguage(i),
            f.language,
          )
        )
          return false;
        if (f.zoomStatus !== "all") {
          const z = zoomPipelineFilterKey(i);
          if (z !== f.zoomStatus) return false;
        }
        const name = i.candidates?.full_name;
        const email = i.candidates?.email;
        return matchesRowSearch(name, email, f.search);
      }),
    [],
  );

  const eligibleFiltered = useMemo(
    () =>
      [...filterEligible(eligibleQueue, filters.eligible)]
        // Safety guard: if any completed candidate slips through, hide in Eligible tab.
        .filter((c) => {
          return !interviews.some(
            (i) => i.candidate_id === c.id && isCompletedInterview(i),
          );
        })
        .sort((a, b) => {
        const dateA = new Date(a.created_at || 0).getTime();
        const dateB = new Date(b.created_at || 0).getTime();
        const cmp = dateA - dateB;
        return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
        }),
    [eligibleQueue, filters.eligible, filterEligible, interviews],
  );

  const interviewEligibleFiltered = useMemo(
    () =>
      eligibleFiltered.filter(
        (c) =>
          !c.linkedin_track && c.followup_status !== "not_interested",
      ),
    [eligibleFiltered],
  );

  const notInterestedEligibleFiltered = useMemo(
    () =>
      eligibleFiltered.filter(
        (c) => !c.linkedin_track && c.followup_status === "not_interested",
      ),
    [eligibleFiltered],
  );

  const linkedInTrackFiltered = useMemo(
    () => eligibleFiltered.filter((c) => c.linkedin_track),
    [eligibleFiltered],
  );

  useEffect(() => {
    setLinkedInListPage(0);
  }, [
    filters.eligible.search,
    filters.eligible.interviewType,
    linkedInTrackFiltered.length,
  ]);

  const scheduledFiltered = useMemo(
    () =>
      [...filterInterviews(byStatus.scheduled, filters.scheduled)].sort(
        (a, b) => {
          const dateA = new Date(a.scheduled_date || 0).getTime();
          const dateB = new Date(b.scheduled_date || 0).getTime();
          const cmp = dateA - dateB;
          return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
        },
      ),
    [byStatus.scheduled, filters.scheduled, filterInterviews],
  );

  const rescheduledFiltered = useMemo(
    () =>
      [...filterInterviews(byStatus.rescheduled, filters.rescheduled)].sort(
        (a, b) => {
          const dateA = new Date(a.scheduled_date || 0).getTime();
          const dateB = new Date(b.scheduled_date || 0).getTime();
          const cmp = dateA - dateB;
          return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
        },
      ),
    [byStatus.rescheduled, filters.rescheduled, filterInterviews],
  );

  const completedCategoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const i of byStatus.completed) {
      for (const line of interviewCategoryLines(i.category)) {
        set.add(line);
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [byStatus.completed]);

  const completedFiltered = useMemo(
    () =>
      [...filterCompletedInterviews(byStatus.completed, completedFilters)].sort(
        (a, b) => {
          const dateA = new Date(a.completed_at || 0).getTime();
          const dateB = new Date(b.completed_at || 0).getTime();
          const cmp = dateB - dateA;
          return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
        },
      ),
    [byStatus.completed, completedFilters],
  );

  const paginate = <T,>(rows: T[], page: number) => {
    const start = page * PAGE_SIZE;
    return {
      slice: rows.slice(start, start + PAGE_SIZE),
      totalPages: Math.max(1, Math.ceil(rows.length / PAGE_SIZE)),
      total: rows.length,
    };
  };

  const eligiblePage = useMemo(
    () => paginate(interviewEligibleFiltered, filters.eligible.page),
    [interviewEligibleFiltered, filters.eligible.page],
  );

  const linkedInPageData = useMemo(() => {
    const start = linkedInListPage * PAGE_SIZE;
    const total = linkedInTrackFiltered.length;
    return {
      slice: linkedInTrackFiltered.slice(start, start + PAGE_SIZE),
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      total,
    };
  }, [linkedInTrackFiltered, linkedInListPage]);

  const scheduledPage = useMemo(
    () => paginate(scheduledFiltered, filters.scheduled.page),
    [scheduledFiltered, filters.scheduled.page],
  );
  const rescheduledPage = useMemo(
    () => paginate(rescheduledFiltered, filters.rescheduled.page),
    [rescheduledFiltered, filters.rescheduled.page],
  );
  const completedPage = useMemo(
    () => paginate(completedFiltered, completedFilters.page),
    [completedFiltered, completedFilters.page],
  );

  const exportCompletedCsv = useCallback(() => {
    if (completedFiltered.length === 0) return;
    const headers = [
      "Name",
      "Phone",
      "Email",
      "Interview Type",
      "Language",
      "Interviewer",
      "POC",
      "Completed On",
      "Post-Interview Eligible",
      "Category",
      "Funnel",
      "Reward Item",
      "Comments",
    ];
    const body = completedFiltered.map((i) => {
      const postEligible =
        i.post_interview_eligible === true
          ? "Eligible"
          : i.post_interview_eligible === false
            ? "Not eligible"
            : "—";
      return [
        i.candidates?.full_name?.trim() || "",
        i.candidates?.whatsapp_number?.trim() || "",
        i.candidates?.email || "",
        i.interview_type || "",
        formatInterviewLanguageLabel(effectiveInterviewLanguage(i)),
        formatInterviewerStoredForUi(i.interviewer),
        i.poc?.trim() || i.candidates?.poc_assigned?.trim() || "",
        formatDateTime(i.completed_at),
        postEligible,
        interviewCategoryLines(i.category).join(" | "),
        i.funnel?.trim() || "",
        i.reward_item?.trim() || "",
        i.comments?.trim() || "",
      ]
        .map(escapeCsvCell)
        .join(",");
    });
    const csv = [headers.map(escapeCsvCell).join(","), ...body].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `completed-interviews-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [completedFiltered]);

  const addCompletedToPostProduction = useCallback(
    async (i: InterviewWithCandidate) => {
      if (!supabase || !canMoveToPostProduction(i)) return;
      setPostProdBusyId(i.id);
      setError(null);
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setPostProdBusyId(null);
        setError("You must be signed in.");
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
            source: "testimonial",
            interview_id: i.id,
          }),
        });
      } catch (e) {
        console.error("Post production insert failed", e);
        setPostProdBusyId(null);
        setError("Network error while adding to post production.");
        return;
      }
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      setPostProdBusyId(null);
      if (!res.ok) {
        console.error("Post production insert failed", {
          status: res.status,
          body: json,
          interview_id: i.id,
        });
        setError(json.error ?? "Could not add to post production.");
        return;
      }
      setToastMessage("Added to post production.");
      void loadData();
    },
    [supabase, loadData],
  );

  const openCompleteModal = useCallback((interview: InterviewWithCandidate) => {
    console.debug("[InterviewsBoard] open complete modal", interview);
    setSelectedInterview(interview);
    setIsCompleteModalOpen(true);
  }, []);

  const handleMarkIncomplete = useCallback(
    async (interview: InterviewWithCandidate) => {
      if (!supabase) return;
      const ok = window.confirm(
        "Mark this interview as incomplete and move it back to Scheduled?\n\nThis will clear post-interview details.",
      );
      if (!ok) return;
      setError(null);
      setIncompleteBusyId(interview.id);
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) {
          setError("You must be signed in.");
          return;
        }
        const response = await fetch(`/api/interviews/${interview.id}/incomplete`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        if (!response.ok) {
          setError(payload.error ?? "Could not mark interview incomplete.");
          return;
        }
        setToastMessage("Interview moved back to scheduled.");
        setCompletedPopoverId(null);
        await loadData();
      } catch (e) {
        console.error("Mark incomplete failed", e);
        setError("Network error while marking interview incomplete.");
      } finally {
        setIncompleteBusyId(null);
      }
    },
    [supabase, loadData],
  );

  const handlePocChange = async (candidate: EligibleCandidate, value: string) => {
    if (!supabase) return;
    const name = value.trim() || null;
    setPocSavingId(candidate.id);
    const { error: uErr } = await supabase
      .from("candidates")
      .update({
        poc_assigned: name,
        poc_assigned_at: name ? new Date().toISOString() : null,
        assigned_at: name ? new Date().toISOString() : null,
      })
      .eq("id", candidate.id)
      .eq("is_deleted", false);
    setPocSavingId(null);
    if (uErr) {
      setError(uErr.message);
      return;
    }
    if (name) {
      const candDisplay =
        candidate.full_name?.trim() || candidate.email || "Candidate";
      const authPoc = await getUserSafe(supabase);
      if (authPoc) {
        await logActivity({
          supabase,
          user: authPoc,
          action_type: "interviews",
          entity_type: "candidate",
          entity_id: candidate.id,
          candidate_name: candDisplay,
          description: `Assigned ${name} as POC for ${candDisplay}`,
        });
      }
      const pocSlackEmail = await slackEmailForTeamMember(supabase, name);
      if (pocSlackEmail) {
        const phone =
          candidate.whatsapp_number?.trim() || "—";
        const typeLabel =
          candidate.interview_type === "project"
            ? "Project"
            : candidate.interview_type === "testimonial"
              ? "Testimonial"
              : "Not set";
        const pocMsg =
          `👋 Hi! You've been assigned as POC for *${candDisplay}*.\n` +
          `📞 Phone: ${phone}\n` +
          `🎯 Interview Type: ${typeLabel}\n` +
          `Please reach out to schedule their interview.`;
        voidSlackNotify(supabase, pocSlackEmail, pocMsg);
      }
    }
    setPocEditingId((prev) => (prev === candidate.id ? null : prev));
    void loadData();
  };

  const handleMarkNotInterestedActive = async (c: EligibleCandidate) => {
    if (!supabase) return;
    setRestoringNotInterestedId(c.id);
    const { error: uErr } = await supabase
      .from("candidates")
      .update({
        followup_status: "pending",
        followup_count: 0,
        callback_datetime: null,
        not_interested_reason: null,
        not_interested_at: null,
      })
      .eq("id", c.id)
      .eq("is_deleted", false);
    setRestoringNotInterestedId(null);
    if (uErr) {
      setError(uErr.message);
      return;
    }
    const display = c.full_name?.trim() || c.email || "Candidate";
    const authUser = await getUserSafe(supabase);
    if (authUser) {
      await logActivity({
        supabase,
        user: authUser,
        action_type: "eligibility",
        entity_type: "candidate",
        entity_id: c.id,
        candidate_name: display,
        description: `Marked ${display} active again (follow-up pipeline)`,
        metadata: { followup: true },
      });
    }
    void loadData();
  };

  const moveCandidateToLinkedInTrack = async (c: EligibleCandidate) => {
    if (!supabase) return;
    const confirmed = window.confirm(
      "Move this candidate to LinkedIn Track?\n\nThey will be removed from interview scheduling.",
    );
    if (!confirmed) return;
    setLiBusyId(c.id);
    const { error: uErr } = await supabase
      .from("candidates")
      .update({
        linkedin_track: true,
        linkedin_track_status: "pending_post",
      })
      .eq("id", c.id)
      .eq("is_deleted", false);
    setLiBusyId(null);
    if (uErr) {
      setError(uErr.message);
      return;
    }
    const display = c.full_name?.trim() || c.email || "Candidate";
    const authLi = await getUserSafe(supabase);
    if (authLi) {
      await logActivity({
        supabase,
        user: authLi,
        action_type: "interviews",
        entity_type: "candidate",
        entity_id: c.id,
        candidate_name: display,
        description: `Moved ${display} to LinkedIn track (pending post)`,
      });
    }
    void loadData();
  };

  const setLinkedInPipelineStatus = async (
    c: EligibleCandidate,
    next: LinkedInTrackStatus,
    logDescription: string,
  ) => {
    if (!supabase) return;
    setLiBusyId(c.id);
    const { error: uErr } = await supabase
      .from("candidates")
      .update({ linkedin_track_status: next })
      .eq("id", c.id)
      .eq("is_deleted", false);
    setLiBusyId(null);
    if (uErr) {
      setError(uErr.message);
      return;
    }
    const display = c.full_name?.trim() || c.email || "Candidate";
    const authS = await getUserSafe(supabase);
    if (authS) {
      await logActivity({
        supabase,
        user: authS,
        action_type: "interviews",
        entity_type: "candidate",
        entity_id: c.id,
        candidate_name: display,
        description: logDescription,
      });
    }
    void loadData();
  };

  const markLinkedInEligibleWithDispatch = async (c: EligibleCandidate) => {
    if (!supabase) return;
    if (c.linkedin_track_status === "eligible") return;
    setLiBusyId(c.id);
    const prevStatus: LinkedInTrackStatus =
      c.linkedin_track_status ?? "pending_post";
    const { error: uErr } = await supabase
      .from("candidates")
      .update({ linkedin_track_status: "eligible" })
      .eq("id", c.id)
      .eq("is_deleted", false);
    if (uErr) {
      setLiBusyId(null);
      setError(uErr.message);
      return;
    }
    const { error: dErr } = await supabase.from("dispatch").insert({
      candidate_id: c.id,
      shipping_address: null,
      dispatch_status: "pending",
      reward_item: REWARD_JBL_CLIP,
      special_comments:
        "LinkedIn track reward — collect shipping address before dispatch.",
    });
    if (dErr) {
      await supabase
        .from("candidates")
        .update({ linkedin_track_status: prevStatus })
        .eq("id", c.id)
        .eq("is_deleted", false);
      setLiBusyId(null);
      setError(dErr.message);
      return;
    }
    const display = c.full_name?.trim() || c.email || "Candidate";
    const authE = await getUserSafe(supabase);
    if (authE) {
      await logActivity({
        supabase,
        user: authE,
        action_type: "interviews",
        entity_type: "candidate",
        entity_id: c.id,
        candidate_name: display,
        description: `LinkedIn track: marked ${display} eligible — ${REWARD_JBL_CLIP} dispatch created`,
      });
    }
    setLiBusyId(null);
    void loadData();
  };

  const tableWrap =
    "overflow-hidden rounded-2xl border border-[#f0f0f0] bg-white shadow-sm";
  const thBase =
    "border-b border-gray-100 bg-[#fafafa] py-3 px-4 text-xs font-semibold tracking-wider text-gray-400";
  const tdBase =
    "border-b border-gray-100 py-4 px-4 text-sm align-middle text-[#1d1d1f]";

  const thName = `${thBase} min-w-[180px] text-left`;
  const thEmail = `${thBase} min-w-[220px] text-left`;
  const thInterviewType = `${thBase} min-w-[150px] text-center`;
  const thLanguage = `${thBase} min-w-[120px] text-center`;
  const thTrack = `${thBase} min-w-[130px] text-left`;
  const thLinkedInStatus = `${thBase} min-w-[140px] text-left`;
  const thPocAssigned = `${thBase} min-w-[160px] text-left`;
  const thAssignedOn = `${thBase} min-w-[140px] text-left`;
  const thFollowUp = `${thBase} min-w-[150px] text-left`;
  const thActions = `${thBase} min-w-[220px] text-right max-lg:min-w-[170px] max-lg:px-2 max-lg:py-2 max-lg:text-[10px]`;

  const tdName = `${tdBase} min-w-[180px] text-left`;
  const tdEmail = `${tdBase} min-w-[220px] text-left text-[#6e6e73]`;
  const tdInterviewType = `${tdBase} min-w-[150px] text-center`;
  const tdLanguage = `${tdBase} min-w-[120px] text-center`;
  const tdTrack = `${tdBase} min-w-[130px] text-left align-top`;
  const tdLinkedInStatus = `${tdBase} min-w-[140px] text-left align-top`;
  const tdPocAssigned = `${tdBase} min-w-[160px] text-left`;
  const tdAssignedOn = `${tdBase} min-w-[140px] text-left text-[#6e6e73]`;
  const tdFollowUp = `${tdBase} min-w-[150px] text-left align-top`;
  const tdActions = `${tdBase} min-w-[220px] text-right max-lg:min-w-[170px] max-lg:px-2 max-lg:py-2 max-lg:text-xs`;

  const thDateTime = `${thBase} min-w-[170px] text-left`;
  const tdDateTime = `${tdBase} min-w-[170px] text-left`;
  const thInterviewer = `${thBase} min-w-[120px] text-left`;
  const tdInterviewer = `${tdBase} min-w-[120px] text-left`;
  const thZoomStatus = `${thBase} min-w-[150px] text-left`;
  const tdZoomStatus = `${tdBase} min-w-[150px] text-left align-top`;
  const thPocInterview = `${thBase} min-w-[120px] text-left`;
  const tdPocInterview = `${tdBase} min-w-[120px] text-left text-[#6e6e73]`;

  const thReason = `${thBase} min-w-[180px] text-left`;
  const tdReason = `${tdBase} min-w-[180px] text-left text-[#6e6e73]`;

  const thDateOnly = `${thBase} min-w-[130px] text-left`;
  const tdDateOnly = `${tdBase} min-w-[130px] text-left`;
  const thCompletedOn = `${thBase} min-w-[170px] text-left`;
  const tdCompletedOn = `${tdBase} min-w-[170px] text-left`;
  const thPhone = `${thBase} min-w-[130px] text-left`;
  const tdPhone = `${tdBase} min-w-[130px] text-left text-[#6e6e73]`;
  const thPostInterview = `${thBase} min-w-[160px] text-left`;
  const tdPostInterview = `${tdBase} min-w-[160px] text-left`;
  const thPostProdGate = `${thBase} min-w-[120px] text-left`;
  const tdPostProdGate = `${tdBase} min-w-[120px] text-left align-top`;
  const thCategoryCol = `${thBase} min-w-[120px] text-left`;
  const tdCategoryCol = `${tdBase} min-w-[120px] text-left text-[#6e6e73]`;
  const thFunnelCol = `${thBase} min-w-[120px] text-left`;
  const tdFunnelCol = `${tdBase} min-w-[120px] text-left text-[#6e6e73]`;
  const thCommentsCol = `${thBase} min-w-[160px] text-left`;
  const tdCommentsCol = `${tdBase} min-w-[160px] text-left text-[#6e6e73]`;

  const filterInp =
    "w-full rounded-xl border border-[#e5e5e5] bg-white px-3 py-2 text-sm text-[#1d1d1f] focus:border-[#3b82f6] focus:outline-none focus:ring-0";
  const nameLinkBtn =
    "max-w-full min-w-0 truncate text-left font-medium text-[#3b82f6] hover:underline focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/25 rounded-sm";

  const renderPagination = (
    tab: BoardTab,
    totalPages: number,
    total: number,
  ) => {
    const page =
      tab === "completed"
        ? completedFilters.page
        : filters[tab as SimpleTab].page;
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

  const emptyState = (
    <div className="py-16 text-center text-sm text-[#aeaeb2]">
      No entries here yet
    </div>
  );

  if (!supabase) {
    return (
      <div className="mx-auto max-w-lg px-8 py-16 text-center text-sm text-[#6e6e73]">
        {error ?? "Cannot connect to Supabase."}
      </div>
    );
  }

  return (
    <>
      {toastMessage ? (
        <div
          className="fixed bottom-6 left-1/2 z-[70] max-w-md -translate-x-1/2 rounded-xl border border-[#e5e5e5] bg-[#1d1d1f] px-4 py-3 text-center text-sm font-medium text-white shadow-lg"
          role="status"
        >
          {toastMessage}
        </div>
      ) : null}

      <header className="sticky top-14 z-30 bg-[#f5f5f7]/90 px-4 py-4 backdrop-blur-md sm:px-6 sm:py-5 lg:top-0 lg:px-8 lg:py-6">
        <h1 className="text-xl font-semibold tracking-tight text-[#1d1d1f] sm:text-2xl">
          Testimonial Interviews
        </h1>
        <p className="mt-1 text-sm text-[#6e6e73]">
          Eligible and scheduled testimonial interviews · real-time updates
        </p>
        {showViewOnlyBadge ? (
          <span className="mt-2 inline-flex rounded-full bg-[#f3f4f6] px-3 py-1 text-xs font-medium text-[#6b7280]">
            View only
          </span>
        ) : null}
      </header>

      <main className="mx-auto max-w-[1600px] px-4 pb-10 pt-2 text-sm text-[#1d1d1f] sm:px-6 lg:px-8 lg:pb-12">
        {error && (
          <div className="mb-4 rounded-2xl border border-[#f0f0f0] bg-white px-4 py-3 text-sm text-[#1d1d1f] shadow-[0_4px_16px_rgba(0,0,0,0.08)]">
            {error}
            <button
              type="button"
              className="ml-2 font-medium text-[#3b82f6] hover:text-[#2563eb]"
              onClick={() => setError(null)}
            >
              Dismiss
            </button>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-[#6e6e73]">Loading…</p>
        ) : (
          <>
            <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
              {(
                [
                  {
                    key: "eligible" as const,
                    label: "Eligible",
                    value: counts.eligible,
                    accent: "bg-[#16a34a]",
                  },
                  {
                    key: "scheduled",
                    label: "Scheduled",
                    value: counts.scheduled,
                    accent: "bg-[#2563eb]",
                  },
                  {
                    key: "rescheduled",
                    label: "Rescheduled",
                    value: counts.rescheduled,
                    accent: "bg-[#ea580c]",
                  },
                  {
                    key: "completed",
                    label: "Completed",
                    value: counts.completed,
                    accent: "bg-[#059669]",
                  },
                ] as const
              ).map((card) => (
                <div key={card.key} className={`p-4 sm:p-6 ${cardChrome}`}>
                  <p className="mb-2 text-xs font-medium text-[#6e6e73] sm:mb-3">
                    {card.label}
                  </p>
                  <p className="text-2xl font-bold tabular-nums tracking-tight text-[#1d1d1f] sm:text-4xl">
                    {card.value}
                  </p>
                  <div className={`mt-4 h-0.5 w-8 rounded-full ${card.accent}`} />
                </div>
              ))}
            </section>

            <div className="mb-6 -mx-1 border-b border-[#e5e5e5] pb-1">
              <div className="flex gap-2 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] lg:flex-wrap lg:overflow-visible [&::-webkit-scrollbar]:hidden">
                {(
                  [
                    ["eligible", "Eligible", counts.eligible],
                    ["scheduled", "Scheduled", counts.scheduled],
                    ["rescheduled", "Rescheduled", counts.rescheduled],
                    ["completed", "Completed", counts.completed],
                  ] as const
                ).map(([id, label, n]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveTab(id)}
                    className={`shrink-0 ${
                      activeTab === id
                        ? "rounded-full bg-[#1d1d1f] px-3 py-2 text-sm font-medium text-white sm:px-4"
                        : "rounded-full px-3 py-2 text-sm font-medium text-[#6e6e73] transition-colors hover:text-[#1d1d1f] sm:px-4"
                    }`}
                  >
                    {label}{" "}
                    <span className={activeTab === id ? "text-white/80" : ""}>
                      ({n})
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {activeTab === "eligible" && (
              <section className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <label className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
                      Search
                    </span>
                    <input
                      type="search"
                      placeholder="Name or email"
                      className={filterInp}
                      value={filters.eligible.search}
                      onChange={(e) =>
                        updateFilter("eligible", { search: e.target.value })
                      }
                    />
                  </label>
                  <label className="flex w-full flex-col gap-1 sm:w-48 sm:shrink-0">
                    <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
                      Interview type
                    </span>
                    <select
                      className={filterInp}
                      value={filters.eligible.interviewType}
                      onChange={(e) =>
                        updateFilter("eligible", {
                          interviewType: e.target
                            .value as InterviewTypeFilter,
                        })
                      }
                    >
                      <option value="all">All</option>
                      <option value="testimonial">Testimonial</option>
                      <option value="project">Project</option>
                    </select>
                  </label>
                </div>

                <div className={tableWrap}>
                  <div className="w-full min-w-0 max-w-full overflow-x-auto">
                    <table className="w-full min-w-[1100px] table-auto border-collapse">
                      <thead>
                        <tr>
                          <th className={thName}>Name</th>
                          <th className={thEmail}>Email</th>
                          <th className={thInterviewType}>Interview type</th>
                          <th className={thTrack}>Track</th>
                          <th className={thPocAssigned}>POC assigned</th>
                          <th className={thAssignedOn}>Assigned On</th>
                          <th className={thFollowUp}>Follow-up</th>
                          <th className={thActions}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {eligiblePage.slice.length === 0 ? (
                          <tr>
                            <td className={tdBase} colSpan={8}>
                              {emptyState}
                            </td>
                          </tr>
                        ) : (
                          eligiblePage.slice.map((c) => {
                            const hasPoc = Boolean(c.poc_assigned?.trim());
                            const showPocDropdown =
                              !hasPoc || pocEditingId === c.id;
                            const showSchedule = canShowEligibleScheduleButton(c);
                            const scheduleDisabled =
                              !canEditEligibleTab ||
                              !hasPoc ||
                              eligibleScheduleDisabled(c);
                            const scheduleTitle = !canEditEligibleTab
                              ? "View only"
                              : !hasPoc
                                ? "Assign a POC first"
                                : eligibleScheduleTooltip(c);
                            return (
                              <tr key={c.id}>
                                <td className={tdName}>
                                  <div className="flex flex-col gap-1">
                                    <button
                                      type="button"
                                      className={nameLinkBtn}
                                      onClick={() =>
                                        setDetailCandidateId(c.id)
                                      }
                                    >
                                      {c.full_name?.trim() || "—"}
                                    </button>
                                    <button
                                      type="button"
                                      className="w-fit text-left text-xs font-medium text-[#6e6e73] underline decoration-[#d1d5db] underline-offset-2 hover:text-[#1d1d1f]"
                                      onClick={() =>
                                        setFollowupHistoryFor({
                                          id: c.id,
                                          label:
                                            c.full_name?.trim() ||
                                            c.email ||
                                            "Candidate",
                                        })
                                      }
                                    >
                                      View history
                                    </button>
                                  </div>
                                </td>
                                <td className={tdEmail}>{c.email}</td>
                                <td className={tdInterviewType}>
                                  <div className="flex items-center justify-center">
                                    {interviewTypeBadge(c.interview_type)}
                                  </div>
                                </td>
                                <td className={tdTrack}>
                                  <div className="flex flex-col gap-1.5">
                                    <span className="text-[#6e6e73]">—</span>
                                    <button
                                      type="button"
                                      disabled={liBusyId === c.id}
                                      className="w-fit text-left text-xs font-medium text-[#7c3aed] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                                      onClick={() =>
                                        void moveCandidateToLinkedInTrack(c)
                                      }
                                    >
                                      → LinkedIn
                                    </button>
                                  </div>
                                </td>
                                <td className={tdPocAssigned}>
                                  {showPocDropdown ? (
                                    <div className="flex flex-wrap items-center gap-2">
                                      <select
                                        disabled={pocSavingId === c.id}
                                        className="max-w-[180px] rounded-lg border border-[#e5e5e5] bg-white px-2 py-1.5 text-xs text-[#1d1d1f] focus:border-[#3b82f6] focus:outline-none disabled:opacity-50"
                                        value={c.poc_assigned ?? ""}
                                        onChange={(e) =>
                                          void handlePocChange(
                                            c,
                                            e.target.value,
                                          )
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
                                <td className={tdAssignedOn}>
                                  {formatAssignedOnIst(
                                    c.assigned_at ?? c.poc_assigned_at ?? null,
                                  )}
                                </td>
                                <td className={tdFollowUp}>
                                  <div className="flex flex-col gap-1">
                                    {followupStatusBadgeFromSnapshot(c)}
                                  </div>
                                </td>
                                <td className={tdActions}>
                                  <div className="flex flex-wrap items-center justify-end gap-2">
                                    <button
                                      type="button"
                                      disabled={!canEditEligibleTab}
                                      title={
                                        !canEditEligibleTab
                                          ? "View only"
                                          : undefined
                                      }
                                      className="rounded-lg border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#1d1d1f] transition-colors hover:bg-[#fafafa] disabled:cursor-not-allowed disabled:opacity-50"
                                      onClick={() =>
                                        canEditEligibleTab
                                          ? setLogFollowupFor(c)
                                          : undefined
                                      }
                                    >
                                      Log Call
                                    </button>
                                    {showSchedule ? (
                                      <button
                                        type="button"
                                        disabled={scheduleDisabled}
                                        title={scheduleTitle}
                                        className="rounded-lg bg-[#1d1d1f] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#2d2d2f] disabled:cursor-not-allowed disabled:bg-[#d1d5db] disabled:text-[#6b7280]"
                                        onClick={() => {
                                          setScheduleProjectFor(null);
                                          setScheduleFor({
                                            id: c.id,
                                            full_name: c.full_name,
                                            email: c.email,
                                            whatsapp_number:
                                              c.whatsapp_number,
                                            interview_type: c.interview_type,
                                            poc_assigned: c.poc_assigned,
                                          });
                                        }}
                                      >
                                        Schedule
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
                    "eligible",
                    eligiblePage.totalPages,
                    eligiblePage.total,
                  )}
                </div>

                {notInterestedEligibleFiltered.length > 0 ? (
                  <div className="mt-8 space-y-2">
                    <button
                      type="button"
                      onClick={() => setNotInterestedOpen((o) => !o)}
                      className="flex w-full items-center justify-between rounded-xl border border-[#f0f0f0] bg-[#fafafa] px-4 py-3 text-left text-sm font-semibold text-[#1d1d1f] transition-colors hover:bg-[#f5f5f7]"
                    >
                      <span>
                        Not Interested ({notInterestedEligibleFiltered.length})
                      </span>
                      <span className="text-[#6e6e73]">
                        {notInterestedOpen ? "▼" : "▶"}
                      </span>
                    </button>
                    {notInterestedOpen ? (
                      <div className={tableWrap}>
                        <div className="w-full min-w-0 max-w-full overflow-x-auto">
                          <table className="w-full min-w-[800px] table-auto border-collapse">
                            <thead>
                              <tr>
                                <th className={thName}>Name</th>
                                <th className={thPhone}>Phone</th>
                                <th className={thReason}>Reason</th>
                                <th className={thDateOnly}>Date</th>
                                <th className={thActions}>Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {notInterestedEligibleFiltered.map((c) => {
                                const label =
                                  c.full_name?.trim() || c.email || "—";
                                return (
                                  <tr key={c.id}>
                                    <td className={tdName}>{label}</td>
                                    <td className={tdPhone}>
                                      {c.whatsapp_number?.trim() || "—"}
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
                                          !canEditEligibleTab ||
                                          restoringNotInterestedId === c.id
                                        }
                                        className="rounded-lg border border-[#1d1d1f] bg-white px-3 py-1.5 text-xs font-medium text-[#1d1d1f] hover:bg-[#fafafa] disabled:cursor-not-allowed disabled:opacity-50"
                                        onClick={() =>
                                          void handleMarkNotInterestedActive(c)
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

                {linkedInTrackFiltered.length > 0 ? (
                  <div className="mt-10 space-y-3">
                    <div>
                      <h2 className="text-base font-semibold text-[#1d1d1f]">
                        LinkedIn track
                      </h2>
                      <p className="mt-1 text-xs text-[#6e6e73]">
                        These candidates are no longer in the interview
                        scheduling queue. Update posting status and reward
                        eligibility below.
                      </p>
                    </div>
                    <div className={tableWrap}>
                      <div className="w-full min-w-0 max-w-full overflow-x-auto">
                        <table className="w-full min-w-[980px] table-auto border-collapse">
                          <thead>
                            <tr>
                              <th className={thName}>Name</th>
                              <th className={thEmail}>Email</th>
                              <th className={thInterviewType}>
                                Interview type
                              </th>
                              <th className={thTrack}>Track</th>
                              <th className={thLinkedInStatus}>
                                LinkedIn status
                              </th>
                              <th className={thActions}>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {linkedInPageData.slice.map((c) => {
                              const st = c.linkedin_track_status;
                              const display =
                                c.full_name?.trim() || c.email || "Candidate";
                              const busy = liBusyId === c.id;
                              return (
                                <tr key={c.id}>
                                  <td className={tdName}>
                                    <button
                                      type="button"
                                      className={nameLinkBtn}
                                      onClick={() =>
                                        setDetailCandidateId(c.id)
                                      }
                                    >
                                      {c.full_name?.trim() || "—"}
                                    </button>
                                  </td>
                                  <td className={tdEmail}>{c.email}</td>
                                  <td className={tdInterviewType}>
                                    <div className="flex items-center justify-center">
                                      {interviewTypeBadge(c.interview_type)}
                                    </div>
                                  </td>
                                  <td className={tdTrack}>
                                    {linkedInTrackColumnBadge()}
                                  </td>
                                  <td className={tdLinkedInStatus}>
                                    {linkedInPipelineBadge(st)}
                                  </td>
                                  <td className={tdActions}>
                                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                                      {st === "pending_post" ? (
                                        <button
                                          type="button"
                                          disabled={busy}
                                          className="rounded-lg border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-xs font-medium text-[#1d1d1f] hover:bg-[#f5f5f7] disabled:opacity-50"
                                          onClick={() =>
                                            void setLinkedInPipelineStatus(
                                              c,
                                              "posted",
                                              `LinkedIn track: marked ${display} as posted`,
                                            )
                                          }
                                        >
                                          Mark Posted
                                        </button>
                                      ) : null}
                                      {st === "posted" ? (
                                        <button
                                          type="button"
                                          disabled={busy}
                                          className="rounded-lg border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-xs font-medium text-[#1d1d1f] hover:bg-[#f5f5f7] disabled:opacity-50"
                                          onClick={() =>
                                            void setLinkedInPipelineStatus(
                                              c,
                                              "verified",
                                              `LinkedIn track: confirmed ${display} LinkedIn post (verified)`,
                                            )
                                          }
                                        >
                                          Mark Verified
                                        </button>
                                      ) : null}
                                      {st === "posted" || st === "verified" ? (
                                        <>
                                          <button
                                            type="button"
                                            disabled={busy}
                                            className="rounded-lg bg-[#16a34a] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#15803d] disabled:opacity-50"
                                            onClick={() =>
                                              void markLinkedInEligibleWithDispatch(
                                                c,
                                              )
                                            }
                                          >
                                            Mark Eligible
                                          </button>
                                          <button
                                            type="button"
                                            disabled={busy}
                                            className="rounded-lg bg-[#dc2626] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#b91c1c] disabled:opacity-50"
                                            onClick={() =>
                                              void setLinkedInPipelineStatus(
                                                c,
                                                "not_eligible",
                                                `LinkedIn track: marked ${display} not eligible`,
                                              )
                                            }
                                          >
                                            Mark Not Eligible
                                          </button>
                                        </>
                                      ) : null}
                                      {st === "eligible" ||
                                      st === "not_eligible" ? (
                                        <span className="text-xs text-[#aeaeb2]">
                                          —
                                        </span>
                                      ) : null}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      {linkedInPageData.total > 0 ? (
                        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#f0f0f0] bg-[#fafafa] px-4 py-3 text-xs text-[#6e6e73]">
                          <span>
                            Showing {linkedInListPage * PAGE_SIZE + 1}–
                            {Math.min(
                              (linkedInListPage + 1) * PAGE_SIZE,
                              linkedInPageData.total,
                            )}{" "}
                            of {linkedInPageData.total}
                          </span>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={linkedInListPage <= 0}
                              className="rounded-lg border border-[#e5e5e5] bg-white px-3 py-1.5 font-medium text-[#1d1d1f] transition-colors hover:bg-[#f5f5f7] disabled:cursor-not-allowed disabled:opacity-40"
                              onClick={() =>
                                setLinkedInListPage((p) => Math.max(0, p - 1))
                              }
                            >
                              Previous
                            </button>
                            <button
                              type="button"
                              disabled={
                                linkedInListPage >=
                                linkedInPageData.totalPages - 1
                              }
                              className="rounded-lg border border-[#e5e5e5] bg-white px-3 py-1.5 font-medium text-[#1d1d1f] transition-colors hover:bg-[#f5f5f7] disabled:cursor-not-allowed disabled:opacity-40"
                              onClick={() =>
                                setLinkedInListPage((p) => p + 1)
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

            {activeTab === "scheduled" && (
              <section className="space-y-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <label className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
                      Search
                    </span>
                    <input
                      type="search"
                      placeholder="Name or email"
                      className={filterInp}
                      value={filters.scheduled.search}
                      onChange={(e) =>
                        updateFilter("scheduled", { search: e.target.value })
                      }
                    />
                  </label>
                  <div className="flex w-full flex-col gap-3 sm:flex-row lg:w-auto lg:shrink-0">
                    <label className="flex w-full flex-col gap-1 sm:w-48">
                      <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
                        Interview type
                      </span>
                      <select
                        className={filterInp}
                        value={filters.scheduled.interviewType}
                        onChange={(e) =>
                          updateFilter("scheduled", {
                            interviewType: e.target
                              .value as InterviewTypeFilter,
                          })
                        }
                      >
                        <option value="all">All</option>
                        <option value="testimonial">Testimonial</option>
                        <option value="project">Project</option>
                      </select>
                    </label>
                    <label className="flex w-full flex-col gap-1 sm:w-48">
                      <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
                        Language
                      </span>
                      <select
                        className={filterInp}
                        value={filters.scheduled.language}
                        onChange={(e) =>
                          updateFilter("scheduled", {
                            language: e.target
                              .value as InterviewLanguageFilter,
                          })
                        }
                      >
                        {LANGUAGE_FILTER_OPTIONS.map(({ value, label }) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex w-full flex-col gap-1 sm:w-48">
                      <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
                        Zoom status
                      </span>
                      <select
                        className={filterInp}
                        value={filters.scheduled.zoomStatus}
                        onChange={(e) =>
                          updateFilter("scheduled", {
                            zoomStatus: e.target.value as ZoomStatusFilter,
                          })
                        }
                      >
                        {ZOOM_STATUS_FILTER_OPTIONS.map(({ value, label }) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>

                <div className={tableWrap}>
                  <div className="w-full min-w-0 max-w-full overflow-x-auto">
                    <table className="w-full min-w-[1380px] table-auto border-collapse">
                      <thead>
                        <tr>
                          <th className={thName}>Name</th>
                          <th className={thEmail}>Email</th>
                          <th className={thInterviewType}>Interview type</th>
                          <th className={thLanguage}>Language</th>
                          <th className={thDateTime}>Date &amp; time</th>
                          <th className={thInterviewer}>Interviewer</th>
                          <th className={thZoomStatus}>Zoom status</th>
                          <th className={thPocInterview}>POC</th>
                          <th className={thActions}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scheduledPage.slice.length === 0 ? (
                          <tr>
                            <td className={tdBase} colSpan={9}>
                              {emptyState}
                            </td>
                          </tr>
                        ) : (
                          scheduledPage.slice.map((i) => {
                            const status = i.interview_status?.trim().toLowerCase();
                            const isDraftRow = status === "draft";
                            const isCompletedRow = status === "completed";
                            const hasZoom = Boolean(
                              i.zoom_link?.trim() || i.zoom_account?.trim(),
                            );
                            const hasIv = hasAssignedInterviewer(i);
                            return (
                              <tr key={i.id}>
                                <td className={tdName}>
                                  <button
                                    type="button"
                                    className={nameLinkBtn}
                                    onClick={() =>
                                      setDetailCandidateId(i.candidate_id)
                                    }
                                  >
                                    {i.candidates?.full_name?.trim() || "—"}
                                  </button>
                                </td>
                                <td className={tdEmail}>
                                  {i.candidates?.email || "—"}
                                </td>
                                <td className={tdInterviewType}>
                                  <div className="flex items-center justify-center">
                                    {interviewTypeBadge(i.interview_type)}
                                  </div>
                                </td>
                                <td className={tdLanguage}>
                                  <div className="flex items-center justify-center">
                                    {interviewLanguageBadge(i)}
                                  </div>
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
                                  {zoomStatusColumn(i, {
                                    canEditScheduledTab,
                                    onOpenZoomModal: setAddZoomFor,
                                  })}
                                </td>
                                <td className={tdPocInterview}>
                                  {i.poc?.trim() ||
                                    i.candidates?.poc_assigned?.trim() ||
                                    "—"}
                                </td>
                                <td className={tdActions}>
                                  <div className="flex flex-wrap items-center justify-end gap-2">
                                    <button
                                      type="button"
                                      disabled={!canEditScheduledTab}
                                      title={
                                        !canEditScheduledTab
                                          ? "View only"
                                          : undefined
                                      }
                                      className="rounded-lg border border-[#d4d4d8] bg-white px-3 py-1.5 text-xs font-medium text-[#1d1d1f] hover:bg-[#fafafa] disabled:cursor-not-allowed disabled:border-[#d1d5db] disabled:text-[#9ca3af]"
                                      onClick={() =>
                                        canEditScheduledTab
                                          ? setEditInterviewFor(i)
                                          : undefined
                                      }
                                    >
                                      Edit
                                    </button>
                                    {isDraftRow && !hasIv ? (
                                      <button
                                        type="button"
                                        disabled={!canEditScheduledTab}
                                        title={
                                          !canEditScheduledTab
                                            ? "View only"
                                            : undefined
                                        }
                                        className="rounded-lg bg-[#2563eb] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:bg-[#d1d5db] disabled:text-[#6b7280]"
                                        onClick={() =>
                                          canEditScheduledTab
                                            ? setAssignInterviewerFor(i)
                                            : undefined
                                        }
                                      >
                                        Assign Interviewer
                                      </button>
                                    ) : null}
                                    <button
                                      type="button"
                                      disabled={
                                        !canEditScheduledTab || isCompletedRow
                                      }
                                      title={
                                        !canEditScheduledTab
                                          ? "View only"
                                          : isCompletedRow
                                            ? "Already completed"
                                            : undefined
                                      }
                                      className="rounded-lg bg-[#ea580c] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#c2410c] disabled:cursor-not-allowed disabled:bg-[#d1d5db] disabled:text-[#6b7280]"
                                      onClick={() => {
                                        console.debug(
                                          "[InterviewsBoard] reschedule click",
                                          i,
                                        );
                                        if (!canEditScheduledTab || isCompletedRow) return;
                                        setRescheduleCtx({
                                          interview: i,
                                          mode: "from_scheduled",
                                        });
                                      }}
                                    >
                                      Reschedule
                                    </button>
                                    <button
                                      type="button"
                                      disabled={
                                        !canEditScheduledTab ||
                                        !hasZoom ||
                                        isCompletedRow
                                      }
                                      title={
                                        !canEditScheduledTab
                                          ? "View only"
                                          : isCompletedRow
                                            ? "Already completed"
                                            : !hasZoom
                                              ? "Add Zoom details first"
                                            : undefined
                                      }
                                      className="rounded-lg bg-[#16a34a] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#15803d] disabled:cursor-not-allowed disabled:bg-[#d1d5db] disabled:text-[#6b7280]"
                                      onClick={() => {
                                        console.debug(
                                          "[InterviewsBoard] mark completed click",
                                          i,
                                        );
                                        openCompleteModal(i);
                                      }}
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

            {activeTab === "rescheduled" && (
              <section className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <label className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
                      Search
                    </span>
                    <input
                      type="search"
                      placeholder="Name or email"
                      className={filterInp}
                      value={filters.rescheduled.search}
                      onChange={(e) =>
                        updateFilter("rescheduled", { search: e.target.value })
                      }
                    />
                  </label>
                  <label className="flex w-full flex-col gap-1 sm:w-48 sm:shrink-0">
                    <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
                      Interview type
                    </span>
                    <select
                      className={filterInp}
                      value={filters.rescheduled.interviewType}
                      onChange={(e) =>
                        updateFilter("rescheduled", {
                          interviewType: e.target
                            .value as InterviewTypeFilter,
                        })
                      }
                    >
                      <option value="all">All</option>
                      <option value="testimonial">Testimonial</option>
                      <option value="project">Project</option>
                    </select>
                  </label>
                </div>

                <div className={tableWrap}>
                  <div className="w-full min-w-0 max-w-full overflow-x-auto">
                    <table className="w-full min-w-[1280px] table-auto border-collapse">
                      <thead>
                        <tr>
                          <th className={thName}>Name</th>
                          <th className={thEmail}>Email</th>
                          <th className={thInterviewType}>Interview type</th>
                          <th className={thDateTime}>Original date</th>
                          <th className={thReason}>Reschedule reason</th>
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
                          rescheduledPage.slice.map((i) => (
                            <tr key={i.id}>
                              <td className={tdName}>
                                <button
                                  type="button"
                                  className={nameLinkBtn}
                                  onClick={() =>
                                    setDetailCandidateId(i.candidate_id)
                                  }
                                >
                                  {i.candidates?.full_name?.trim() || "—"}
                                </button>
                              </td>
                              <td className={tdEmail}>
                                {i.candidates?.email}
                              </td>
                              <td className={tdInterviewType}>
                                <div className="flex items-center justify-center">
                                  {interviewTypeBadge(i.interview_type)}
                                </div>
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
                              <td className={tdInterviewer}>
                                {formatInterviewerStoredForUi(i.interviewer)}
                              </td>
                              <td className={tdActions}>
                                <div className="flex flex-wrap items-center justify-end gap-2">
                                  <button
                                    type="button"
                                    disabled={!canEditRescheduledTab}
                                    className="rounded-lg bg-[#1d1d1f] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#2d2d2f]"
                                    onClick={() =>
                                      canEditRescheduledTab
                                        ? setRescheduleCtx({
                                            interview: i,
                                            mode: "from_rescheduled",
                                          })
                                        : undefined
                                    }
                                  >
                                    Schedule again
                                  </button>
                                  <button
                                    type="button"
                                    disabled={
                                      !canEditRescheduledTab ||
                                      !Boolean(
                                        i.zoom_link?.trim() ||
                                          i.zoom_account?.trim(),
                                      ) ||
                                      i.interview_status?.trim().toLowerCase() ===
                                        "completed"
                                    }
                                    title={
                                      !canEditRescheduledTab
                                        ? "View only"
                                        : i.interview_status?.trim().toLowerCase() ===
                                            "completed"
                                          ? "Already completed"
                                          : !(
                                                i.zoom_link?.trim() ||
                                                i.zoom_account?.trim()
                                              )
                                          ? "Add Zoom details first"
                                          : undefined
                                    }
                                    className="rounded-lg bg-[#16a34a] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#15803d] disabled:cursor-not-allowed disabled:bg-[#d1d5db] disabled:text-[#6b7280]"
                                    onClick={() =>
                                      canEditRescheduledTab
                                        ? (console.debug(
                                            "[InterviewsBoard] mark completed click",
                                            i,
                                          ),
                                          openCompleteModal(i))
                                        : undefined
                                    }
                                  >
                                    Mark completed
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))
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

            {activeTab === "completed" && (
              <section className="space-y-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <label className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
                      Search
                    </span>
                    <input
                      type="search"
                      placeholder="Name, email, or phone"
                      className={filterInp}
                      value={completedFilters.search}
                      onChange={(e) =>
                        patchCompletedFilters({ search: e.target.value })
                      }
                    />
                  </label>
                  <div className="flex w-full flex-col gap-3 sm:flex-row lg:w-auto lg:shrink-0">
                    <label className="flex w-full flex-col gap-1 sm:w-48">
                      <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
                        Interview type
                      </span>
                      <select
                        className={filterInp}
                        value={completedFilters.interviewType}
                        onChange={(e) =>
                          patchCompletedFilters({
                            interviewType: e.target
                              .value as InterviewTypeFilter,
                          })
                        }
                      >
                        <option value="all">All</option>
                        <option value="testimonial">Testimonial</option>
                        <option value="project">Project</option>
                      </select>
                    </label>
                    <label className="flex w-full flex-col gap-1 sm:w-48">
                      <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
                        Language
                      </span>
                      <select
                        className={filterInp}
                        value={completedFilters.language}
                        onChange={(e) =>
                          patchCompletedFilters({
                            language: e.target
                              .value as InterviewLanguageFilter,
                          })
                        }
                      >
                        {LANGUAGE_FILTER_OPTIONS.map(({ value, label }) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={exportCompletedCsv}
                      disabled={completedFiltered.length === 0}
                      className="rounded-xl border border-[#e5e5e5] bg-white px-4 py-2 text-sm font-medium text-[#1d1d1f] transition-colors hover:bg-[#f5f5f7] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Export CSV
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-3 rounded-2xl border border-[#f0f0f0] bg-white p-4 shadow-sm">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
                        Post-interview eligible
                      </span>
                      <select
                        className={filterInp}
                        value={completedFilters.postInterviewEligible}
                        onChange={(e) =>
                          patchCompletedFilters({
                            postInterviewEligible: e.target
                              .value as PostInterviewEligibleFilter,
                          })
                        }
                      >
                        <option value="all">All</option>
                        <option value="eligible">Eligible</option>
                        <option value="not_eligible">Not eligible</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
                        Interviewer
                      </span>
                      <select
                        className={filterInp}
                        value={completedFilters.interviewer}
                        onChange={(e) =>
                          patchCompletedFilters({
                            interviewer: e.target.value,
                          })
                        }
                      >
                        <option value="all">All</option>
                        {interviewerRoster.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
                        Completed from
                      </span>
                      <input
                        type="date"
                        className={filterInp}
                        value={completedFilters.completedFrom}
                        onChange={(e) =>
                          patchCompletedFilters({
                            completedFrom: e.target.value,
                          })
                        }
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
                        Completed to
                      </span>
                      <input
                        type="date"
                        className={filterInp}
                        value={completedFilters.completedTo}
                        onChange={(e) =>
                          patchCompletedFilters({
                            completedTo: e.target.value,
                          })
                        }
                      />
                    </label>
                    <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-1 xl:col-span-2">
                      <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
                        Category
                      </span>
                      <select
                        className={filterInp}
                        value={completedFilters.category}
                        onChange={(e) =>
                          patchCompletedFilters({
                            category: e.target.value,
                          })
                        }
                      >
                        <option value="">All</option>
                        {completedCategoryOptions.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="flex justify-end border-t border-gray-100 pt-3">
                    <button
                      type="button"
                      className="text-sm font-medium text-[#3b82f6] hover:text-[#2563eb]"
                      onClick={clearCompletedFilters}
                    >
                      Clear all filters
                    </button>
                  </div>
                </div>

                <div className={tableWrap}>
                  <div className="w-full min-w-0 max-w-full overflow-x-auto">
                    <table className="w-full min-w-[1640px] table-auto border-collapse">
                      <thead>
                        <tr>
                          <th className={thName}>Name</th>
                          <th className={thPhone}>Phone</th>
                          <th className={thInterviewType}>Interview type</th>
                          <th className={thLanguage}>Language</th>
                          <th className={thInterviewer}>Interviewer</th>
                          <th className={thCompletedOn}>Completed on</th>
                          <th className={thPostInterview}>
                            Post-interview eligible
                          </th>
                          <th
                            className={thPostProdGate}
                            title={POST_PRODUCTION_ELIGIBILITY_TOOLTIP}
                          >
                            Post production
                          </th>
                          <th className={thCategoryCol}>Category</th>
                          <th className={thFunnelCol}>Funnel</th>
                          <th className={thCommentsCol}>Comments</th>
                          <th className={thActions}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {completedPage.slice.length === 0 ? (
                          <tr>
                            <td className={tdBase} colSpan={12}>
                              {emptyState}
                            </td>
                          </tr>
                        ) : (
                          completedPage.slice.map((i) => {
                            const commentsPreview = truncateWithTooltip(
                              i.comments,
                              40,
                            );
                            const catLines = interviewCategoryLines(i.category);
                            return (
                              <tr key={i.id}>
                                <td className={tdName}>
                                  <button
                                    type="button"
                                    className={nameLinkBtn}
                                    onClick={() =>
                                      setDetailCandidateId(i.candidate_id)
                                    }
                                  >
                                    {i.candidates?.full_name?.trim() || "—"}
                                  </button>
                                </td>
                                <td className={tdPhone}>
                                  {i.candidates?.whatsapp_number?.trim() ||
                                    "—"}
                                </td>
                                <td className={tdInterviewType}>
                                  <div className="flex items-center justify-center">
                                    {interviewTypeBadge(i.interview_type)}
                                  </div>
                                </td>
                                <td className={tdLanguage}>
                                  <div className="flex items-center justify-center">
                                    {interviewLanguageBadge(i)}
                                  </div>
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
                                <td className={tdPostProdGate}>
                                  {postProductionEligibilityGateBadge(i)}
                                </td>
                                <td className={tdCategoryCol}>
                                  {catLines.length ? catLines.join(" · ") : "—"}
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
                                    className="relative flex flex-wrap items-center justify-end gap-2"
                                    data-completed-popover-root
                                  >
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
                                      className="rounded-lg bg-[#1d1d1f] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#2d2d2f] disabled:cursor-not-allowed disabled:bg-[#d1d5db] disabled:text-[#6b7280]"
                                      onMouseDown={(e) => e.stopPropagation()}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void addCompletedToPostProduction(i);
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
                                        className="absolute right-0 top-full z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] max-w-sm rounded-xl border border-[#f0f0f0] bg-white p-4 text-left shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
                                        onMouseDown={(e) =>
                                          e.stopPropagation()
                                        }
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
                                              {i.post_interview_eligible ===
                                              true
                                                ? i.reward_item?.trim() ===
                                                  REWARD_NO_DISPATCH
                                                  ? "Eligible — no physical dispatch"
                                                  : "Eligible"
                                                : i.post_interview_eligible ===
                                                    false
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
                                              Category
                                            </dt>
                                            <dd className="mt-0.5 whitespace-pre-wrap break-words text-[#1d1d1f]">
                                              {catLines.length
                                                ? catLines.join("\n")
                                                : "—"}
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
                                        <div className="mt-4 flex flex-wrap items-center gap-2">
                                          <button
                                            type="button"
                                            disabled={!canEditCompletedTab}
                                            className="rounded-lg border border-[#d4d4d8] bg-white px-2.5 py-1 text-xs font-medium text-[#1d1d1f] hover:bg-[#fafafa] disabled:cursor-not-allowed disabled:border-[#d1d5db] disabled:text-[#9ca3af]"
                                            onClick={() => {
                                              if (!canEditCompletedTab) return;
                                              setCompletedPopoverId(null);
                                              openCompleteModal(i);
                                            }}
                                          >
                                            Edit Details
                                          </button>
                                          <button
                                            type="button"
                                            disabled={
                                              !canEditCompletedTab ||
                                              incompleteBusyId === i.id
                                            }
                                            className="rounded-lg bg-[#dc2626] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#b91c1c] disabled:cursor-not-allowed disabled:bg-[#d1d5db] disabled:text-[#6b7280]"
                                            onClick={() =>
                                              void handleMarkIncomplete(i)
                                            }
                                          >
                                            {incompleteBusyId === i.id
                                              ? "Reverting..."
                                              : "Mark Incomplete"}
                                          </button>
                                          <button
                                            type="button"
                                            className="text-xs font-medium text-[#3b82f6] hover:text-[#2563eb]"
                                            onClick={() =>
                                              setCompletedPopoverId(null)
                                            }
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
          </>
        )}
      </main>

      <LogFollowupCallModal
        key={logFollowupFor?.id ?? "log-followup-closed"}
        open={!!logFollowupFor}
        candidate={logFollowupFor}
        projectCandidate={null}
        supabase={supabase}
        onClose={() => setLogFollowupFor(null)}
        onSaved={() => void loadData()}
      />

      <FollowupHistoryModal
        open={!!followupHistoryFor}
        candidateId={followupHistoryFor?.id ?? null}
        candidateLabel={followupHistoryFor?.label ?? ""}
        supabase={supabase}
        onClose={() => setFollowupHistoryFor(null)}
      />

      <ScheduleInterviewModal
        key={
          scheduleFor?.id ?? scheduleProjectFor?.id ?? "schedule-closed"
        }
        open={!!scheduleFor || !!scheduleProjectFor}
        candidate={scheduleFor}
        projectCandidate={scheduleProjectFor}
        supabase={supabase}
        onClose={() => {
          setScheduleFor(null);
          setScheduleProjectFor(null);
        }}
        onCreated={() => void loadData()}
      />

      <ZoomDetailsModal
        key={addZoomFor?.id ?? "add-zoom-closed"}
        open={!!addZoomFor}
        interviewId={addZoomFor?.id ?? ""}
        table="interviews"
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
          setToastMessage("Zoom details saved");
        }}
      />

      <AssignInterviewerModal
        key={assignInterviewerFor?.id ?? "assign-iv-closed"}
        open={!!assignInterviewerFor}
        interview={assignInterviewerFor}
        supabase={supabase}
        onClose={() => setAssignInterviewerFor(null)}
        onSaved={() => void loadData()}
      />

      <EditInterviewDetailsModal
        key={editInterviewFor?.id ?? "edit-iv-closed"}
        open={!!editInterviewFor}
        interview={editInterviewFor}
        supabase={supabase}
        onClose={() => setEditInterviewFor(null)}
        onSaved={() => void loadData()}
        onToast={(msg) => setToastMessage(msg)}
      />

      <CandidateDetailModal
        open={!!detailCandidateId}
        candidateId={detailCandidateId}
        supabase={supabase}
        onClose={() => setDetailCandidateId(null)}
      />

      <RescheduleInterviewModal
        key={rescheduleCtx?.interview.id ?? "reschedule-closed"}
        open={!!rescheduleCtx}
        interview={rescheduleCtx?.interview ?? null}
        mode={rescheduleCtx?.mode ?? "from_scheduled"}
        supabase={supabase}
        onClose={() => setRescheduleCtx(null)}
        onSaved={() => void loadData()}
      />

      <PostInterviewDrawer
        key={selectedInterview?.id ?? "post-closed"}
        open={isCompleteModalOpen}
        interview={selectedInterview}
        supabase={supabase}
        onClose={() => {
          setIsCompleteModalOpen(false);
          setSelectedInterview(null);
        }}
        onSaved={() => void loadData()}
        onToast={(msg) => setToastMessage(msg)}
      />

    </>
  );
}

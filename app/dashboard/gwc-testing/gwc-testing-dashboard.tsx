"use client";

import { Loader2, Pencil, Phone, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { ProjectCandidateRow } from "@/app/dashboard/interviews/types";
import { useAccessControl } from "@/components/access-control-context";
import { CandidateDetailModal } from "@/components/candidate-detail-modal";
import { ProjectCandidateDetailModal } from "@/components/project-candidate-detail-modal";
import { logActivity } from "@/lib/activity-logger";
import { backfillGwcTestingRows } from "@/lib/gwc-testing-actions";
import {
  GWC_INTERESTED_IN_OPTIONS,
  GWC_TESTING_TABS,
  channelLabel,
  interestedInLabel,
  isContentChannel,
  tabMatchesChannel,
  workflowStageFromInterestedIn,
  gwcEntryDisplayName,
  gwcEntryEntityId,
  gwcSourceTypeBadgeClass,
  gwcSourceTypeLabel,
  isProjectGwcRow,
  gwcCallOutcomeLabel,
  gwcRowMatchesPocFilter,
  gwcRowMatchesSearch,
  GWC_POC_FILTER_UNASSIGNED,
  parseInterestedInPointers,
  type GwcCallOutcome,
  type GwcContentChannel,
  type GwcInterestedIn,
  type GwcInterestedInPointers,
  type GwcSourceType,
  type GwcTestingRow,
  type GwcTestingTab,
} from "@/lib/gwc-testing";
import { fetchTeamRosterNames, mergeRosterWithCurrent } from "@/lib/team-roster";
import { getUserSafe, displayNameFromUser } from "@/lib/supabase-auth";
import { createBrowserSupabaseClient } from "@/lib/supabase-browser";

import { AddContentLinkModal } from "./add-content-link-modal";
import { EditInterestedInModal } from "./edit-interested-in-modal";
import { LogGwcCallModal } from "./log-gwc-call-modal";

function formatGwcDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function sanitizeInterestedInPointers(
  pointers: GwcInterestedInPointers,
): GwcInterestedInPointers {
  const out: GwcInterestedInPointers = {};
  for (const [key, value] of Object.entries(pointers)) {
    if (typeof value === "string" && value.trim()) {
      out[key as GwcInterestedIn] = value.trim();
    }
  }
  return out;
}

const cardChrome =
  "rounded-2xl bg-white shadow-[0_4px_16px_rgba(0,0,0,0.08)] border border-[#f0f0f0]";

const nameLinkBtn =
  "max-w-full min-w-0 cursor-pointer truncate text-left font-medium text-[#1d1d1f] transition-colors hover:text-[#3b82f6] hover:underline focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/25 rounded-sm";

const PROJECT_CANDIDATE_DETAIL_SELECT =
  "id, created_at, email, full_name, whatsapp_number, project_title, problem_statement, target_user, ai_usage, demo_link, status, poc_assigned, poc_assigned_at";

const GWC_SELECT_BASE = `
  id,
  candidate_id,
  poc,
  poc_assigned_at,
  interested_in,
  interested_in_pointers,
  workflow_stage,
  created_at,
  updated_at,
  candidates (
    id,
    full_name,
    email,
    whatsapp_number
  )
`;

const GWC_SELECT_WITH_PROJECT = `
  ${GWC_SELECT_BASE},
  project_candidate_id,
  project_candidates (
    id,
    full_name,
    email,
    whatsapp_number,
    project_title
  )
`;

function normalizeRow(
  raw: Record<string, unknown>,
  verifications: GwcTestingRow["verifications"],
  lastCall: { at: string; outcome: GwcCallOutcome } | null,
): GwcTestingRow {
  const c = raw.candidates;
  const candidate = Array.isArray(c) ? c[0] ?? null : c;
  const pc = raw.project_candidates;
  const projectCandidate = Array.isArray(pc) ? pc[0] ?? null : pc;
  const projectCandidateId =
    (raw.project_candidate_id as string | null) ?? null;
  const source_type = projectCandidateId ? "project" : "testimonial";
  return {
    id: raw.id as string,
    candidate_id: (raw.candidate_id as string | null) ?? null,
    project_candidate_id: projectCandidateId,
    source_type,
    poc: (raw.poc as string | null) ?? null,
    poc_assigned_at: (raw.poc_assigned_at as string | null) ?? null,
    interested_in: (raw.interested_in as GwcInterestedIn[]) ?? [],
    interested_in_pointers: parseInterestedInPointers(
      raw.interested_in_pointers,
    ),
    workflow_stage: raw.workflow_stage as GwcTestingRow["workflow_stage"],
    created_at: raw.created_at as string,
    updated_at: raw.updated_at as string,
    candidates: candidate as GwcTestingRow["candidates"],
    project_candidates:
      projectCandidate as GwcTestingRow["project_candidates"],
    verifications,
    last_call_at: lastCall?.at ?? null,
    last_call_outcome: lastCall?.outcome ?? null,
  };
}

function GwcSourceTypeBadge({ source }: { source: GwcSourceType }) {
  return (
    <span className={gwcSourceTypeBadgeClass(source)}>
      {gwcSourceTypeLabel(source)}
    </span>
  );
}

function partialProjectCandidateFromRow(
  row: GwcTestingRow,
): ProjectCandidateRow | null {
  const pc = row.project_candidates;
  if (!pc || !row.project_candidate_id) return null;
  return {
    id: pc.id,
    email: pc.email,
    full_name: pc.full_name,
    whatsapp_number: pc.whatsapp_number,
    project_title: pc.project_title,
    problem_statement: null,
    target_user: null,
    ai_usage: null,
    demo_link: null,
    status: "gwc",
    poc_assigned: null,
    poc_assigned_at: null,
    interview_type: "gwc",
  };
}

function rowInTab(row: GwcTestingRow, tab: GwcTestingTab): boolean {
  if (tab === "dispatch") {
    return row.workflow_stage === "dispatch";
  }
  if (tab === "scheduled") {
    return (
      row.workflow_stage === "scheduled" ||
      row.interested_in.includes("video_interview")
    );
  }
  if (tab === "queue") {
    return row.workflow_stage === "active";
  }
  const channel = tabMatchesChannel(tab);
  if (!channel) return false;
  return (
    row.interested_in.includes(channel) &&
    row.workflow_stage !== "dispatch" &&
    !row.verifications.some((v) => v.channel === channel && v.verified)
  );
}

export function GwcTestingDashboard() {
  const { canEditCurrentPage, showViewOnlyBadge } = useAccessControl();
  const [rows, setRows] = useState<GwcTestingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<GwcTestingTab>("queue");
  const [trackFilter, setTrackFilter] = useState<"all" | GwcSourceType>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [pocFilter, setPocFilter] = useState("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pocRoster, setPocRoster] = useState<string[]>([]);

  const [detailCandidateId, setDetailCandidateId] = useState<string | null>(
    null,
  );
  const [detailProjectCandidate, setDetailProjectCandidate] =
    useState<ProjectCandidateRow | null>(null);
  const [interestedInEditRow, setInterestedInEditRow] =
    useState<GwcTestingRow | null>(null);
  const [interestedInSaving, setInterestedInSaving] = useState(false);
  const [logCallRow, setLogCallRow] = useState<GwcTestingRow | null>(null);
  const [linkModal, setLinkModal] = useState<{
    row: GwcTestingRow;
    channel: GwcContentChannel;
    verify: boolean;
  } | null>(null);

  const supabase = useMemo(() => {
    try {
      return createBrowserSupabaseClient();
    } catch {
      return null;
    }
  }, []);

  const load = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    const backfill = await backfillGwcTestingRows(supabase);
    if (backfill.error) {
      setError(backfill.error);
      setLoading(false);
      return;
    }

    let gwcRows: Record<string, unknown>[] | null = null;
    const primary = await supabase
      .from("gwc_testing")
      .select(GWC_SELECT_WITH_PROJECT)
      .order("updated_at", { ascending: false });

    if (
      primary.error?.message?.includes("project_candidate_id") ||
      primary.error?.message?.includes("project_candidates") ||
      primary.error?.message?.includes("interested_in_pointers") ||
      primary.error?.message?.includes("poc_assigned_at")
    ) {
      const legacy = await supabase
        .from("gwc_testing")
        .select(GWC_SELECT_BASE)
        .order("updated_at", { ascending: false });
      gwcRows = (legacy.data as Record<string, unknown>[] | null) ?? null;
      if (legacy.error) {
        setError(legacy.error.message);
        setLoading(false);
        return;
      }
    } else if (primary.error) {
      setError(primary.error.message);
      setLoading(false);
      return;
    } else {
      gwcRows = (primary.data as Record<string, unknown>[] | null) ?? null;
    }

    const ids = (gwcRows ?? []).map((r) => r.id as string);
    let verifications: GwcTestingRow["verifications"] = [];
    if (ids.length > 0) {
      const { data: verRows, error: verErr } = await supabase
        .from("gwc_content_verification")
        .select(
          "id, gwc_testing_id, channel, content_link, verified, verified_at, verified_by",
        )
        .in("gwc_testing_id", ids);
      if (verErr) {
        setError(verErr.message);
        setLoading(false);
        return;
      }
      verifications = (verRows ?? []) as GwcTestingRow["verifications"];
    }

    const byGwc = new Map<string, GwcTestingRow["verifications"]>();
    for (const v of verifications) {
      const list = byGwc.get(v.gwc_testing_id) ?? [];
      list.push(v);
      byGwc.set(v.gwc_testing_id, list);
    }

    const lastCallByGwc = new Map<
      string,
      { at: string; outcome: GwcCallOutcome }
    >();
    if (ids.length > 0) {
      const { data: callRows, error: callErr } = await supabase
        .from("gwc_call_log")
        .select("gwc_testing_id, created_at, outcome")
        .in("gwc_testing_id", ids)
        .order("created_at", { ascending: false });
      if (callErr) {
        setError(callErr.message);
        setLoading(false);
        return;
      }
      for (const log of callRows ?? []) {
        const gid = log.gwc_testing_id as string;
        if (!lastCallByGwc.has(gid)) {
          lastCallByGwc.set(gid, {
            at: log.created_at as string,
            outcome: log.outcome as GwcCallOutcome,
          });
        }
      }
    }

    setRows(
      (gwcRows ?? []).map((r) =>
        normalizeRow(
          r as Record<string, unknown>,
          byGwc.get(r.id as string) ?? [],
          lastCallByGwc.get(r.id as string) ?? null,
        ),
      ),
    );
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!supabase) return;
    void fetchTeamRosterNames(supabase, "poc").then(setPocRoster);
    const channel = supabase
      .channel("gwc-testing-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "gwc_testing" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "gwc_content_verification" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "gwc_call_log" },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, load]);

  const matchesTrackFilter = useCallback(
    (r: GwcTestingRow) =>
      trackFilter === "all" || r.source_type === trackFilter,
    [trackFilter],
  );

  const pocFilterNames = useMemo(() => {
    const names = new Set<string>(pocRoster);
    for (const r of rows) {
      const p = r.poc?.trim();
      if (p) names.add(p);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [rows, pocRoster]);

  const filteredRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          matchesTrackFilter(r) &&
          rowInTab(r, tab) &&
          gwcRowMatchesSearch(r, searchQuery) &&
          gwcRowMatchesPocFilter(r, pocFilter),
      ),
    [rows, tab, matchesTrackFilter, searchQuery, pocFilter],
  );

  const hasActiveFilters =
    searchQuery.trim().length > 0 || pocFilter !== "all";

  const tabCounts = useMemo(() => {
    const counts: Record<GwcTestingTab, number> = {
      queue: 0,
      scheduled: 0,
      blog_post: 0,
      linkedin_post: 0,
      reddit_reply: 0,
      own_video: 0,
      dispatch: 0,
    };
    for (const r of rows) {
      if (!matchesTrackFilter(r)) continue;
      for (const t of GWC_TESTING_TABS) {
        if (rowInTab(r, t.id)) counts[t.id]++;
      }
    }
    return counts;
  }, [rows, matchesTrackFilter]);

  const trackCounts = useMemo(
    () => ({
      all: rows.length,
      testimonial: rows.filter((r) => r.source_type === "testimonial").length,
      project: rows.filter((r) => r.source_type === "project").length,
    }),
    [rows],
  );

  async function updatePoc(row: GwcTestingRow, poc: string) {
    if (!canEditCurrentPage || !supabase) return;
    setBusyId(row.id);
    const assigned = poc.trim();
    const payload = {
      poc: assigned || null,
      poc_assigned_at: assigned ? new Date().toISOString() : null,
    };
    let { error: uErr } = await supabase
      .from("gwc_testing")
      .update(payload)
      .eq("id", row.id);
    if (uErr?.message?.includes("poc_assigned_at")) {
      ({ error: uErr } = await supabase
        .from("gwc_testing")
        .update({ poc: payload.poc })
        .eq("id", row.id));
    }
    setBusyId(null);
    if (uErr) setError(uErr.message);
    else void load();
  }

  async function syncContentVerificationRows(
    gwcTestingId: string,
    interestedIn: GwcInterestedIn[],
  ) {
    if (!supabase) return;
    const channels = interestedIn.filter(isContentChannel);
    for (const channel of channels) {
      await supabase.from("gwc_content_verification").upsert(
        {
          gwc_testing_id: gwcTestingId,
          channel,
          verified: false,
        },
        { onConflict: "gwc_testing_id,channel", ignoreDuplicates: true },
      );
    }
  }

  async function updateInterestedIn(
    row: GwcTestingRow,
    next: GwcInterestedIn[],
    pointersInput?: GwcInterestedInPointers,
  ): Promise<boolean> {
    if (!canEditCurrentPage || !supabase) return false;
    setBusyId(row.id);
    const stage = workflowStageFromInterestedIn(next, row.workflow_stage);
    const rawPointers = sanitizeInterestedInPointers(
      pointersInput ?? row.interested_in_pointers,
    );
    const nextPointers: GwcInterestedInPointers = {};
    for (const interest of next) {
      if (rawPointers[interest]) nextPointers[interest] = rawPointers[interest];
    }
    const { error: uErr } = await supabase
      .from("gwc_testing")
      .update({
        interested_in: next,
        interested_in_pointers: nextPointers,
        workflow_stage: stage,
      })
      .eq("id", row.id);
    if (uErr) {
      setError(uErr.message);
      setBusyId(null);
      return false;
    }
    await syncContentVerificationRows(row.id, next);

    if (next.includes("video_interview")) {
      if (isProjectGwcRow(row) && row.project_candidate_id) {
        const { data: existingProjectInterview } = await supabase
          .from("project_interviews")
          .select("id")
          .eq("project_candidate_id", row.project_candidate_id)
          .in("interview_status", ["draft", "scheduled", "rescheduled"])
          .maybeSingle();
        if (!existingProjectInterview) {
          await supabase.from("project_interviews").insert({
            project_candidate_id: row.project_candidate_id,
            interview_status: "scheduled",
            interview_type: "project",
            poc: row.poc,
          });
        }
      } else if (row.candidate_id) {
        const { data: existingInterview } = await supabase
          .from("interviews")
          .select("id")
          .eq("candidate_id", row.candidate_id)
          .eq("interview_type", "testimonial")
          .in("interview_status", ["draft", "scheduled", "rescheduled"])
          .maybeSingle();
        if (!existingInterview) {
          await supabase.from("interviews").insert({
            candidate_id: row.candidate_id,
            interview_status: "scheduled",
            interview_type: "testimonial",
            poc: row.poc,
          });
        }
      }
    }

    const actor = await getUserSafe(supabase);
    if (actor) {
      const display = gwcEntryDisplayName(row);
      await logActivity({
        supabase,
        user: actor,
        action_type: "interviews",
        entity_type: "candidate",
        entity_id: gwcEntryEntityId(row),
        candidate_name: display,
        description: `Updated Interested In for ${display}`,
        metadata: { interested_in: next, workflow_stage: stage },
      });
    }

    setBusyId(null);
    void load();
    return true;
  }

  async function saveInterestedInFromModal(
    interestedIn: GwcInterestedIn[],
    pointers: GwcInterestedInPointers,
  ) {
    if (!interestedInEditRow) return;
    setInterestedInSaving(true);
    const ok = await updateInterestedIn(
      interestedInEditRow,
      interestedIn,
      sanitizeInterestedInPointers(pointers),
    );
    setInterestedInSaving(false);
    if (ok) setInterestedInEditRow(null);
  }

  function pocOptions(current: string | null) {
    return mergeRosterWithCurrent(pocRoster, current);
  }

  async function openProjectCandidateDetail(
    projectCandidateId: string,
    preview?: ProjectCandidateRow | null,
  ) {
    if (!supabase) return;
    if (preview) {
      setDetailCandidateId(null);
      setDetailProjectCandidate(preview);
    }
    const { data, error: fetchErr } = await supabase
      .from("project_candidates")
      .select(PROJECT_CANDIDATE_DETAIL_SELECT)
      .eq("id", projectCandidateId)
      .maybeSingle();
    if (fetchErr) {
      setError(fetchErr.message);
      return;
    }
    if (!data) {
      setError("Project candidate not found.");
      setDetailProjectCandidate(null);
      return;
    }
    setDetailProjectCandidate(data as ProjectCandidateRow);
  }

  function openCandidateDetail(row: GwcTestingRow) {
    if (!supabase) {
      setError("Unable to load candidate details. Please refresh the page.");
      return;
    }
    if (row.source_type === "project" && row.project_candidate_id) {
      void openProjectCandidateDetail(
        row.project_candidate_id,
        partialProjectCandidateFromRow(row),
      );
      return;
    }
    if (row.candidate_id) {
      setDetailProjectCandidate(null);
      setDetailCandidateId(row.candidate_id);
      return;
    }
    setError("Candidate record is missing for this entry.");
  }

  return (
    <main className="min-h-screen bg-[#f5f5f7] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1400px]">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-[#1d1d1f]">
            GWC Testing
          </h1>
          <p className="mt-1 text-sm text-[#6e6e73]">
            Manage GWC candidates, content channels, verification, and dispatch
          </p>
          {showViewOnlyBadge ? (
            <p className="mt-2 text-xs font-medium text-[#6e6e73]">
              View only — you cannot edit this section
            </p>
          ) : null}
        </header>

        {error ? (
          <p className="mb-4 rounded-xl bg-[#fef2f2] px-4 py-3 text-sm text-[#dc2626]">
            {error}
          </p>
        ) : null}

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
            Track
          </span>
          {(
            [
              { id: "all" as const, label: "All" },
              { id: "testimonial" as const, label: "Testimonial" },
              { id: "project" as const, label: "Project" },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setTrackFilter(f.id)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                trackFilter === f.id
                  ? "bg-[#1d1d1f] text-white"
                  : "bg-white text-[#6e6e73] shadow-sm hover:text-[#1d1d1f]"
              }`}
            >
              {f.label}
              <span className="ml-1 opacity-70">
                ({trackCounts[f.id]})
              </span>
            </button>
          ))}
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {GWC_TESTING_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                tab === t.id
                  ? "bg-[#1d1d1f] text-white"
                  : "bg-white text-[#6e6e73] shadow-sm hover:text-[#1d1d1f]"
              }`}
            >
              {t.label}
              <span className="ml-1.5 opacity-70">({tabCounts[t.id]})</span>
            </button>
          ))}
        </div>

        <div className={cardChrome}>
          <div className="flex flex-wrap items-end gap-3 border-b border-[#f0f0f0] px-4 py-3">
              <div className="min-w-[200px] flex-1">
                <label
                  htmlFor="gwc-search"
                  className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]"
                >
                  Search candidates
                </label>
                <div className="relative mt-1">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#aeaeb2]"
                    aria-hidden
                  />
                  <input
                    id="gwc-search"
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Name, email, project, phone…"
                    className="w-full rounded-xl border border-[#e5e5e5] bg-white py-2.5 pl-9 pr-3 text-sm text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:border-[#3b82f6] focus:outline-none"
                  />
                </div>
              </div>
              <div className="min-w-[160px]">
                <label
                  htmlFor="gwc-poc-filter"
                  className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]"
                >
                  POC filter
                </label>
                <select
                  id="gwc-poc-filter"
                  value={pocFilter}
                  onChange={(e) => setPocFilter(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-[#e5e5e5] bg-white px-3 py-2.5 text-sm text-[#1d1d1f] focus:border-[#3b82f6] focus:outline-none"
                >
                  <option value="all">All POCs</option>
                  <option value={GWC_POC_FILTER_UNASSIGNED}>Unassigned</option>
                  {pocFilterNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
              {hasActiveFilters ? (
                <button
                  type="button"
                  className="rounded-xl px-3 py-2.5 text-sm font-medium text-[#6e6e73] hover:bg-[#f5f5f5]"
                  onClick={() => {
                    setSearchQuery("");
                    setPocFilter("all");
                  }}
                >
                  Clear filters
                </button>
              ) : null}
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 px-4 py-16 text-[#6e6e73]">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading…
            </div>
          ) : filteredRows.length === 0 ? (
            <p className="px-4 py-16 text-center text-sm text-[#6e6e73]">
              {hasActiveFilters
                ? "No candidates match your search or POC filter."
                : "No entries in this section."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead>
                  <tr className="border-b border-[#f0f0f0] text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                    <th className="px-4 py-3">Candidate</th>
                    <th className="px-4 py-3">Track</th>
                    {tab === "queue" ? (
                      <>
                        <th className="px-4 py-3">POC</th>
                        <th className="px-4 py-3">POC assigned</th>
                        <th className="px-4 py-3">Last call</th>
                        <th className="px-4 py-3">Interested in</th>
                        <th className="px-4 py-3">Actions</th>
                      </>
                    ) : null}
                    {tabMatchesChannel(tab) ? (
                      <>
                        <th className="px-4 py-3">Link</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Actions</th>
                      </>
                    ) : null}
                    {tab === "scheduled" ? (
                      <th className="px-4 py-3">Stage</th>
                    ) : null}
                    {tab === "dispatch" ? (
                      <th className="px-4 py-3">Channels</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => {
                    const display = gwcEntryDisplayName(row);
                    const email =
                      row.source_type === "project"
                        ? row.project_candidates?.email
                        : row.candidates?.email;
                    const channel = tabMatchesChannel(tab);

                    return (
                      <tr
                        key={row.id}
                        className="border-b border-[#f5f5f5] last:border-0"
                      >
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            className={nameLinkBtn}
                            title="View candidate details"
                            onClick={() => openCandidateDetail(row)}
                          >
                            {display}
                          </button>
                          <p className="text-xs text-[#6e6e73]">
                            {email ?? "—"}
                            {row.source_type === "project" &&
                            row.project_candidates?.project_title ? (
                              <span className="block text-[#aeaeb2]">
                                {row.project_candidates.project_title}
                              </span>
                            ) : null}
                          </p>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <GwcSourceTypeBadge source={row.source_type} />
                        </td>

                        {tab === "queue" ? (
                          <>
                            <td className="px-4 py-3">
                              <select
                                disabled={
                                  !canEditCurrentPage || busyId === row.id
                                }
                                className="rounded-lg border border-[#e5e5e5] px-2 py-1.5 text-sm disabled:opacity-50"
                                value={row.poc ?? ""}
                                onChange={(e) =>
                                  void updatePoc(row, e.target.value)
                                }
                              >
                                <option value="">Assign POC</option>
                                {pocOptions(row.poc).map((name) => (
                                  <option key={name} value={name}>
                                    {name}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 align-top text-xs text-[#6e6e73]">
                              {formatGwcDateTime(row.poc_assigned_at)}
                            </td>
                            <td className="px-4 py-3 align-top text-xs text-[#6e6e73]">
                              {row.last_call_at ? (
                                <>
                                  <span className="block text-[#1d1d1f]">
                                    {formatGwcDateTime(row.last_call_at)}
                                  </span>
                                  {row.last_call_outcome ? (
                                    <span className="mt-0.5 block text-[#aeaeb2]">
                                      {gwcCallOutcomeLabel(row.last_call_outcome)}
                                    </span>
                                  ) : null}
                                </>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="max-w-[220px] px-4 py-3 align-top">
                              {row.interested_in.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {row.interested_in.map((v) => (
                                    <span
                                      key={v}
                                      className="rounded-full bg-[#f0f0f0] px-2 py-0.5 text-xs font-medium text-[#1d1d1f]"
                                      title={
                                        row.interested_in_pointers[v] ??
                                        undefined
                                      }
                                    >
                                      {interestedInLabel(v)}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-xs text-[#aeaeb2]">
                                  None selected
                                </span>
                              )}
                              <button
                                type="button"
                                disabled={
                                  !canEditCurrentPage || busyId === row.id
                                }
                                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[#3b82f6] hover:underline disabled:opacity-50"
                                onClick={() => setInterestedInEditRow(row)}
                              >
                                <Pencil className="h-3 w-3" aria-hidden />
                                Edit interests
                              </button>
                            </td>
                            <td className="px-4 py-3">
                              <button
                                type="button"
                                disabled={!canEditCurrentPage}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] px-3 py-1.5 text-sm font-medium text-[#1d1d1f] hover:bg-[#fafafa] disabled:opacity-50"
                                onClick={() => setLogCallRow(row)}
                              >
                                <Phone className="h-4 w-4" />
                                Log Call
                              </button>
                            </td>
                          </>
                        ) : null}

                        {channel ? (
                          <>
                            <td className="px-4 py-3">
                              {row.verifications.find(
                                (v) => v.channel === channel,
                              )?.content_link ? (
                                <a
                                  href={
                                    row.verifications.find(
                                      (v) => v.channel === channel,
                                    )!.content_link!
                                  }
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[#2563eb] hover:underline"
                                >
                                  View link
                                </a>
                              ) : (
                                <span className="text-[#6e6e73]">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {row.verifications.find(
                                (v) => v.channel === channel,
                              )?.verified ? (
                                <span className="rounded-full bg-[#f0fdf4] px-2.5 py-1 text-xs font-medium text-[#16a34a]">
                                  Verified
                                </span>
                              ) : (
                                <span className="rounded-full bg-[#fafafa] px-2.5 py-1 text-xs font-medium text-[#6e6e73]">
                                  Pending
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  disabled={!canEditCurrentPage}
                                  className="rounded-lg border border-[#e5e5e5] px-3 py-1.5 text-sm font-medium hover:bg-[#fafafa] disabled:opacity-50"
                                  onClick={() =>
                                    setLinkModal({
                                      row,
                                      channel,
                                      verify: false,
                                    })
                                  }
                                >
                                  Add Link
                                </button>
                                {row.verifications.find(
                                  (v) => v.channel === channel,
                                )?.content_link ? (
                                  <button
                                    type="button"
                                    disabled={!canEditCurrentPage}
                                    className="rounded-lg bg-[#16a34a] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                                    onClick={() =>
                                      setLinkModal({
                                        row,
                                        channel,
                                        verify: true,
                                      })
                                    }
                                  >
                                    Verify
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          </>
                        ) : null}

                        {tab === "scheduled" ? (
                          <td className="px-4 py-3">
                            <span className="rounded-full bg-[#eff6ff] px-2.5 py-1 text-xs font-medium text-[#2563eb]">
                              Video interview scheduled
                            </span>
                          </td>
                        ) : null}

                        {tab === "dispatch" ? (
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              {row.interested_in
                                .filter(isContentChannel)
                                .map((ch) => (
                                  <span
                                    key={ch}
                                    className="rounded-full bg-[#f5f5f5] px-2 py-0.5 text-xs text-[#6e6e73]"
                                  >
                                    {channelLabel(ch)}
                                  </span>
                                ))}
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {supabase ? (
        <>
          <CandidateDetailModal
            open={!!detailCandidateId}
            candidateId={detailCandidateId}
            supabase={supabase}
            onClose={() => setDetailCandidateId(null)}
          />
          <ProjectCandidateDetailModal
            open={!!detailProjectCandidate}
            candidate={detailProjectCandidate}
            onClose={() => setDetailProjectCandidate(null)}
          />
          <EditInterestedInModal
            open={Boolean(interestedInEditRow)}
            row={interestedInEditRow}
            canEdit={canEditCurrentPage}
            saving={interestedInSaving}
            onClose={() => setInterestedInEditRow(null)}
            onSave={saveInterestedInFromModal}
          />
          <LogGwcCallModal
            open={Boolean(logCallRow)}
            row={logCallRow}
            supabase={supabase}
            onClose={() => setLogCallRow(null)}
            onSaved={() => void load()}
          />
          <AddContentLinkModal
            open={Boolean(linkModal)}
            row={linkModal?.row ?? null}
            channel={linkModal?.channel ?? null}
            verifyOnSave={linkModal?.verify ?? false}
            supabase={supabase}
            onClose={() => setLinkModal(null)}
            onSaved={() => void load()}
          />
        </>
      ) : null}
    </main>
  );
}

"use client";

import { format } from "date-fns";
import { useCallback, useEffect, useState } from "react";

import type { SupabaseClient } from "@supabase/supabase-js";

import { useAccessControl } from "@/components/access-control-context";
import { modalOverlayClass, modalPanelWideClass } from "@/lib/modal-responsive";
import { teamMemberDisplayName } from "@/lib/team-roster";

import { TeamReportRatingsTab } from "./team-report-ratings-tab";
import {
  PERIOD_LABELS,
  PERIOD_ORDER,
  rangeFilterIso,
  rangeForPreset,
  type TeamReportPeriodPreset,
} from "./team-report-period";

export type { TeamReportPeriodPreset } from "./team-report-period";

type TeamReportTab = "metrics" | "ratings";

const PAGE = 1000;

async function fetchAllPages<T extends Record<string, unknown>>(
  run: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const to = from + PAGE - 1;
    const { data, error } = await run(from, to);
    if (error) return { rows, error: error.message };
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  return { rows, error: null };
}

type FollowupRow = {
  created_at: string;
  logged_by: string | null;
  logged_by_email: string | null;
  candidate_id: string | null;
  project_candidate_id: string | null;
  status: string | null;
};

type InterviewRow = {
  interviewer: string | null;
  completed_at: string | null;
  interview_status: string | null;
  interviewer_assigned_at?: string | null;
};

type ProjectInterviewRow = {
  interviewer: string | null;
  completed_at: string | null;
  interview_status: string | null;
  interviewer_assigned_at?: string | null;
};

type DispatchRow = { id: string };

function isProbablyEmail(s: string): boolean {
  const t = s.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(t);
}

/** Stable merge key: prefer email when present (including email stored only in logged_by). */
function followupActorKey(r: FollowupRow): string {
  const by = r.logged_by?.trim() ?? "";
  const emField = r.logged_by_email?.trim().toLowerCase();
  const email = emField || (by && isProbablyEmail(by) ? by.toLowerCase() : "");
  if (email) return `e:${email}`;
  const nameKey = by.toLowerCase();
  if (nameKey) return `n:${nameKey}`;
  return "unknown";
}

/** Display name only (no email). Trusts a non-email `logged_by`, else team roster / pretty local-part. */
function followupPersonLabel(r: FollowupRow, emailToName: Map<string, string>): string {
  const by = r.logged_by?.trim() ?? "";
  const emRaw = r.logged_by_email?.trim();
  const em = (emRaw?.toLowerCase() ?? "") || (by && isProbablyEmail(by) ? by.toLowerCase() : "");

  if (by && !isProbablyEmail(by)) {
    return by;
  }
  if (em && emailToName.has(em)) {
    return emailToName.get(em)!;
  }
  if (em) {
    return teamMemberDisplayName({ full_name: null, email: emRaw ?? by }) || "Unknown";
  }
  if (by && isProbablyEmail(by)) {
    return teamMemberDisplayName({ full_name: null, email: by }) || "Unknown";
  }
  return "Unknown";
}

function bestPersonDisplay(prev: string | undefined, next: string): string {
  if (!prev) return next;
  if (next === prev) return prev;
  const prevEmailish = isProbablyEmail(prev);
  const nextEmailish = isProbablyEmail(next);
  if (nextEmailish && !prevEmailish) return prev;
  if (prevEmailish && !nextEmailish) return next;
  if (next.includes(" ") && !prev.includes(" ")) return next;
  if (prev.includes(" ") && !next.includes(" ")) return prev;
  return next.length > prev.length ? next : prev;
}

async function buildEmailToDisplayNameMap(
  supabase: SupabaseClient,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  const tm = await supabase
    .from("team_members")
    .select("email, full_name, status")
    .in("status", ["active", "invited"]);
  if (!tm.error && tm.data) {
    for (const row of tm.data as { email: string | null; full_name: string | null }[]) {
      const em = row.email?.trim().toLowerCase();
      if (!em) continue;
      const label = teamMemberDisplayName({
        full_name: row.full_name,
        email: row.email,
      });
      if (label && !map.has(em)) map.set(em, label);
    }
  }

  const tr = await supabase
    .from("team_roster")
    .select("name, email, is_active")
    .eq("is_active", true);
  if (!tr.error && tr.data) {
    for (const row of tr.data as { name: string | null; email: string | null }[]) {
      const em = row.email?.trim().toLowerCase();
      if (!em || map.has(em)) continue;
      const n = row.name?.trim();
      map.set(
        em,
        n || teamMemberDisplayName({ full_name: null, email: row.email }),
      );
    }
  }

  return map;
}

function increment(map: Map<string, number>, key: string, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

function mergeAssignedCompleted(
  assignedMap: Map<string, number>,
  completedMap: Map<string, number>,
): { label: string; assigned: number; completed: number }[] {
  const labels = new Set<string>([...assignedMap.keys(), ...completedMap.keys()]);
  const rows = [...labels].map((label) => ({
    label,
    assigned: assignedMap.get(label) ?? 0,
    completed: completedMap.get(label) ?? 0,
  }));
  rows.sort(
    (a, b) =>
      b.completed - a.completed ||
      b.assigned - a.assigned ||
      a.label.localeCompare(b.label),
  );
  return rows.filter((r) => r.assigned > 0 || r.completed > 0);
}

export type TeamReportModalProps = {
  open: boolean;
  supabase: SupabaseClient;
  onClose: () => void;
};

export function TeamReportModal({ open, supabase, onClose }: TeamReportModalProps) {
  const { canManageTeam } = useAccessControl();
  const [tab, setTab] = useState<TeamReportTab>("metrics");
  const [period, setPeriod] = useState<TeamReportPeriodPreset>("month");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [followupByActor, setFollowupByActor] = useState<
    { key: string; label: string; count: number }[]
  >([]);
  const [testimonialIvByPerson, setTestimonialIvByPerson] = useState<
    { label: string; assigned: number; completed: number }[]
  >([]);
  const [projectIvByPerson, setProjectIvByPerson] = useState<
    { label: string; assigned: number; completed: number }[]
  >([]);

  const [totals, setTotals] = useState({
    followupTestimonialPipeline: 0,
    followupProjectPipeline: 0,
    followupInterested: 0,
    followupCallback: 0,
    testimonialScheduledSlots: 0,
    projectScheduledSlots: 0,
    testimonialCompleted: 0,
    projectCompleted: 0,
    dispatches: 0,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { startIso, endIso } = rangeFilterIso(period);

    const followRes = await fetchAllPages<FollowupRow>(async (from, to) => {
      let q = supabase
        .from("followup_log")
        .select(
          "created_at, logged_by, logged_by_email, candidate_id, project_candidate_id, status",
        )
        .order("created_at", { ascending: true });
      if (startIso) q = q.gte("created_at", startIso).lte("created_at", endIso);
      return q.range(from, to);
    });
    if (followRes.error) {
      setError(followRes.error);
      setLoading(false);
      return;
    }

    const emailToName = await buildEmailToDisplayNameMap(supabase);

    const byActor = new Map<string, number>();
    const displayByActorKey = new Map<string, string>();
    let followT = 0;
    let followP = 0;
    let interested = 0;
    let callback = 0;

    for (const r of followRes.rows) {
      const key = followupActorKey(r);
      increment(byActor, key);
      const label = followupPersonLabel(r, emailToName);
      displayByActorKey.set(key, bestPersonDisplay(displayByActorKey.get(key), label));
      if (r.candidate_id) followT += 1;
      else if (r.project_candidate_id) followP += 1;
      const st = (r.status ?? "").trim();
      if (st === "interested") interested += 1;
      if (st === "callback") callback += 1;
    }

    const followRowsSorted = [...byActor.entries()]
      .map(([aggKey, count]) => ({
        key: aggKey,
        label: displayByActorKey.get(aggKey) ?? "Unknown",
        count,
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    const testimonialCompletedRes = await fetchAllPages<InterviewRow>(async (from, to) => {
      let q = supabase
        .from("interviews")
        .select("interviewer, completed_at, interview_status, candidates!inner(is_deleted)")
        .eq("candidates.is_deleted", false)
        .eq("interview_type", "testimonial")
        .or("interview_status.eq.completed,completed_at.not.is.null")
        .not("completed_at", "is", null);
      if (startIso) q = q.gte("completed_at", startIso).lte("completed_at", endIso);
      return q.range(from, to);
    });
    if (testimonialCompletedRes.error) {
      setError(testimonialCompletedRes.error);
      setLoading(false);
      return;
    }

    const testimonialAssignedRes = await fetchAllPages<Pick<InterviewRow, "interviewer">>(
      async (from, to) => {
        let q = supabase
          .from("interviews")
          .select("interviewer, interviewer_assigned_at, candidates!inner(is_deleted)")
          .eq("candidates.is_deleted", false)
          .eq("interview_type", "testimonial")
          .not("interviewer", "is", null)
          .not("interviewer_assigned_at", "is", null);
        if (startIso) {
          q = q.gte("interviewer_assigned_at", startIso).lte("interviewer_assigned_at", endIso);
        }
        return q.range(from, to);
      },
    );
    if (testimonialAssignedRes.error) {
      setError(testimonialAssignedRes.error);
      setLoading(false);
      return;
    }

    const testimonialScheduledRes = await fetchAllPages<Pick<InterviewRow, "interviewer">>(
      async (from, to) => {
        let q = supabase
          .from("interviews")
          .select("interviewer, candidates!inner(is_deleted)")
          .eq("candidates.is_deleted", false)
          .eq("interview_type", "testimonial")
          .not("scheduled_date", "is", null);
        if (startIso) q = q.gte("scheduled_date", startIso).lte("scheduled_date", endIso);
        return q.range(from, to);
      },
    );
    if (testimonialScheduledRes.error) {
      setError(testimonialScheduledRes.error);
      setLoading(false);
      return;
    }

    const projectCompletedRes = await fetchAllPages<ProjectInterviewRow>(async (from, to) => {
      let q = supabase
        .from("project_interviews")
        .select(
          "interviewer, completed_at, interview_status, project_candidates!inner(is_deleted)",
        )
        .eq("project_candidates.is_deleted", false)
        .or("interview_status.eq.completed,completed_at.not.is.null")
        .not("completed_at", "is", null);
      if (startIso) q = q.gte("completed_at", startIso).lte("completed_at", endIso);
      return q.range(from, to);
    });
    if (projectCompletedRes.error) {
      setError(projectCompletedRes.error);
      setLoading(false);
      return;
    }

    const projectAssignedRes = await fetchAllPages<Pick<ProjectInterviewRow, "interviewer">>(
      async (from, to) => {
        let q = supabase
          .from("project_interviews")
          .select(
            "interviewer, interviewer_assigned_at, project_candidates!inner(is_deleted)",
          )
          .eq("project_candidates.is_deleted", false)
          .not("interviewer", "is", null)
          .not("interviewer_assigned_at", "is", null);
        if (startIso) {
          q = q.gte("interviewer_assigned_at", startIso).lte("interviewer_assigned_at", endIso);
        }
        return q.range(from, to);
      },
    );
    if (projectAssignedRes.error) {
      setError(projectAssignedRes.error);
      setLoading(false);
      return;
    }

    const projectScheduledRes = await fetchAllPages<Pick<ProjectInterviewRow, "interviewer">>(
      async (from, to) => {
        let q = supabase
          .from("project_interviews")
          .select("interviewer, project_candidates!inner(is_deleted)")
          .eq("project_candidates.is_deleted", false)
          .not("scheduled_date", "is", null);
        if (startIso) q = q.gte("scheduled_date", startIso).lte("scheduled_date", endIso);
        return q.range(from, to);
      },
    );
    if (projectScheduledRes.error) {
      setError(projectScheduledRes.error);
      setLoading(false);
      return;
    }

    const testimonialAssignedMap = new Map<string, number>();
    for (const r of testimonialAssignedRes.rows) {
      const label = r.interviewer?.trim();
      if (!label) continue;
      increment(testimonialAssignedMap, label);
    }

    const testimonialCompletedMap = new Map<string, number>();
    for (const r of testimonialCompletedRes.rows) {
      const label = r.interviewer?.trim() || "Unassigned";
      increment(testimonialCompletedMap, label);
    }

    const projectAssignedMap = new Map<string, number>();
    for (const r of projectAssignedRes.rows) {
      const label = r.interviewer?.trim();
      if (!label) continue;
      increment(projectAssignedMap, label);
    }

    const projectCompletedMap = new Map<string, number>();
    for (const r of projectCompletedRes.rows) {
      const label = r.interviewer?.trim() || "Unassigned";
      increment(projectCompletedMap, label);
    }

    const dispRes = await fetchAllPages<DispatchRow>(async (from, to) => {
      let q = supabase
        .from("dispatch")
        .select("id, candidates!inner(is_deleted)")
        .eq("candidates.is_deleted", false);
      if (startIso) q = q.gte("created_at", startIso).lte("created_at", endIso);
      return q.range(from, to);
    });
    if (dispRes.error) {
      setError(dispRes.error);
      setLoading(false);
      return;
    }

    setFollowupByActor(followRowsSorted);
    setTestimonialIvByPerson(
      mergeAssignedCompleted(testimonialAssignedMap, testimonialCompletedMap),
    );
    setProjectIvByPerson(mergeAssignedCompleted(projectAssignedMap, projectCompletedMap));
    setTotals({
      followupTestimonialPipeline: followT,
      followupProjectPipeline: followP,
      followupInterested: interested,
      followupCallback: callback,
      testimonialScheduledSlots: testimonialScheduledRes.rows.length,
      projectScheduledSlots: projectScheduledRes.rows.length,
      testimonialCompleted: testimonialCompletedRes.rows.length,
      projectCompleted: projectCompletedRes.rows.length,
      dispatches: dispRes.rows.length,
    });
    setLoading(false);
  }, [supabase, period]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  if (!open) return null;

  const { start, end } = rangeForPreset(period);
  const rangeLabel = start
    ? `${format(start, "MMM d, yyyy")} – ${format(end, "MMM d, yyyy")}`
    : "All time";

  const th =
    "bg-gray-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 first:rounded-tl-xl last:rounded-tr-xl";
  const td = "px-4 py-2.5 text-sm text-gray-900";
  const tdNum = "px-4 py-2.5 text-right text-sm font-semibold tabular-nums text-gray-900";

  return (
    <div className={modalOverlayClass}>
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close team report"
        onClick={onClose}
      />
      <div
        className={`${modalPanelWideClass} max-w-4xl overflow-y-auto p-6 sm:p-8`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-report-title"
      >
        <div className="flex flex-col gap-4 border-b border-gray-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 id="team-report-title" className="text-lg font-semibold text-gray-900">
              Team report
            </h2>
            <p className="mt-1 text-sm text-gray-500">{rangeLabel}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {PERIOD_ORDER.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                disabled={loading}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                  period === p
                    ? "bg-[#1d4ed8] text-white"
                    : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Close
            </button>
          </div>
        </div>

        <div className="mt-4 flex gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1">
          <button
            type="button"
            onClick={() => setTab("metrics")}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              tab === "metrics"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Metrics
          </button>
          <button
            type="button"
            onClick={() => setTab("ratings")}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              tab === "ratings"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Ratings
          </button>
        </div>

        {error ? (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}

        {tab === "ratings" ? (
          <div className="mt-6">
            <TeamReportRatingsTab
              supabase={supabase}
              period={period}
              canEdit={canManageTeam}
            />
          </div>
        ) : loading ? (
          <p className="mt-8 text-sm text-gray-500">Loading numbers…</p>
        ) : (
          <div className="mt-6 space-y-10">
            <section>
              <h3 className="text-base font-semibold text-gray-900">Total calls</h3>
              {followupByActor.length === 0 ? (
                <p className="mt-4 text-sm text-gray-500">No calls in this period.</p>
              ) : (
                <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 shadow-sm">
                  <table className="min-w-full border-collapse text-left">
                    <thead>
                      <tr>
                        <th className={th}>Name</th>
                        <th className={`${th} text-right`}>Total calls</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {followupByActor.map((row) => (
                        <tr key={row.key} className="hover:bg-gray-50/80">
                          <td className={td}>{row.label}</td>
                          <td className={tdNum}>{row.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section>
              <h3 className="text-base font-semibold text-gray-900">Testimonial interviews</h3>
              {testimonialIvByPerson.length === 0 ? (
                <p className="mt-4 text-sm text-gray-500">None in this period.</p>
              ) : (
                <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 shadow-sm">
                  <table className="min-w-full border-collapse text-left">
                    <thead>
                      <tr>
                        <th className={th}>Interviewer</th>
                        <th className={`${th} text-right`}>Assigned</th>
                        <th className={`${th} text-right`}>Completed</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {testimonialIvByPerson.map((row) => (
                        <tr key={`t-${row.label}`} className="hover:bg-gray-50/80">
                          <td className={td}>{row.label}</td>
                          <td className={tdNum}>{row.assigned}</td>
                          <td className={tdNum}>{row.completed}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section>
              <h3 className="text-base font-semibold text-gray-900">Project interviews</h3>
              {projectIvByPerson.length === 0 ? (
                <p className="mt-4 text-sm text-gray-500">None in this period.</p>
              ) : (
                <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 shadow-sm">
                  <table className="min-w-full border-collapse text-left">
                    <thead>
                      <tr>
                        <th className={th}>Interviewer</th>
                        <th className={`${th} text-right`}>Assigned</th>
                        <th className={`${th} text-right`}>Completed</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {projectIvByPerson.map((row) => (
                        <tr key={`p-${row.label}`} className="hover:bg-gray-50/80">
                          <td className={td}>{row.label}</td>
                          <td className={tdNum}>{row.assigned}</td>
                          <td className={tdNum}>{row.completed}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="rounded-xl border border-gray-200 bg-gradient-to-b from-gray-50 to-white p-5 shadow-sm">
              <h3 className="text-base font-semibold text-gray-900">Period summary</h3>
              <dl className="mt-4 divide-y divide-gray-200">
                <div className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0">
                  <dt className="text-sm text-gray-600">Total calls (testimonial pipeline)</dt>
                  <dd className="text-sm font-semibold tabular-nums text-gray-900">
                    {totals.followupTestimonialPipeline}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 py-2.5">
                  <dt className="text-sm text-gray-600">Total calls (project pipeline)</dt>
                  <dd className="text-sm font-semibold tabular-nums text-gray-900">
                    {totals.followupProjectPipeline}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 py-2.5">
                  <dt className="text-sm text-gray-600">Interested</dt>
                  <dd className="text-sm font-semibold tabular-nums text-gray-900">
                    {totals.followupInterested}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 py-2.5">
                  <dt className="text-sm text-gray-600">Callback requested</dt>
                  <dd className="text-sm font-semibold tabular-nums text-gray-900">
                    {totals.followupCallback}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 py-2.5">
                  <dt className="text-sm text-gray-600">
                    Testimonial interviews with a slot in this date range
                  </dt>
                  <dd className="text-sm font-semibold tabular-nums text-gray-900">
                    {totals.testimonialScheduledSlots}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 py-2.5">
                  <dt className="text-sm text-gray-600">
                    Project interviews with a slot in this date range
                  </dt>
                  <dd className="text-sm font-semibold tabular-nums text-gray-900">
                    {totals.projectScheduledSlots}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 py-2.5">
                  <dt className="text-sm text-gray-600">
                    Testimonial interviews finished in this date range
                  </dt>
                  <dd className="text-sm font-semibold tabular-nums text-gray-900">
                    {totals.testimonialCompleted}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 py-2.5">
                  <dt className="text-sm text-gray-600">
                    Project interviews finished in this date range
                  </dt>
                  <dd className="text-sm font-semibold tabular-nums text-gray-900">
                    {totals.projectCompleted}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 py-2.5 last:pb-0">
                  <dt className="text-sm text-gray-600">Dispatches logged in this date range</dt>
                  <dd className="text-sm font-semibold tabular-nums text-gray-900">
                    {totals.dispatches}
                  </dd>
                </div>
              </dl>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

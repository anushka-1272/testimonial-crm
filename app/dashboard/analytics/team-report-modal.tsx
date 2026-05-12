"use client";

import { endOfDay, format, startOfMonth, startOfQuarter, startOfWeek } from "date-fns";
import { useCallback, useEffect, useState } from "react";

import type { SupabaseClient } from "@supabase/supabase-js";

import { modalOverlayClass, modalPanelWideClass } from "@/lib/modal-responsive";

export type TeamReportPeriodPreset = "week" | "month" | "quarter";

const PERIOD_LABELS: Record<TeamReportPeriodPreset, string> = {
  week: "This week",
  month: "This month",
  quarter: "This quarter",
};

function rangeForPreset(preset: TeamReportPeriodPreset): { start: Date; end: Date } {
  const end = endOfDay(new Date());
  const now = new Date();
  if (preset === "week") {
    return { start: startOfWeek(now, { weekStartsOn: 1 }), end };
  }
  if (preset === "month") {
    return { start: startOfMonth(now), end };
  }
  return { start: startOfQuarter(now), end };
}

function isoRange(start: Date, end: Date): { startIso: string; endIso: string } {
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

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
};

type ProjectInterviewRow = {
  interviewer: string | null;
  completed_at: string | null;
  interview_status: string | null;
};

type DispatchRow = { id: string };

function followupActorKey(r: FollowupRow): string {
  const em = r.logged_by_email?.trim().toLowerCase();
  if (em) return `e:${em}`;
  const n = r.logged_by?.trim().toLowerCase();
  if (n) return `n:${n}`;
  return "unknown";
}

function followupActorDisplay(r: FollowupRow): string {
  const name = r.logged_by?.trim();
  const em = r.logged_by_email?.trim();
  if (name && em) return `${name} (${em})`;
  return name || em || "Unknown";
}

function increment(map: Map<string, number>, key: string, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

function mapToSortedRows(map: Map<string, number>): { label: string; count: number }[] {
  const out = [...map.entries()].map(([label, count]) => ({ label, count }));
  out.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return out;
}

export type TeamReportModalProps = {
  open: boolean;
  supabase: SupabaseClient;
  onClose: () => void;
};

export function TeamReportModal({ open, supabase, onClose }: TeamReportModalProps) {
  const [period, setPeriod] = useState<TeamReportPeriodPreset>("month");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [followupByActor, setFollowupByActor] = useState<{ label: string; count: number }[]>(
    [],
  );
  const [testimonialIvByPerson, setTestimonialIvByPerson] = useState<
    { label: string; count: number }[]
  >([]);
  const [projectIvByPerson, setProjectIvByPerson] = useState<
    { label: string; count: number }[]
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

    const { start, end } = rangeForPreset(period);
    const { startIso, endIso } = isoRange(start, end);

    const followRes = await fetchAllPages<FollowupRow>(async (from, to) =>
      supabase
        .from("followup_log")
        .select(
          "created_at, logged_by, logged_by_email, candidate_id, project_candidate_id, status",
        )
        .gte("created_at", startIso)
        .lte("created_at", endIso)
        .order("created_at", { ascending: true })
        .range(from, to),
    );
    if (followRes.error) {
      setError(followRes.error);
      setLoading(false);
      return;
    }

    const byActor = new Map<string, number>();
    const displayByActorKey = new Map<string, string>();
    let followT = 0;
    let followP = 0;
    let interested = 0;
    let callback = 0;

    for (const r of followRes.rows) {
      const key = followupActorKey(r);
      increment(byActor, key);
      if (!displayByActorKey.has(key)) {
        displayByActorKey.set(key, followupActorDisplay(r));
      }
      if (r.candidate_id) followT += 1;
      else if (r.project_candidate_id) followP += 1;
      const st = (r.status ?? "").trim();
      if (st === "interested") interested += 1;
      if (st === "callback") callback += 1;
    }

    const followRowsSorted = [...byActor.entries()]
      .map(([key, count]) => ({
        label: displayByActorKey.get(key) ?? "Unknown",
        count,
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    const testimonialCompletedRes = await fetchAllPages<InterviewRow>(async (from, to) =>
      supabase
        .from("interviews")
        .select("interviewer, completed_at, interview_status, candidates!inner(is_deleted)")
        .eq("candidates.is_deleted", false)
        .eq("interview_type", "testimonial")
        .or("interview_status.eq.completed,completed_at.not.is.null")
        .not("completed_at", "is", null)
        .gte("completed_at", startIso)
        .lte("completed_at", endIso)
        .range(from, to),
    );
    if (testimonialCompletedRes.error) {
      setError(testimonialCompletedRes.error);
      setLoading(false);
      return;
    }

    const testimonialScheduledRes = await fetchAllPages<Pick<InterviewRow, "interviewer">>(
      async (from, to) =>
        supabase
          .from("interviews")
          .select("interviewer, candidates!inner(is_deleted)")
          .eq("candidates.is_deleted", false)
          .eq("interview_type", "testimonial")
          .not("scheduled_date", "is", null)
          .gte("scheduled_date", startIso)
          .lte("scheduled_date", endIso)
          .range(from, to),
    );
    if (testimonialScheduledRes.error) {
      setError(testimonialScheduledRes.error);
      setLoading(false);
      return;
    }

    const projectCompletedRes = await fetchAllPages<ProjectInterviewRow>(async (from, to) =>
      supabase
        .from("project_interviews")
        .select(
          "interviewer, completed_at, interview_status, project_candidates!inner(is_deleted)",
        )
        .eq("project_candidates.is_deleted", false)
        .or("interview_status.eq.completed,completed_at.not.is.null")
        .not("completed_at", "is", null)
        .gte("completed_at", startIso)
        .lte("completed_at", endIso)
        .range(from, to),
    );
    if (projectCompletedRes.error) {
      setError(projectCompletedRes.error);
      setLoading(false);
      return;
    }

    const projectScheduledRes = await fetchAllPages<Pick<ProjectInterviewRow, "interviewer">>(
      async (from, to) =>
        supabase
          .from("project_interviews")
          .select("interviewer, project_candidates!inner(is_deleted)")
          .eq("project_candidates.is_deleted", false)
          .not("scheduled_date", "is", null)
          .gte("scheduled_date", startIso)
          .lte("scheduled_date", endIso)
          .range(from, to),
    );
    if (projectScheduledRes.error) {
      setError(projectScheduledRes.error);
      setLoading(false);
      return;
    }

    const testimonialIvMap = new Map<string, number>();
    for (const r of testimonialCompletedRes.rows) {
      const label = r.interviewer?.trim() || "Unassigned";
      increment(testimonialIvMap, label);
    }

    const projectIvMap = new Map<string, number>();
    for (const r of projectCompletedRes.rows) {
      const label = r.interviewer?.trim() || "Unassigned";
      increment(projectIvMap, label);
    }

    const dispRes = await fetchAllPages<DispatchRow>(async (from, to) =>
      supabase
        .from("dispatch")
        .select("id, candidates!inner(is_deleted)")
        .eq("candidates.is_deleted", false)
        .gte("created_at", startIso)
        .lte("created_at", endIso)
        .range(from, to),
    );
    if (dispRes.error) {
      setError(dispRes.error);
      setLoading(false);
      return;
    }

    setFollowupByActor(followRowsSorted);
    setTestimonialIvByPerson(mapToSortedRows(testimonialIvMap));
    setProjectIvByPerson(mapToSortedRows(projectIvMap));
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
  const rangeLabel = `${format(start, "MMM d, yyyy")} – ${format(end, "MMM d, yyyy")}`;

  const th =
    "border-b border-gray-200 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500";
  const td = "border-b border-gray-100 px-3 py-2 text-sm tabular-nums text-gray-900";

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
            <p className="mt-1 text-xs text-gray-400">
              Week starts Monday (device local time). Follow-up counts use who logged the call;
              interview counts use the assigned interviewer on the completed row.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(Object.keys(PERIOD_LABELS) as TeamReportPeriodPreset[]).map((p) => (
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

        {error ? (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}

        {loading ? (
          <p className="mt-8 text-sm text-gray-500">Loading numbers…</p>
        ) : (
          <div className="mt-6 space-y-8">
            <section>
              <h3 className="text-sm font-semibold text-gray-800">Pipeline totals</h3>
              <ul className="mt-3 grid gap-2 text-sm text-gray-700 sm:grid-cols-2">
                <li>
                  Follow-up calls logged (testimonial / eligible pipeline):{" "}
                  <span className="font-semibold tabular-nums text-gray-900">
                    {totals.followupTestimonialPipeline}
                  </span>
                </li>
                <li>
                  Follow-up calls logged (project pipeline):{" "}
                  <span className="font-semibold tabular-nums text-gray-900">
                    {totals.followupProjectPipeline}
                  </span>
                </li>
                <li>
                  Follow-up calls logged (all):{" "}
                  <span className="font-semibold tabular-nums text-gray-900">
                    {totals.followupTestimonialPipeline + totals.followupProjectPipeline}
                  </span>
                </li>
                <li>
                  Follow-up outcomes — interested:{" "}
                  <span className="font-semibold tabular-nums text-gray-900">
                    {totals.followupInterested}
                  </span>
                </li>
                <li>
                  Follow-up outcomes — callback requested:{" "}
                  <span className="font-semibold tabular-nums text-gray-900">
                    {totals.followupCallback}
                  </span>
                </li>
                <li>
                  Testimonial interviews — slots with{" "}
                  <code className="rounded bg-gray-100 px-1 text-xs">scheduled_date</code> in
                  range:{" "}
                  <span className="font-semibold tabular-nums text-gray-900">
                    {totals.testimonialScheduledSlots}
                  </span>
                </li>
                <li>
                  Project interviews — slots with{" "}
                  <code className="rounded bg-gray-100 px-1 text-xs">scheduled_date</code> in
                  range:{" "}
                  <span className="font-semibold tabular-nums text-gray-900">
                    {totals.projectScheduledSlots}
                  </span>
                </li>
                <li>
                  Testimonial interviews completed (
                  <code className="rounded bg-gray-100 px-1 text-xs">completed_at</code> in
                  range):{" "}
                  <span className="font-semibold tabular-nums text-gray-900">
                    {totals.testimonialCompleted}
                  </span>
                </li>
                <li>
                  Project interviews completed (
                  <code className="rounded bg-gray-100 px-1 text-xs">completed_at</code> in
                  range):{" "}
                  <span className="font-semibold tabular-nums text-gray-900">
                    {totals.projectCompleted}
                  </span>
                </li>
                <li>
                  Dispatch records created (
                  <code className="rounded bg-gray-100 px-1 text-xs">dispatch.created_at</code>{" "}
                  in range):{" "}
                  <span className="font-semibold tabular-nums text-gray-900">
                    {totals.dispatches}
                  </span>
                </li>
              </ul>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-gray-800">
                Follow-up calls by person (logged)
              </h3>
              <p className="mt-1 text-xs text-gray-500">
                From <code className="rounded bg-gray-100 px-1">followup_log</code> — whoever
                saved the log entry (name / email when available).
              </p>
              {followupByActor.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">No follow-up logs in this period.</p>
              ) : (
                <div className="mt-3 overflow-x-auto rounded-lg border border-gray-100">
                  <table className="min-w-full border-collapse text-left">
                    <thead>
                      <tr>
                        <th className={th}>Person</th>
                        <th className={`${th} text-right`}>Calls logged</th>
                      </tr>
                    </thead>
                    <tbody>
                      {followupByActor.map((row) => (
                        <tr key={row.label}>
                          <td className={td}>{row.label}</td>
                          <td className={`${td} text-right font-medium`}>{row.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section>
              <h3 className="text-sm font-semibold text-gray-800">
                Testimonial interviews completed — by interviewer
              </h3>
              {testimonialIvByPerson.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">None in this period.</p>
              ) : (
                <div className="mt-3 overflow-x-auto rounded-lg border border-gray-100">
                  <table className="min-w-full border-collapse text-left">
                    <thead>
                      <tr>
                        <th className={th}>Interviewer</th>
                        <th className={`${th} text-right`}>Completed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {testimonialIvByPerson.map((row) => (
                        <tr key={`t-${row.label}`}>
                          <td className={td}>{row.label}</td>
                          <td className={`${td} text-right font-medium`}>{row.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section>
              <h3 className="text-sm font-semibold text-gray-800">
                Project interviews completed — by interviewer
              </h3>
              {projectIvByPerson.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">None in this period.</p>
              ) : (
                <div className="mt-3 overflow-x-auto rounded-lg border border-gray-100">
                  <table className="min-w-full border-collapse text-left">
                    <thead>
                      <tr>
                        <th className={th}>Interviewer</th>
                        <th className={`${th} text-right`}>Completed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projectIvByPerson.map((row) => (
                        <tr key={`p-${row.label}`}>
                          <td className={td}>{row.label}</td>
                          <td className={`${td} text-right font-medium`}>{row.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

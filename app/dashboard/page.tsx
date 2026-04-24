"use client";

import { format, formatDistanceToNow, parseISO } from "date-fns";
import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import {
  buildInterviewerSelectOptions,
  type InterviewerSelectOption,
} from "@/lib/interviewer-enum";
import { fetchTeamRosterNames } from "@/lib/team-roster";
import { getUserSafe } from "@/lib/supabase-auth";
import { createBrowserSupabaseClient } from "@/lib/supabase-browser";

type Period = "total" | "monthly" | "weekly";

const INTERVIEWER_THEME: Record<string, { bar: string; avatar: string }> = {
  Anushka: { bar: "#2563eb", avatar: "#2563eb" },
  "Anushka Roy": { bar: "#2563eb", avatar: "#2563eb" },
  Harika: { bar: "#7c3aed", avatar: "#7c3aed" },
  Gargi: { bar: "#16a34a", avatar: "#16a34a" },
  Mudit: { bar: "#d97706", avatar: "#d97706" },
};
const INTERVIEWER_THEME_FALLBACK = [
  { bar: "#2563eb", avatar: "#2563eb" },
  { bar: "#7c3aed", avatar: "#7c3aed" },
  { bar: "#16a34a", avatar: "#16a34a" },
  { bar: "#d97706", avatar: "#d97706" },
  { bar: "#0ea5e9", avatar: "#0ea5e9" },
  { bar: "#db2777", avatar: "#db2777" },
];

/** Rows fetched and stored in `recentActivity` for the dashboard preview only. */
const DASHBOARD_RECENT_ACTIVITY_LIMIT = 3;

type PeriodBounds = { startIso: string; endIso?: string } | null;

function getPeriodBounds(period: Period): PeriodBounds {
  const now = new Date();
  if (period === "weekly") {
    // UTC Saturday 00:00:00.000 → next Saturday (exclusive), i.e. Sat–Fri.
    const day = now.getUTCDay(); // 0=Sun ... 6=Sat
    const diff = day === 6 ? 0 : -(day + 1);
    const startMs = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + diff,
      0,
      0,
      0,
      0,
    );
    const endMs = startMs + 7 * 24 * 60 * 60 * 1000;
    return {
      startIso: new Date(startMs).toISOString(),
      endIso: new Date(endMs).toISOString(),
    };
  }
  if (period === "monthly") {
    const startMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0);
    return { startIso: new Date(startMs).toISOString() };
  }
  return null;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function periodLabel(p: Period): string {
  if (p === "total") return "Total";
  if (p === "monthly") return "Monthly";
  return "Weekly";
}

/** `followup_log.status` values shown in Calls Done breakdown */
const FOLLOWUP_BREAKDOWN_STATUSES = [
  "no_answer",
  "interested",
  "callback",
  "not_interested",
] as const;

const FOLLOWUP_BREAKDOWN_LABELS: Record<
  (typeof FOLLOWUP_BREAKDOWN_STATUSES)[number],
  string
> = {
  no_answer: "No answer",
  interested: "Interested",
  callback: "Callback",
  not_interested: "Not interested",
};

type FollowupCallBreakdown = Record<
  (typeof FOLLOWUP_BREAKDOWN_STATUSES)[number],
  number
>;

function emptyFollowupBreakdown(): FollowupCallBreakdown {
  return {
    no_answer: 0,
    interested: 0,
    callback: 0,
    not_interested: 0,
  };
}

function formatFollowupBreakdownSubtitle(
  total: number,
  b: FollowupCallBreakdown,
): string | undefined {
  if (total <= 0) return undefined;
  const parts = FOLLOWUP_BREAKDOWN_STATUSES.filter((k) => b[k] > 0).map(
    (k) => `${FOLLOWUP_BREAKDOWN_LABELS[k]}: ${b[k]}`,
  );
  const sumFour = FOLLOWUP_BREAKDOWN_STATUSES.reduce((s, k) => s + b[k], 0);
  const other = total - sumFour;
  if (other > 0) parts.push(`Other: ${other}`);
  if (parts.length === 0) return undefined;
  return parts.join(" · ");
}

function greetingForHour(h: number): string {
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function greetNameFromEmail(email: string | undefined): string {
  if (!email) return "there";
  const local = email.split("@")[0] ?? "";
  if (!local) return "there";
  return local.charAt(0).toUpperCase() + local.slice(1);
}

type RecentActivityRow = {
  id: string;
  created_at: string;
  user_id: string | null;
  user_name: string | null;
  action_type: string;
  description: string;
  /** Resolved from team_members.full_name when available */
  display_user_name: string;
};

/** Strip redundant “Admin email …” / duplicate actor prefix from log description. */
function activityActionText(actor: string, description: string): string {
  let d = description.trim();
  d = d.replace(/^Admin\s+\S+@\S+\s+/i, "");
  d = d.replace(/^Admin\s+\S+\s+/i, "");
  const a = actor.trim();
  if (a.length > 0 && d.toLowerCase().startsWith(a.toLowerCase() + " ")) {
    d = d.slice(a.length).trim();
  }
  if (d.length > 0 && /^[a-z]/.test(d)) {
    d = d.charAt(0).toUpperCase() + d.slice(1);
  }
  return d.length > 0 ? d : description.trim();
}

function activityLeftBorderClass(actionType: string, description: string): string {
  const d = description.toLowerCase();
  if (
    d.includes("deleted") ||
    d.includes("delete candidate") ||
    d.includes("delete project")
  ) {
    return "!border-l-red-500";
  }
  switch (actionType) {
    case "eligibility":
      return "!border-l-purple-500";
    case "interviews":
      return "!border-l-blue-500";
    case "dispatch":
      return "!border-l-orange-500";
    case "settings":
      return "!border-l-gray-400";
    case "post_production":
      return "!border-l-blue-500";
    default:
      return "!border-l-gray-300";
  }
}

function avatarHue(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 65% 42%)`;
}

const cardChrome =
  "shadow-[0_4px_16px_rgba(0,0,0,0.08)] border border-[#f0f0f0]";

export default function DashboardPage() {
  const supabase = createBrowserSupabaseClient();
  const [period, setPeriod] = useState<Period>("total");
  const [greetName, setGreetName] = useState("there");
  const [stats, setStats] = useState({
    testimonials: 0,
    projects: 0,
    dispatches: 0,
    entries: 0,
    calls: 0,
    /** One row per follow-up call attempt (`followup_log`), not interviews */
    totalCallAttempts: 0,
  });
  const [followupBreakdown, setFollowupBreakdown] =
    useState<FollowupCallBreakdown>(emptyFollowupBreakdown);
  const [interviewer, setInterviewer] = useState<Record<string, number>>({});
  const [interviewerOpts, setInterviewerOpts] = useState<
    InterviewerSelectOption[]
  >([]);
  const [funnel, setFunnel] = useState({
    entries: 0,
    eligible: 0,
    scheduled: 0,
    completed: 0,
    dispatched: 0,
  });
  const [recentActivity, setRecentActivity] = useState<RecentActivityRow[]>(
    [],
  );
  const [recentLoading, setRecentLoading] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();
    void (async () => {
      const user = await getUserSafe(supabase);
      if (ctrl.signal.aborted || !user) return;
      setGreetName(greetNameFromEmail(user.email ?? undefined));
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (ctrl.signal.aborted) return;
      const u = session?.user;
      if (u) setGreetName(greetNameFromEmail(u.email ?? undefined));
    });
    return () => {
      ctrl.abort();
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    const bounds = getPeriodBounds(period);
    const rangeStart = bounds?.startIso ?? null;
    const rangeEnd = bounds?.endIso ?? null;

    if (period === "weekly" && rangeStart && rangeEnd) {
      console.log("WEEK (Sat-Fri)", rangeStart, rangeEnd);
    }

    let entriesQ = supabase
      .from("candidates")
      .select("*", { count: "exact", head: true })
      .eq("is_deleted", false);
    if (rangeStart) entriesQ = entriesQ.gte("created_at", rangeStart);
    if (rangeEnd) entriesQ = entriesQ.lt("created_at", rangeEnd);
    const { count: entries } = await entriesQ;

    let callsQ = supabase
      .from("interviews")
      .select("id, candidates!inner(id)", { count: "exact", head: true })
      .or("interview_status.eq.completed,completed_at.not.is.null")
      .not("completed_at", "is", null)
      .eq("post_interview_eligible", true)
      .eq("candidates.is_deleted", false);
    if (rangeStart) callsQ = callsQ.gte("completed_at", rangeStart);
    if (rangeEnd) callsQ = callsQ.lt("completed_at", rangeEnd);
    const { count: calls } = await callsQ;

    let testQ = supabase
      .from("interviews")
      .select("id, candidates!inner(id)", { count: "exact", head: true })
      .or("interview_status.eq.completed,completed_at.not.is.null")
      .not("completed_at", "is", null)
      .eq("interview_type", "testimonial")
      .eq("candidates.is_deleted", false);
    if (rangeStart) testQ = testQ.gte("completed_at", rangeStart);
    if (rangeEnd) testQ = testQ.lt("completed_at", rangeEnd);
    const { count: testimonials } = await testQ;

    let projQ = supabase
      .from("project_interviews")
      .select("id, project_candidates!inner(id)", { count: "exact", head: true })
      .or("interview_status.eq.completed,completed_at.not.is.null")
      .not("completed_at", "is", null)
      .eq("project_candidates.is_deleted", false);
    if (rangeStart) projQ = projQ.gte("completed_at", rangeStart);
    if (rangeEnd) projQ = projQ.lt("completed_at", rangeEnd);
    const { count: projects } = await projQ;

    let dispQ = supabase
      .from("dispatch")
      .select("id, candidates!inner(id)", { count: "exact", head: true })
      .eq("candidates.is_deleted", false);
    if (rangeStart) dispQ = dispQ.gte("created_at", rangeStart);
    if (rangeEnd) dispQ = dispQ.lt("created_at", rangeEnd);
    const { count: dispatches } = await dispQ;

    let followupTotalQ = supabase
      .from("followup_log")
      .select("id", { count: "exact", head: true });
    if (rangeStart) followupTotalQ = followupTotalQ.gte("created_at", rangeStart);
    if (rangeEnd) followupTotalQ = followupTotalQ.lt("created_at", rangeEnd);
    const { count: totalCallAttempts } = await followupTotalQ;

    const nextBreakdown = emptyFollowupBreakdown();
    for (const st of FOLLOWUP_BREAKDOWN_STATUSES) {
      let bq = supabase
        .from("followup_log")
        .select("id", { count: "exact", head: true })
        .eq("status", st);
      if (rangeStart) bq = bq.gte("created_at", rangeStart);
      if (rangeEnd) bq = bq.lt("created_at", rangeEnd);
      const { count: c } = await bq;
      nextBreakdown[st] = c || 0;
    }
    setFollowupBreakdown(nextBreakdown);

    setStats({
      testimonials: testimonials || 0,
      projects: projects || 0,
      dispatches: dispatches || 0,
      entries: entries || 0,
      calls: calls || 0,
      totalCallAttempts: totalCallAttempts || 0,
    });

    const ivNames = await fetchTeamRosterNames(supabase, "interviewer", true);
    const ivOptions = buildInterviewerSelectOptions(ivNames, null);
    setInterviewerOpts(ivOptions);
    const ivStats: Record<string, number> = {};
    for (const opt of ivOptions) {
      let q = supabase
        .from("interviews")
        .select("id, candidates!inner(id)", { count: "exact", head: true })
        .eq("interviewer", opt.value)
        .or("interview_status.eq.completed,completed_at.not.is.null")
        .not("completed_at", "is", null)
        .eq("candidates.is_deleted", false);
      if (rangeStart) q = q.gte("completed_at", rangeStart);
      if (rangeEnd) q = q.lt("completed_at", rangeEnd);
      const { count } = await q;
      ivStats[opt.value] = count || 0;
    }
    setInterviewer(ivStats);

    const { count: fEntries } = await supabase
      .from("candidates")
      .select("*", { count: "exact", head: true })
      .eq("is_deleted", false);
    let fEligibleQ = supabase
      .from("interviews")
      .select("id, candidates!inner(id)", { count: "exact", head: true })
      .or("interview_status.eq.completed,completed_at.not.is.null")
      .not("completed_at", "is", null)
      .eq("post_interview_eligible", true)
      .eq("candidates.is_deleted", false);
    if (rangeStart) fEligibleQ = fEligibleQ.gte("completed_at", rangeStart);
    if (rangeEnd) fEligibleQ = fEligibleQ.lt("completed_at", rangeEnd);
    const { count: fEligible } = await fEligibleQ;
    const { count: fScheduled } = await supabase
      .from("interviews")
      .select("id, candidates!inner(id)", { count: "exact", head: true })
      .eq("candidates.is_deleted", false);
    let fCompletedQ = supabase
      .from("interviews")
      .select("id, candidates!inner(id)", { count: "exact", head: true })
      .or("interview_status.eq.completed,completed_at.not.is.null")
      .not("completed_at", "is", null)
      .eq("candidates.is_deleted", false);
    if (rangeStart) fCompletedQ = fCompletedQ.gte("completed_at", rangeStart);
    if (rangeEnd) fCompletedQ = fCompletedQ.lt("completed_at", rangeEnd);
    const { count: fCompleted } = await fCompletedQ;
    const { count: fDispatched } = await supabase
      .from("dispatch")
      .select("id, candidates!inner(id)", { count: "exact", head: true })
      .eq("candidates.is_deleted", false);
    setFunnel({
      entries: fEntries || 0,
      eligible: fEligible || 0,
      scheduled: fScheduled || 0,
      completed: fCompleted || 0,
      dispatched: fDispatched || 0,
    });

    if (period === "weekly") {
      let sampleQ = supabase
        .from("interviews")
        .select("id, completed_at, interview_status")
        .or("interview_status.eq.completed,completed_at.not.is.null")
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: false })
        .limit(5);
      if (rangeStart) sampleQ = sampleQ.gte("completed_at", rangeStart);
      if (rangeEnd) sampleQ = sampleQ.lt("completed_at", rangeEnd);
      const { data: sampleRows } = await sampleQ;
      console.debug("[Dashboard weekly] completed samples", sampleRows ?? []);
    }

    setLoading(false);
  }, [supabase, period]);

  const fetchRecentActivity = useCallback(async () => {
    setRecentLoading(true);
    const { data: rows } = await supabase
      .from("activity_log")
      .select("id, created_at, user_id, user_name, action_type, description")
      .order("created_at", { ascending: false })
      .limit(DASHBOARD_RECENT_ACTIVITY_LIMIT);

    const raw = (rows ?? []) as {
      id: string;
      created_at: string;
      user_id: string | null;
      user_name: string | null;
      action_type: string;
      description: string;
    }[];

    const userIds = [
      ...new Set(
        raw.map((r) => r.user_id).filter((id): id is string => Boolean(id)),
      ),
    ];

    let fullNameByUserId: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: members } = await supabase
        .from("team_members")
        .select("user_id, full_name")
        .in("user_id", userIds);
      for (const m of members ?? []) {
        const uid = m.user_id as string;
        const fn = (m.full_name as string | null)?.trim();
        if (uid && fn) fullNameByUserId[uid] = fn;
      }
    }

    const enriched: RecentActivityRow[] = raw.map((r) => {
      const fromTeam =
        r.user_id && fullNameByUserId[r.user_id]
          ? fullNameByUserId[r.user_id]
          : null;
      const fallback = r.user_name?.trim() || "Someone";
      return {
        ...r,
        action_type: r.action_type ?? "unknown",
        display_user_name: fromTeam ?? fallback,
      };
    });

    setRecentActivity(enriched.slice(0, DASHBOARD_RECENT_ACTIVITY_LIMIT));
    setRecentLoading(false);
  }, [supabase]);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    void fetchRecentActivity();
  }, [fetchRecentActivity]);

  useEffect(() => {
    const ch = supabase
      .channel("dashboard-activity-log")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "activity_log" },
        () => {
          void fetchRecentActivity();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [supabase, fetchRecentActivity]);

  useEffect(() => {
    const ch = supabase
      .channel("dashboard-candidates")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "candidates" },
        () => {
          void fetchStats();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [supabase, fetchStats]);

  const funnelSteps = useMemo(
    () => [
      { label: "Entries", value: funnel.entries },
      { label: "Eligible", value: funnel.eligible },
      { label: "Scheduled", value: funnel.scheduled },
      { label: "Completed", value: funnel.completed },
      { label: "Dispatched", value: funnel.dispatched },
    ],
    [funnel],
  );

  const interviewerGrid = useMemo(() => {
    return interviewerOpts.map((opt, idx) => ({
      value: opt.value,
      name: opt.label,
      count: interviewer[opt.value] ?? 0,
      theme:
        INTERVIEWER_THEME[opt.value] ??
        INTERVIEWER_THEME_FALLBACK[idx % INTERVIEWER_THEME_FALLBACK.length],
    }));
  }, [interviewer, interviewerOpts]);

  const interviewerTeamTotal = useMemo(() => {
    return interviewerOpts.reduce(
      (s, opt) => s + (interviewer[opt.value] ?? 0),
      0,
    );
  }, [interviewer, interviewerOpts]);

  const statCards = useMemo(() => {
    const callsDoneSubtitle = formatFollowupBreakdownSubtitle(
      stats.totalCallAttempts,
      followupBreakdown,
    );
    return [
      { label: "Testimonial interviews", value: stats.testimonials },
      { label: "Project interviews", value: stats.projects },
      { label: "Dispatches", value: stats.dispatches },
      { label: "Form entries", value: stats.entries },
      { label: "Eligible (Post Interview)", value: stats.calls },
      {
        label: "Calls Done",
        value: stats.totalCallAttempts,
        title:
          "Total follow-up call attempts logged in followup_log (by period when Weekly/Monthly is selected). Does not include interview completions.",
        subtitle: callsDoneSubtitle,
      },
    ];
  }, [stats, followupBreakdown]);

  const hour = new Date().getHours();
  const greeting = greetingForHour(hour);

  return (
    <>
      <header className="sticky top-14 z-30 bg-[#f5f5f7]/90 px-4 py-4 backdrop-blur-md sm:px-6 sm:py-5 lg:top-0 lg:px-8 lg:py-6">
        <div className="mx-auto flex max-w-[1400px] items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[#1d1d1f] sm:text-2xl">
              {greeting}, {greetName}{" "}
              <span className="font-normal" aria-hidden>
                👋
              </span>
            </h1>
            <p className="mt-1 text-sm text-[#6e6e73]">
              Here&apos;s what&apos;s happening today
            </p>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 pb-10 pt-2 sm:px-6 lg:px-8 lg:pb-12">
        <div className="mx-auto max-w-[1400px] space-y-10">
          <div className="inline-flex rounded-full bg-white p-1 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
            {(["total", "monthly", "weekly"] as Period[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`rounded-full px-4 py-1.5 text-sm transition-all duration-200 ease-in-out ${
                  period === p
                    ? "bg-[#1d1d1f] font-medium text-white"
                    : "text-[#6e6e73] hover:text-[#1d1d1f]"
                }`}
              >
                {periodLabel(p)}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-6 lg:gap-4">
            {statCards.map(({ label, value, subtitle, title }) => (
              <div
                key={label}
                title={title}
                className={`rounded-2xl bg-white p-4 transition-transform duration-200 ease-in-out hover:scale-[1.01] sm:p-6 ${cardChrome} cursor-default`}
              >
                <p className="mb-3 text-xs font-medium text-[#6e6e73]">
                  {label}
                </p>
                <p className="text-2xl font-bold tracking-tight text-[#1d1d1f] tabular-nums sm:text-4xl">
                  {loading ? "—" : value}
                </p>
                {subtitle ? (
                  <p className="mt-2 text-[11px] leading-snug text-[#6e6e73]">
                    {subtitle}
                  </p>
                ) : null}
                <div className="mt-4 h-0.5 w-8 rounded-full bg-[#3b82f6]" />
              </div>
            ))}
          </div>

          <div className="border-t border-[#e8e8ed] pt-10">
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-5 lg:gap-10">
              <div className="w-full lg:col-span-3">
                <div className="mb-5 border-l-4 border-blue-500 pl-3">
                  <h2 className="text-base font-semibold text-gray-800">
                    Interviewer performance
                  </h2>
                  <p className="mt-1 text-sm text-[#6e6e73]">
                    Completed testimonial interviews · share of team total
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {interviewerGrid.map((row) => {
                    const barPct =
                      loading || interviewerTeamTotal <= 0
                        ? 0
                        : Math.round(
                            (row.count / interviewerTeamTotal) * 100,
                          );
                    return (
                      <div
                        key={row.value}
                        className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm"
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                            style={{ backgroundColor: row.theme.avatar }}
                          >
                            {initials(row.name)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-[#1d1d1f]">
                              {row.name}
                            </p>
                            {loading ? (
                              <p className="mt-1 text-3xl font-bold tabular-nums text-[#1d1d1f]">
                                —
                              </p>
                            ) : row.count === 0 ? (
                              <p className="mt-2 text-sm text-gray-400">
                                No interviews yet
                              </p>
                            ) : (
                              <>
                                <p className="mt-1 text-3xl font-bold tabular-nums tracking-tight text-[#1d1d1f]">
                                  {row.count}
                                </p>
                                <p className="mt-0.5 text-xs text-[#6e6e73]">
                                  {barPct}% of team
                                </p>
                              </>
                            )}
                          </div>
                        </div>
                        {(loading || row.count > 0) && (
                          <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-gray-100">
                            <div
                              className="h-full rounded-full transition-all duration-300"
                              style={{
                                width: loading ? "0%" : `${barPct}%`,
                                backgroundColor: row.theme.bar,
                              }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="w-full lg:col-span-2">
                <div className="mb-5 border-l-4 border-violet-500 pl-3">
                  <h2 className="text-base font-semibold text-gray-800">
                    Recent activity
                  </h2>
                  <p className="mt-1 text-sm text-[#6e6e73]">
                    Latest changes from your team
                  </p>
                </div>
                <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                  {recentLoading ? (
                    <p className="text-sm text-[#6e6e73]">Loading…</p>
                  ) : recentActivity.length === 0 ? (
                    <p className="text-sm text-[#6e6e73]">No activity yet</p>
                  ) : (
                    <ul className="space-y-3">
                      {recentActivity.map((a) => {
                        const actor = a.display_user_name;
                        const actionText = activityActionText(
                          actor,
                          a.description,
                        );
                        const borderAccent = activityLeftBorderClass(
                          a.action_type,
                          a.description,
                        );
                        return (
                          <li
                            key={a.id}
                            className={`flex items-start gap-3 rounded-xl border border-gray-100 border-l-4 border-l-transparent bg-[#fafafa]/80 py-3 pl-3 pr-3 ${borderAccent}`}
                          >
                            <div
                              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-medium text-white"
                              style={{ backgroundColor: avatarHue(actor) }}
                            >
                              {initials(actor)}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm leading-snug text-[#1d1d1f]">
                                <span className="font-semibold">{actor}</span>{" "}
                                {actionText}
                              </p>
                            </div>
                            <time
                              className="shrink-0 text-right text-xs text-gray-400"
                              dateTime={a.created_at}
                            >
                              {formatDistanceToNow(parseISO(a.created_at), {
                                addSuffix: true,
                              })}
                            </time>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <Link
                    href="/dashboard/activity"
                    className="mt-5 inline-flex text-sm font-medium text-[#3b82f6] transition-colors hover:text-[#2563eb]"
                  >
                    View all →
                  </Link>
                </div>
              </div>
            </div>
          </div>

          <section
            className={`rounded-2xl bg-white p-8 transition-all duration-200 ease-in-out ${cardChrome}`}
          >
            <div className="mb-6 border-l-4 border-slate-500 pl-3">
              <h2 className="text-base font-semibold text-gray-800">
                Conversion funnel
              </h2>
              <p className="mt-1 text-sm text-[#6e6e73]">
                End-to-end candidate journey
              </p>
            </div>
            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-0">
              {funnelSteps.map((step, i) => (
                <Fragment key={step.label}>
                  <div className="min-w-0 flex-1 text-center">
                    <p className="text-4xl font-bold tabular-nums text-[#1d1d1f]">
                      {loading ? "—" : step.value}
                    </p>
                    <p className="mt-2 text-xs text-[#6e6e73]">{step.label}</p>
                  </div>
                  {i < funnelSteps.length - 1 ? (
                    <div className="flex flex-col items-center justify-center self-center px-1 py-2 sm:px-2 sm:pb-0 sm:pt-1">
                      <ChevronDown
                        className="h-5 w-5 text-[#aeaeb2] sm:hidden"
                        strokeWidth={2}
                        aria-hidden
                      />
                      <ChevronRight
                        className="hidden h-5 w-5 text-[#aeaeb2] sm:block"
                        strokeWidth={2}
                        aria-hidden
                      />
                      <p className="mt-1 text-xs font-medium text-[#3b82f6]">
                        {loading
                          ? "—"
                          : funnelSteps[i].value > 0
                            ? `${Math.round(
                                (funnelSteps[i + 1].value /
                                  funnelSteps[i].value) *
                                  100,
                              )}%`
                            : "—"}
                      </p>
                    </div>
                  ) : null}
                </Fragment>
              ))}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}

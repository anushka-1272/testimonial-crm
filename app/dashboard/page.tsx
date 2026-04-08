"use client";

import { format, formatDistanceToNow, parseISO } from "date-fns";
import { Bell, ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import { createBrowserSupabaseClient } from "@/lib/supabase-browser";

type Period = "total" | "monthly" | "weekly";

const INTERVIEWERS = ["Harika", "Gargi", "Mudit", "Anushka"];

function getDateRange(period: Period) {
  const now = new Date();
  if (period === "weekly") {
    const day = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
    monday.setHours(0, 0, 0, 0);
    return monday.toISOString();
  }
  if (period === "monthly") {
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
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
  user_name: string | null;
  description: string;
};

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
  });
  const [interviewer, setInterviewer] = useState<Record<string, number>>({});
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
    void supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setGreetName(greetNameFromEmail(user.email ?? undefined));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      const u = session?.user;
      if (u) setGreetName(greetNameFromEmail(u.email ?? undefined));
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    const from = getDateRange(period);

    let entriesQ = supabase
      .from("candidates")
      .select("*", { count: "exact", head: true });
    if (from) entriesQ = entriesQ.gte("created_at", from);
    const { count: entries } = await entriesQ;

    let callsQ = supabase
      .from("candidates")
      .select("*", { count: "exact", head: true })
      .eq("eligibility_status", "eligible");
    if (from) callsQ = callsQ.gte("created_at", from);
    const { count: calls } = await callsQ;

    let testQ = supabase
      .from("interviews")
      .select("*", { count: "exact", head: true })
      .eq("interview_status", "completed")
      .eq("interview_type", "testimonial");
    if (from) testQ = testQ.gte("created_at", from);
    const { count: testimonials } = await testQ;

    let projQ = supabase
      .from("project_candidates")
      .select("*", { count: "exact", head: true });
    if (from) projQ = projQ.gte("created_at", from);
    const { count: projects } = await projQ;

    let dispQ = supabase
      .from("dispatch")
      .select("*", { count: "exact", head: true });
    if (from) dispQ = dispQ.gte("created_at", from);
    const { count: dispatches } = await dispQ;

    setStats({
      testimonials: testimonials || 0,
      projects: projects || 0,
      dispatches: dispatches || 0,
      entries: entries || 0,
      calls: calls || 0,
    });

    const ivStats: Record<string, number> = {};
    for (const iv of INTERVIEWERS) {
      let q = supabase
        .from("interviews")
        .select("*", { count: "exact", head: true })
        .eq("interviewer", iv)
        .eq("interview_status", "completed");
      if (from) q = q.gte("created_at", from);
      const { count } = await q;
      ivStats[iv] = count || 0;
    }
    setInterviewer(ivStats);

    const { count: fEntries } = await supabase
      .from("candidates")
      .select("*", { count: "exact", head: true });
    const { count: fEligible } = await supabase
      .from("candidates")
      .select("*", { count: "exact", head: true })
      .eq("eligibility_status", "eligible");
    const { count: fScheduled } = await supabase
      .from("interviews")
      .select("*", { count: "exact", head: true });
    const { count: fCompleted } = await supabase
      .from("interviews")
      .select("*", { count: "exact", head: true })
      .eq("interview_status", "completed");
    const { count: fDispatched } = await supabase
      .from("dispatch")
      .select("*", { count: "exact", head: true });
    setFunnel({
      entries: fEntries || 0,
      eligible: fEligible || 0,
      scheduled: fScheduled || 0,
      completed: fCompleted || 0,
      dispatched: fDispatched || 0,
    });

    setLoading(false);
  }, [supabase, period]);

  const fetchRecentActivity = useCallback(async () => {
    setRecentLoading(true);
    const { data } = await supabase
      .from("activity_log")
      .select("id, created_at, user_name, description")
      .order("created_at", { ascending: false })
      .limit(20);
    setRecentActivity((data ?? []) as RecentActivityRow[]);
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

  const rankedInterviewers = useMemo(() => {
    return [...INTERVIEWERS]
      .map((name) => ({ name, count: interviewer[name] ?? 0 }))
      .sort((a, b) => b.count - a.count);
  }, [interviewer]);

  const statCards = useMemo(
    () => [
      { label: "Testimonial interviews", value: stats.testimonials },
      { label: "Project interviews", value: stats.projects },
      { label: "Dispatches", value: stats.dispatches },
      { label: "Form entries", value: stats.entries },
      { label: "Calls done", value: stats.calls },
    ],
    [stats],
  );

  const ivMax = useMemo(() => {
    const vals = rankedInterviewers.map((r) => r.count);
    return Math.max(1, ...vals);
  }, [rankedInterviewers]);

  const hour = new Date().getHours();
  const greeting = greetingForHour(hour);

  return (
    <>
      <header className="sticky top-0 z-30 bg-[#f5f5f7]/90 px-8 py-6 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1400px] items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[#1d1d1f]">
              {greeting}, {greetName}{" "}
              <span className="font-normal" aria-hidden>
                👋
              </span>
            </h1>
            <p className="mt-1 text-sm text-[#6e6e73]">
              Here&apos;s what&apos;s happening today
            </p>
          </div>
          <button
            type="button"
            className="mt-1 flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#6e6e73] shadow-[0_2px_8px_rgba(0,0,0,0.06)] transition-all duration-200 ease-in-out hover:scale-[1.02]"
            aria-label="Notifications"
          >
            <Bell className="h-[18px] w-[18px]" strokeWidth={1.5} />
          </button>
        </div>
      </header>

      <main className="flex-1 px-8 pb-12 pt-2">
        <div className="mx-auto max-w-[1400px] space-y-8">
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

          <div className="flex gap-4 overflow-x-auto pb-1 snap-x snap-mandatory lg:grid lg:grid-cols-5 lg:overflow-visible lg:pb-0 lg:snap-none">
            {statCards.map(({ label, value }) => (
              <div
                key={label}
                className={`min-w-[160px] flex-none snap-start rounded-2xl bg-white p-6 transition-transform duration-200 ease-in-out hover:scale-[1.01] lg:min-w-0 ${cardChrome} cursor-default`}
              >
                <p className="mb-3 text-xs font-medium text-[#6e6e73]">
                  {label}
                </p>
                <p className="text-4xl font-bold tracking-tight text-[#1d1d1f] tabular-nums">
                  {loading ? "—" : value}
                </p>
                <div className="mt-4 h-0.5 w-8 rounded-full bg-[#3b82f6]" />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <section
                className={`rounded-2xl bg-white p-6 transition-all duration-200 ease-in-out ${cardChrome}`}
              >
                <h2 className="mb-1 text-base font-semibold text-[#1d1d1f]">
                  Interviewer performance
                </h2>
                <p className="mb-6 text-sm text-[#6e6e73]">
                  Completed interviews by team member
                </p>
                <div>
                  {rankedInterviewers.map((row, index) => {
                    const barPct =
                      loading || ivMax <= 0
                        ? 0
                        : Math.min(100, Math.round((row.count / ivMax) * 100));
                    return (
                      <div
                        key={row.name}
                        className="flex items-center gap-4 border-b border-[#f5f5f5] py-3 last:border-0"
                      >
                        <span className="w-4 shrink-0 text-sm text-[#aeaeb2]">
                          {index + 1}
                        </span>
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#1d1d1f] text-xs font-medium text-white">
                          {initials(row.name)}
                        </div>
                        <span className="min-w-0 flex-1 text-sm font-medium text-[#1d1d1f]">
                          {row.name}
                        </span>
                        <div className="hidden h-1 w-24 shrink-0 overflow-hidden rounded-full bg-[#f5f5f7] sm:block">
                          <div
                            className="h-full rounded-full bg-[#3b82f6] transition-all duration-200 ease-in-out"
                            style={{ width: `${barPct}%` }}
                          />
                        </div>
                        <span className="shrink-0 text-sm font-semibold tabular-nums text-[#1d1d1f]">
                          {loading ? "—" : row.count}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>

            <section
              className={`h-fit rounded-2xl bg-white p-6 transition-all duration-200 ease-in-out ${cardChrome} lg:col-span-1`}
            >
              <h2 className="mb-1 text-base font-semibold text-[#1d1d1f]">
                Recent activity
              </h2>
              <p className="mb-6 text-sm text-[#6e6e73]">
                Latest changes from your team
              </p>
              {recentLoading ? (
                <p className="text-sm text-[#6e6e73]">Loading…</p>
              ) : recentActivity.length === 0 ? (
                <p className="text-sm text-[#6e6e73]">No activity yet</p>
              ) : (
                <ul className="space-y-4">
                  {recentActivity.map((a) => {
                    const uname = a.user_name?.trim() || "Someone";
                    return (
                      <li key={a.id} className="flex gap-3">
                        <div
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-medium text-white"
                          style={{ backgroundColor: avatarHue(uname) }}
                        >
                          {initials(uname)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-[#1d1d1f]">
                            <span className="font-semibold">{uname}</span>{" "}
                            {a.description}
                          </p>
                          <p className="mt-1 text-xs text-[#aeaeb2]">
                            {formatDistanceToNow(parseISO(a.created_at), {
                              addSuffix: true,
                            })}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              <Link
                href="/dashboard/activity"
                className="mt-6 inline-block text-sm font-medium text-[#3b82f6] transition-colors hover:text-[#2563eb]"
              >
                View all activity
              </Link>
            </section>
          </div>

          <section
            className={`rounded-2xl bg-white p-8 transition-all duration-200 ease-in-out ${cardChrome}`}
          >
            <h2 className="text-base font-semibold text-[#1d1d1f]">
              Conversion funnel
            </h2>
            <p className="mb-8 text-sm text-[#6e6e73]">
              End-to-end candidate journey
            </p>
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

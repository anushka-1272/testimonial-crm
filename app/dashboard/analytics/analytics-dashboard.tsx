"use client";

import {
  endOfDay,
  parseISO,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
} from "date-fns";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { createBrowserSupabaseClient } from "@/lib/supabase-browser";
import {
  effectiveInterviewLanguage,
  interviewLanguageFilterBucket,
  type InterviewLangPreset,
  type InterviewLanguageFilter,
} from "@/lib/interview-language";

export type DateRangePreset = "week" | "month" | "quarter" | "all";

const RANGE_LABELS: Record<DateRangePreset, string> = {
  week: "This Week",
  month: "This Month",
  quarter: "This Quarter",
  all: "All Time",
};

const COLORS = {
  primary: "#1d4ed8",
  success: "#16a34a",
  warning: "#d97706",
  danger: "#dc2626",
  purple: "#7c3aed",
  gray: "#6b7280",
} as const;

/** Fixed industry buckets for domain breakdown (mapped from intake text). */
const DOMAIN_INDUSTRY_BUCKETS = [
  "Software Engineering",
  "Data (Analyst / Scientist / BA)",
  "Educators / Teaching",
  "Finance",
  "Marketing",
  "Sales",
  "Consulting",
  "Other",
] as const;

type DomainIndustryBucket = (typeof DOMAIN_INDUSTRY_BUCKETS)[number];

type CandidateRow = {
  id: string;
  created_at: string;
  email: string;
  eligibility_status: string;
  domain: string | null;
  job_role: string | null;
  role_before_program: string | null;
  primary_goal: string | null;
};

type InterviewRow = {
  candidate_id: string;
  scheduled_date: string | null;
  completed_at: string | null;
  interview_status: string;
  interview_type: string;
  interview_language: string | null;
  language: string | null;
  category: string | null;
  reward_item: string | null;
  post_interview_eligible: boolean | null;
};

type DispatchRow = {
  id: string;
  candidate_id: string;
  dispatch_status: string;
  dispatch_date: string | null;
  reward_item: string | null;
  actual_delivery_date: string | null;
  created_at: string | null;
};

function rangeBounds(preset: DateRangePreset): { start: Date | null; end: Date } {
  const end = endOfDay(new Date());
  if (preset === "all") return { start: null, end };
  const now = new Date();
  if (preset === "week") {
    return { start: startOfWeek(now, { weekStartsOn: 1 }), end };
  }
  if (preset === "month") {
    return { start: startOfMonth(now), end };
  }
  return { start: startOfQuarter(now), end };
}

function inRangeInclusive(
  iso: string | null | undefined,
  start: Date | null,
  end: Date,
): boolean {
  if (!iso) return false;
  if (!start) return true;
  const d = parseISO(iso);
  return d >= start && d <= end;
}

/** Map free-text role / goal (domain–industry style intake) into a fixed bucket. */
function mapToDomainIndustryBucket(raw: string | null | undefined): DomainIndustryBucket {
  const s = raw?.trim().toLowerCase() ?? "";
  if (!s) return "Other";

  const has = (re: RegExp) => re.test(s);

  if (has(/teacher|teaching|educator|professor|faculty|tutor|lecturer|academic|school|education/))
    return "Educators / Teaching";
  if (has(/\bconsultant\b|consulting/)) return "Consulting";
  if (has(/finance|financial|accounting|accountant|banking|\bbank\b|auditor|cfa|investment banking/))
    return "Finance";
  if (has(/marketing|brand manager|growth marketing|\bseo\b|cmo|content strategy/))
    return "Marketing";
  if (has(/\bsales\b|business development|\bbdr\b|\bsdr\b|account executive|account manager/))
    return "Sales";
  if (
    has(
      /\bdata\b|data analyst|data scientist|business analyst|\bba\b|statistician|analytics|bi developer|data engineer|research analyst/,
    )
  )
    return "Data (Analyst / Scientist / BA)";
  if (
    has(
      /software|developer|engineer|programming|devops|full[\s-]?stack|front[\s-]?end|back[\s-]?end|\bsde\b|tech lead|\bcto\b|programmer|coding|web developer|mobile developer/,
    )
  )
    return "Software Engineering";

  return "Other";
}

function domainIndustrySource(c: CandidateRow): string {
  return [
    c.domain,
    c.job_role,
    c.role_before_program,
    c.primary_goal,
  ]
    .filter(Boolean)
    .join(" ");
}

function categoryLines(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function dispatchSortTime(d: DispatchRow): string | null {
  return d.dispatch_date ?? d.actual_delivery_date ?? d.created_at ?? null;
}

function langDisplayBucket(
  eff: string,
): Exclude<InterviewLanguageFilter, "all"> {
  const b = interviewLanguageFilterBucket(eff);
  if (b === "other") return "other";
  if (b === "all") return "other";
  return b as InterviewLangPreset;
}

const LANG_ORDER: Exclude<InterviewLanguageFilter, "all">[] = [
  "english",
  "hindi",
  "kannada",
  "telugu",
  "marathi",
  "bengali",
  "other",
];

const LANG_LABELS: Record<Exclude<InterviewLanguageFilter, "all">, string> = {
  english: "English",
  hindi: "Hindi",
  kannada: "Kannada",
  telugu: "Telugu",
  marathi: "Marathi",
  bengali: "Bengali",
  other: "Other",
};

const cardClass =
  "rounded-2xl border border-gray-100 bg-white p-6 shadow-sm";
const chartTitle = "text-base font-semibold text-gray-800";
const chartSubtitle = "mt-1 text-sm text-gray-500";

function ChartCard({
  title,
  subtitle,
  children,
  empty,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  empty?: boolean;
}) {
  return (
    <div className={cardClass}>
      <h3 className={chartTitle}>{title}</h3>
      {subtitle ? <p className={chartSubtitle}>{subtitle}</p> : null}
      <div className="mt-4 h-[280px] w-full">
        {empty ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-500">
            No data for this range
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function StatSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <div className="mb-3 h-3 w-24 rounded bg-gray-200" />
      <div className="h-9 w-20 rounded bg-gray-200" />
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <div className="mb-2 h-4 w-40 rounded bg-gray-200" />
      <div className="mb-4 h-3 w-56 rounded bg-gray-200" />
      <div className="h-[280px] rounded-lg bg-gray-100" />
    </div>
  );
}

export function AnalyticsDashboard() {
  const supabase = useMemo(() => {
    try {
      return createBrowserSupabaseClient();
    } catch {
      return null;
    }
  }, []);

  const [preset, setPreset] = useState<DateRangePreset>("month");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [interviews, setInterviews] = useState<InterviewRow[]>([]);
  const [dispatches, setDispatches] = useState<DispatchRow[]>([]);

  const load = useCallback(async () => {
    if (!supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    const candQ = supabase
      .from("candidates")
      .select(
        "id, created_at, email, eligibility_status, domain, job_role, role_before_program, primary_goal",
      );

    const intQ = supabase
      .from("interviews")
      .select(
        "candidate_id, scheduled_date, completed_at, interview_status, interview_type, interview_language, language, category, reward_item, post_interview_eligible",
      );

    let dispQ = supabase
      .from("dispatch")
      .select(
        "id, candidate_id, dispatch_status, dispatch_date, reward_item, actual_delivery_date, created_at",
      );

    const [cRes, iRes, dRes] = await Promise.all([candQ, intQ, dispQ]);

    if (cRes.error || iRes.error) {
      setError(cRes.error?.message ?? iRes.error?.message ?? "Failed to load");
      setLoading(false);
      return;
    }

    let dispRows: DispatchRow[];
    if (dRes.error) {
      const retry = await supabase
        .from("dispatch")
        .select(
          "id, candidate_id, dispatch_status, dispatch_date, reward_item, actual_delivery_date",
        );
      if (retry.error) {
        setError(retry.error.message);
        setLoading(false);
        return;
      }
      dispRows = (retry.data ?? []).map((r) => ({
        ...(r as DispatchRow),
        created_at: null,
      }));
    } else {
      dispRows = (dRes.data ?? []) as DispatchRow[];
    }

    setCandidates((cRes.data ?? []) as CandidateRow[]);
    setInterviews((iRes.data ?? []) as InterviewRow[]);
    setDispatches(dispRows);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const { start, end } = useMemo(() => rangeBounds(preset), [preset]);

  const testimonialInterviews = useMemo(
    () => interviews.filter((i) => i.interview_type === "testimonial"),
    [interviews],
  );

  const overview = useMemo(() => {
    const entries = candidates.filter((c) =>
      inRangeInclusive(c.created_at, start, end),
    );
    const eligible = entries.filter((c) => c.eligibility_status === "eligible");
    const totalEntries = entries.length;
    const eligibleRate =
      totalEntries > 0 ? Math.round((eligible.length / totalEntries) * 100) : 0;

    const completed = testimonialInterviews.filter(
      (i) =>
        i.interview_status === "completed" &&
        i.completed_at &&
        inRangeInclusive(i.completed_at, start, end),
    ).length;

    const dispatched = dispatches.filter((d) =>
      inRangeInclusive(dispatchSortTime(d), start, end),
    ).length;

    return {
      totalEntries,
      eligibleRate,
      interviewsCompleted: completed,
      totalDispatched: dispatched,
    };
  }, [candidates, testimonialInterviews, dispatches, start, end]);

  const domainData = useMemo(() => {
    const entries = candidates.filter((c) =>
      inRangeInclusive(c.created_at, start, end),
    );
    const counts = new Map<
      DomainIndustryBucket,
      { eligible: number; notEligible: number }
    >();
    for (const b of DOMAIN_INDUSTRY_BUCKETS) {
      counts.set(b, { eligible: 0, notEligible: 0 });
    }
    for (const c of entries) {
      const bucket = mapToDomainIndustryBucket(domainIndustrySource(c));
      const row = counts.get(bucket)!;
      if (c.eligibility_status === "eligible") row.eligible += 1;
      else row.notEligible += 1;
    }
    return DOMAIN_INDUSTRY_BUCKETS.map((domain) => {
      const { eligible, notEligible } = counts.get(domain)!;
      const total = eligible + notEligible;
      return {
        domain,
        eligible,
        notEligible,
        total,
        conversion:
          total > 0 ? Math.round((eligible / total) * 100) : 0,
      };
    });
  }, [candidates, start, end]);

  const jobRoleData = useMemo(() => {
    const entries = candidates.filter((c) =>
      inRangeInclusive(c.created_at, start, end),
    );
    const map = new Map<
      string,
      { role: string; eligible: number; notEligible: number }
    >();
    for (const c of entries) {
      const role = c.role_before_program?.trim() || "Unknown";
      if (!map.has(role))
        map.set(role, { role, eligible: 0, notEligible: 0 });
      const row = map.get(role)!;
      if (c.eligibility_status === "eligible") row.eligible += 1;
      else row.notEligible += 1;
    }
    return [...map.values()]
      .map((r) => ({
        ...r,
        total: r.eligible + r.notEligible,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [candidates, start, end]);

  const languageDonut = useMemo(() => {
    const completed = testimonialInterviews.filter(
      (i) =>
        i.interview_status === "completed" &&
        i.completed_at &&
        inRangeInclusive(i.completed_at, start, end),
    );
    const counts: Record<Exclude<InterviewLanguageFilter, "all">, number> = {
      english: 0,
      hindi: 0,
      kannada: 0,
      telugu: 0,
      marathi: 0,
      bengali: 0,
      other: 0,
    };
    for (const iv of completed) {
      const eff = effectiveInterviewLanguage({
        interview_language: iv.interview_language,
        language: iv.language,
      });
      const b = langDisplayBucket(eff);
      counts[b] += 1;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return LANG_ORDER.map((key) => ({
      name: LANG_LABELS[key],
      value: counts[key],
      key,
      pct: total > 0 ? Math.round((counts[key] / total) * 100) : 0,
    })).filter((d) => d.value > 0);
  }, [testimonialInterviews, start, end]);

  const topCategories = useMemo(() => {
    const completed = testimonialInterviews.filter(
      (i) =>
        i.interview_status === "completed" &&
        i.completed_at &&
        inRangeInclusive(i.completed_at, start, end),
    );
    const freq = new Map<string, number>();
    for (const iv of completed) {
      for (const line of categoryLines(iv.category)) {
        freq.set(line, (freq.get(line) ?? 0) + 1);
      }
    }
    return [...freq.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [testimonialInterviews, start, end]);

  const avgDispatchDays = useMemo(() => {
    const completedByCandidate = new Map<string, string[]>();
    for (const iv of testimonialInterviews) {
      if (iv.interview_status !== "completed" || !iv.completed_at) continue;
      const list = completedByCandidate.get(iv.candidate_id) ?? [];
      list.push(iv.completed_at);
      completedByCandidate.set(iv.candidate_id, list);
    }
    for (const [, list] of completedByCandidate) {
      list.sort();
    }

    const deltas: number[] = [];
    for (const d of dispatches) {
      const sortT = dispatchSortTime(d);
      if (!sortT) continue;
      const endD = parseISO(sortT);
      const times = completedByCandidate.get(d.candidate_id);
      if (!times?.length) continue;
      let best: string | null = null;
      for (let i = times.length - 1; i >= 0; i -= 1) {
        const cAt = parseISO(times[i]!);
        if (cAt <= endD) {
          best = times[i]!;
          break;
        }
      }
      if (!best) continue;
      const days = Math.round(
        (endD.getTime() - parseISO(best).getTime()) / (1000 * 60 * 60 * 24),
      );
      if (days >= 0 && inRangeInclusive(sortT, start, end)) deltas.push(days);
    }

    if (deltas.length === 0) {
      return { avg: null as number | null, min: null as number | null, max: null as number | null };
    }
    const sum = deltas.reduce((a, b) => a + b, 0);
    return {
      avg: Math.round((sum / deltas.length) * 10) / 10,
      min: Math.min(...deltas),
      max: Math.max(...deltas),
    };
  }, [testimonialInterviews, dispatches, start, end]);

  const langColors = [
    COLORS.primary,
    COLORS.success,
    COLORS.purple,
    COLORS.warning,
    COLORS.danger,
    COLORS.gray,
    "#0d9488",
  ];

  const languageTotal = languageDonut.reduce((s, d) => s + d.value, 0);

  const domainChartTotal = domainData.reduce((s, r) => s + r.total, 0);

  const hasAnyData =
    candidates.length > 0 || interviews.length > 0 || dispatches.length > 0;

  if (!supabase) {
    return (
      <p className="text-sm text-red-600">
        Supabase is not configured. Cannot load analytics.
      </p>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Analytics</h1>
          <p className="mt-1 text-sm text-gray-500">
            Testimonial CRM performance overview
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(RANGE_LABELS) as DateRangePreset[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setPreset(k)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                preset === k
                  ? "bg-[#1d4ed8] text-white"
                  : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              {RANGE_LABELS[k]}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="space-y-8">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <StatSkeleton key={i} />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {Array.from({ length: 5 }, (_, i) => (
              <ChartSkeleton key={i} />
            ))}
          </div>
        </div>
      ) : !hasAnyData ? (
        <div
          className={`${cardClass} py-16 text-center text-sm text-gray-500`}
        >
          No data yet. Form entries and pipeline activity will appear here.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className={cardClass}>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Total form entries
              </p>
              <p className="mt-2 text-3xl font-bold tabular-nums text-gray-900">
                {overview.totalEntries}
              </p>
            </div>
            <div className={cardClass}>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Eligible rate
              </p>
              <p className="mt-2 text-3xl font-bold tabular-nums text-gray-900">
                {overview.totalEntries > 0 ? `${overview.eligibleRate}%` : "—"}
              </p>
              <p className="mt-1 text-xs text-gray-500">Eligible / total in range</p>
            </div>
            <div className={cardClass}>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Interviews completed
              </p>
              <p className="mt-2 text-3xl font-bold tabular-nums text-gray-900">
                {overview.interviewsCompleted}
              </p>
              <p className="mt-1 text-xs text-gray-500">Testimonial interviews</p>
            </div>
            <div className={cardClass}>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Total dispatched
              </p>
              <p className="mt-2 text-3xl font-bold tabular-nums text-gray-900">
                {overview.totalDispatched}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ChartCard
              title="Domain breakdown"
              subtitle="Mapped from role before program and primary goal; stacked eligible vs not eligible"
              empty={domainChartTotal === 0}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={domainData}
                  margin={{ top: 8, right: 8, left: 0, bottom: 96 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis
                    dataKey="domain"
                    angle={-40}
                    textAnchor="end"
                    height={100}
                    interval={0}
                    tick={{ fontSize: 9, fill: COLORS.gray }}
                  />
                  <YAxis tick={{ fontSize: 11, fill: COLORS.gray }} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const p = payload[0]!.payload as (typeof domainData)[0];
                      return (
                        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-md">
                          <p className="font-medium">{p.domain}</p>
                          <p className="text-green-700">Eligible: {p.eligible}</p>
                          <p className="text-red-700">Not eligible: {p.notEligible}</p>
                          <p className="text-gray-600">
                            Conversion: {p.conversion}%
                          </p>
                        </div>
                      );
                    }}
                  />
                  <Legend />
                  <Bar
                    dataKey="eligible"
                    stackId="a"
                    fill={COLORS.success}
                    name="Eligible"
                  />
                  <Bar
                    dataKey="notEligible"
                    stackId="a"
                    fill={COLORS.danger}
                    name="Not eligible"
                  >
                    <LabelList
                      dataKey="conversion"
                      position="top"
                      formatter={(v: number) => (v > 0 ? `${v}%` : "")}
                      className="fill-gray-600 text-[10px]"
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Job role breakdown"
              subtitle="Top 10 roles by submissions (intake); green = eligible, red = not"
              empty={jobRoleData.length === 0}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={[...jobRoleData].reverse()}
                  margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: COLORS.gray }} />
                  <YAxis
                    type="category"
                    dataKey="role"
                    width={120}
                    tick={{ fontSize: 10, fill: COLORS.gray }}
                  />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="eligible" stackId="r" fill={COLORS.success} name="Eligible" />
                  <Bar
                    dataKey="notEligible"
                    stackId="r"
                    fill={COLORS.danger}
                    name="Not eligible"
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Interview language"
              subtitle="Completed testimonial interviews in range"
              empty={languageTotal === 0}
            >
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={languageDonut.map((d) => ({
                      ...d,
                      pct: d.pct,
                    }))}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={58}
                    outerRadius={88}
                    paddingAngle={2}
                  >
                    {languageDonut.map((_, i) => (
                      <Cell
                        key={`lc-${i}`}
                        fill={langColors[i % langColors.length]!}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const p = payload[0]!.payload as {
                        name: string;
                        value: number;
                        pct: number;
                      };
                      return (
                        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-md">
                          <p className="font-medium">{p.name}</p>
                          <p className="text-gray-600">
                            {p.value} ({p.pct}%)
                          </p>
                        </div>
                      );
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Top post-interview categories"
              subtitle="From completed interviews in range (top 8)"
              empty={topCategories.length === 0}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={[...topCategories].reverse()}
                  margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: COLORS.gray }} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={100}
                    tick={{ fontSize: 9, fill: COLORS.gray }}
                  />
                  <Tooltip />
                  <Bar
                    dataKey="count"
                    fill={COLORS.primary}
                    name="Count"
                    radius={[0, 4, 4, 0]}
                  >
                    <LabelList
                      dataKey="count"
                      position="right"
                      className="fill-gray-700 text-[11px]"
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <div className={cardClass}>
            <h3 className={chartTitle}>
              Avg days — interview to dispatch
            </h3>
            <p className={chartSubtitle}>
              Days between completed interview and dispatch timeline (dispatch
              date, delivery, or record created)
            </p>
            {avgDispatchDays.avg == null ? (
              <p className="mt-6 text-sm text-gray-500">
                No matching interview-to-dispatch pairs in this range.
              </p>
            ) : (
              <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-12">
                <div>
                  <p className="text-5xl font-bold tabular-nums text-gray-900">
                    {avgDispatchDays.avg}
                  </p>
                  <p className="mt-1 text-sm text-gray-500">Average days</p>
                </div>
                <div className="flex gap-8 text-sm">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                      Fastest
                    </p>
                    <p className="mt-1 text-lg font-semibold text-gray-800">
                      {avgDispatchDays.min} days
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                      Slowest
                    </p>
                    <p className="mt-1 text-lg font-semibold text-gray-800">
                      {avgDispatchDays.max} days
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

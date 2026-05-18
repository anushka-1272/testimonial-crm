import {
  endOfDay,
  endOfMonth,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  subMonths,
} from "date-fns";

export type TeamReportPeriodPreset =
  | "week"
  | "month"
  | "prev_month"
  | "quarter"
  | "all";

export const PERIOD_LABELS: Record<TeamReportPeriodPreset, string> = {
  week: "This week",
  month: "This month",
  prev_month: "Previous month",
  quarter: "This quarter",
  all: "All time",
};

export const PERIOD_ORDER: TeamReportPeriodPreset[] = [
  "week",
  "month",
  "prev_month",
  "quarter",
  "all",
];

/** `start` null means entire history (no lower bound on query filters). */
export function rangeForPreset(preset: TeamReportPeriodPreset): {
  start: Date | null;
  end: Date;
} {
  const end = endOfDay(new Date());
  const now = new Date();
  if (preset === "week") {
    return { start: startOfWeek(now, { weekStartsOn: 1 }), end };
  }
  if (preset === "month") {
    return { start: startOfMonth(now), end };
  }
  if (preset === "prev_month") {
    const ref = subMonths(now, 1);
    return { start: startOfMonth(ref), end: endOfMonth(ref) };
  }
  if (preset === "quarter") {
    return { start: startOfQuarter(now), end };
  }
  return { start: null, end };
}

export function rangeFilterIso(preset: TeamReportPeriodPreset): {
  startIso: string | null;
  endIso: string;
} {
  const { start, end } = rangeForPreset(preset);
  return {
    startIso: start ? start.toISOString() : null,
    endIso: end.toISOString(),
  };
}

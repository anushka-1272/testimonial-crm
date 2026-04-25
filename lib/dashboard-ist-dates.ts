/**
 * Dashboard stat periods: week (Sat–Fri) and month boundaries in Asia/Kolkata,
 * expressed as UTC ISO strings for Supabase timestamptz filters.
 */

export const TIMEZONE = "Asia/Kolkata";

export type DashboardPeriod = "total" | "monthly" | "weekly";

export type DashboardPeriodBounds = {
  startIso: string;
  endIso?: string;
} | null;

/** Optional anchors for dashboard weekly/monthly stats (IST). */
export type DashboardPeriodBoundsOptions = {
  /** Any instant on the IST calendar day that falls inside the target week (Sat–Fri). */
  weeklyAnchorDate?: Date;
  /** IST calendar month (1–12) and year for monthly bounds. */
  monthlyYear?: number;
  monthlyMonth?: number;
};

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Calendar year / month / day for an instant, in Asia/Kolkata. */
export function getISTYmd(date: Date = new Date()): {
  year: number;
  month: number;
  day: number;
} {
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  const [y, m, d] = s.split("-").map(Number);
  return { year: y, month: m, day: d };
}

/**
 * Anchor for the IST calendar day containing `date` (noon IST avoids edge cases).
 * Prefer this over parsing `Intl.DateTimeFormat(...).format(date)` with `new Date(...)`.
 */
export function getISTDate(date: Date = new Date()): Date {
  const { year, month, day } = getISTYmd(date);
  return new Date(
    `${year}-${pad2(month)}-${pad2(day)}T12:00:00+05:30`,
  );
}

function istMidnightInstant(year: number, month: number, day: number): Date {
  return new Date(
    `${year}-${pad2(month)}-${pad2(day)}T00:00:00+05:30`,
  );
}

function istWeekdaySat0Sun6(date: Date): number {
  const w = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    weekday: "short",
  }).format(date);
  const key = w.slice(0, 3);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[key] ?? 0;
}

/** Add signed calendar days in IST (fixed +05:30, no DST). */
function addISTCalendarDays(
  year: number,
  month: number,
  day: number,
  deltaDays: number,
): { year: number; month: number; day: number } {
  const t = new Date(`${year}-${pad2(month)}-${pad2(day)}T12:00:00+05:30`);
  const u = new Date(t.getTime() + deltaDays * 86400000);
  return getISTYmd(u);
}

/** Week = Saturday 00:00 IST → next Saturday 00:00 IST (exclusive). */
export function getWeekBoundsIST(date: Date = new Date()): {
  startIso: string;
  endIso: string;
} {
  const { year, month, day } = getISTYmd(date);
  const noon = new Date(`${year}-${pad2(month)}-${pad2(day)}T12:00:00+05:30`);
  const dow = istWeekdaySat0Sun6(noon);
  const daysBackToSaturday = (dow + 1) % 7;
  const sat = addISTCalendarDays(year, month, day, -daysBackToSaturday);
  const start = istMidnightInstant(sat.year, sat.month, sat.day);
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

/** Calendar month in IST: first day 00:00 IST → first day of next month 00:00 IST (exclusive). */
export function getMonthBoundsIST(date: Date = new Date()): {
  startIso: string;
  endIso: string;
} {
  const { year, month } = getISTYmd(date);
  return getMonthBoundsForISTYearMonth(year, month);
}

/** IST calendar month (month = 1–12). */
export function getMonthBoundsForISTYearMonth(
  year: number,
  month: number,
): { startIso: string; endIso: string } {
  const start = istMidnightInstant(year, month, 1);
  let ny = year;
  let nm = month + 1;
  if (nm > 12) {
    nm = 1;
    ny += 1;
  }
  const end = istMidnightInstant(ny, nm, 1);
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

/** `YYYY-MM-DD` from `<input type="date">` → noon on that IST civil day (week anchor). */
export function parseWeeklyDateInputToAnchor(ymd: string): Date | null {
  const t = ymd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return new Date(`${t}T12:00:00+05:30`);
}

/** Default `<input type="date">` value for “current” IST day. */
export function defaultIstWeeklyDateInput(): string {
  const { year, month, day } = getISTYmd(new Date());
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Default `<input type="month">` value (`YYYY-MM`) for current IST month. */
export function defaultIstMonthlyInput(): string {
  const { year, month } = getISTYmd(new Date());
  return `${year}-${pad2(month)}`;
}

/** Parse `<input type="month">` value. Month is 1–12. */
export function parseMonthlyInput(value: string): {
  year: number;
  month: number;
} | null {
  const m = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(year) || month < 1 || month > 12) return null;
  return { year, month };
}

/** Single place to resolve bounds for dashboard stats (IST). */
export function resolveDashboardStatsBounds(
  period: DashboardPeriod,
  weeklyDateInput: string,
  monthlyInput: string,
): DashboardPeriodBounds {
  if (period === "weekly") {
    const anchor =
      parseWeeklyDateInputToAnchor(weeklyDateInput) ?? new Date();
    return getPeriodBoundsIST("weekly", { weeklyAnchorDate: anchor });
  }
  if (period === "monthly") {
    const pm = parseMonthlyInput(monthlyInput);
    if (pm) {
      return getPeriodBoundsIST("monthly", {
        monthlyYear: pm.year,
        monthlyMonth: pm.month,
      });
    }
    return getPeriodBoundsIST("monthly");
  }
  return null;
}

export function getPeriodBoundsIST(
  period: DashboardPeriod,
  options?: DashboardPeriodBoundsOptions,
): DashboardPeriodBounds {
  if (period === "weekly") {
    const anchor = options?.weeklyAnchorDate ?? new Date();
    const { startIso, endIso } = getWeekBoundsIST(anchor);
    return { startIso, endIso };
  }
  if (period === "monthly") {
    if (
      options?.monthlyYear != null &&
      options?.monthlyMonth != null &&
      options.monthlyMonth >= 1 &&
      options.monthlyMonth <= 12
    ) {
      const { startIso, endIso } = getMonthBoundsForISTYearMonth(
        options.monthlyYear,
        options.monthlyMonth,
      );
      return { startIso, endIso };
    }
    const { startIso, endIso } = getMonthBoundsIST(new Date());
    return { startIso, endIso };
  }
  return null;
}

function formatDayMonthInIST(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    month: "short",
    day: "numeric",
  }).format(d);
}

/** Human-readable range for the period toggle (all strings in IST). */
export function formatDashboardPeriodRangeIST(
  period: DashboardPeriod,
  bounds: DashboardPeriodBounds,
): string | null {
  if (!bounds || period === "total") return null;
  if (period === "weekly" && bounds.endIso) {
    const endExclusive = new Date(bounds.endIso);
    const lastInRange = new Date(endExclusive.getTime() - 1);
    const a = formatDayMonthInIST(bounds.startIso);
    const b = new Intl.DateTimeFormat("en-US", {
      timeZone: TIMEZONE,
      month: "short",
      day: "numeric",
    }).format(lastInRange);
    return `Week: ${a} – ${b} (IST)`;
  }
  if (period === "monthly") {
    const label = new Intl.DateTimeFormat("en-US", {
      timeZone: TIMEZONE,
      month: "long",
      year: "numeric",
    }).format(new Date(bounds.startIso));
    return `Month: ${label} (IST)`;
  }
  return null;
}

/** Current hour (0–23) in Asia/Kolkata for greetings. */
export function getISTHour(date: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    hour: "numeric",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(date);
  const h = parts.find((p) => p.type === "hour")?.value;
  return h != null ? Number(h) : 12;
}

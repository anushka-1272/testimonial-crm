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

export function getPeriodBoundsIST(
  period: DashboardPeriod,
): DashboardPeriodBounds {
  if (period === "weekly") {
    const { startIso, endIso } = getWeekBoundsIST();
    return { startIso, endIso };
  }
  if (period === "monthly") {
    const { startIso, endIso } = getMonthBoundsIST();
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

import { getISTYmd, TIMEZONE } from "@/lib/dashboard-ist-dates";

const pad2 = (n: number) => String(n).padStart(2, "0");

export function parseIsoInstant(iso: string | null | undefined): Date | null {
  if (!iso?.trim()) return null;
  const date = new Date(iso.trim());
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatInIst(date: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    ...options,
  }).format(date);
}

function istCalendarKey(date: Date): string {
  const { year, month, day } = getISTYmd(date);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function tomorrowIstKey(): string {
  const { year, month, day } = getISTYmd(new Date());
  const noonIst = new Date(
    `${year}-${pad2(month)}-${pad2(day)}T12:00:00+05:30`,
  );
  return istCalendarKey(new Date(noonIst.getTime() + 86_400_000));
}

/** "May 24, 2026 · 11:00 AM" in IST (for slots and callbacks). */
export function formatDateTimeSlotIst(
  iso: string | null | undefined,
): string | null {
  const date = parseIsoInstant(iso);
  if (!date) return null;
  try {
    const datePart = formatInIst(date, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const timePart = formatInIst(date, {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return `${datePart} · ${timePart}`;
  } catch {
    return null;
  }
}

/** "May 24, 2026" in IST. */
export function formatDateOnlyIst(
  iso: string | null | undefined,
): string | null {
  const date = parseIsoInstant(iso);
  if (!date) return null;
  try {
    return formatInIst(date, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return null;
  }
}

/** "today at 11:00 AM", "tomorrow at 11:00 AM", or "May 24 at 11:00 AM" in IST. */
export function formatScheduledHeadlineIst(
  iso: string | null | undefined,
): string | null {
  const date = parseIsoInstant(iso);
  if (!date) return null;
  try {
    const time = formatInIst(date, {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    const key = istCalendarKey(date);
    if (key === istCalendarKey(new Date())) return `today at ${time}`;
    if (key === tomorrowIstKey()) return `tomorrow at ${time}`;
    const dayLabel = formatInIst(date, { month: "short", day: "numeric" });
    return `${dayLabel} at ${time}`;
  } catch {
    return null;
  }
}

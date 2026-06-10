import type { GvizCell } from "@/lib/google-sheet-gviz";

const MIN_PHONE_DIGITS = 8;
const MAX_PHONE_DIGITS = 15;

export function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, "");
}

export function looksLikePhone(raw: string): boolean {
  const digits = digitsOnly(raw);
  return digits.length >= MIN_PHONE_DIGITS && digits.length <= MAX_PHONE_DIGITS;
}

/**
 * Normalize phone values from sheets, forms, or manual entry.
 * Accepts +91 98765-43210, (987) 654-3210, 9876543210, etc.
 */
export function normalizePhoneFromRaw(raw: string): string | null {
  const trimmed = raw.trim().replace(/^'+/, "");
  if (!trimmed) return null;

  const hasPlus = trimmed.startsWith("+");
  const digits = digitsOnly(trimmed);
  if (!looksLikePhone(digits)) return null;

  if (hasPlus) return `+${digits}`;
  return digits;
}

/** Extract a phone number from a Google gviz cell (text or numeric). */
export function phoneFromGvizCell(cell: GvizCell): string | null {
  if (cell == null) return null;

  if (cell.f != null && String(cell.f).trim() !== "") {
    return normalizePhoneFromRaw(String(cell.f));
  }

  const v = cell.v;
  if (v == null || v === "") return null;

  if (typeof v === "number" && Number.isFinite(v)) {
    const asInt = Number.isInteger(v) ? v : Math.round(v);
    const asStr = Number.isSafeInteger(asInt)
      ? String(asInt)
      : v.toFixed(0).replace(/\.0+$/, "");
    return normalizePhoneFromRaw(asStr);
  }

  if (typeof v === "string") {
    return normalizePhoneFromRaw(v);
  }

  return normalizePhoneFromRaw(String(v));
}

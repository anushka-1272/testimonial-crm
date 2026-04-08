"use client";

import { endOfWeek, format, parseISO, startOfWeek } from "date-fns";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { CandidateDetailModal } from "@/components/candidate-detail-modal";
import { logActivity } from "@/lib/activity-logger";
import { createBrowserSupabaseClient } from "@/lib/supabase-browser";

type DispatchStatus = "pending" | "dispatched" | "delivered";

export type DispatchRow = {
  id: string;
  candidate_id: string;
  shipping_address: string | null;
  dispatch_status: DispatchStatus;
  dispatch_date: string | null;
  expected_delivery_date: string | null;
  actual_delivery_date: string | null;
  tracking_id: string | null;
  special_comments: string | null;
  reward_item: string | null;
  candidates: {
    full_name: string | null;
    email: string;
    whatsapp_number: string | null;
  } | null;
};

const SELECT = `id, candidate_id, shipping_address, dispatch_status, dispatch_date, expected_delivery_date, actual_delivery_date, tracking_id, special_comments, reward_item, candidates ( full_name, email, whatsapp_number )`;

function normalizeRow(
  row: Record<string, unknown> & {
    candidates:
      | { full_name: string | null; email: string; whatsapp_number: string | null }
      | { full_name: string | null; email: string; whatsapp_number: string | null }[]
      | null;
  },
): DispatchRow {
  const c = row.candidates;
  const candidate =
    c == null ? null : Array.isArray(c) ? c[0] ?? null : c;
  return { ...row, candidates: candidate } as DispatchRow;
}

const cardChrome =
  "rounded-2xl bg-white shadow-[0_4px_16px_rgba(0,0,0,0.08)] border border-[#f0f0f0]";

const REWARD_AIRPODS = "AirPods";
const REWARD_JBL = "JBL Clip 5";

function rewardItemBadge(reward: string | null | undefined) {
  const v = reward?.trim();
  if (!v) {
    return <span className="text-[#6e6e73]">—</span>;
  }
  if (v === REWARD_AIRPODS) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#f3f4f6] px-2.5 py-1 text-xs font-medium text-[#374151]">
        <span aria-hidden>🎧</span> AirPods
      </span>
    );
  }
  if (v === REWARD_JBL) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#eff6ff] px-2.5 py-1 text-xs font-medium text-[#2563eb]">
        <span aria-hidden>🔊</span> JBL Clip 5
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#fef9c3] px-2.5 py-1 text-xs font-medium text-[#854d0e]">
      <span aria-hidden>✏️</span>
      <span className="max-w-[140px] truncate" title={v}>
        {v}
      </span>
    </span>
  );
}

/** Read-only reward label for delivered rows (no pill, no edit affordances). */
function rewardItemPlainText(reward: string | null | undefined) {
  const v = reward?.trim();
  if (!v) {
    return <span className="text-[#6e6e73]">—</span>;
  }
  if (v === REWARD_AIRPODS) {
    return (
      <span className="text-xs text-[#374151]">
        <span aria-hidden>🎧</span> AirPods
      </span>
    );
  }
  if (v === REWARD_JBL) {
    return (
      <span className="text-xs text-[#2563eb]">
        <span aria-hidden>🔊</span> JBL Clip 5
      </span>
    );
  }
  return (
    <span className="inline-flex max-w-[160px] items-center gap-1 truncate text-xs text-[#854d0e]" title={v}>
      <span aria-hidden>✏️</span>
      <span className="truncate">{v}</span>
    </span>
  );
}

function RewardItemCell({
  row,
  supabase,
  onRewardSaved,
  setError,
}: {
  row: DispatchRow;
  supabase: NonNullable<ReturnType<typeof createBrowserSupabaseClient>>;
  onRewardSaved: (id: string, reward_item: string | null) => void;
  setError: (msg: string | null) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [otherMode, setOtherMode] = useState(false);
  const [otherText, setOtherText] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [menuPos, setMenuPos] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [mounted, setMounted] = useState(false);

  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const hasReward = Boolean(row.reward_item?.trim());

  const updateMenuPosition = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setMenuPos({ top: r.bottom + 6, left: r.left });
  }, []);

  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuPos(null);
      return;
    }
    updateMenuPosition();
    const onScrollOrResize = () => updateMenuPosition();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [menuOpen, updateMenuPosition]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setMenuOpen(false);
      setOtherMode(false);
      setOtherText("");
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  const openMenu = () => {
    setMenuOpen(true);
    setOtherMode(false);
    setOtherText(
      row.reward_item &&
        row.reward_item !== REWARD_AIRPODS &&
        row.reward_item !== REWARD_JBL
        ? row.reward_item
        : "",
    );
  };

  const triggerSavedFlash = () => {
    setSavedFlash(true);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setSavedFlash(false), 2000);
  };

  const saveReward = async (value: string | null) => {
    const trimmed = value?.trim() ?? null;
    setSaving(true);
    setError(null);
    const { error: uErr } = await supabase
      .from("dispatch")
      .update({ reward_item: trimmed })
      .eq("id", row.id);
    setSaving(false);
    if (uErr) {
      setError(uErr.message);
      return;
    }
    const oldLabel = row.reward_item?.trim() || "—";
    const newLabel = trimmed || "—";
    if (oldLabel !== newLabel) {
      const candDisplay =
        row.candidates?.full_name?.trim() || "Candidate";
      const { data: authRw } = await supabase.auth.getUser();
      if (authRw.user) {
        await logActivity({
          supabase,
          user: authRw.user,
          action_type: "dispatch",
          entity_type: "dispatch",
          entity_id: row.id,
          candidate_name: candDisplay,
          description: `Changed reward item for ${candDisplay} from ${oldLabel} to ${newLabel}`,
          metadata: { from: row.reward_item, to: trimmed },
        });
      }
    }
    onRewardSaved(row.id, trimmed);
    setMenuOpen(false);
    setOtherMode(false);
    setOtherText("");
    triggerSavedFlash();
  };

  const menuContent =
    menuOpen && menuPos && mounted ? (
      <div
        ref={menuRef}
        className="fixed z-[200] w-56 rounded-xl border border-[#e5e5e5] bg-white py-1 shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
        style={{ top: menuPos.top, left: menuPos.left }}
        role="listbox"
      >
        <button
          type="button"
          disabled={saving}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[#1d1d1f] hover:bg-[#f5f5f7] disabled:opacity-50"
          onClick={() => void saveReward(REWARD_AIRPODS)}
        >
          <span aria-hidden>🎧</span> AirPods
        </button>
        <button
          type="button"
          disabled={saving}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[#1d1d1f] hover:bg-[#f5f5f7] disabled:opacity-50"
          onClick={() => void saveReward(REWARD_JBL)}
        >
          <span aria-hidden>🔊</span> JBL Clip 5
        </button>
        {!otherMode ? (
          <button
            type="button"
            disabled={saving}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[#1d1d1f] hover:bg-[#f5f5f7] disabled:opacity-50"
            onClick={() => setOtherMode(true)}
          >
            <span aria-hidden>✏️</span> Other
          </button>
        ) : (
          <div className="border-t border-[#f0f0f0] px-3 py-2">
            <input
              type="text"
              className="w-full rounded-lg border border-[#e5e5e5] px-2 py-1.5 text-sm text-[#1d1d1f] focus:border-[#3b82f6] focus:outline-none"
              placeholder="Specify item..."
              value={otherText}
              onChange={(e) => setOtherText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && otherText.trim()) {
                  e.preventDefault();
                  void saveReward(otherText.trim());
                }
              }}
            />
            <button
              type="button"
              disabled={saving || !otherText.trim()}
              className="mt-2 w-full rounded-lg bg-[#1d1d1f] py-1.5 text-xs font-medium text-white hover:bg-[#2d2d2f] disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void saveReward(otherText.trim())}
            >
              Save
            </button>
          </div>
        )}
      </div>
    ) : null;

  if (row.dispatch_status === "delivered") {
    return (
      <div className="flex min-h-[2rem] flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {rewardItemPlainText(row.reward_item)}
        </div>
      </div>
    );
  }

  return (
    <div ref={anchorRef} className="flex min-h-[2rem] flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {hasReward ? (
          <div className="group flex items-center gap-0.5">
            {rewardItemBadge(row.reward_item)}
            <button
              type="button"
              className="shrink-0 rounded p-0.5 text-[#6e6e73] opacity-0 transition-opacity hover:bg-[#f0f0f0] hover:text-[#1d1d1f] group-hover:opacity-100 focus:opacity-100"
              aria-label="Edit reward item"
              onClick={(e) => {
                e.stopPropagation();
                if (menuOpen) {
                  setMenuOpen(false);
                  setOtherMode(false);
                } else {
                  openMenu();
                }
              }}
            >
              <span className="text-sm leading-none" aria-hidden>
                ✏️
              </span>
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="text-xs font-medium text-[#3b82f6] hover:underline"
            onClick={() => (menuOpen ? setMenuOpen(false) : openMenu())}
          >
            + Add item
          </button>
        )}
        {savedFlash ? (
          <span className="text-xs font-medium text-[#16a34a]">Saved ✓</span>
        ) : null}
      </div>
      {mounted && menuContent
        ? createPortal(menuContent, document.body)
        : null}
    </div>
  );
}

function statusBadgeClass(s: DispatchStatus): string {
  switch (s) {
    case "pending":
      return "bg-[#fafafa] text-[#6e6e73]";
    case "dispatched":
      return "bg-[#eff6ff] text-[#3b82f6]";
    case "delivered":
      return "bg-[#f0fdf4] text-[#16a34a]";
    default:
      return "bg-[#fafafa] text-[#6e6e73]";
  }
}

function formatDisplayDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "MMM d, yyyy");
  } catch {
    return "—";
  }
}

function formatDisplayDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "MMM d, yyyy h:mm a");
  } catch {
    return "—";
  }
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function buildCsv(rows: DispatchRow[]): string {
  const headers = [
    "Name",
    "Email",
    "Phone",
    "Shipping Address",
    "Reward item",
    "Dispatch Status",
    "Dispatch Date",
    "Tracking ID",
    "Expected Delivery",
    "Actual Delivery",
    "Special Comments",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    const c = r.candidates;
    lines.push(
      [
        csvEscape(c?.full_name ?? ""),
        csvEscape(c?.email ?? ""),
        csvEscape(c?.whatsapp_number ?? ""),
        csvEscape(r.shipping_address ?? ""),
        csvEscape(r.reward_item ?? ""),
        csvEscape(r.dispatch_status),
        csvEscape(
          r.dispatch_date ? format(parseISO(r.dispatch_date), "yyyy-MM-dd") : "",
        ),
        csvEscape(r.tracking_id ?? ""),
        csvEscape(
          r.expected_delivery_date
            ? format(parseISO(r.expected_delivery_date), "yyyy-MM-dd")
            : "",
        ),
        csvEscape(
          r.actual_delivery_date
            ? format(parseISO(r.actual_delivery_date), "yyyy-MM-dd")
            : "",
        ),
        csvEscape(r.special_comments ?? ""),
      ].join(","),
    );
  }
  return "\uFEFF" + lines.join("\n");
}

function UpdateDispatchModal({
  row,
  open,
  onClose,
  supabase,
  onSaved,
}: {
  row: DispatchRow | null;
  open: boolean;
  onClose: () => void;
  supabase: ReturnType<typeof createBrowserSupabaseClient>;
  onSaved: () => void;
}) {
  const [trackingId, setTrackingId] = useState("");
  const [dispatchDate, setDispatchDate] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [comments, setComments] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!row || !open) return;
    setTrackingId(row.tracking_id ?? "");
    setDispatchDate(
      row.dispatch_date
        ? format(parseISO(row.dispatch_date), "yyyy-MM-dd")
        : "",
    );
    setExpectedDate(
      row.expected_delivery_date
        ? format(parseISO(row.expected_delivery_date), "yyyy-MM-dd")
        : "",
    );
    setComments(row.special_comments ?? "");
    setError(null);
  }, [row, open]);

  if (!open || !row) return null;

  const email = row.candidates?.email;
  const name = row.candidates?.full_name;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!trackingId.trim()) {
      setError("Tracking ID is required to send confirmation.");
      return;
    }
    if (!expectedDate) {
      setError("Expected delivery date is required for the confirmation email.");
      return;
    }

    setSubmitting(true);
    try {
      const dispatchIso = dispatchDate
        ? new Date(`${dispatchDate}T12:00:00`).toISOString()
        : null;
      const expectedIso = new Date(`${expectedDate}T12:00:00`).toISOString();

      const nextStatus: DispatchStatus =
        row.dispatch_status === "delivered" ? "delivered" : "dispatched";

      const { error: upErr } = await supabase
        .from("dispatch")
        .update({
          tracking_id: trackingId.trim(),
          dispatch_date: dispatchIso,
          expected_delivery_date: expectedIso,
          special_comments: comments.trim() || null,
          dispatch_status: nextStatus,
        })
        .eq("id", row.id);

      if (upErr) {
        setError(upErr.message);
        setSubmitting(false);
        return;
      }

      const candDisplay =
        row.candidates?.full_name?.trim() || "Candidate";
      const expectedStr = format(parseISO(expectedIso), "MMMM d, yyyy");
      const { data: authDu } = await supabase.auth.getUser();
      if (authDu.user) {
        await logActivity({
          supabase,
          user: authDu.user,
          action_type: "dispatch",
          entity_type: "dispatch",
          entity_id: row.id,
          candidate_name: candDisplay,
          description: `Updated dispatch for ${candDisplay} — Tracking: ${trackingId.trim()}, Expected: ${expectedStr}`,
        });
      }

      if (email && row.dispatch_status !== "delivered") {
        const expectedLabel = expectedStr;
        const dispatchLabel = dispatchIso
          ? format(parseISO(dispatchIso), "MMMM d, yyyy")
          : "—";
        const res = await fetch("/api/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "dispatch_confirmation",
            to: email,
            name,
            reward_item: row.reward_item,
            tracking_id: trackingId.trim(),
            dispatch_date: dispatchLabel,
            expected_delivery_date: expectedLabel,
          }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          setError(
            j.error ?? "Saved dispatch but confirmation email failed to send.",
          );
          setSubmitting(false);
          onSaved();
          onClose();
          return;
        }
      }

      onSaved();
      onClose();
    } catch {
      setError("Something went wrong.");
    }
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-[#1d1d1f]/25 backdrop-blur-sm"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[#f0f0f0] bg-white p-6 shadow-[0_4px_16px_rgba(0,0,0,0.08)]">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[#1d1d1f]">
              Update dispatch
            </h2>
            <p className="text-sm text-[#6e6e73]">
              {name ?? "Candidate"} · {email}
            </p>
          </div>
          <button
            type="button"
            className="rounded-xl p-2 text-[#aeaeb2] transition-all hover:bg-[#f5f5f7] hover:text-[#1d1d1f]"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 text-sm">
          {error && (
            <p className="rounded-xl border border-[#f0f0f0] bg-[#f5f5f7] px-3 py-2 text-sm text-[#1d1d1f]">
              {error}
            </p>
          )}

          <label className="block text-sm">
            <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
              Tracking ID
            </span>
            <input
              required
              className="mt-1 w-full rounded-xl border border-[#e5e5e5] px-3 py-2.5 text-sm text-[#1d1d1f] focus:border-[#3b82f6] focus:outline-none focus:ring-0"
              value={trackingId}
              onChange={(e) => setTrackingId(e.target.value)}
            />
          </label>

          <label className="block text-sm">
            <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
              Dispatch date
            </span>
            <input
              type="date"
              className="mt-1 w-full rounded-xl border border-[#e5e5e5] px-3 py-2.5 text-sm text-[#1d1d1f] focus:border-[#3b82f6] focus:outline-none focus:ring-0"
              value={dispatchDate}
              onChange={(e) => setDispatchDate(e.target.value)}
            />
          </label>

          <label className="block text-sm">
            <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
              Expected delivery date
            </span>
            <input
              required
              type="date"
              className="mt-1 w-full rounded-xl border border-[#e5e5e5] px-3 py-2.5 text-sm text-[#1d1d1f] focus:border-[#3b82f6] focus:outline-none focus:ring-0"
              value={expectedDate}
              onChange={(e) => setExpectedDate(e.target.value)}
            />
          </label>

          <label className="block text-sm">
            <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
              Special comments
            </span>
            <textarea
              rows={3}
              className="mt-1 w-full rounded-xl border border-[#e5e5e5] px-3 py-2.5 text-sm text-[#1d1d1f] focus:border-[#3b82f6] focus:outline-none focus:ring-0"
              value={comments}
              onChange={(e) => setComments(e.target.value)}
            />
          </label>

          <p className="text-xs text-[#6e6e73]">
            Saving sets status to <strong className="font-medium text-[#1d1d1f]">dispatched</strong> (unless already
            delivered) and emails the candidate the dispatch confirmation.
          </p>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="rounded-xl border border-[#f0f0f0] bg-white px-4 py-2 text-sm font-medium text-[#1d1d1f] transition-all hover:bg-[#fafafa]"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-xl bg-[#1d1d1f] px-4 py-2 text-sm font-medium text-white transition-all hover:bg-[#2d2d2f] disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Save & notify"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function DispatchDashboard() {
  const [rows, setRows] = useState<DispatchRow[]>([]);
  const [filter, setFilter] = useState<DispatchStatus | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [updateRow, setUpdateRow] = useState<DispatchRow | null>(null);
  const [detailCandidateId, setDetailCandidateId] = useState<string | null>(
    null,
  );
  const [stats, setStats] = useState<{
    pending: number;
    dispatchedWeek: number;
    deliveredWeek: number;
  } | null>(null);

  const supabase = useMemo(() => {
    try {
      return createBrowserSupabaseClient();
    } catch {
      return null;
    }
  }, []);

  const weekStart = useMemo(
    () => startOfWeek(new Date(), { weekStartsOn: 1 }),
    [],
  );
  const weekEnd = useMemo(
    () => endOfWeek(new Date(), { weekStartsOn: 1 }),
    [],
  );

  const loadRows = useCallback(async () => {
    if (!supabase) return;
    const { data, error: qErr } = await supabase
      .from("dispatch")
      .select(SELECT)
      .order("dispatch_date", { ascending: false, nullsFirst: false });

    if (qErr) {
      setError(qErr.message);
      return;
    }
    const list = (data ?? []).map((r) =>
      normalizeRow(r as Parameters<typeof normalizeRow>[0]),
    );
    setRows(list);
    setError(null);
  }, [supabase]);

  const loadStats = useCallback(async () => {
    if (!supabase) return;
    const ws = weekStart.toISOString();
    const we = weekEnd.toISOString();

    const [pendingRes, dispRes, delRes] = await Promise.all([
      supabase
        .from("dispatch")
        .select("id", { count: "exact", head: true })
        .eq("dispatch_status", "pending"),
      supabase
        .from("dispatch")
        .select("id", { count: "exact", head: true })
        .eq("dispatch_status", "dispatched")
        .gte("dispatch_date", ws)
        .lte("dispatch_date", we),
      supabase
        .from("dispatch")
        .select("id", { count: "exact", head: true })
        .eq("dispatch_status", "delivered")
        .gte("actual_delivery_date", ws)
        .lte("actual_delivery_date", we),
    ]);

    setStats({
      pending: pendingRes.count ?? 0,
      dispatchedWeek: dispRes.count ?? 0,
      deliveredWeek: delRes.count ?? 0,
    });
  }, [supabase, weekStart, weekEnd]);

  useEffect(() => {
    if (!supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }

    const ch = supabase
      .channel("dispatch-dashboard")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "dispatch" },
        () => {
          void loadRows();
          void loadStats();
        },
      )
      .subscribe();

    void (async () => {
      setLoading(true);
      await Promise.all([loadRows(), loadStats()]);
      setLoading(false);
    })();

    return () => {
      void supabase.removeChannel(ch);
    };
  }, [supabase, loadRows, loadStats]);

  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((r) => r.dispatch_status === filter);
  }, [rows, filter]);

  const exportCsv = () => {
    const csv = buildCsv(filtered);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dispatch-export-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const markDelivered = async (r: DispatchRow) => {
    if (!supabase) return;
    setBusyId(r.id);
    const { error: uErr } = await supabase
      .from("dispatch")
      .update({
        dispatch_status: "delivered",
        actual_delivery_date: new Date().toISOString(),
      })
      .eq("id", r.id);
    setBusyId(null);
    if (uErr) {
      setError(uErr.message);
      return;
    }
    const candDisplay = r.candidates?.full_name?.trim() || "Candidate";
    const { data: authMd } = await supabase.auth.getUser();
    if (authMd.user) {
      await logActivity({
        supabase,
        user: authMd.user,
        action_type: "dispatch",
        entity_type: "dispatch",
        entity_id: r.id,
        candidate_name: candDisplay,
        description: `Marked ${candDisplay} as Delivered`,
      });
    }
  };

  const patchRowReward = useCallback(
    (id: string, reward_item: string | null) => {
      setRows((prev) =>
        prev.map((row) => (row.id === id ? { ...row, reward_item } : row)),
      );
    },
    [],
  );

  if (!supabase) {
    return (
      <div className="mx-auto max-w-lg px-8 py-16 text-center text-sm text-[#6e6e73]">
        {error ?? "Cannot connect to Supabase."}
      </div>
    );
  }

  const tabs: { id: typeof filter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "pending", label: "Pending" },
    { id: "dispatched", label: "Dispatched" },
    { id: "delivered", label: "Delivered" },
  ];

  return (
    <>
      <header className="sticky top-0 z-30 bg-[#f5f5f7]/90 px-8 py-6 backdrop-blur-md">
        <h1 className="text-2xl font-semibold tracking-tight text-[#1d1d1f]">
          Dispatch
        </h1>
        <p className="mt-1 text-sm text-[#6e6e73]">
          Track shipments and delivery status
        </p>
      </header>

      <main className="mx-auto max-w-7xl px-8 pb-12 pt-2 text-sm text-[#1d1d1f]">
        {error && (
          <div className="mb-6 rounded-2xl border border-[#f0f0f0] bg-white px-4 py-3 text-sm text-[#1d1d1f] shadow-[0_4px_16px_rgba(0,0,0,0.08)]">
            {error}
            <button
              type="button"
              className="ml-2 font-medium text-[#3b82f6] hover:text-[#2563eb]"
              onClick={() => setError(null)}
            >
              Dismiss
            </button>
          </div>
        )}

        <section className="mb-8 grid gap-4 sm:grid-cols-3">
          <div className={`p-6 ${cardChrome}`}>
            <p className="mb-3 text-xs font-medium text-[#6e6e73]">
              Total pending dispatches
            </p>
            <p className="text-4xl font-bold tabular-nums tracking-tight text-[#1d1d1f]">
              {loading ? "…" : (stats?.pending ?? "—")}
            </p>
            <div className="mt-4 h-0.5 w-8 rounded-full bg-[#3b82f6]" />
          </div>
          <div className={`p-6 ${cardChrome}`}>
            <p className="mb-3 text-xs font-medium text-[#6e6e73]">
              Dispatched this week
            </p>
            <p className="text-4xl font-bold tabular-nums tracking-tight text-[#1d1d1f]">
              {loading ? "…" : (stats?.dispatchedWeek ?? "—")}
            </p>
            <p className="mt-1 text-sm text-[#6e6e73]">Mon–Sun · dispatch date</p>
            <div className="mt-4 h-0.5 w-8 rounded-full bg-[#3b82f6]" />
          </div>
          <div className={`p-6 ${cardChrome}`}>
            <p className="mb-3 text-xs font-medium text-[#6e6e73]">
              Delivered this week
            </p>
            <p className="text-4xl font-bold tabular-nums tracking-tight text-[#1d1d1f]">
              {loading ? "…" : (stats?.deliveredWeek ?? "—")}
            </p>
            <p className="mt-1 text-sm text-[#6e6e73]">Mon–Sun · actual delivery</p>
            <div className="mt-4 h-0.5 w-8 rounded-full bg-[#3b82f6]" />
          </div>
        </section>

        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex rounded-full bg-white p-1 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setFilter(t.id)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-200 ease-in-out ${
                  filter === t.id
                    ? "bg-[#1d1d1f] text-white"
                    : "text-[#6e6e73] hover:text-[#1d1d1f]"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="text-sm font-medium text-[#3b82f6] transition-all hover:text-[#2563eb] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Export CSV ({filtered.length} rows)
          </button>
        </div>

        <div className={`overflow-hidden ${cardChrome}`}>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[#f5f5f5]">
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                    Name
                  </th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                    Email
                  </th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                    Phone
                  </th>
                  <th className="min-w-[160px] px-3 py-3 text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                    Shipping address
                  </th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                    Reward item
                  </th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                    Status
                  </th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                    Dispatch date
                  </th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                    Tracking ID
                  </th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                    Expected delivery
                  </th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td
                      colSpan={10}
                      className="px-4 py-12 text-center text-sm text-[#6e6e73]"
                    >
                      Loading…
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={10}
                      className="px-4 py-12 text-center text-sm text-[#6e6e73]"
                    >
                      No dispatch records for this filter.
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => {
                    const c = r.candidates;
                    const canUpdate =
                      r.dispatch_status === "pending" ||
                      r.dispatch_status === "dispatched";
                    const canDeliver =
                      r.dispatch_status === "pending" ||
                      r.dispatch_status === "dispatched";
                    return (
                      <tr
                        key={r.id}
                        className="border-b border-[#f5f5f5] last:border-b-0 hover:bg-[#fafafa]"
                      >
                        <td className="max-w-[140px] px-3 py-3">
                          <button
                            type="button"
                            className="max-w-full truncate text-left font-medium text-[#3b82f6] hover:underline focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/25 rounded-sm"
                            onClick={() => setDetailCandidateId(r.candidate_id)}
                          >
                            {c?.full_name?.trim() || "—"}
                          </button>
                        </td>
                        <td className="max-w-[160px] truncate px-3 py-3 text-[#6e6e73]">
                          {c?.email ?? "—"}
                        </td>
                        <td className="max-w-[100px] truncate px-3 py-3 text-[#6e6e73]">
                          {c?.whatsapp_number ?? "—"}
                        </td>
                        <td className="max-w-[200px] whitespace-pre-wrap break-words px-3 py-3 text-[#6e6e73]">
                          {r.shipping_address ?? "—"}
                        </td>
                        <td className="max-w-[160px] px-3 py-3">
                          <RewardItemCell
                            row={r}
                            supabase={supabase}
                            onRewardSaved={patchRowReward}
                            setError={setError}
                          />
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className={`inline-flex rounded-full px-3 py-1 text-xs font-medium capitalize ${statusBadgeClass(r.dispatch_status)}`}
                          >
                            {r.dispatch_status}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-[#6e6e73]">
                          {formatDisplayDateTime(r.dispatch_date)}
                        </td>
                        <td className="max-w-[120px] truncate px-3 py-3 font-mono text-xs text-[#1d1d1f]">
                          {r.tracking_id ?? "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-[#6e6e73]">
                          {formatDisplayDate(r.expected_delivery_date)}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-col items-start gap-2">
                            {canUpdate && (
                              <button
                                type="button"
                                className="whitespace-nowrap text-sm font-medium text-[#3b82f6] transition-all hover:text-[#2563eb]"
                                onClick={() => setUpdateRow(r)}
                              >
                                Update dispatch
                              </button>
                            )}
                            {canDeliver && (
                              <button
                                type="button"
                                disabled={busyId === r.id}
                                className="whitespace-nowrap text-sm font-medium text-[#16a34a] transition-all hover:text-[#15803d] disabled:opacity-50"
                                onClick={() => void markDelivered(r)}
                              >
                                Mark delivered
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      <UpdateDispatchModal
        key={updateRow?.id ?? "closed"}
        row={updateRow}
        open={!!updateRow}
        onClose={() => setUpdateRow(null)}
        supabase={supabase}
        onSaved={() => {
          void loadRows();
          void loadStats();
        }}
      />

      <CandidateDetailModal
        open={!!detailCandidateId}
        candidateId={detailCandidateId}
        supabase={supabase}
        onClose={() => setDetailCandidateId(null)}
      />
    </>
  );
}

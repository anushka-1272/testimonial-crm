"use client";

import { endOfWeek, format, parseISO, startOfWeek } from "date-fns";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { createBrowserSupabaseClient } from "@/lib/supabase-browser";
import type { RealtimeChannel } from "@supabase/supabase-js";

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
  candidates: {
    full_name: string | null;
    email: string;
    whatsapp_number: string | null;
  } | null;
};

const SELECT = `id, candidate_id, shipping_address, dispatch_status, dispatch_date, expected_delivery_date, actual_delivery_date, tracking_id, special_comments, candidates ( full_name, email, whatsapp_number )`;

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

function statusBadgeClass(s: DispatchStatus): string {
  switch (s) {
    case "pending":
      return "bg-amber-50 text-amber-900 ring-amber-200";
    case "dispatched":
      return "bg-sky-50 text-sky-900 ring-sky-200";
    case "delivered":
      return "bg-emerald-50 text-emerald-900 ring-emerald-200";
    default:
      return "bg-slate-100 text-slate-700 ring-slate-200";
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

      if (email && row.dispatch_status !== "delivered") {
        const expectedLabel = format(parseISO(expectedIso), "MMMM d, yyyy");
        const res = await fetch("/api/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "dispatch_confirmation",
            to: email,
            name,
            tracking_id: trackingId.trim(),
            date: expectedLabel,
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
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Update dispatch
            </h2>
            <p className="text-sm text-slate-500">
              {name ?? "Candidate"} · {email}
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <label className="block text-sm">
            <span className="font-medium text-slate-700">Tracking ID</span>
            <input
              required
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
              value={trackingId}
              onChange={(e) => setTrackingId(e.target.value)}
            />
          </label>

          <label className="block text-sm">
            <span className="font-medium text-slate-700">Dispatch date</span>
            <input
              type="date"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
              value={dispatchDate}
              onChange={(e) => setDispatchDate(e.target.value)}
            />
          </label>

          <label className="block text-sm">
            <span className="font-medium text-slate-700">
              Expected delivery date
            </span>
            <input
              required
              type="date"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
              value={expectedDate}
              onChange={(e) => setExpectedDate(e.target.value)}
            />
          </label>

          <label className="block text-sm">
            <span className="font-medium text-slate-700">Special comments</span>
            <textarea
              rows={3}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
              value={comments}
              onChange={(e) => setComments(e.target.value)}
            />
          </label>

          <p className="text-xs text-slate-500">
            Saving sets status to <strong>dispatched</strong> (unless already
            delivered) and emails the candidate the dispatch confirmation.
          </p>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
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

    let ch: RealtimeChannel | null = null;

    (async () => {
      setLoading(true);
      await Promise.all([loadRows(), loadStats()]);
      setLoading(false);

      ch = supabase
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
    })();

    return () => {
      if (ch) void supabase.removeChannel(ch);
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
    if (uErr) setError(uErr.message);
  };

  if (!supabase) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center text-slate-600">
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
    <div className="min-h-screen bg-slate-50/80">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Dashboard
            </p>
            <h1 className="text-xl font-semibold text-slate-900">
              Dispatch management
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm font-medium">
            <Link
              href="/dashboard/eligibility"
              className="text-slate-600 hover:text-slate-900"
            >
              Eligibility
            </Link>
            <Link
              href="/dashboard/interviews"
              className="text-slate-600 hover:text-slate-900"
            >
              Interviews
            </Link>
            <Link href="/" className="text-slate-600 hover:text-slate-900">
              Home
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {error && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            {error}
            <button
              type="button"
              className="ml-2 underline"
              onClick={() => setError(null)}
            >
              Dismiss
            </button>
          </div>
        )}

        <section className="mb-8 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-slate-500">
              Total pending dispatches
            </p>
            <p className="mt-2 text-3xl font-semibold tabular-nums text-slate-900">
              {loading ? "…" : (stats?.pending ?? "—")}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-slate-500">
              Dispatched this week
            </p>
            <p className="mt-2 text-3xl font-semibold tabular-nums text-slate-900">
              {loading ? "…" : (stats?.dispatchedWeek ?? "—")}
            </p>
            <p className="mt-1 text-xs text-slate-400">Mon–Sun · dispatch date</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-slate-500">
              Delivered this week
            </p>
            <p className="mt-2 text-3xl font-semibold tabular-nums text-slate-900">
              {loading ? "…" : (stats?.deliveredWeek ?? "—")}
            </p>
            <p className="mt-1 text-xs text-slate-400">Mon–Sun · actual delivery</p>
          </div>
        </section>

        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setFilter(t.id)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  filter === t.id
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-50"
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
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Export CSV ({filtered.length} rows)
          </button>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-3 font-semibold text-slate-700">
                    Name
                  </th>
                  <th className="px-3 py-3 font-semibold text-slate-700">
                    Email
                  </th>
                  <th className="px-3 py-3 font-semibold text-slate-700">
                    Phone
                  </th>
                  <th className="min-w-[160px] px-3 py-3 font-semibold text-slate-700">
                    Shipping address
                  </th>
                  <th className="px-3 py-3 font-semibold text-slate-700">
                    Status
                  </th>
                  <th className="px-3 py-3 font-semibold text-slate-700">
                    Dispatch date
                  </th>
                  <th className="px-3 py-3 font-semibold text-slate-700">
                    Tracking ID
                  </th>
                  <th className="px-3 py-3 font-semibold text-slate-700">
                    Expected delivery
                  </th>
                  <th className="px-3 py-3 font-semibold text-slate-700">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-12 text-center text-slate-500"
                    >
                      Loading…
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-12 text-center text-slate-500"
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
                      <tr key={r.id} className="hover:bg-slate-50/80">
                        <td className="max-w-[120px] truncate px-3 py-3 font-medium text-slate-900">
                          {c?.full_name ?? "—"}
                        </td>
                        <td className="max-w-[160px] truncate px-3 py-3 text-slate-600">
                          {c?.email ?? "—"}
                        </td>
                        <td className="max-w-[100px] truncate px-3 py-3 text-slate-600">
                          {c?.whatsapp_number ?? "—"}
                        </td>
                        <td className="max-w-[200px] whitespace-pre-wrap break-words px-3 py-3 text-slate-600">
                          {r.shipping_address ?? "—"}
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ring-1 ring-inset ${statusBadgeClass(r.dispatch_status)}`}
                          >
                            {r.dispatch_status}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-slate-600">
                          {formatDisplayDateTime(r.dispatch_date)}
                        </td>
                        <td className="max-w-[120px] truncate px-3 py-3 font-mono text-xs text-slate-700">
                          {r.tracking_id ?? "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-slate-600">
                          {formatDisplayDate(r.expected_delivery_date)}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-col gap-1">
                            {canUpdate && (
                              <button
                                type="button"
                                className="whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-800"
                                onClick={() => setUpdateRow(r)}
                              >
                                Update dispatch
                              </button>
                            )}
                            {canDeliver && (
                              <button
                                type="button"
                                disabled={busyId === r.id}
                                className="whitespace-nowrap rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
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
    </div>
  );
}

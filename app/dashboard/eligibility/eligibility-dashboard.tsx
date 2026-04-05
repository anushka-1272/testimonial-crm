"use client";

import { endOfDay, parseISO, startOfDay, startOfWeek } from "date-fns";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  formatAchievementSummary,
  truncateText,
} from "@/lib/candidate-summary";
import { createBrowserSupabaseClient } from "@/lib/supabase-browser";
import type { RealtimeChannel } from "@supabase/supabase-js";

type EligibilityStatus = "pending_review" | "eligible" | "not_eligible";

export type CandidateRow = {
  id: string;
  created_at: string;
  form_filled_date: string | null;
  email: string;
  full_name: string | null;
  whatsapp_number: string | null;
  role_before_program: string | null;
  salary_before_program: string | null;
  primary_goal: string | null;
  achievement_type: string | null;
  achievement_title: string | null;
  achieved_on_date: string | null;
  program_joined_date: string | null;
  quantified_result: string | null;
  skills_modules_helped: string | null;
  how_program_helped: string | null;
  proof_document_url: string | null;
  proof_description: string | null;
  linkedin_url: string | null;
  instagram_url: string | null;
  declaration_accepted: boolean | null;
  ai_eligibility_score: number | null;
  ai_eligibility_reason: string | null;
  eligibility_status: EligibilityStatus;
  human_reviewed_by: string | null;
  human_reviewed_at: string | null;
  congratulation_call_pending: boolean;
};

type DashboardStats = {
  weekTotal: number;
  pending: number;
  eligible: number;
  notEligible: number;
};

const SELECT_COLUMNS =
  "id, created_at, form_filled_date, email, full_name, whatsapp_number, role_before_program, salary_before_program, primary_goal, achievement_type, achievement_title, achieved_on_date, program_joined_date, quantified_result, skills_modules_helped, how_program_helped, proof_document_url, proof_description, linkedin_url, instagram_url, declaration_accepted, ai_eligibility_score, ai_eligibility_reason, eligibility_status, human_reviewed_by, human_reviewed_at, congratulation_call_pending";

function scoreBadgeClass(score: number | null): string {
  if (score === null || Number.isNaN(score)) {
    return "bg-slate-100 text-slate-600 ring-slate-200";
  }
  if (score > 70) return "bg-emerald-50 text-emerald-800 ring-emerald-200";
  if (score >= 40) return "bg-amber-50 text-amber-900 ring-amber-200";
  return "bg-red-50 text-red-800 ring-red-200";
}

function statusPill(status: EligibilityStatus): string {
  switch (status) {
    case "pending_review":
      return "bg-slate-100 text-slate-700 ring-slate-200";
    case "eligible":
      return "bg-emerald-50 text-emerald-800 ring-emerald-200";
    case "not_eligible":
      return "bg-red-50 text-red-800 ring-red-200";
    default:
      return "bg-slate-100 text-slate-600 ring-slate-200";
  }
}

function statusLabel(status: EligibilityStatus): string {
  switch (status) {
    case "pending_review":
      return "Pending review";
    case "eligible":
      return "Eligible";
    case "not_eligible":
      return "Not eligible";
    default:
      return status;
  }
}

export function EligibilityDashboard() {
  const [rows, setRows] = useState<CandidateRow[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const [statusFilter, setStatusFilter] = useState<string>("");
  const [industryFilter, setIndustryFilter] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawer, setDrawer] = useState<CandidateRow | null>(null);

  const supabase = useMemo(() => {
    try {
      return createBrowserSupabaseClient();
    } catch (e) {
      return null;
    }
  }, []);

  const loadRows = useCallback(async () => {
    if (!supabase) return;
    const { data, error: qErr } = await supabase
      .from("candidates")
      .select(SELECT_COLUMNS)
      .order("created_at", { ascending: false });

    if (qErr) {
      setError(qErr.message);
      return;
    }
    setRows((data ?? []) as CandidateRow[]);
    setError(null);
  }, [supabase]);

  const loadStats = useCallback(async () => {
    if (!supabase) return;
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });

    const [weekRes, pendingRes, eligibleRes, notRes] = await Promise.all([
      supabase
        .from("candidates")
        .select("id", { count: "exact", head: true })
        .gte("created_at", weekStart.toISOString()),
      supabase
        .from("candidates")
        .select("id", { count: "exact", head: true })
        .eq("eligibility_status", "pending_review"),
      supabase
        .from("candidates")
        .select("id", { count: "exact", head: true })
        .eq("eligibility_status", "eligible"),
      supabase
        .from("candidates")
        .select("id", { count: "exact", head: true })
        .eq("eligibility_status", "not_eligible"),
    ]);

    setStats({
      weekTotal: weekRes.count ?? 0,
      pending: pendingRes.count ?? 0,
      eligible: eligibleRes.count ?? 0,
      notEligible: notRes.count ?? 0,
    });
  }, [supabase]);

  useEffect(() => {
    if (!supabase) {
      setError(
        "Supabase browser client is not configured (check NEXT_PUBLIC_* env vars).",
      );
      setLoading(false);
      return;
    }

    let channel: RealtimeChannel | null = null;

    (async () => {
      setLoading(true);
      await Promise.all([loadRows(), loadStats()]);
      setLoading(false);

      channel = supabase
        .channel("candidates-realtime")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "candidates" },
          () => {
            void loadRows();
            void loadStats();
          },
        )
        .subscribe();
    })();

    return () => {
      if (channel && supabase) {
        void supabase.removeChannel(channel);
      }
    };
  }, [supabase, loadRows, loadStats]);

  const industryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const v = r.role_before_program?.trim();
      if (v) set.add(v);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter && r.eligibility_status !== statusFilter) {
        return false;
      }
      if (industryFilter && (r.role_before_program ?? "") !== industryFilter) {
        return false;
      }
      if (dateFrom) {
        const created = parseISO(r.created_at);
        const from = startOfDay(parseISO(dateFrom));
        if (created < from) return false;
      }
      if (dateTo) {
        const created = parseISO(r.created_at);
        const to = endOfDay(parseISO(dateTo));
        if (created > to) return false;
      }
      return true;
    });
  }, [rows, statusFilter, industryFilter, dateFrom, dateTo]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    const ids = filteredRows.map((r) => r.id);
    const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOn) {
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const markEligible = async (r: CandidateRow) => {
    if (!supabase) return;
    setBusyId(r.id);
    const { error: uErr } = await supabase
      .from("candidates")
      .update({
        eligibility_status: "eligible",
        congratulation_call_pending: true,
      })
      .eq("id", r.id);
    setBusyId(null);
    if (uErr) {
      setError(uErr.message);
      return;
    }
    setSelected((prev) => {
      const n = new Set(prev);
      n.delete(r.id);
      return n;
    });
  };

  const markNotEligible = async (r: CandidateRow) => {
    if (!supabase) return;
    setBusyId(r.id);
    const { error: uErr } = await supabase
      .from("candidates")
      .update({ eligibility_status: "not_eligible" })
      .eq("id", r.id);
    if (uErr) {
      setBusyId(null);
      setError(uErr.message);
      return;
    }
    try {
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "eligibility_reject",
          to: r.email,
          candidateName: r.full_name,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? "Rejection email failed to send");
      }
    } catch {
      setError("Network error sending rejection email");
    }
    setBusyId(null);
    setSelected((prev) => {
      const n = new Set(prev);
      n.delete(r.id);
      return n;
    });
  };

  const bulkMarkEligible = async () => {
    if (!supabase || selected.size === 0) return;
    setBulkBusy(true);
    const ids = Array.from(selected);
    const { error: uErr } = await supabase
      .from("candidates")
      .update({
        eligibility_status: "eligible",
        congratulation_call_pending: true,
      })
      .in("id", ids);
    setBulkBusy(false);
    if (uErr) setError(uErr.message);
    else setSelected(new Set());
  };

  const bulkMarkNotEligible = async () => {
    if (!supabase || selected.size === 0) return;
    setBulkBusy(true);
    const ids = Array.from(selected);
    const { error: uErr } = await supabase
      .from("candidates")
      .update({ eligibility_status: "not_eligible" })
      .in("id", ids);
    if (uErr) {
      setBulkBusy(false);
      setError(uErr.message);
      return;
    }
    const toEmail = rows.filter((r) => ids.includes(r.id));
    for (const r of toEmail) {
      try {
        await fetch("/api/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "eligibility_reject",
            to: r.email,
            candidateName: r.full_name,
          }),
        });
      } catch {
        /* continue others */
      }
      await new Promise((res) => setTimeout(res, 400));
    }
    setBulkBusy(false);
    setSelected(new Set());
  };

  const bulkRunAi = async () => {
    if (selected.size === 0) return;
    setBulkBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/bulk-assess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidate_ids: Array.from(selected) }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        failed?: number;
      };
      if (!res.ok) {
        setError(j.error ?? "Bulk assessment failed");
      } else if (j.failed && j.failed > 0) {
        setError(`Bulk assessment completed with ${j.failed} failure(s).`);
      }
    } catch {
      setError("Bulk assessment request failed");
    }
    setBulkBusy(false);
    setSelected(new Set());
  };

  if (!supabase && !loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 text-center text-slate-600">
        <p>{error ?? "Cannot initialize Supabase client."}</p>
      </div>
    );
  }

  const allFilteredSelected =
    filteredRows.length > 0 &&
    filteredRows.every((r) => selected.has(r.id));

  return (
    <div className="min-h-screen bg-slate-50/80">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Dashboard
            </p>
            <h1 className="text-xl font-semibold text-slate-900">
              Eligibility review
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm font-medium">
            <Link
              href="/dashboard/interviews"
              className="text-slate-600 hover:text-slate-900"
            >
              Interviews
            </Link>
            <Link
              href="/dashboard/dispatch"
              className="text-slate-600 hover:text-slate-900"
            >
              Dispatch
            </Link>
            <Link href="/" className="text-slate-600 hover:text-slate-900">
              ← Home
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {error && (
          <div
            className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            role="alert"
          >
            {error}
            <button
              type="button"
              className="ml-3 font-medium underline"
              onClick={() => setError(null)}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Stats */}
        <section className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              label: "New this week",
              value: stats?.weekTotal ?? "—",
              sub: "Created since Monday",
            },
            {
              label: "Pending review",
              value: stats?.pending ?? "—",
              sub: "Awaiting decision",
            },
            {
              label: "Eligible",
              value: stats?.eligible ?? "—",
              sub: "Approved",
            },
            {
              label: "Not eligible",
              value: stats?.notEligible ?? "—",
              sub: "Declined",
            },
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <p className="text-sm font-medium text-slate-500">{card.label}</p>
              <p className="mt-2 text-3xl font-semibold tabular-nums text-slate-900">
                {loading ? "…" : card.value}
              </p>
              <p className="mt-1 text-xs text-slate-400">{card.sub}</p>
            </div>
          ))}
        </section>

        {/* Filters */}
        <section className="mb-4 flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:flex-wrap sm:items-end">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Status</span>
            <select
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All</option>
              <option value="pending_review">Pending review</option>
              <option value="eligible">Eligible</option>
              <option value="not_eligible">Not eligible</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Industry / role</span>
            <select
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
              value={industryFilter}
              onChange={(e) => setIndustryFilter(e.target.value)}
            >
              <option value="">All</option>
              {industryOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">From</span>
            <input
              type="date"
              className="rounded-lg border border-slate-200 px-3 py-2 text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">To</span>
            <input
              type="date"
              className="rounded-lg border border-slate-200 px-3 py-2 text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            onClick={() => {
              setStatusFilter("");
              setIndustryFilter("");
              setDateFrom("");
              setDateTo("");
            }}
          >
            Clear filters
          </button>
        </section>

        {/* Bulk bar */}
        {selected.size > 0 && (
          <div className="mb-4 flex flex-col gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-medium text-indigo-900">
              {selected.size} selected
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={bulkBusy}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                onClick={() => void bulkMarkEligible()}
              >
                Bulk mark eligible
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
                onClick={() => void bulkMarkNotEligible()}
              >
                Bulk mark not eligible
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
                onClick={() => void bulkRunAi()}
              >
                Bulk run AI assessment
              </button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="w-10 px-3 py-3">
                    <input
                      type="checkbox"
                      className="rounded border-slate-300"
                      checked={allFilteredSelected}
                      onChange={toggleSelectAllFiltered}
                      aria-label="Select all visible"
                    />
                  </th>
                  <th className="px-3 py-3 font-semibold text-slate-700">
                    Name
                  </th>
                  <th className="px-3 py-3 font-semibold text-slate-700">
                    Email
                  </th>
                  <th className="px-3 py-3 font-semibold text-slate-700">
                    Industry
                  </th>
                  <th className="px-3 py-3 font-semibold text-slate-700">
                    Achievement
                  </th>
                  <th className="px-3 py-3 font-semibold text-slate-700">
                    AI score
                  </th>
                  <th className="px-3 py-3 font-semibold text-slate-700">
                    AI reason
                  </th>
                  <th className="px-3 py-3 font-semibold text-slate-700">
                    Status
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
                      Loading candidates…
                    </td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-12 text-center text-slate-500"
                    >
                      No candidates match the current filters.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((r) => {
                    const summary = formatAchievementSummary(r);
                    const displaySummary = summary
                      ? truncateText(summary, 72)
                      : "—";
                    const score = r.ai_eligibility_score;
                    return (
                      <tr
                        key={r.id}
                        className="hover:bg-slate-50/80"
                      >
                        <td className="px-3 py-3 align-top">
                          <input
                            type="checkbox"
                            className="rounded border-slate-300"
                            checked={selected.has(r.id)}
                            onChange={() => toggleSelect(r.id)}
                            aria-label={`Select ${r.full_name ?? r.email}`}
                          />
                        </td>
                        <td className="max-w-[140px] truncate px-3 py-3 font-medium text-slate-900">
                          {r.full_name ?? "—"}
                        </td>
                        <td className="max-w-[180px] truncate px-3 py-3 text-slate-600">
                          {r.email}
                        </td>
                        <td className="max-w-[120px] truncate px-3 py-3 text-slate-600">
                          {r.role_before_program ?? "—"}
                        </td>
                        <td
                          className="max-w-[200px] truncate px-3 py-3 text-slate-600"
                          title={summary || undefined}
                        >
                          {displaySummary}
                        </td>
                        <td className="px-3 py-3 align-top">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${scoreBadgeClass(score)}`}
                          >
                            {score === null ? "—" : score}
                          </span>
                        </td>
                        <td className="max-w-[160px] px-3 py-3 text-slate-600">
                          <span
                            className="line-clamp-2 cursor-help"
                            title={
                              r.ai_eligibility_reason ?? "No reason recorded"
                            }
                          >
                            {r.ai_eligibility_reason ?? "—"}
                          </span>
                        </td>
                        <td className="px-3 py-3 align-top">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${statusPill(r.eligibility_status)}`}
                          >
                            {statusLabel(r.eligibility_status)}
                          </span>
                        </td>
                        <td className="px-3 py-3 align-top">
                          <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap">
                            <button
                              type="button"
                              disabled={busyId === r.id}
                              className="whitespace-nowrap rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                              onClick={() => void markEligible(r)}
                            >
                              Mark eligible
                            </button>
                            <button
                              type="button"
                              disabled={busyId === r.id}
                              className="whitespace-nowrap rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                              onClick={() => void markNotEligible(r)}
                            >
                              Mark not eligible
                            </button>
                            <button
                              type="button"
                              className="whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                              onClick={() => setDrawer(r)}
                            >
                              View details
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
            Showing {filteredRows.length} of {rows.length} loaded · Realtime
            updates enabled
          </p>
        </div>
      </main>

      {/* Drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]"
            aria-label="Close drawer"
            onClick={() => setDrawer(null)}
          />
          <aside className="relative flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {drawer.full_name ?? "Candidate"}
                </h2>
                <p className="text-sm text-slate-500">{drawer.email}</p>
              </div>
              <button
                type="button"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                onClick={() => setDrawer(null)}
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 text-sm">
              <dl className="space-y-4">
                {(
                  [
                    ["Created", drawer.created_at],
                    ["Form filled", drawer.form_filled_date],
                    ["WhatsApp", drawer.whatsapp_number],
                    ["Role / industry", drawer.role_before_program],
                    ["Salary (before)", drawer.salary_before_program],
                    ["Primary goal", drawer.primary_goal],
                    ["Achievement type", drawer.achievement_type],
                    ["Achievement title", drawer.achievement_title],
                    ["Achieved on", drawer.achieved_on_date],
                    ["Program joined", drawer.program_joined_date],
                    ["Quantified result", drawer.quantified_result],
                    ["Skills / modules", drawer.skills_modules_helped],
                    ["How program helped", drawer.how_program_helped],
                    ["Proof URL", drawer.proof_document_url],
                    ["Proof description", drawer.proof_description],
                    ["LinkedIn", drawer.linkedin_url],
                    ["Instagram", drawer.instagram_url],
                    [
                      "Declaration accepted",
                      drawer.declaration_accepted == null
                        ? "—"
                        : String(drawer.declaration_accepted),
                    ],
                    ["AI score", drawer.ai_eligibility_score ?? "—"],
                    ["AI reason", drawer.ai_eligibility_reason],
                    ["Status", statusLabel(drawer.eligibility_status)],
                    [
                      "Congratulation call pending",
                      String(drawer.congratulation_call_pending),
                    ],
                    ["Reviewed by", drawer.human_reviewed_by],
                    ["Reviewed at", drawer.human_reviewed_at],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
                      {k}
                    </dt>
                    <dd className="mt-0.5 whitespace-pre-wrap break-words text-slate-800">
                      {v === null || v === "" ? "—" : String(v)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="border-t border-slate-100 px-5 py-3">
              <button
                type="button"
                className="w-full rounded-lg bg-slate-900 py-2 text-sm font-medium text-white hover:bg-slate-800"
                onClick={() => setDrawer(null)}
              >
                Close
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

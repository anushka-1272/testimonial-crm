"use client";

import { endOfDay, parseISO, startOfDay, startOfWeek } from "date-fns";
import { Check, Loader2, RefreshCw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAccessControl } from "@/components/access-control-context";
import {
  formatAchievementSummary,
  truncateText,
} from "@/lib/candidate-summary";
import { logActivity } from "@/lib/activity-logger";
import { getUserSafe } from "@/lib/supabase-auth";
import { createBrowserSupabaseClient } from "@/lib/supabase-browser";

type EligibilityStatus = "pending_review" | "eligible" | "not_eligible";

export type InterviewTrack = "testimonial" | "project";

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
  interview_type: InterviewTrack | null;
};

type DashboardStats = {
  weekTotal: number;
  pending: number;
  eligible: number;
  notEligible: number;
};

const SELECT_COLUMNS =
  "id, created_at, form_filled_date, email, full_name, whatsapp_number, role_before_program, salary_before_program, primary_goal, achievement_type, achievement_title, achieved_on_date, program_joined_date, quantified_result, skills_modules_helped, how_program_helped, proof_document_url, proof_description, linkedin_url, instagram_url, declaration_accepted, ai_eligibility_score, ai_eligibility_reason, eligibility_status, human_reviewed_by, human_reviewed_at, congratulation_call_pending, interview_type";

const cardChrome =
  "rounded-2xl bg-white shadow-[0_4px_16px_rgba(0,0,0,0.08)] border border-[#f0f0f0]";

function scorePillClass(score: number | null): string {
  if (score === null) return "bg-[#fafafa] text-[#6e6e73]";
  if (score < 45) return "bg-[#fef2f2] text-[#dc2626]";
  if (score < 75) return "bg-[#fafafa] text-[#6e6e73]";
  return "bg-[#f0fdf4] text-[#16a34a]";
}

function eligibilityStatusBadgeClass(status: EligibilityStatus): string {
  switch (status) {
    case "eligible":
      return "bg-[#f0fdf4] text-[#16a34a]";
    case "not_eligible":
      return "bg-[#fef2f2] text-[#dc2626]";
    case "pending_review":
    default:
      return "bg-[#fafafa] text-[#6e6e73]";
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

function interviewTypeTableCell(t: InterviewTrack | null | undefined) {
  if (t === "testimonial") {
    return (
      <span className="inline-flex rounded-full bg-[#f0fdf4] px-3 py-1 text-xs font-medium text-[#16a34a]">
        Testimonial
      </span>
    );
  }
  if (t === "project") {
    return (
      <span className="inline-flex rounded-full bg-[#eff6ff] px-3 py-1 text-xs font-medium text-[#2563eb]">
        Project
      </span>
    );
  }
  return <span className="text-[#6e6e73]">—</span>;
}

function DetailField({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string | null | undefined;
  className?: string;
}) {
  const display =
    value == null || String(value).trim() === "" ? null : String(value);
  return (
    <div className={className}>
      <dt className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
        {label}
      </dt>
      <dd className="mt-1 whitespace-pre-wrap break-words text-[#1d1d1f]">
        {display ?? <span className="text-[#6e6e73]">—</span>}
      </dd>
    </div>
  );
}

export function EligibilityDashboard() {
  const { role, canEditCurrentPage, showViewOnlyBadge } = useAccessControl();
  const [rows, setRows] = useState<CandidateRow[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [sheetSyncBusy, setSheetSyncBusy] = useState(false);

  const [statusFilter, setStatusFilter] = useState<string>("");
  const [industryFilter, setIndustryFilter] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailCandidate, setDetailCandidate] = useState<CandidateRow | null>(
    null,
  );

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

    const channel = supabase
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

    void (async () => {
      setLoading(true);
      await Promise.all([loadRows(), loadStats()]);
      setLoading(false);
    })();

    return () => {
      void supabase.removeChannel(channel);
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

  const markEligible = async (r: CandidateRow, interviewType: InterviewTrack) => {
    if (!canEditCurrentPage) return;
    if (!supabase) return;
    setBusyId(r.id);
    const { error: uErr } = await supabase
      .from("candidates")
      .update({
        eligibility_status: "eligible",
        congratulation_call_pending: true,
        interview_type: interviewType,
      })
      .eq("id", r.id);
    setBusyId(null);
    if (uErr) {
      setError(uErr.message);
      return;
    }
    const actor = await getUserSafe(supabase);
    if (actor) {
      const display = r.full_name?.trim() || r.email || "Candidate";
      const trackLabel =
        interviewType === "testimonial" ? "Testimonial" : "Project";
      if (
        r.eligibility_status === "eligible" &&
        r.interview_type !== interviewType
      ) {
        await logActivity({
          supabase,
          user: actor,
          action_type: "eligibility",
          entity_type: "candidate",
          entity_id: r.id,
          candidate_name: display,
          description: `Changed interview type for ${display} to ${trackLabel}`,
          metadata: { from: r.interview_type, to: interviewType },
        });
      } else if (r.eligibility_status !== "eligible") {
        await logActivity({
          supabase,
          user: actor,
          action_type: "eligibility",
          entity_type: "candidate",
          entity_id: r.id,
          candidate_name: display,
          description: `Marked ${display} as Eligible (${trackLabel})`,
        });
      }
    }
    setSelected((prev) => {
      const n = new Set(prev);
      n.delete(r.id);
      return n;
    });
    setDetailCandidate((prev) => (prev?.id === r.id ? null : prev));
  };

  const deleteCandidate = async (r: CandidateRow) => {
    if (role !== "admin") return;
    if (!supabase) return;
    const displayName =
      r.full_name?.trim() || r.email?.trim() || "this candidate";
    const ok = window.confirm(
      `Are you sure you want to delete ${displayName}? This will permanently remove the candidate and all associated interviews and dispatch records.`,
    );
    if (!ok) return;
    setBusyId(r.id);
    const { error: dErr } = await supabase
      .from("candidates")
      .delete()
      .eq("id", r.id);
    setBusyId(null);
    if (dErr) {
      setError(dErr.message);
      return;
    }
    const actor = await getUserSafe(supabase);
    if (actor) {
      await logActivity({
        supabase,
        user: actor,
        action_type: "eligibility",
        entity_type: "candidate",
        entity_id: r.id,
        candidate_name: displayName,
        description: `Deleted candidate ${displayName}`,
      });
    }
    setSelected((prev) => {
      const n = new Set(prev);
      n.delete(r.id);
      return n;
    });
    setDetailCandidate((prev) => (prev?.id === r.id ? null : prev));
    void loadRows();
    void loadStats();
  };

  const markNotEligible = async (r: CandidateRow) => {
    if (!canEditCurrentPage) return;
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
    const actorNe = await getUserSafe(supabase);
    if (actorNe) {
      const display = r.full_name?.trim() || r.email || "Candidate";
      await logActivity({
        supabase,
        user: actorNe,
        action_type: "eligibility",
        entity_type: "candidate",
        entity_id: r.id,
        candidate_name: display,
        description: `Marked ${display} as Not Eligible`,
      });
    }
    setBusyId(null);
    setSelected((prev) => {
      const n = new Set(prev);
      n.delete(r.id);
      return n;
    });
    setDetailCandidate((prev) => (prev?.id === r.id ? null : prev));
  };

  const bulkMarkEligible = async () => {
    if (!canEditCurrentPage) return;
    if (!supabase || selected.size === 0) return;
    setBulkBusy(true);
    const ids = Array.from(selected);
    const { error: uErr } = await supabase
      .from("candidates")
      .update({
        eligibility_status: "eligible",
        congratulation_call_pending: true,
        interview_type: "testimonial",
      })
      .in("id", ids);
    setBulkBusy(false);
    if (uErr) setError(uErr.message);
    else {
      const actorBulk = await getUserSafe(supabase);
      if (actorBulk) {
        for (const id of ids) {
          const row = rows.find((x) => x.id === id);
          if (!row) continue;
          const display =
            row.full_name?.trim() || row.email || "Candidate";
          await logActivity({
            supabase,
            user: actorBulk,
            action_type: "eligibility",
            entity_type: "candidate",
            entity_id: id,
            candidate_name: display,
            description: `Marked ${display} as Eligible (Testimonial)`,
          });
        }
      }
      setSelected(new Set());
    }
  };

  const bulkMarkNotEligible = async () => {
    if (!canEditCurrentPage) return;
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
    const actorBn = await getUserSafe(supabase);
    if (actorBn) {
      for (const id of ids) {
        const row = rows.find((x) => x.id === id);
        if (!row) continue;
        const display = row.full_name?.trim() || row.email || "Candidate";
        await logActivity({
          supabase,
          user: actorBn,
          action_type: "eligibility",
          entity_type: "candidate",
          entity_id: id,
          candidate_name: display,
          description: `Marked ${display} as Not Eligible`,
        });
      }
    }
    setBulkBusy(false);
    setSelected(new Set());
  };

  const syncSheet = async () => {
    if (!supabase) return;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setError("You must be signed in to sync.");
      return;
    }
    setSheetSyncBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sync-sheet", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const j = (await res.json()) as {
        error?: string;
        total_rows?: number;
        new_inserted?: number;
        updated_rows?: number;
        skipped_empty_email?: number;
        errors?: string[];
      };
      if (!res.ok) {
        setError(j.error ?? "Sheet sync failed.");
        return;
      }
      const inserted = j.new_inserted ?? 0;
      const updated = j.updated_rows ?? 0;
      const skippedEmail = j.skipped_empty_email ?? 0;
      alert(
        `Synced ${inserted} new, ${updated} updated, ${skippedEmail} rows without email (from ${j.total_rows ?? 0} sheet rows).`,
      );
      if (j.errors?.length) {
        setError(j.errors.slice(0, 5).join(" · "));
      }
      await loadRows();
      await loadStats();
    } catch {
      setError("Sheet sync request failed.");
    } finally {
      setSheetSyncBusy(false);
    }
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
      <div className="mx-auto max-w-4xl px-8 py-16 text-center text-sm text-[#6e6e73]">
        <p>{error ?? "Cannot initialize Supabase client."}</p>
      </div>
    );
  }

  const allFilteredSelected =
    filteredRows.length > 0 &&
    filteredRows.every((r) => selected.has(r.id));

  return (
    <>
      <header className="sticky top-0 z-30 bg-[#f5f5f7]/90 px-8 py-6 backdrop-blur-md">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[#1d1d1f]">
              Eligibility review
            </h1>
            <p className="mt-1 text-sm text-[#6e6e73]">
              Review and update candidate eligibility
            </p>
            {showViewOnlyBadge ? (
              <span className="mt-2 inline-flex rounded-full bg-[#f3f4f6] px-3 py-1 text-xs font-medium text-[#6b7280]">
                View only
              </span>
            ) : null}
          </div>
          <button
            type="button"
            disabled={!canEditCurrentPage || sheetSyncBusy || !supabase}
            onClick={() => void syncSheet()}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-[#e5e5e5] bg-white px-4 py-2 text-sm font-medium text-[#1d1d1f] transition-all hover:bg-[#f5f5f7] disabled:opacity-50"
          >
            {sheetSyncBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-4 w-4" aria-hidden />
            )}
            Sync Sheet
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-8 pb-12 pt-2 text-sm text-[#1d1d1f]">
        {error && (
          <div
            className="mb-6 rounded-2xl border border-[#f0f0f0] bg-white px-4 py-3 text-sm text-[#1d1d1f] shadow-[0_4px_16px_rgba(0,0,0,0.08)]"
            role="alert"
          >
            {error}
            <button
              type="button"
              className="ml-3 font-medium text-[#3b82f6] hover:text-[#2563eb]"
              onClick={() => setError(null)}
            >
              Dismiss
            </button>
          </div>
        )}

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
            <div key={card.label} className={`p-6 ${cardChrome}`}>
              <p className="mb-3 text-xs font-medium text-[#6e6e73]">
                {card.label}
              </p>
              <p className="text-4xl font-bold tabular-nums tracking-tight text-[#1d1d1f]">
                {loading ? "…" : card.value}
              </p>
              <p className="mt-1 text-sm text-[#6e6e73]">{card.sub}</p>
              <div className="mt-4 h-0.5 w-8 rounded-full bg-[#3b82f6]" />
            </div>
          ))}
        </section>

        <section className="mb-6 flex flex-col gap-4 rounded-2xl border border-[#f0f0f0] bg-white p-4 shadow-sm sm:flex-row sm:flex-wrap sm:items-end">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
              Status
            </span>
            <select
              className="rounded-xl border border-[#e5e5e5] bg-white px-3 py-2 text-sm text-[#1d1d1f] focus:border-[#3b82f6] focus:outline-none focus:ring-0"
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
            <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
              Industry / role
            </span>
            <select
              className="rounded-xl border border-[#e5e5e5] bg-white px-3 py-2 text-sm text-[#1d1d1f] focus:border-[#3b82f6] focus:outline-none focus:ring-0"
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
            <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
              From
            </span>
            <input
              type="date"
              className="rounded-xl border border-[#e5e5e5] px-3 py-2 text-sm text-[#1d1d1f] focus:border-[#3b82f6] focus:outline-none focus:ring-0"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs uppercase tracking-widest text-[#aeaeb2]">
              To
            </span>
            <input
              type="date"
              className="rounded-xl border border-[#e5e5e5] px-3 py-2 text-sm text-[#1d1d1f] focus:border-[#3b82f6] focus:outline-none focus:ring-0"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="rounded-xl px-4 py-2 text-sm font-medium text-[#3b82f6] transition-all hover:text-[#2563eb]"
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

        {selected.size > 0 && (
          <div
            className={`mb-6 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between ${cardChrome}`}
          >
            <p className="text-sm font-medium text-[#1d1d1f]">
              {selected.size} selected
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={bulkBusy}
                className="rounded-xl bg-[#1d1d1f] px-4 py-2 text-sm font-medium text-white transition-all hover:bg-[#2d2d2f] disabled:opacity-50"
                onClick={() => void bulkMarkEligible()}
              >
                Bulk mark eligible
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                className="rounded-xl border border-[#f0f0f0] bg-white px-4 py-2 text-sm font-medium text-[#ef4444] transition-all hover:bg-[#fafafa] disabled:opacity-50"
                onClick={() => void bulkMarkNotEligible()}
              >
                Bulk mark not eligible
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                className="text-sm font-medium text-[#3b82f6] transition-all hover:text-[#2563eb] disabled:opacity-50"
                onClick={() => void bulkRunAi()}
              >
                Bulk run AI assessment
              </button>
            </div>
          </div>
        )}

        <div className={`overflow-hidden ${cardChrome}`}>
          <div className="w-full min-w-0 max-w-full overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[#f5f5f5]">
                  <th className="w-10 px-3 py-3">
                    <input
                      type="checkbox"
                      className="rounded border-[#e5e5e5] text-[#1d1d1f] focus:ring-[#3b82f6]"
                      checked={allFilteredSelected}
                      onChange={toggleSelectAllFiltered}
                      aria-label="Select all visible"
                    />
                  </th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                    Name
                  </th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                    Email
                  </th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                    Industry
                  </th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                    Achievement
                  </th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                    AI score
                  </th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                    AI reason
                  </th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                    Status
                  </th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                    Interview type
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
                      Loading candidates…
                    </td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={10}
                      className="px-4 py-12 text-center text-sm text-[#6e6e73]"
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
                        className="border-b border-[#f5f5f5] last:border-b-0 hover:bg-[#fafafa]"
                      >
                        <td className="px-3 py-3 align-top">
                          <input
                            type="checkbox"
                            className="rounded border-[#e5e5e5] text-[#1d1d1f] focus:ring-[#3b82f6]"
                            checked={selected.has(r.id)}
                            onChange={() => toggleSelect(r.id)}
                            aria-label={`Select ${r.full_name ?? r.email}`}
                          />
                        </td>
                        <td className="max-w-[140px] truncate px-3 py-3 font-medium text-[#1d1d1f]">
                          {r.full_name ?? "—"}
                        </td>
                        <td className="max-w-[180px] truncate px-3 py-3 text-[#6e6e73]">
                          {r.email}
                        </td>
                        <td className="max-w-[120px] truncate px-3 py-3 text-[#6e6e73]">
                          {r.role_before_program ?? "—"}
                        </td>
                        <td
                          className="max-w-[200px] truncate px-3 py-3 text-[#6e6e73]"
                          title={summary || undefined}
                        >
                          {displaySummary}
                        </td>
                        <td className="px-3 py-3 align-top">
                          <span
                            className={`inline-flex rounded-full px-3 py-1 text-xs font-medium tabular-nums ${scorePillClass(score)}`}
                          >
                            {score === null ? "—" : score}
                          </span>
                        </td>
                        <td className="max-w-[160px] px-3 py-3 text-[#6e6e73]">
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
                            className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${eligibilityStatusBadgeClass(r.eligibility_status)}`}
                          >
                            {statusLabel(r.eligibility_status)}
                          </span>
                        </td>
                        <td className="px-3 py-3 align-top whitespace-nowrap">
                          {interviewTypeTableCell(r.interview_type)}
                        </td>
                        <td className="px-3 py-3 align-top">
                          <div className="flex flex-col items-start gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                disabled={busyId === r.id}
                                title="Mark eligible for a testimonial interview"
                                aria-label="Mark eligible as testimonial"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#bbf7d0] bg-[#f0fdf4] text-xs font-bold text-[#16a34a] transition-colors hover:bg-[#dcfce7] disabled:opacity-50"
                                onClick={() =>
                                  void markEligible(r, "testimonial")
                                }
                              >
                                T
                              </button>
                              <button
                                type="button"
                                disabled={busyId === r.id}
                                title="Mark eligible for a project interview"
                                aria-label="Mark eligible as project"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#bfdbfe] bg-[#eff6ff] text-xs font-bold text-[#2563eb] transition-colors hover:bg-[#dbeafe] disabled:opacity-50"
                                onClick={() => void markEligible(r, "project")}
                              >
                                P
                              </button>
                            </div>
                            <button
                              type="button"
                              disabled={busyId === r.id}
                              title="Mark Not Eligible"
                              aria-label="Mark Not Eligible"
                              className="inline-flex items-center justify-center rounded-lg border border-[#fecaca] bg-[#fef2f2] p-2 text-[#dc2626] transition-colors hover:bg-[#fee2e2] disabled:opacity-50"
                              onClick={() => void markNotEligible(r)}
                            >
                              <X className="h-4 w-4" strokeWidth={2.5} />
                            </button>
                            <button
                              type="button"
                              className="whitespace-nowrap text-sm font-medium text-[#6e6e73] transition-all hover:text-[#1d1d1f]"
                              onClick={() => setDetailCandidate(r)}
                            >
                              View details
                            </button>
                            {role === "admin" ? (
                              <button
                                type="button"
                                disabled={busyId === r.id}
                                title="Delete candidate"
                                aria-label="Delete candidate"
                                className="inline-flex items-center justify-center rounded-lg border border-[#fecaca] bg-[#fef2f2] p-2 text-[#dc2626] transition-colors hover:bg-[#fee2e2] disabled:opacity-50"
                                onClick={() => void deleteCandidate(r)}
                              >
                                <Trash2
                                  className="h-4 w-4"
                                  strokeWidth={2}
                                  aria-hidden
                                />
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <p className="border-t border-[#f5f5f5] px-4 py-3 text-xs text-[#aeaeb2]">
            Showing {filteredRows.length} of {rows.length} loaded · Realtime
            updates enabled
          </p>
        </div>
      </main>

      {detailCandidate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-[#1d1d1f]/60 backdrop-blur-sm"
            aria-label="Close details"
            onClick={() => setDetailCandidate(null)}
          />
          <div
            className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="candidate-detail-title"
          >
            <div className="flex items-start justify-between border-b border-[#f5f5f5] px-6 py-4">
              <h2
                id="candidate-detail-title"
                className="pr-8 text-xl font-semibold text-[#1d1d1f]"
              >
                {detailCandidate.full_name ?? "Candidate"}
              </h2>
              <button
                type="button"
                className="shrink-0 rounded-lg p-2 text-[#aeaeb2] transition-all hover:bg-[#f5f5f7] hover:text-[#1d1d1f]"
                aria-label="Close"
                onClick={() => setDetailCandidate(null)}
              >
                <X className="h-5 w-5" strokeWidth={2} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 text-sm text-[#1d1d1f]">
              <dl className="grid gap-5 sm:grid-cols-2">
                <DetailField
                  label="Name"
                  value={detailCandidate.full_name}
                  className="sm:col-span-2"
                />
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                    Interview type
                  </dt>
                  <dd className="mt-1">
                    {interviewTypeTableCell(detailCandidate.interview_type)}
                  </dd>
                </div>
                <DetailField label="Email" value={detailCandidate.email} />
                <DetailField
                  label="Phone"
                  value={detailCandidate.whatsapp_number}
                />
                <DetailField
                  label="Role"
                  value={detailCandidate.role_before_program}
                />
                <DetailField
                  label="Salary"
                  value={detailCandidate.salary_before_program}
                />
                <DetailField
                  label="Achievement type"
                  value={detailCandidate.achievement_type}
                  className="sm:col-span-2"
                />
                <DetailField
                  label="Achievement title"
                  value={detailCandidate.achievement_title}
                  className="sm:col-span-2"
                />
                <DetailField
                  label="Quantified result"
                  value={detailCandidate.quantified_result}
                  className="sm:col-span-2"
                />
                <DetailField
                  label="How program helped"
                  value={detailCandidate.how_program_helped}
                  className="sm:col-span-2"
                />
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                    Proof
                  </dt>
                  <dd className="mt-2 space-y-2">
                    {detailCandidate.proof_document_url?.trim() ? (
                      <a
                        href={detailCandidate.proof_document_url.trim()}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex rounded-xl bg-[#1d1d1f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2d2d2f]"
                      >
                        View Proof
                      </a>
                    ) : (
                      <span className="text-[#6e6e73]">—</span>
                    )}
                    {detailCandidate.proof_description?.trim() ? (
                      <p className="whitespace-pre-wrap text-[#6e6e73]">
                        {detailCandidate.proof_description}
                      </p>
                    ) : null}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                    LinkedIn
                  </dt>
                  <dd className="mt-1 break-all">
                    {detailCandidate.linkedin_url?.trim() ? (
                      <a
                        href={detailCandidate.linkedin_url.trim()}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#3b82f6] hover:underline"
                      >
                        {detailCandidate.linkedin_url.trim()}
                      </a>
                    ) : (
                      <span className="text-[#6e6e73]">—</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                    Instagram
                  </dt>
                  <dd className="mt-1 break-all">
                    {detailCandidate.instagram_url?.trim() ? (
                      <a
                        href={detailCandidate.instagram_url.trim()}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#3b82f6] hover:underline"
                      >
                        {detailCandidate.instagram_url.trim()}
                      </a>
                    ) : (
                      <span className="text-[#6e6e73]">—</span>
                    )}
                  </dd>
                </div>
                <DetailField
                  label="AI score"
                  value={
                    detailCandidate.ai_eligibility_score == null
                      ? null
                      : String(detailCandidate.ai_eligibility_score)
                  }
                />
                <DetailField
                  label="AI reason"
                  value={detailCandidate.ai_eligibility_reason}
                  className="sm:col-span-2"
                />
              </dl>
            </div>

            <div className="grid grid-cols-1 gap-3 border-t border-[#f5f5f5] px-6 py-4 sm:grid-cols-2">
              <button
                type="button"
                disabled={busyId === detailCandidate.id}
                title="Mark eligible for a testimonial interview"
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#bbf7d0] bg-[#f0fdf4] px-4 py-2.5 text-sm font-medium text-[#16a34a] transition-colors hover:bg-[#dcfce7] disabled:opacity-50"
                onClick={() =>
                  void markEligible(detailCandidate, "testimonial")
                }
              >
                <Check className="h-4 w-4 shrink-0" strokeWidth={2.5} />
                Testimonial
              </button>
              <button
                type="button"
                disabled={busyId === detailCandidate.id}
                title="Mark eligible for a project interview"
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#bfdbfe] bg-[#eff6ff] px-4 py-2.5 text-sm font-medium text-[#2563eb] transition-colors hover:bg-[#dbeafe] disabled:opacity-50"
                onClick={() => void markEligible(detailCandidate, "project")}
              >
                <Check className="h-4 w-4 shrink-0" strokeWidth={2.5} />
                Project
              </button>
              <button
                type="button"
                disabled={busyId === detailCandidate.id}
                title="Mark Not Eligible"
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#fecaca] bg-[#fef2f2] px-4 py-2.5 text-sm font-medium text-[#dc2626] transition-colors hover:bg-[#fee2e2] disabled:opacity-50 sm:col-span-2"
                onClick={() => void markNotEligible(detailCandidate)}
              >
                <X className="h-4 w-4 shrink-0" strokeWidth={2.5} />
                Mark Not Eligible
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

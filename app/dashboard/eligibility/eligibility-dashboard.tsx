"use client";

import { endOfDay, parseISO, startOfDay } from "date-fns";
import { Check, Loader2, RefreshCw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAccessControl } from "@/components/access-control-context";
import {
  formatAchievementSummary,
  truncateText,
} from "@/lib/candidate-summary";
import {
  defaultIstWeeklyDateInput,
  formatDashboardPeriodRangeIST,
  resolveDashboardStatsBounds,
  type DashboardPeriod,
} from "@/lib/dashboard-ist-dates";
import { logActivity } from "@/lib/activity-logger";
import { ensureGwcTestingForCandidate } from "@/lib/gwc-testing-actions";
import { displayNameFromUser, getUserSafe } from "@/lib/supabase-auth";
import { createBrowserSupabaseClient } from "@/lib/supabase-browser";

type EligibilityStatus = "pending_review" | "eligible" | "not_eligible";

export type InterviewTrack = "testimonial" | "project" | "gwc";

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
  total: number;
  pending: number;
  eligible: number;
  notEligible: number;
};

const SELECT_COLUMNS =
  "id, created_at, form_filled_date, email, full_name, whatsapp_number, role_before_program, salary_before_program, primary_goal, achievement_type, achievement_title, achieved_on_date, program_joined_date, quantified_result, skills_modules_helped, how_program_helped, proof_document_url, proof_description, linkedin_url, instagram_url, declaration_accepted, ai_eligibility_score, ai_eligibility_reason, eligibility_status, human_reviewed_by, human_reviewed_at, congratulation_call_pending, interview_type";

const cardChrome =
  "rounded-2xl bg-elevated shadow-card border border-border-subtle";

function scorePillClass(score: number | null): string {
  if (score === null) return "bg-background/80 text-muted";
  if (score < 45) return "bg-[#fef2f2] text-[#dc2626]";
  if (score < 75) return "bg-background/80 text-muted";
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
      return "bg-background/80 text-muted";
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

function periodLabel(period: DashboardPeriod): string {
  if (period === "total") return "Overall";
  if (period === "monthly") return "Monthly";
  return "Weekly";
}

function hasCustomDateRange(dateFrom: string, dateTo: string): boolean {
  return Boolean(dateFrom || dateTo);
}

/** Partial match on email (case-insensitive) or phone digits (ignores spaces, +, dashes). */
function matchesEmailOrPhoneSearch(
  email: string | null | undefined,
  whatsapp: string | null | undefined,
  rawQuery: string,
): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  const em = (email ?? "").toLowerCase();
  if (em.includes(q)) return true;
  const phoneDigits = (whatsapp ?? "").replace(/\D/g, "");
  const qDigits = q.replace(/\D/g, "");
  if (qDigits.length > 0 && phoneDigits.includes(qDigits)) return true;
  return false;
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
  if (t === "gwc") {
    return (
      <span className="inline-flex rounded-full bg-[#faf5ff] px-3 py-1 text-xs font-medium text-[#7c3aed]">
        GWC
      </span>
    );
  }
  return <span className="text-muted">—</span>;
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
      <dt className="text-xs font-medium uppercase tracking-widest text-muted/80">
        {label}
      </dt>
      <dd className="mt-1 whitespace-pre-wrap break-words text-foreground">
        {display ?? <span className="text-muted">—</span>}
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
  const [contactSearch, setContactSearch] = useState("");
  const [period, setPeriod] = useState<DashboardPeriod>("total");
  const [weeklyDateInput, setWeeklyDateInput] = useState(
    defaultIstWeeklyDateInput,
  );

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
      .eq("is_deleted", false)
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
    const customRangeActive = hasCustomDateRange(dateFrom, dateTo);
    const bounds = customRangeActive
      ? null
      : resolveDashboardStatsBounds(period, weeklyDateInput, "");
    const rangeStart = customRangeActive
      ? dateFrom
        ? startOfDay(parseISO(dateFrom)).toISOString()
        : null
      : (bounds?.startIso ?? null);
    const rangeEnd = customRangeActive
      ? dateTo
        ? endOfDay(parseISO(dateTo)).toISOString()
        : null
      : (bounds?.endIso ?? null);

    const buildCountQuery = (status?: EligibilityStatus) => {
      let q = supabase
        .from("candidates")
        .select("id", { count: "exact", head: true })
        .eq("is_deleted", false);
      if (status) q = q.eq("eligibility_status", status);
      if (rangeStart) q = q.gte("created_at", rangeStart);
      if (rangeEnd) q = q.lt("created_at", rangeEnd);
      return q;
    };

    const [totalRes, pendingRes, eligibleRes, notRes] = await Promise.all([
      buildCountQuery(),
      buildCountQuery("pending_review"),
      buildCountQuery("eligible"),
      buildCountQuery("not_eligible"),
    ]);

    setStats({
      total: totalRes.count ?? 0,
      pending: pendingRes.count ?? 0,
      eligible: eligibleRes.count ?? 0,
      notEligible: notRes.count ?? 0,
    });
  }, [supabase, period, weeklyDateInput, dateFrom, dateTo]);

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
      if (!matchesEmailOrPhoneSearch(r.email, r.whatsapp_number, contactSearch)) {
        return false;
      }
      return true;
    });
  }, [rows, statusFilter, industryFilter, dateFrom, dateTo, contactSearch]);

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
      .eq("id", r.id)
      .eq("is_deleted", false);
    setBusyId(null);
    if (uErr) {
      setError(uErr.message);
      return;
    }
    const actor = await getUserSafe(supabase);
    if (actor) {
      const display = r.full_name?.trim() || r.email || "Candidate";
      const trackLabel =
        interviewType === "testimonial"
          ? "Testimonial"
          : interviewType === "project"
            ? "Project"
            : "GWC";
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

  const markGwc = async (r: CandidateRow) => {
    if (!canEditCurrentPage) return;
    if (!supabase) return;
    setBusyId(r.id);
    const { error: uErr } = await supabase
      .from("candidates")
      .update({
        eligibility_status: "eligible",
        congratulation_call_pending: true,
        interview_type: "gwc",
      })
      .eq("id", r.id)
      .eq("is_deleted", false);
    if (uErr) {
      setBusyId(null);
      setError(uErr.message);
      return;
    }
    const { error: gwcErr } = await ensureGwcTestingForCandidate(supabase, r.id);
    setBusyId(null);
    if (gwcErr) {
      setError(gwcErr);
      return;
    }
    const actor = await getUserSafe(supabase);
    if (actor) {
      const display = r.full_name?.trim() || r.email || "Candidate";
      await logActivity({
        supabase,
        user: actor,
        action_type: "eligibility",
        entity_type: "candidate",
        entity_id: r.id,
        candidate_name: display,
        description: `Marked ${display} as Eligible (GWC Testing)`,
      });
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
      `Are you sure you want to delete ${displayName}? They will be removed from active views; restore anytime from Settings → Deleted Entries.`,
    );
    if (!ok) return;
    setBusyId(r.id);
    const actor = await getUserSafe(supabase);
    const deletedBy = actor ? displayNameFromUser(actor) : "Unknown";
    const { error: dErr } = await supabase
      .from("candidates")
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: deletedBy,
      })
      .eq("id", r.id)
      .eq("is_deleted", false);
    setBusyId(null);
    if (dErr) {
      setError(dErr.message);
      return;
    }
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
      .eq("id", r.id)
      .eq("is_deleted", false);
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
      .in("id", ids)
      .eq("is_deleted", false);
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
      .in("id", ids)
      .eq("is_deleted", false);
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
        upserted?: number;
        scored?: number;
        failed?: number;
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
      const upserted = j.upserted ?? inserted + updated;
      const scored = j.scored ?? 0;
      const failedAi = j.failed ?? 0;
      alert(
        `Synced ${inserted} new, ${updated} updated (${upserted} upserted), ${skippedEmail} rows without email (from ${j.total_rows ?? 0} sheet rows). AI scored: ${scored}, failed: ${failedAi}.`,
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
      <div className="mx-auto max-w-4xl px-8 py-16 text-center text-sm text-muted">
        <p>{error ?? "Cannot initialize Supabase client."}</p>
      </div>
    );
  }

  const allFilteredSelected =
    filteredRows.length > 0 &&
    filteredRows.every((r) => selected.has(r.id));

  const customRangeActive = hasCustomDateRange(dateFrom, dateTo);

  const periodRangeLabel = useMemo(() => {
    if (customRangeActive) {
      if (dateFrom && dateTo) return `Range: ${dateFrom} to ${dateTo}`;
      if (dateFrom) return `Range: from ${dateFrom}`;
      if (dateTo) return `Range: until ${dateTo}`;
      return null;
    }
    const bounds = resolveDashboardStatsBounds(period, weeklyDateInput, "");
    return formatDashboardPeriodRangeIST(period, bounds);
  }, [period, weeklyDateInput, customRangeActive, dateFrom, dateTo]);

  return (
    <>
      <header className="sticky top-14 z-30 bg-background/90 px-4 py-4 backdrop-blur-md sm:px-6 sm:py-5 lg:top-0 lg:px-8 lg:py-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              Eligibility review
            </h1>
            <p className="mt-1 text-sm text-muted">
              Review and update candidate eligibility
            </p>
            {showViewOnlyBadge ? (
              <span className="mt-2 inline-flex rounded-full bg-border/40 px-3 py-1 text-xs font-medium text-muted">
                View only
              </span>
            ) : null}
          </div>
          <button
            type="button"
            disabled={!canEditCurrentPage || sheetSyncBusy || !supabase}
            onClick={() => void syncSheet()}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-border bg-elevated px-4 py-2 text-sm font-medium text-foreground transition-all hover:bg-background disabled:opacity-50"
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

      <main className="mx-auto max-w-7xl px-4 pb-10 pt-2 text-sm text-foreground sm:px-6 lg:px-8 lg:pb-12">
        {error && (
          <div
            className="mb-6 rounded-2xl border border-border-subtle bg-elevated px-4 py-3 text-sm text-foreground shadow-card"
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

        <section className="mb-4 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="inline-flex rounded-full bg-elevated p-1 shadow-segment">
            {(["total", "weekly"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`rounded-full px-4 py-1.5 text-sm transition-all duration-200 ease-in-out ${
                  period === p
                    ? "bg-foreground font-medium text-background"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {periodLabel(p)}
              </button>
            ))}
          </div>
          {period === "weekly" ? (
            <label className="flex min-w-[220px] flex-col gap-1">
              <span className="text-xs uppercase tracking-widest text-muted/80">
                Select week
              </span>
              <input
                type="date"
                value={weeklyDateInput}
                onChange={(e) => setWeeklyDateInput(e.target.value)}
                className="rounded-xl border border-border bg-elevated px-3 py-2 text-sm text-foreground focus:border-[#3b82f6] focus:outline-none focus:ring-0"
              />
            </label>
          ) : null}
        </section>

        {periodRangeLabel ? (
          <p className="mb-4 text-sm text-muted">{periodRangeLabel}</p>
        ) : null}

        <section className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          {[
            {
              label: customRangeActive
                ? "New in range"
                : period === "weekly"
                  ? "New this week"
                  : "Total candidates",
              value: stats?.total ?? "—",
              sub:
                customRangeActive
                  ? "Created in selected date range"
                  : period === "weekly"
                  ? "Created Saturday to Friday"
                  : "All-time entries",
            },
            {
              label: "Pending review",
              value: stats?.pending ?? "—",
              sub:
                customRangeActive
                  ? "Awaiting decision in range"
                  : period === "weekly"
                  ? "Awaiting decision this week"
                  : "Awaiting decision overall",
            },
            {
              label: "Eligible",
              value: stats?.eligible ?? "—",
              sub: customRangeActive
                ? "Approved in range"
                : period === "weekly"
                  ? "Approved this week"
                  : "Approved overall",
            },
            {
              label: "Not eligible",
              value: stats?.notEligible ?? "—",
              sub: customRangeActive
                ? "Declined in range"
                : period === "weekly"
                  ? "Declined this week"
                  : "Declined overall",
            },
          ].map((card) => (
            <div key={card.label} className={`p-4 sm:p-6 ${cardChrome}`}>
              <p className="mb-2 text-xs font-medium text-muted sm:mb-3">
                {card.label}
              </p>
              <p className="text-2xl font-bold tabular-nums tracking-tight text-foreground sm:text-4xl">
                {loading ? "…" : card.value}
              </p>
              <p className="mt-1 text-sm text-muted">{card.sub}</p>
              <div className="mt-4 h-0.5 w-8 rounded-full bg-[#3b82f6]" />
            </div>
          ))}
        </section>

        <section className="mb-6 flex flex-col gap-4 rounded-2xl border border-border-subtle bg-elevated p-4 shadow-sm md:flex-row md:flex-wrap md:items-end">
          <label className="flex w-full min-w-0 flex-col gap-1 text-sm md:w-auto md:min-w-[140px]">
            <span className="text-xs uppercase tracking-widest text-muted/80">
              Status
            </span>
            <select
              className="rounded-xl border border-border bg-elevated px-3 py-2 text-sm text-foreground focus:border-[#3b82f6] focus:outline-none focus:ring-0"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All</option>
              <option value="pending_review">Pending review</option>
              <option value="eligible">Eligible</option>
              <option value="not_eligible">Not eligible</option>
            </select>
          </label>
          <label className="flex w-full min-w-0 flex-col gap-1 text-sm md:w-auto md:min-w-[160px]">
            <span className="text-xs uppercase tracking-widest text-muted/80">
              Industry / role
            </span>
            <select
              className="rounded-xl border border-border bg-elevated px-3 py-2 text-sm text-foreground focus:border-[#3b82f6] focus:outline-none focus:ring-0"
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
          <label className="flex w-full min-w-0 flex-col gap-1 text-sm md:w-auto">
            <span className="text-xs uppercase tracking-widest text-muted/80">
              From
            </span>
            <input
              type="date"
              className="rounded-xl border border-border px-3 py-2 text-sm text-foreground focus:border-[#3b82f6] focus:outline-none focus:ring-0"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <label className="flex w-full min-w-0 flex-col gap-1 text-sm md:w-auto">
            <span className="text-xs uppercase tracking-widest text-muted/80">
              To
            </span>
            <input
              type="date"
              className="rounded-xl border border-border px-3 py-2 text-sm text-foreground focus:border-[#3b82f6] focus:outline-none focus:ring-0"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
          <label className="flex w-full min-w-0 flex-col gap-1 text-sm md:min-w-[220px] md:flex-1">
            <span className="text-xs uppercase tracking-widest text-muted/80">
              Email or phone
            </span>
            <input
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              placeholder="Search by email or number…"
              className="w-full rounded-xl border border-border px-3 py-2 text-sm text-foreground placeholder:text-muted/80 focus:border-[#3b82f6] focus:outline-none focus:ring-0"
              value={contactSearch}
              onChange={(e) => setContactSearch(e.target.value)}
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
              setContactSearch("");
            }}
          >
            Clear filters
          </button>
        </section>

        {selected.size > 0 && (
          <div
            className={`mb-6 flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between ${cardChrome}`}
          >
            <p className="text-sm font-medium text-foreground">
              {selected.size} selected
            </p>
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
              <button
                type="button"
                disabled={bulkBusy}
                className="w-full rounded-xl bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-all hover:opacity-90 disabled:opacity-50 sm:w-auto"
                onClick={() => void bulkMarkEligible()}
              >
                Bulk mark eligible
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                className="w-full rounded-xl border border-border-subtle bg-elevated px-4 py-2.5 text-sm font-medium text-[#ef4444] transition-all hover:bg-background/80 disabled:opacity-50 sm:w-auto"
                onClick={() => void bulkMarkNotEligible()}
              >
                Bulk mark not eligible
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                className="w-full py-2 text-center text-sm font-medium text-[#3b82f6] transition-all hover:text-[#2563eb] disabled:opacity-50 sm:w-auto sm:py-0 sm:text-left"
                onClick={() => void bulkRunAi()}
              >
                Bulk run AI assessment
              </button>
            </div>
          </div>
        )}

        <div className={`overflow-hidden ${cardChrome}`}>
          <div className="w-full min-w-0 max-w-full overflow-x-auto">
            <table className="min-w-[920px] text-left text-sm">
              <thead>
                <tr className="border-b border-[#f5f5f5]">
                  <th className="w-10 px-3 py-3">
                    <input
                      type="checkbox"
                      className="rounded border-border text-foreground focus:ring-[#3b82f6]"
                      checked={allFilteredSelected}
                      onChange={toggleSelectAllFiltered}
                      aria-label="Select all visible"
                    />
                  </th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-widest text-muted/80">
                    Name
                  </th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-widest text-muted/80">
                    Email
                  </th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-widest text-muted/80">
                    Industry
                  </th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-widest text-muted/80">
                    Achievement
                  </th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-widest text-muted/80">
                    AI score
                  </th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-widest text-muted/80">
                    AI reason
                  </th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-widest text-muted/80">
                    Status
                  </th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-widest text-muted/80">
                    Interview type
                  </th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-widest text-muted/80">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td
                      colSpan={10}
                      className="px-4 py-12 text-center text-sm text-muted"
                    >
                      Loading candidates…
                    </td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={10}
                      className="px-4 py-12 text-center text-sm text-muted"
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
                        className="border-b border-[#f5f5f5] last:border-b-0 hover:bg-background/80"
                      >
                        <td className="px-3 py-3 align-top">
                          <input
                            type="checkbox"
                            className="rounded border-border text-foreground focus:ring-[#3b82f6]"
                            checked={selected.has(r.id)}
                            onChange={() => toggleSelect(r.id)}
                            aria-label={`Select ${r.full_name ?? r.email}`}
                          />
                        </td>
                        <td className="max-w-[140px] truncate px-3 py-3 font-medium text-foreground">
                          {r.full_name ?? "—"}
                        </td>
                        <td className="max-w-[180px] truncate px-3 py-3 text-muted">
                          {r.email}
                        </td>
                        <td className="max-w-[120px] truncate px-3 py-3 text-muted">
                          {r.role_before_program ?? "—"}
                        </td>
                        <td
                          className="max-w-[200px] truncate px-3 py-3 text-muted"
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
                        <td className="max-w-[160px] px-3 py-3 text-muted">
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
                              <button
                                type="button"
                                disabled={busyId === r.id}
                                title="Mark eligible for GWC Testing workflow"
                                aria-label="Mark eligible as GWC"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#e9d5ff] bg-[#faf5ff] text-xs font-bold text-[#7c3aed] transition-colors hover:bg-[#f3e8ff] disabled:opacity-50"
                                onClick={() => void markGwc(r)}
                              >
                                G
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
                              className="whitespace-nowrap text-sm font-medium text-muted transition-all hover:text-foreground"
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
          <p className="border-t border-[#f5f5f5] px-4 py-3 text-xs text-muted/80">
            Showing {filteredRows.length} of {rows.length} loaded · Realtime
            updates enabled
          </p>
        </div>
      </main>

      {detailCandidate && (
        <div className="fixed inset-0 z-50 flex min-h-0 items-center justify-center p-0 sm:p-4">
          <button
            type="button"
            className="absolute inset-0 bg-foreground/60 backdrop-blur-sm"
            aria-label="Close details"
            onClick={() => setDetailCandidate(null)}
          />
          <div
            className="relative mx-4 flex max-h-[min(90vh,100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-elevated shadow-xl sm:mx-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="candidate-detail-title"
          >
            <div className="flex items-start justify-between border-b border-[#f5f5f5] px-6 py-4">
              <h2
                id="candidate-detail-title"
                className="pr-8 text-xl font-semibold text-foreground"
              >
                {detailCandidate.full_name ?? "Candidate"}
              </h2>
              <button
                type="button"
                className="shrink-0 rounded-lg p-2 text-muted/80 transition-all hover:bg-background hover:text-foreground"
                aria-label="Close"
                onClick={() => setDetailCandidate(null)}
              >
                <X className="h-5 w-5" strokeWidth={2} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 text-sm text-foreground">
              <dl className="grid gap-5 sm:grid-cols-2">
                <DetailField
                  label="Name"
                  value={detailCandidate.full_name}
                  className="sm:col-span-2"
                />
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-widest text-muted/80">
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
                  <dt className="text-xs font-medium uppercase tracking-widest text-muted/80">
                    Proof
                  </dt>
                  <dd className="mt-2 space-y-2">
                    {detailCandidate.proof_document_url?.trim() ? (
                      <a
                        href={detailCandidate.proof_document_url.trim()}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:opacity-90"
                      >
                        View Proof
                      </a>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                    {detailCandidate.proof_description?.trim() ? (
                      <p className="whitespace-pre-wrap text-muted">
                        {detailCandidate.proof_description}
                      </p>
                    ) : null}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-widest text-muted/80">
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
                      <span className="text-muted">—</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-widest text-muted/80">
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
                      <span className="text-muted">—</span>
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
                title="Mark eligible for GWC Testing workflow"
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#e9d5ff] bg-[#faf5ff] px-4 py-2.5 text-sm font-medium text-[#7c3aed] transition-colors hover:bg-[#f3e8ff] disabled:opacity-50 sm:col-span-2"
                onClick={() => void markGwc(detailCandidate)}
              >
                <Check className="h-4 w-4 shrink-0" strokeWidth={2.5} />
                GWC Testing
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

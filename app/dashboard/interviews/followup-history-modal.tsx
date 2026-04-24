"use client";

import { format, parseISO } from "date-fns";
import { useCallback, useEffect, useState } from "react";

import type { SupabaseClient } from "@supabase/supabase-js";

import { followupOutcomeDisplayLabel } from "@/lib/followup-outcome-display";
import { modalOverlayClass, modalPanel3xlClass } from "@/lib/modal-responsive";

import type { FollowupLogRow } from "./types";

type Props = {
  open: boolean;
  candidateId: string | null;
  candidateLabel: string;
  supabase: SupabaseClient;
  onClose: () => void;
};

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "MMM d, yyyy h:mm a");
  } catch {
    return "—";
  }
}

function statusDisplay(status: string): string {
  if (status === "callback") return "Callback requested";
  return followupOutcomeDisplayLabel(status);
}

export function FollowupHistoryModal({
  open,
  candidateId,
  candidateLabel,
  supabase,
  onClose,
}: Props) {
  const [rows, setRows] = useState<FollowupLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!candidateId) return;
    setLoading(true);
    setError(null);
    const { data, error: qErr } = await supabase
      .from("followup_log")
      .select(
        "id, created_at, candidate_id, attempt_number, status, notes, callback_datetime, logged_by, logged_by_email",
      )
      .eq("candidate_id", candidateId)
      .order("created_at", { ascending: true });
    if (qErr) {
      setError(qErr.message);
      setRows([]);
    } else {
      setRows((data ?? []) as FollowupLogRow[]);
    }
    setLoading(false);
  }, [supabase, candidateId]);

  useEffect(() => {
    if (!open || !candidateId) return;
    void load();
  }, [open, candidateId, load]);

  if (!open || !candidateId) return null;

  const th = "border-b border-gray-200 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[#6e6e73]";
  const td = "border-b border-gray-100 px-3 py-2 text-sm text-[#1d1d1f] align-top";

  return (
    <div className={modalOverlayClass}>
      <button
        type="button"
        className="absolute inset-0"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        className={`${modalPanel3xlClass} shadow-[0_4px_16px_rgba(0,0,0,0.08)]`}
      >
        <div className="flex items-start justify-between border-b border-[#f0f0f0] p-5">
          <div>
            <h2 className="text-lg font-semibold text-[#1d1d1f]">
              Follow-up history
            </h2>
            <p className="text-sm text-[#6e6e73]">{candidateLabel}</p>
          </div>
          <button
            type="button"
            className="rounded-xl p-2 text-[#aeaeb2] transition-all hover:bg-[#f5f5f7] hover:text-[#1d1d1f]"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="max-h-[calc(85vh-5rem)] overflow-auto p-4">
          {loading ? (
            <p className="text-sm text-[#6e6e73]">Loading…</p>
          ) : error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-[#6e6e73]">No calls logged yet.</p>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse">
              <thead>
                <tr>
                  <th className={th}>Attempt #</th>
                  <th className={th}>Date</th>
                  <th className={th}>Status</th>
                  <th className={th}>Notes</th>
                  <th className={th}>Logged by</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className={td}>{r.attempt_number}</td>
                    <td className={td}>{formatWhen(r.created_at)}</td>
                    <td className={td}>
                      {statusDisplay(r.status)}
                      {r.callback_datetime ? (
                        <span className="mt-0.5 block text-xs text-[#6e6e73]">
                          CB: {formatWhen(r.callback_datetime)}
                        </span>
                      ) : null}
                    </td>
                    <td className={`${td} max-w-[200px] whitespace-pre-wrap`}>
                      {r.notes?.trim() || "—"}
                    </td>
                    <td className={td}>
                      {r.logged_by?.trim() || "—"}
                      {r.logged_by_email ? (
                        <span className="mt-0.5 block text-xs text-[#6e6e73]">
                          {r.logged_by_email}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { format } from "date-fns";
import { Star } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getUserSafe } from "@/lib/supabase-auth";

import { rangeForPreset, type TeamReportPeriodPreset } from "./team-report-period";

export type RatingScores = {
  consistency: number | null;
  activeness: number | null;
  reminders: number | null;
  notes: string;
};

type RatingRow = RatingScores & {
  member_name: string;
};

function periodDates(preset: TeamReportPeriodPreset): { start: string; end: string } | null {
  const { start, end } = rangeForPreset(preset);
  if (!start) return null;
  return {
    start: format(start, "yyyy-MM-dd"),
    end: format(end, "yyyy-MM-dd"),
  };
}

function averageScore(scores: RatingScores): number | null {
  const nums = [scores.consistency, scores.activeness, scores.reminders].filter(
    (n): n is number => n != null,
  );
  if (nums.length === 0) return null;
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  return Math.round(avg * 10) / 10;
}

function mergeUniqueNames(...lists: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const raw of list) {
      const name = raw.trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function StarRatingInput({
  value,
  onChange,
  disabled,
  label,
}: {
  value: number | null;
  onChange: (value: number) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div className="inline-flex items-center justify-end gap-0.5" role="group" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = value != null && n <= value;
        return (
          <button
            key={n}
            type="button"
            disabled={disabled}
            onClick={() => onChange(n)}
            className={`rounded p-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              filled ? "text-amber-500 hover:text-amber-600" : "text-gray-300 hover:text-amber-400"
            }`}
            aria-label={`${label}: ${n} of 5`}
            aria-pressed={value === n}
          >
            <Star className="h-5 w-5" fill={filled ? "currentColor" : "none"} strokeWidth={1.5} />
          </button>
        );
      })}
    </div>
  );
}

function OverallBadge({ value }: { value: number | null }) {
  if (value == null) {
    return <span className="text-sm text-gray-400">—</span>;
  }
  return (
    <span className="inline-flex min-w-[2.5rem] items-center justify-center rounded-full bg-amber-50 px-2.5 py-1 text-sm font-semibold tabular-nums text-amber-800 ring-1 ring-amber-200/80">
      {value}
    </span>
  );
}

const th =
  "bg-gray-50 px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 first:rounded-tl-xl last:rounded-tr-xl";
const td = "px-3 py-3 text-sm text-gray-900 align-middle";

export type TeamReportRatingsTabProps = {
  supabase: SupabaseClient;
  period: TeamReportPeriodPreset;
  canEdit: boolean;
  metricMemberNames: string[];
};

export function TeamReportRatingsTab({
  supabase,
  period,
  canEdit,
  metricMemberNames,
}: TeamReportRatingsTabProps) {
  const bounds = periodDates(period);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rosterNames, setRosterNames] = useState<string[]>([]);
  const [ratings, setRatings] = useState<Map<string, RatingScores>>(new Map());

  const memberNames = useMemo(
    () => mergeUniqueNames(rosterNames, metricMemberNames),
    [rosterNames, metricMemberNames],
  );

  const load = useCallback(async () => {
    if (!bounds) {
      setLoading(false);
      setRatings(new Map());
      return;
    }

    setLoading(true);
    setError(null);

    const rosterRes = await supabase
      .from("team_roster")
      .select("name")
      .eq("is_active", true)
      .order("display_order", { ascending: true });
    if (rosterRes.error) {
      setError(rosterRes.error.message);
      setLoading(false);
      return;
    }
    const names = (rosterRes.data ?? [])
      .map((r) => (r as { name: string | null }).name?.trim() ?? "")
      .filter(Boolean);
    setRosterNames(names);

    const ratingsRes = await supabase
      .from("team_member_ratings")
      .select("member_name, consistency, activeness, reminders, notes")
      .eq("period_start", bounds.start)
      .eq("period_end", bounds.end);
    if (ratingsRes.error) {
      setError(ratingsRes.error.message);
      setLoading(false);
      return;
    }

    const map = new Map<string, RatingScores>();
    for (const row of ratingsRes.data ?? []) {
      const r = row as {
        member_name: string;
        consistency: number | null;
        activeness: number | null;
        reminders: number | null;
        notes: string | null;
      };
      const name = r.member_name?.trim();
      if (!name) continue;
      map.set(name, {
        consistency: r.consistency,
        activeness: r.activeness,
        reminders: r.reminders,
        notes: r.notes?.trim() ?? "",
      });
    }
    setRatings(map);
    setLoading(false);
  }, [supabase, bounds?.start, bounds?.end]);

  useEffect(() => {
    void load();
  }, [load]);

  const persist = useCallback(
    async (memberName: string, next: RatingScores) => {
      if (!bounds || !canEdit) return;

      setSavingKey(memberName);
      setError(null);

      const user = await getUserSafe(supabase);
      const payload = {
        period_start: bounds.start,
        period_end: bounds.end,
        member_name: memberName,
        consistency: next.consistency,
        activeness: next.activeness,
        reminders: next.reminders,
        notes: next.notes.trim() || null,
        rated_by: user?.id ?? null,
        updated_at: new Date().toISOString(),
      };

      const { error: upsertError } = await supabase
        .from("team_member_ratings")
        .upsert(payload, { onConflict: "period_start,period_end,member_name" });

      setSavingKey(null);
      if (upsertError) {
        setError(upsertError.message);
        return;
      }
    },
    [supabase, bounds, canEdit],
  );

  const updateField = useCallback(
    (memberName: string, patch: Partial<RatingScores>) => {
      setRatings((prev) => {
        const current = prev.get(memberName) ?? {
          consistency: null,
          activeness: null,
          reminders: null,
          notes: "",
        };
        const next = { ...current, ...patch };
        const map = new Map(prev);
        map.set(memberName, next);
        void persist(memberName, next);
        return map;
      });
    },
    [persist],
  );

  if (!bounds) {
    return (
      <p className="text-sm text-gray-500">
        Choose a specific date range (not All time) to record monthly performance ratings.
      </p>
    );
  }

  if (loading) {
    return <p className="text-sm text-gray-500">Loading ratings…</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-gray-600">
          Rate each teammate from 1–5 for this period. Overall is the average of consistency,
          activeness, and follow-up reminders.
        </p>
        {!canEdit ? (
          <p className="mt-2 text-sm text-amber-800">
            View only — only admins can edit ratings.
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {memberNames.length === 0 ? (
        <p className="text-sm text-gray-500">No team members to rate for this period.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
          <table className="min-w-[720px] border-collapse text-left">
            <thead>
              <tr>
                <th className={th}>Name</th>
                <th className={`${th} text-right`}>Consistency</th>
                <th className={`${th} text-right`}>Activeness</th>
                <th className={`${th} text-right`}>Reminders</th>
                <th className={`${th} text-center`}>Overall</th>
                <th className={th}>Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {memberNames.map((name) => {
                const row: RatingRow = {
                  member_name: name,
                  ...(ratings.get(name) ?? {
                    consistency: null,
                    activeness: null,
                    reminders: null,
                    notes: "",
                  }),
                };
                const overall = averageScore(row);
                const busy = savingKey === name;

                return (
                  <tr key={name} className="hover:bg-gray-50/80">
                    <td className={`${td} font-medium`}>
                      {name}
                      {busy ? (
                        <span className="ml-2 text-xs font-normal text-gray-400">Saving…</span>
                      ) : null}
                    </td>
                    <td className={`${td} text-right`}>
                      <StarRatingInput
                        label={`${name} consistency`}
                        value={row.consistency}
                        disabled={!canEdit}
                        onChange={(v) => updateField(name, { consistency: v })}
                      />
                    </td>
                    <td className={`${td} text-right`}>
                      <StarRatingInput
                        label={`${name} activeness`}
                        value={row.activeness}
                        disabled={!canEdit}
                        onChange={(v) => updateField(name, { activeness: v })}
                      />
                    </td>
                    <td className={`${td} text-right`}>
                      <StarRatingInput
                        label={`${name} reminders`}
                        value={row.reminders}
                        disabled={!canEdit}
                        onChange={(v) => updateField(name, { reminders: v })}
                      />
                    </td>
                    <td className={`${td} text-center`}>
                      <OverallBadge value={overall} />
                    </td>
                    <td className={td}>
                      <input
                        type="text"
                        value={row.notes}
                        disabled={!canEdit}
                        placeholder="Optional"
                        onChange={(e) => {
                          const notes = e.target.value;
                          setRatings((prev) => {
                            const map = new Map(prev);
                            const current = map.get(name) ?? {
                              consistency: null,
                              activeness: null,
                              reminders: null,
                              notes: "",
                            };
                            map.set(name, { ...current, notes });
                            return map;
                          });
                        }}
                        onBlur={(e) => {
                          const notes = e.target.value;
                          const current = ratings.get(name) ?? {
                            consistency: null,
                            activeness: null,
                            reminders: null,
                            notes: "",
                          };
                          void persist(name, { ...current, notes });
                        }}
                        className="w-full min-w-[8rem] rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#1d4ed8] focus:outline-none focus:ring-1 focus:ring-[#1d4ed8] disabled:bg-gray-50"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

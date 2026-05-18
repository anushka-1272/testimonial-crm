"use client";

import { format } from "date-fns";
import { Star } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  fetchTeamMemberRatings,
  upsertTeamMemberRating,
  type RatingScores,
} from "@/lib/team-member-ratings-db";
import { getUserSafe } from "@/lib/supabase-auth";

import { rangeForPreset, type TeamReportPeriodPreset } from "./team-report-period";

const RATING_ROLES = ["poc", "interviewer"] as const;

export type { RatingScores };

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
  const nums = [scores.callings, scores.interviews, scores.reminder].filter(
    (n): n is number => n != null,
  );
  if (nums.length === 0) return null;
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  return Math.round(avg * 10) / 10;
}

function dedupeNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
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

const emptyScores = (): RatingScores => ({
  callings: null,
  interviews: null,
  reminder: null,
});

export type TeamReportRatingsTabProps = {
  supabase: SupabaseClient;
  period: TeamReportPeriodPreset;
  canEdit: boolean;
};

export function TeamReportRatingsTab({
  supabase,
  period,
  canEdit,
}: TeamReportRatingsTabProps) {
  const bounds = periodDates(period);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [memberNames, setMemberNames] = useState<string[]>([]);
  const [ratings, setRatings] = useState<Map<string, RatingScores>>(new Map());
  const [ratingsSchema, setRatingsSchema] = useState<"new" | "legacy">("new");

  const load = useCallback(async () => {
    if (!bounds) {
      setLoading(false);
      setRatings(new Map());
      setMemberNames([]);
      return;
    }

    setLoading(true);
    setError(null);

    const rosterRes = await supabase
      .from("team_roster")
      .select("name")
      .eq("is_active", true)
      .in("role_type", [...RATING_ROLES])
      .order("display_order", { ascending: true });
    if (rosterRes.error) {
      setError(rosterRes.error.message);
      setLoading(false);
      return;
    }
    const names = dedupeNames(
      (rosterRes.data ?? []).map((r) => (r as { name: string | null }).name?.trim() ?? ""),
    );
    setMemberNames(names);

    const ratingsRes = await fetchTeamMemberRatings(supabase, bounds.start, bounds.end);
    if (ratingsRes.error) {
      setError(ratingsRes.error);
      setLoading(false);
      return;
    }

    setRatingsSchema(ratingsRes.schema);
    const allowed = new Set(names);
    const map = new Map<string, RatingScores>();
    for (const [name, scores] of ratingsRes.rows) {
      if (!allowed.has(name)) continue;
      map.set(name, scores);
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
      const { error: upsertError, schema } = await upsertTeamMemberRating(supabase, {
        periodStart: bounds.start,
        periodEnd: bounds.end,
        memberName,
        scores: next,
        ratedBy: user?.id ?? null,
        schema: ratingsSchema,
      });

      setRatingsSchema(schema);
      setSavingKey(null);
      if (upsertError) {
        setError(upsertError);
        return;
      }
    },
    [supabase, bounds, canEdit, ratingsSchema],
  );

  const updateField = useCallback(
    (memberName: string, patch: Partial<RatingScores>) => {
      setRatings((prev) => {
        const current = prev.get(memberName) ?? emptyScores();
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
          Rate POCs and interviewers from 1–5 for this period. Overall is the average of callings,
          interviews, and reminder.
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
        <p className="text-sm text-gray-500">No POCs or interviewers on the active roster.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
          <table className="min-w-[560px] border-collapse text-left">
            <thead>
              <tr>
                <th className={th}>Name</th>
                <th className={`${th} text-right`}>Callings</th>
                <th className={`${th} text-right`}>Interviews</th>
                <th className={`${th} text-right`}>Reminder</th>
                <th className={`${th} text-center`}>Overall</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {memberNames.map((name) => {
                const row: RatingRow = {
                  member_name: name,
                  ...(ratings.get(name) ?? emptyScores()),
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
                        label={`${name} callings`}
                        value={row.callings}
                        disabled={!canEdit}
                        onChange={(v) => updateField(name, { callings: v })}
                      />
                    </td>
                    <td className={`${td} text-right`}>
                      <StarRatingInput
                        label={`${name} interviews`}
                        value={row.interviews}
                        disabled={!canEdit}
                        onChange={(v) => updateField(name, { interviews: v })}
                      />
                    </td>
                    <td className={`${td} text-right`}>
                      <StarRatingInput
                        label={`${name} reminder`}
                        value={row.reminder}
                        disabled={!canEdit}
                        onChange={(v) => updateField(name, { reminder: v })}
                      />
                    </td>
                    <td className={`${td} text-center`}>
                      <OverallBadge value={overall} />
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

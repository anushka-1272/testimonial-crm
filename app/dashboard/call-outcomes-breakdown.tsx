"use client";

import { useState } from "react";

const STATUS_ORDER = [
  "no_answer",
  "interested",
  "already_completed",
  "callback",
  "not_interested",
] as const;

const STATUS_LABELS: Record<(typeof STATUS_ORDER)[number], string> = {
  no_answer: "No answer",
  interested: "Interested",
  already_completed: "Already completed",
  callback: "Callback",
  not_interested: "Not interested",
};

/** Matches dashboard `followup_log` status breakdown rows */
export type CallOutcomesBreakdownMap = Record<
  (typeof STATUS_ORDER)[number],
  number
>;

export function emptyCallOutcomesBreakdown(): CallOutcomesBreakdownMap {
  return {
    no_answer: 0,
    interested: 0,
    already_completed: 0,
    callback: 0,
    not_interested: 0,
  };
}

function pct(part: number, total: number): string {
  if (total <= 0 || part <= 0) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

function otherCount(total: number, b: CallOutcomesBreakdownMap): number {
  const sum = STATUS_ORDER.reduce((s, k) => s + b[k], 0);
  return Math.max(0, total - sum);
}

type Tab = "testimonials" | "projects";

type Props = {
  loading: boolean;
  testimonialTotal: number;
  projectTotal: number;
  testimonialBreakdown: CallOutcomesBreakdownMap;
  projectBreakdown: CallOutcomesBreakdownMap;
};

export function CallOutcomesBreakdown({
  loading,
  testimonialTotal,
  projectTotal,
  testimonialBreakdown,
  projectBreakdown,
}: Props) {
  const [tab, setTab] = useState<Tab>("testimonials");

  const total = tab === "testimonials" ? testimonialTotal : projectTotal;
  const b = tab === "testimonials" ? testimonialBreakdown : projectBreakdown;
  const other = otherCount(total, b);

  return (
    <section
      className="rounded-2xl border border-[#f0f0f0] bg-white p-5 shadow-[0_4px_16px_rgba(0,0,0,0.08)] sm:p-6"
      aria-label="Call outcomes breakdown"
    >
      <h2 className="text-base font-semibold text-[#1d1d1f]">
        Call Outcomes Breakdown
      </h2>
      <p className="mt-1 text-sm text-[#6e6e73]">
        Logged follow-up attempts by outcome (same period as dashboard stats).
      </p>

      <div className="mt-4 flex gap-2 border-b border-[#e8e8ed] pb-1">
        <button
          type="button"
          onClick={() => setTab("testimonials")}
          className={
            tab === "testimonials"
              ? "rounded-full bg-[#1d1d1f] px-4 py-2 text-sm font-medium text-white"
              : "rounded-full px-4 py-2 text-sm font-medium text-[#6e6e73] transition-colors hover:text-[#1d1d1f]"
          }
        >
          Testimonials
        </button>
        <button
          type="button"
          onClick={() => setTab("projects")}
          className={
            tab === "projects"
              ? "rounded-full bg-[#1d1d1f] px-4 py-2 text-sm font-medium text-white"
              : "rounded-full px-4 py-2 text-sm font-medium text-[#6e6e73] transition-colors hover:text-[#1d1d1f]"
          }
        >
          Projects
        </button>
      </div>

      <div className="mt-4">
        {loading ? (
          <p className="text-sm text-[#6e6e73]">Loading…</p>
        ) : total <= 0 ? (
          <p className="text-sm text-[#6e6e73]">No calls logged in this period.</p>
        ) : (
          <ul className="divide-y divide-[#f0f0f0]">
            {STATUS_ORDER.map((key) => {
              const n = b[key];
              if (n <= 0) return null;
              return (
                <li
                  key={key}
                  className="flex items-center justify-between gap-4 py-2.5 text-sm"
                >
                  <span className="text-[#1d1d1f]">{STATUS_LABELS[key]}</span>
                  <span className="tabular-nums text-[#6e6e73]">
                    {n}{" "}
                    <span className="text-[#aeaeb2]">({pct(n, total)})</span>
                  </span>
                </li>
              );
            })}
            {other > 0 ? (
              <li className="flex items-center justify-between gap-4 py-2.5 text-sm">
                <span className="text-[#1d1d1f]">Other</span>
                <span className="tabular-nums text-[#6e6e73]">
                  {other}{" "}
                  <span className="text-[#aeaeb2]">({pct(other, total)})</span>
                </span>
              </li>
            ) : null}
            <li className="flex items-center justify-between gap-4 py-3 text-sm font-semibold text-[#1d1d1f]">
              <span>Total</span>
              <span className="tabular-nums">{total}</span>
            </li>
          </ul>
        )}
      </div>
    </section>
  );
}

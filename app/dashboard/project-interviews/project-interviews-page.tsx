"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAccessControl } from "@/components/access-control-context";
import { createBrowserSupabaseClient } from "@/lib/supabase-browser";

import { PostInterviewDrawer } from "../interviews/post-interview-drawer";
import { ProjectInterviewsPanel } from "../interviews/project-interviews-panel";
import { RescheduleInterviewModal } from "../interviews/reschedule-interview-modal";
import {
  ScheduleInterviewModal,
  type ScheduleProjectCandidate,
} from "../interviews/schedule-interview-modal";
import type { ProjectInterviewWithProjectCandidate } from "../interviews/types";

const cardChrome =
  "rounded-2xl bg-white shadow-[0_4px_16px_rgba(0,0,0,0.08)] border border-[#f0f0f0]";

type ProjectPipelineStats = {
  pending: number;
  scheduled: number;
  rescheduled: number;
  completed: number;
};

/** Matches `ProjectInterviewsPanel` pending-queue rules (no search filter). */
async function loadProjectPipelineStats(
  supabase: SupabaseClient,
): Promise<ProjectPipelineStats> {
  const [{ data: pcRows }, { data: piRows }] = await Promise.all([
    supabase
      .from("project_candidates")
      .select("id, status")
      .eq("is_deleted", false),
    supabase
      .from("project_interviews")
      .select("project_candidate_id, interview_status"),
  ]);

  const interviews = piRows ?? [];
  const candidateIdsWithInterview = new Set(
    interviews.map((r) => r.project_candidate_id as string),
  );
  const activePipelineCandidateIds = new Set(
    interviews
      .filter(
        (r) =>
          r.interview_status === "scheduled" ||
          r.interview_status === "rescheduled",
      )
      .map((r) => r.project_candidate_id as string),
  );

  let pending = 0;
  for (const c of pcRows ?? []) {
    const id = c.id as string;
    if (activePipelineCandidateIds.has(id)) continue;
    const statusNorm = ((c.status as string | null) ?? "pending").trim() || "pending";
    const hasInterview = candidateIdsWithInterview.has(id);
    const qualifiesPending = statusNorm === "pending" || !hasInterview;
    if (qualifiesPending) pending++;
  }

  const scheduled = interviews.filter((r) => r.interview_status === "scheduled")
    .length;
  const rescheduled = interviews.filter(
    (r) => r.interview_status === "rescheduled",
  ).length;
  const completed = interviews.filter((r) => r.interview_status === "completed")
    .length;

  return { pending, scheduled, rescheduled, completed };
}

export function ProjectInterviewsPage() {
  const { role, showViewOnlyBadge } = useAccessControl();
  const supabase = useMemo(() => {
    try {
      return createBrowserSupabaseClient();
    } catch {
      return null;
    }
  }, []);

  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<ProjectPipelineStats>({
    pending: 0,
    scheduled: 0,
    rescheduled: 0,
    completed: 0,
  });
  const [statsTick, setStatsTick] = useState(0);

  const refreshStats = useCallback(() => {
    setStatsTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    void (async () => {
      try {
        const next = await loadProjectPipelineStats(supabase);
        if (!cancelled) setStats(next);
      } catch {
        if (!cancelled) {
          setStats({
            pending: 0,
            scheduled: 0,
            rescheduled: 0,
            completed: 0,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, statsTick]);

  const [scheduleProjectFor, setScheduleProjectFor] =
    useState<ScheduleProjectCandidate | null>(null);
  const [postFor, setPostFor] =
    useState<ProjectInterviewWithProjectCandidate | null>(null);
  const [rescheduleCtx, setRescheduleCtx] = useState<{
    interview: ProjectInterviewWithProjectCandidate;
    mode: "from_scheduled" | "from_rescheduled";
  } | null>(null);

  if (!supabase) {
    return (
      <div className="mx-auto max-w-lg px-8 py-16 text-center text-sm text-[#6e6e73]">
        {error ?? "Cannot connect to Supabase."}
      </div>
    );
  }

  return (
    <>
      <header className="sticky top-0 z-30 bg-[#f5f5f7]/90 px-8 py-6 backdrop-blur-md">
        <h1 className="text-2xl font-semibold tracking-tight text-[#1d1d1f]">
          Project Interviews
        </h1>
        <p className="mt-1 text-sm text-[#6e6e73]">
          Manage project interview pipeline
        </p>
        {showViewOnlyBadge ? (
          <span className="mt-2 inline-flex rounded-full bg-[#f3f4f6] px-3 py-1 text-xs font-medium text-[#6b7280]">
            View only
          </span>
        ) : null}
      </header>

      <main className="mx-auto max-w-[1600px] px-8 pb-12 pt-2 text-sm text-[#1d1d1f]">
        {error ? (
          <div className="mb-4 rounded-2xl border border-[#f0f0f0] bg-white px-4 py-3 text-sm text-[#1d1d1f] shadow-[0_4px_16px_rgba(0,0,0,0.08)]">
            {error}
            <button
              type="button"
              className="ml-2 font-medium text-[#3b82f6] hover:text-[#2563eb]"
              onClick={() => setError(null)}
            >
              Dismiss
            </button>
          </div>
        ) : null}

        <section className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              {
                key: "pending" as const,
                label: "Pending",
                value: stats.pending,
                accent: "bg-[#16a34a]",
              },
              {
                key: "scheduled",
                label: "Scheduled",
                value: stats.scheduled,
                accent: "bg-[#2563eb]",
              },
              {
                key: "rescheduled",
                label: "Rescheduled",
                value: stats.rescheduled,
                accent: "bg-[#ea580c]",
              },
              {
                key: "completed",
                label: "Completed",
                value: stats.completed,
                accent: "bg-[#059669]",
              },
            ] as const
          ).map((card) => (
            <div key={card.key} className={`p-6 ${cardChrome}`}>
              <p className="mb-3 text-xs font-medium text-[#6e6e73]">
                {card.label}
              </p>
              <p className="text-4xl font-bold tabular-nums tracking-tight text-[#1d1d1f]">
                {card.value}
              </p>
              <div
                className={`mt-4 h-0.5 w-8 rounded-full ${card.accent}`}
              />
            </div>
          ))}
        </section>

        <ProjectInterviewsPanel
          supabase={supabase}
          isAdmin={role === "admin"}
          onError={setError}
          onPipelineChanged={refreshStats}
          onScheduleProject={(c) => {
            setScheduleProjectFor(c);
          }}
          onPostProjectInterview={(i) => setPostFor(i)}
          onRescheduleProjectInterview={(i, mode) =>
            setRescheduleCtx({ interview: i, mode })
          }
        />
      </main>

      <ScheduleInterviewModal
        key={scheduleProjectFor?.id ?? "project-schedule-closed"}
        open={!!scheduleProjectFor}
        candidate={null}
        projectCandidate={scheduleProjectFor}
        supabase={supabase}
        onClose={() => setScheduleProjectFor(null)}
        onCreated={() => {}}
      />

      <RescheduleInterviewModal
        key={rescheduleCtx?.interview.id ?? "project-reschedule-closed"}
        open={!!rescheduleCtx}
        interview={rescheduleCtx?.interview ?? null}
        mode={rescheduleCtx?.mode ?? "from_scheduled"}
        supabase={supabase}
        onClose={() => setRescheduleCtx(null)}
        onSaved={() => setRescheduleCtx(null)}
      />

      <PostInterviewDrawer
        key={postFor?.id ?? "project-post-closed"}
        open={!!postFor}
        interview={postFor}
        supabase={supabase}
        onClose={() => setPostFor(null)}
        onSaved={() => setPostFor(null)}
      />
    </>
  );
}

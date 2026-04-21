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
      .eq("is_deleted", false)
      .order("created_at", { ascending: true }),
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
          r.interview_status === "draft" ||
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

  const scheduled = interviews.filter(
    (r) => r.interview_status === "scheduled" || r.interview_status === "draft",
  ).length;
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
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!toastMessage) return;
    const t = window.setTimeout(() => setToastMessage(null), 4000);
    return () => window.clearTimeout(t);
  }, [toastMessage]);

  if (!supabase) {
    return (
      <div className="mx-auto max-w-lg px-8 py-16 text-center text-sm text-[#6e6e73]">
        {error ?? "Cannot connect to Supabase."}
      </div>
    );
  }

  return (
    <>
      {toastMessage ? (
        <div
          className="fixed bottom-6 left-1/2 z-[70] max-w-md -translate-x-1/2 rounded-xl border border-[#e5e5e5] bg-[#1d1d1f] px-4 py-3 text-center text-sm font-medium text-white shadow-lg"
          role="status"
        >
          {toastMessage}
        </div>
      ) : null}

      <header className="sticky top-14 z-30 bg-[#f5f5f7]/90 px-4 py-4 backdrop-blur-md sm:px-6 sm:py-5 lg:top-0 lg:px-8 lg:py-6">
        <h1 className="text-xl font-semibold tracking-tight text-[#1d1d1f] sm:text-2xl">
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

      <main className="mx-auto max-w-[1600px] px-4 pb-10 pt-2 text-sm text-[#1d1d1f] sm:px-6 lg:px-8 lg:pb-12">
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

        <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
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
            <div key={card.key} className={`p-4 sm:p-6 ${cardChrome}`}>
              <p className="mb-2 text-xs font-medium text-[#6e6e73] sm:mb-3">
                {card.label}
              </p>
              <p className="text-2xl font-bold tabular-nums tracking-tight text-[#1d1d1f] sm:text-4xl">
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
          onToast={(msg) => setToastMessage(msg)}
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
        onToast={(msg) => setToastMessage(msg)}
      />
    </>
  );
}

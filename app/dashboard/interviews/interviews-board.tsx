"use client";

import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { format, parseISO } from "date-fns";
import { useCallback, useEffect, useMemo, useState } from "react";

import { createBrowserSupabaseClient } from "@/lib/supabase-browser";

import { PostInterviewDrawer } from "./post-interview-drawer";
import {
  ScheduleInterviewModal,
  type ScheduleCandidate,
} from "./schedule-interview-modal";
import type { EligibleCandidate, InterviewWithCandidate } from "./types";

const COL_ELIGIBLE = "col-eligible";
const COL_SCHEDULED = "col-scheduled";
const COL_RESCHEDULED = "col-rescheduled";
const COL_COMPLETED = "col-completed";
const COL_CANCELLED = "col-cancelled";

const INTERVIEW_SELECT = `id, candidate_id, scheduled_date, interviewer, zoom_link, language, invitation_sent, poc, remarks, reminder_count, interview_status, post_interview_eligible, category, funnel, comments, interview_type, candidates ( id, full_name, email )`;

function interviewStatusBadgeClass(status: string): string {
  switch (status) {
    case "scheduled":
    case "rescheduled":
      return "bg-[#eff6ff] text-[#3b82f6]";
    case "completed":
      return "bg-[#f0fdf4] text-[#16a34a]";
    case "cancelled":
      return "bg-[#fef2f2] text-[#dc2626]";
    default:
      return "bg-[#fafafa] text-[#6e6e73]";
  }
}

function interviewTypeBadgeClass(
  type: "testimonial" | "project",
): string {
  return type === "testimonial"
    ? "bg-[#eff6ff] text-[#3b82f6]"
    : "bg-[#fafafa] text-[#6e6e73]";
}

function DroppableColumn({
  id,
  title,
  subtitle,
  count,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  count: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[min(420px,70vh)] flex-1 min-w-[260px] flex-col rounded-2xl border border-[#f0f0f0] bg-white shadow-sm transition-shadow ${
        isOver ? "ring-1 ring-[#3b82f6]/25" : ""
      }`}
    >
      <div className="border-b border-[#f5f5f5] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xs uppercase tracking-widest text-[#aeaeb2]">
            {title}
          </h3>
          <span className="shrink-0 rounded-full bg-[#f5f5f7] px-2 py-0.5 text-xs text-[#1d1d1f]">
            {count}
          </span>
        </div>
        {subtitle ? (
          <p className="mt-1.5 text-xs text-[#6e6e73]">{subtitle}</p>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-2 rounded-b-2xl bg-[#f5f5f7] p-2">
        {children}
      </div>
    </div>
  );
}

function CandidateCard({
  candidate,
  onSchedule,
}: {
  candidate: EligibleCandidate;
  onSchedule: (c: EligibleCandidate) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `candidate-${candidate.id}`,
      data: { kind: "candidate" as const, candidate },
    });
  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-xl border border-[#f0f0f0] bg-white p-4 shadow-sm transition-shadow duration-200 ease-out hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] ${
        isDragging ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="mt-0.5 cursor-grab touch-none rounded-lg border border-[#f0f0f0] bg-white px-1.5 py-1 text-xs text-[#aeaeb2] active:cursor-grabbing"
          {...listeners}
          {...attributes}
          aria-label="Drag"
        >
          ⋮⋮
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[#1d1d1f]">
            {candidate.full_name ?? "—"}
          </p>
          <p className="mt-1 truncate text-xs text-[#6e6e73]">
            {candidate.email}
          </p>
          <button
            type="button"
            className="mt-3 w-full rounded-lg bg-[#1d1d1f] px-3 py-1.5 text-xs text-white transition-colors hover:bg-[#2d2d2f]"
            onClick={() => onSchedule(candidate)}
          >
            Schedule interview
          </button>
        </div>
      </div>
    </div>
  );
}

function InterviewCard({
  interview,
  onMarkComplete,
}: {
  interview: InterviewWithCandidate;
  onMarkComplete: (i: InterviewWithCandidate) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `interview-${interview.id}`,
      data: { kind: "interview" as const, interview },
    });
  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined;

  const name = interview.candidates?.full_name ?? "—";
  const when = interview.scheduled_date
    ? format(parseISO(interview.scheduled_date), "MMM d, yyyy h:mm a")
    : "TBD";
  const typeLabel =
    interview.interview_type === "testimonial" ? "Testimonial" : "Project";

  const showComplete =
    interview.interview_status === "scheduled" ||
    interview.interview_status === "rescheduled";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-xl border border-[#f0f0f0] bg-white p-4 shadow-sm transition-shadow duration-200 ease-out hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] ${
        isDragging ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="mt-0.5 cursor-grab touch-none rounded-lg border border-[#f0f0f0] bg-white px-1.5 py-1 text-xs text-[#aeaeb2] active:cursor-grabbing"
          {...listeners}
          {...attributes}
          aria-label="Drag"
        >
          ⋮⋮
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#1d1d1f]">{name}</p>
          <p className="mt-2 text-xs text-[#6e6e73]">{when}</p>
          <p className="mt-1 text-xs text-[#6e6e73]">
            Interviewer: {interview.interviewer}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <span
              className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${interviewTypeBadgeClass(interview.interview_type)}`}
            >
              {typeLabel}
            </span>
            <span
              className={`inline-flex rounded-full px-3 py-1 text-xs font-medium capitalize ${interviewStatusBadgeClass(interview.interview_status)}`}
            >
              {interview.interview_status.replace(/_/g, " ")}
            </span>
          </div>
          {showComplete && (
            <button
              type="button"
              className="mt-3 block w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs text-[#1d1d1f] transition-colors hover:bg-[#f5f5f7]"
              onClick={() => onMarkComplete(interview)}
            >
              Mark completed…
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function InterviewsBoard() {
  const [eligibleQueue, setEligibleQueue] = useState<EligibleCandidate[]>([]);
  const [interviews, setInterviews] = useState<InterviewWithCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scheduleFor, setScheduleFor] = useState<ScheduleCandidate | null>(
    null,
  );
  const [postFor, setPostFor] = useState<InterviewWithCandidate | null>(null);

  const supabase = useMemo(() => {
    try {
      return createBrowserSupabaseClient();
    } catch {
      return null;
    }
  }, []);

  const loadData = useCallback(async () => {
    if (!supabase) return;
    const [{ data: elig, error: e1 }, { data: inv, error: e2 }] =
      await Promise.all([
        supabase
          .from("candidates")
          .select("id, full_name, email")
          .eq("eligibility_status", "eligible"),
        supabase
          .from("interviews")
          .select(INTERVIEW_SELECT)
          .order("scheduled_date", { ascending: true }),
      ]);

    if (e1 || e2) {
      setError(e1?.message ?? e2?.message ?? "Failed to load");
      return;
    }

    const list = (inv ?? []).map((row) => {
      const r = row as Record<string, unknown> & {
        candidates:
          | { id: string; full_name: string | null; email: string }
          | { id: string; full_name: string | null; email: string }[]
          | null;
      };
      const c = r.candidates;
      const candidate =
        c == null
          ? null
          : Array.isArray(c)
            ? c[0] ?? null
            : c;
      return { ...r, candidates: candidate } as InterviewWithCandidate;
    });
    const busy = new Set(
      list
        .filter(
          (i) =>
            i.interview_status === "scheduled" ||
            i.interview_status === "rescheduled",
        )
        .map((i) => i.candidate_id),
    );

    const queue = (elig ?? []).filter((c) => !busy.has(c.id)) as EligibleCandidate[];
    setEligibleQueue(queue);
    setInterviews(list);
    setError(null);
  }, [supabase]);

  useEffect(() => {
    if (!supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }

    const ch = supabase
      .channel("interviews-dashboard")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "interviews" },
        () => {
          void loadData();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "candidates" },
        () => {
          void loadData();
        },
      )
      .subscribe();

    void (async () => {
      setLoading(true);
      await loadData();
      setLoading(false);
    })();

    return () => {
      void supabase.removeChannel(ch);
    };
  }, [supabase, loadData]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const byStatus = useMemo(() => {
    const m = {
      scheduled: [] as InterviewWithCandidate[],
      rescheduled: [] as InterviewWithCandidate[],
      completed: [] as InterviewWithCandidate[],
      cancelled: [] as InterviewWithCandidate[],
    };
    for (const i of interviews) {
      switch (i.interview_status) {
        case "scheduled":
          m.scheduled.push(i);
          break;
        case "rescheduled":
          m.rescheduled.push(i);
          break;
        case "completed":
          m.completed.push(i);
          break;
        case "cancelled":
          m.cancelled.push(i);
          break;
        default:
          break;
      }
    }
    return m;
  }, [interviews]);

  const handleDragEnd = async (event: DragEndEvent) => {
    if (!supabase) return;
    const { active, over } = event;
    if (!over) return;
    const overId = String(over.id);
    const activeId = String(active.id);

    if (activeId.startsWith("candidate-")) {
      if (overId === COL_SCHEDULED) {
        const id = activeId.replace("candidate-", "");
        const c = eligibleQueue.find((x) => x.id === id);
        if (c) {
          setScheduleFor({
            id: c.id,
            full_name: c.full_name,
            email: c.email,
          });
        }
      }
      return;
    }

    if (activeId.startsWith("interview-")) {
      const id = activeId.replace("interview-", "");
      const inv = interviews.find((x) => x.id === id);
      if (!inv) return;

      if (overId === COL_COMPLETED) {
        if (inv.interview_status !== "completed") {
          setPostFor(inv);
        }
        return;
      }

      const map: Record<string, "scheduled" | "rescheduled" | "cancelled"> = {
        [COL_SCHEDULED]: "scheduled",
        [COL_RESCHEDULED]: "rescheduled",
        [COL_CANCELLED]: "cancelled",
      };
      const next = map[overId];
      if (next && inv.interview_status !== next) {
        const { error: uErr } = await supabase
          .from("interviews")
          .update({ interview_status: next })
          .eq("id", id);
        if (uErr) setError(uErr.message);
        else void loadData();
      }
    }
  };

  if (!supabase) {
    return (
      <div className="mx-auto max-w-lg px-8 py-16 text-center text-sm text-[#6e6e73]">
        {error ?? "Cannot connect to Supabase."}
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} onDragEnd={(e) => void handleDragEnd(e)}>
      <>
        <header className="sticky top-0 z-30 bg-[#f5f5f7]/90 px-8 py-6 backdrop-blur-md">
          <h1 className="text-2xl font-semibold tracking-tight text-[#1d1d1f]">
            Interview scheduling
          </h1>
          <p className="mt-1 text-sm text-[#6e6e73]">
            Kanban board · drag to update status
          </p>
        </header>

        <main className="mx-auto max-w-[1600px] px-8 pb-12 pt-2 text-sm text-[#1d1d1f]">
          {error && (
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
          )}

          {loading ? (
            <p className="text-sm text-[#6e6e73]">Loading board…</p>
          ) : (
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:overflow-x-auto lg:pb-2">
              <DroppableColumn
                id={COL_ELIGIBLE}
                title="Eligible"
                subtitle="Not yet scheduled"
                count={eligibleQueue.length}
              >
                {eligibleQueue.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-[#aeaeb2]">
                    No eligible candidates waiting.
                  </p>
                ) : (
                  eligibleQueue.map((c) => (
                    <CandidateCard
                      key={c.id}
                      candidate={c}
                      onSchedule={(x) =>
                        setScheduleFor({
                          id: x.id,
                          full_name: x.full_name,
                          email: x.email,
                        })
                      }
                    />
                  ))
                )}
              </DroppableColumn>

              <DroppableColumn
                id={COL_SCHEDULED}
                title="Scheduled"
                count={byStatus.scheduled.length}
              >
                {byStatus.scheduled.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-[#aeaeb2]">
                    Empty
                  </p>
                ) : (
                  byStatus.scheduled.map((i) => (
                    <InterviewCard
                      key={i.id}
                      interview={i}
                      onMarkComplete={setPostFor}
                    />
                  ))
                )}
              </DroppableColumn>

              <DroppableColumn
                id={COL_RESCHEDULED}
                title="Rescheduled"
                count={byStatus.rescheduled.length}
              >
                {byStatus.rescheduled.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-[#aeaeb2]">
                    Empty
                  </p>
                ) : (
                  byStatus.rescheduled.map((i) => (
                    <InterviewCard
                      key={i.id}
                      interview={i}
                      onMarkComplete={setPostFor}
                    />
                  ))
                )}
              </DroppableColumn>

              <DroppableColumn
                id={COL_COMPLETED}
                title="Completed"
                count={byStatus.completed.length}
              >
                {byStatus.completed.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-[#aeaeb2]">
                    Empty
                  </p>
                ) : (
                  byStatus.completed.map((i) => (
                    <InterviewCard
                      key={i.id}
                      interview={i}
                      onMarkComplete={setPostFor}
                    />
                  ))
                )}
              </DroppableColumn>

              <DroppableColumn
                id={COL_CANCELLED}
                title="Cancelled"
                count={byStatus.cancelled.length}
              >
                {byStatus.cancelled.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-[#aeaeb2]">
                    Empty
                  </p>
                ) : (
                  byStatus.cancelled.map((i) => (
                    <InterviewCard
                      key={i.id}
                      interview={i}
                      onMarkComplete={setPostFor}
                    />
                  ))
                )}
              </DroppableColumn>
            </div>
          )}
        </main>
      </>

      <ScheduleInterviewModal
        key={scheduleFor?.id ?? "schedule-closed"}
        open={!!scheduleFor}
        candidate={scheduleFor}
        supabase={supabase}
        onClose={() => setScheduleFor(null)}
        onCreated={() => void loadData()}
      />

      <PostInterviewDrawer
        key={postFor?.id ?? "post-closed"}
        open={!!postFor}
        interview={postFor}
        supabase={supabase}
        onClose={() => setPostFor(null)}
        onSaved={() => void loadData()}
      />
    </DndContext>
  );
}

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
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { LogoutButton } from "@/components/logout-button";
import { createBrowserSupabaseClient } from "@/lib/supabase-browser";
import type { RealtimeChannel } from "@supabase/supabase-js";

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

function DroppableColumn({
  id,
  title,
  subtitle,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[min(420px,70vh)] flex-1 min-w-[240px] flex-col rounded-xl border border-slate-200 bg-slate-50/80 shadow-sm transition-shadow ${
        isOver ? "ring-2 ring-indigo-400 ring-offset-2" : ""
      }`}
    >
      <div className="border-b border-slate-200 bg-white px-3 py-2.5">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {subtitle && (
          <p className="text-xs text-slate-500">{subtitle}</p>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-2">{children}</div>
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
      className={`rounded-lg border border-slate-200 bg-white p-3 shadow-sm ${
        isDragging ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="mt-0.5 cursor-grab touch-none rounded border border-slate-200 bg-slate-50 px-1.5 py-1 text-xs text-slate-500 active:cursor-grabbing"
          {...listeners}
          {...attributes}
          aria-label="Drag"
        >
          ⋮⋮
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-slate-900">
            {candidate.full_name ?? "—"}
          </p>
          <p className="truncate text-xs text-slate-500">{candidate.email}</p>
          <button
            type="button"
            className="mt-2 w-full rounded-md bg-indigo-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
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
      className={`rounded-lg border border-slate-200 bg-white p-3 shadow-sm ${
        isDragging ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="mt-0.5 cursor-grab touch-none rounded border border-slate-200 bg-slate-50 px-1.5 py-1 text-xs text-slate-500 active:cursor-grabbing"
          {...listeners}
          {...attributes}
          aria-label="Drag"
        >
          ⋮⋮
        </button>
        <div className="min-w-0 flex-1 space-y-1 text-xs">
          <p className="font-semibold text-slate-900">{name}</p>
          <p className="text-slate-600">{when}</p>
          <p className="text-slate-500">
            <span className="font-medium text-slate-700">Interviewer:</span>{" "}
            {interview.interviewer}
          </p>
          <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-700">
            {typeLabel}
          </span>
          {showComplete && (
            <button
              type="button"
              className="mt-2 block w-full rounded-md bg-slate-900 px-2 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
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

    let ch: RealtimeChannel | null = null;

    (async () => {
      setLoading(true);
      await loadData();
      setLoading(false);

      ch = supabase
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
    })();

    return () => {
      if (ch) void supabase.removeChannel(ch);
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
      <div className="mx-auto max-w-lg px-4 py-16 text-center text-slate-600">
        {error ?? "Cannot connect to Supabase."}
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} onDragEnd={(e) => void handleDragEnd(e)}>
      <div className="min-h-screen bg-slate-50/80">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-[1600px] items-center justify-between px-4 py-4 sm:px-6">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Dashboard
              </p>
              <h1 className="text-xl font-semibold text-slate-900">
                Interview scheduling
              </h1>
            </div>
            <div className="flex flex-wrap gap-4 text-sm font-medium">
              <Link
                href="/dashboard/eligibility"
                className="text-slate-600 hover:text-slate-900"
              >
                Eligibility
              </Link>
              <Link
                href="/dashboard/dispatch"
                className="text-slate-600 hover:text-slate-900"
              >
                Dispatch
              </Link>
              <Link href="/dashboard" className="text-slate-600 hover:text-slate-900">
                Home
              </Link>
              <LogoutButton />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
          {error && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
              {error}
              <button
                type="button"
                className="ml-2 underline"
                onClick={() => setError(null)}
              >
                Dismiss
              </button>
            </div>
          )}

          <p className="mb-4 text-sm text-slate-600">
            Drag eligible candidates onto <strong>Scheduled</strong> to open the
            scheduler, or use <strong>Schedule interview</strong>. Drag interviews
            between columns to update status. Drop on{" "}
            <strong>Completed</strong> (or use <strong>Mark completed</strong>) to
            capture post-interview details.
          </p>

          {loading ? (
            <p className="text-slate-500">Loading board…</p>
          ) : (
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:overflow-x-auto lg:pb-2">
              <DroppableColumn
                id={COL_ELIGIBLE}
                title="Eligible"
                subtitle="Not yet scheduled"
              >
                {eligibleQueue.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-slate-400">
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

              <DroppableColumn id={COL_SCHEDULED} title="Scheduled">
                {byStatus.scheduled.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-slate-400">
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

              <DroppableColumn id={COL_RESCHEDULED} title="Rescheduled">
                {byStatus.rescheduled.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-slate-400">
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

              <DroppableColumn id={COL_COMPLETED} title="Completed">
                {byStatus.completed.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-slate-400">
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

              <DroppableColumn id={COL_CANCELLED} title="Cancelled">
                {byStatus.cancelled.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-slate-400">
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
      </div>

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

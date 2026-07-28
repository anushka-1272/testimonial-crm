import { subMonths } from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AUTO_NOT_INTERESTED_MAX_ATTEMPTS_REASON,
  AUTO_NOT_INTERESTED_STALE_REASON,
  FOLLOWUP_INACTIVE_MONTHS,
  MAX_FOLLOWUP_ATTEMPTS,
} from "./followup-constants";

type FollowupEntityRow = {
  id: string;
  followup_status: string;
  followup_count: number;
  created_at: string | null;
  assigned_at: string | null;
  poc_assigned_at: string | null;
};

export function shouldAutoNotInterestedForMaxAttempts(
  outcome: string,
  newCount: number,
): boolean {
  return outcome === "no_answer" && newCount >= MAX_FOLLOWUP_ATTEMPTS;
}

export function resolveLastFollowupActivityAt(row: {
  created_at?: string | null;
  assigned_at?: string | null;
  poc_assigned_at?: string | null;
  lastFollowupLogAt?: string | null;
}): Date {
  const times = [
    row.created_at,
    row.assigned_at,
    row.poc_assigned_at,
    row.lastFollowupLogAt,
  ]
    .filter((v): v is string => Boolean(v?.trim()))
    .map((v) => new Date(v).getTime())
    .filter((t) => !Number.isNaN(t));
  if (!times.length) return new Date(0);
  return new Date(Math.max(...times));
}

export function isStaleInactiveFollowup(row: {
  followup_status: string;
  followup_count: number;
  lastActivityAt: Date;
  now?: Date;
}): boolean {
  const now = row.now ?? new Date();
  if (row.lastActivityAt > subMonths(now, FOLLOWUP_INACTIVE_MONTHS)) {
    return false;
  }
  const { followup_status, followup_count } = row;
  if (followup_status === "pending") return true;
  if (followup_status === "wrong_number") return true;
  if (
    followup_status === "no_answer" &&
    followup_count >= MAX_FOLLOWUP_ATTEMPTS
  ) {
    return true;
  }
  return false;
}

export type AutoNotInterestedResult = {
  testimonialsMaxAttempts: number;
  projectsMaxAttempts: number;
  testimonialsStale: number;
  projectsStale: number;
  errors: string[];
};

function buildLastLogMap(
  logs: { candidate_id: string | null; project_candidate_id: string | null; created_at: string }[],
): { testimonials: Map<string, string>; projects: Map<string, string> } {
  const testimonials = new Map<string, string>();
  const projects = new Map<string, string>();
  for (const log of logs) {
    if (log.candidate_id) {
      const prev = testimonials.get(log.candidate_id);
      if (!prev || log.created_at > prev) {
        testimonials.set(log.candidate_id, log.created_at);
      }
    }
    if (log.project_candidate_id) {
      const prev = projects.get(log.project_candidate_id);
      if (!prev || log.created_at > prev) {
        projects.set(log.project_candidate_id, log.created_at);
      }
    }
  }
  return { testimonials, projects };
}

async function markNotInterested(opts: {
  supabase: SupabaseClient;
  table: "candidates" | "project_candidates";
  id: string;
  reason: string;
  followupCount: number;
  insertLog: boolean;
  candidateId?: string;
  projectCandidateId?: string;
}): Promise<string | null> {
  const now = new Date().toISOString();
  const { error: upErr } = await opts.supabase
    .from(opts.table)
    .update({
      followup_status: "not_interested",
      not_interested_reason: opts.reason,
      not_interested_at: now,
      callback_datetime: null,
    })
    .eq("id", opts.id)
    .eq("is_deleted", false)
    .neq("followup_status", "not_interested");

  if (upErr) return upErr.message;

  if (opts.insertLog) {
    const logPayload = opts.projectCandidateId
      ? {
          project_candidate_id: opts.projectCandidateId,
          attempt_number: opts.followupCount,
          status: "not_interested",
          notes: opts.reason,
          logged_by: "System",
          logged_by_email: null,
        }
      : {
          candidate_id: opts.candidateId,
          attempt_number: opts.followupCount,
          status: "not_interested",
          notes: opts.reason,
          logged_by: "System",
          logged_by_email: null,
        };
    const { error: logErr } = await opts.supabase
      .from("followup_log")
      .insert(logPayload);
    if (logErr) return logErr.message;
  }

  return null;
}

async function getActiveTestimonialCandidateIds(
  supabase: SupabaseClient,
): Promise<Set<string>> {
  const { data } = await supabase
    .from("interviews")
    .select("candidate_id")
    .in("interview_status", ["scheduled", "rescheduled", "draft", "no_show"]);
  return new Set(
    (data ?? [])
      .map((r) => String(r.candidate_id ?? "").trim())
      .filter(Boolean),
  );
}

async function getActiveProjectCandidateIds(
  supabase: SupabaseClient,
): Promise<Set<string>> {
  const { data } = await supabase
    .from("project_interviews")
    .select("project_candidate_id")
    .in("interview_status", ["scheduled", "rescheduled", "draft", "no_show"]);
  return new Set(
    (data ?? [])
      .map((r) => String(r.project_candidate_id ?? "").trim())
      .filter(Boolean),
  );
}

async function processMaxAttemptsBackfill(
  supabase: SupabaseClient,
  result: AutoNotInterestedResult,
): Promise<void> {
  const { data: testimonialRows, error: tErr } = await supabase
    .from("candidates")
    .select("id, followup_count")
    .eq("is_deleted", false)
    .eq("eligibility_status", "eligible")
    .eq("followup_status", "no_answer")
    .gte("followup_count", MAX_FOLLOWUP_ATTEMPTS);

  if (tErr) {
    result.errors.push(tErr.message);
  } else {
    for (const row of testimonialRows ?? []) {
      const err = await markNotInterested({
        supabase,
        table: "candidates",
        id: row.id,
        reason: AUTO_NOT_INTERESTED_MAX_ATTEMPTS_REASON,
        followupCount: row.followup_count,
        insertLog: false,
        candidateId: row.id,
      });
      if (err) result.errors.push(err);
      else result.testimonialsMaxAttempts++;
    }
  }

  const { data: projectRows, error: pErr } = await supabase
    .from("project_candidates")
    .select("id, followup_count")
    .eq("is_deleted", false)
    .eq("followup_status", "no_answer")
    .gte("followup_count", MAX_FOLLOWUP_ATTEMPTS);

  if (pErr) {
    result.errors.push(pErr.message);
  } else {
    for (const row of projectRows ?? []) {
      const err = await markNotInterested({
        supabase,
        table: "project_candidates",
        id: row.id,
        reason: AUTO_NOT_INTERESTED_MAX_ATTEMPTS_REASON,
        followupCount: row.followup_count,
        insertLog: false,
        projectCandidateId: row.id,
      });
      if (err) result.errors.push(err);
      else result.projectsMaxAttempts++;
    }
  }
}

async function processStaleInactive(
  supabase: SupabaseClient,
  result: AutoNotInterestedResult,
  lastLogs: ReturnType<typeof buildLastLogMap>,
  now: Date,
): Promise<void> {
  const activeTestimonials = await getActiveTestimonialCandidateIds(supabase);
  const activeProjects = await getActiveProjectCandidateIds(supabase);

  const { data: testimonialRows, error: tErr } = await supabase
    .from("candidates")
    .select(
      "id, followup_status, followup_count, created_at, assigned_at, poc_assigned_at",
    )
    .eq("is_deleted", false)
    .eq("eligibility_status", "eligible")
    .in("followup_status", ["pending", "wrong_number", "no_answer"]);

  if (tErr) {
    result.errors.push(tErr.message);
  } else {
    for (const row of (testimonialRows ?? []) as FollowupEntityRow[]) {
      if (activeTestimonials.has(row.id)) continue;
      const lastActivityAt = resolveLastFollowupActivityAt({
        created_at: row.created_at,
        assigned_at: row.assigned_at,
        poc_assigned_at: row.poc_assigned_at,
        lastFollowupLogAt: lastLogs.testimonials.get(row.id) ?? null,
      });
      if (
        !isStaleInactiveFollowup({
          followup_status: row.followup_status,
          followup_count: row.followup_count,
          lastActivityAt,
          now,
        })
      ) {
        continue;
      }
      const err = await markNotInterested({
        supabase,
        table: "candidates",
        id: row.id,
        reason: AUTO_NOT_INTERESTED_STALE_REASON,
        followupCount: row.followup_count,
        insertLog: true,
        candidateId: row.id,
      });
      if (err) result.errors.push(err);
      else result.testimonialsStale++;
    }
  }

  const { data: projectRows, error: pErr } = await supabase
    .from("project_candidates")
    .select(
      "id, followup_status, followup_count, created_at, assigned_at, poc_assigned_at, status",
    )
    .eq("is_deleted", false)
    .in("followup_status", ["pending", "wrong_number", "no_answer"]);

  if (pErr) {
    result.errors.push(pErr.message);
  } else {
    for (const row of (projectRows ?? []) as FollowupEntityRow[]) {
      if (activeProjects.has(row.id)) continue;
      const lastActivityAt = resolveLastFollowupActivityAt({
        created_at: row.created_at,
        assigned_at: row.assigned_at,
        poc_assigned_at: row.poc_assigned_at,
        lastFollowupLogAt: lastLogs.projects.get(row.id) ?? null,
      });
      if (
        !isStaleInactiveFollowup({
          followup_status: row.followup_status,
          followup_count: row.followup_count,
          lastActivityAt,
          now,
        })
      ) {
        continue;
      }
      const err = await markNotInterested({
        supabase,
        table: "project_candidates",
        id: row.id,
        reason: AUTO_NOT_INTERESTED_STALE_REASON,
        followupCount: row.followup_count,
        insertLog: true,
        projectCandidateId: row.id,
      });
      if (err) result.errors.push(err);
      else result.projectsStale++;
    }
  }
}

export async function runAutoNotInterestedFollowups(
  supabase: SupabaseClient,
): Promise<AutoNotInterestedResult> {
  const result: AutoNotInterestedResult = {
    testimonialsMaxAttempts: 0,
    projectsMaxAttempts: 0,
    testimonialsStale: 0,
    projectsStale: 0,
    errors: [],
  };

  await processMaxAttemptsBackfill(supabase, result);

  const { data: logs, error: logErr } = await supabase
    .from("followup_log")
    .select("candidate_id, project_candidate_id, created_at");

  if (logErr) {
    result.errors.push(logErr.message);
    return result;
  }

  const lastLogs = buildLastLogMap(logs ?? []);
  await processStaleInactive(supabase, result, lastLogs, new Date());

  return result;
}

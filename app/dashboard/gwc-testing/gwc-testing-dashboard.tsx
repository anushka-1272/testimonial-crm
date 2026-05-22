"use client";

import { Loader2, Phone } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAccessControl } from "@/components/access-control-context";
import { logActivity } from "@/lib/activity-logger";
import {
  GWC_INTERESTED_IN_OPTIONS,
  GWC_TESTING_TABS,
  channelLabel,
  interestedInLabel,
  isContentChannel,
  tabMatchesChannel,
  workflowStageFromInterestedIn,
  gwcEntryDisplayName,
  gwcEntryEntityId,
  gwcSourceTypeBadgeClass,
  gwcSourceTypeLabel,
  isProjectGwcRow,
  type GwcContentChannel,
  type GwcInterestedIn,
  type GwcSourceType,
  type GwcTestingRow,
  type GwcTestingTab,
} from "@/lib/gwc-testing";
import { fetchTeamRosterNames, mergeRosterWithCurrent } from "@/lib/team-roster";
import { getUserSafe, displayNameFromUser } from "@/lib/supabase-auth";
import { createBrowserSupabaseClient } from "@/lib/supabase-browser";

import { AddContentLinkModal } from "./add-content-link-modal";
import { LogGwcCallModal } from "./log-gwc-call-modal";

const cardChrome =
  "rounded-2xl bg-white shadow-[0_4px_16px_rgba(0,0,0,0.08)] border border-[#f0f0f0]";

const GWC_SELECT = `
  id,
  candidate_id,
  project_candidate_id,
  poc,
  interested_in,
  workflow_stage,
  created_at,
  updated_at,
  candidates (
    id,
    full_name,
    email,
    whatsapp_number
  ),
  project_candidates (
    id,
    full_name,
    email,
    whatsapp_number,
    project_title
  )
`;

function normalizeRow(
  raw: Record<string, unknown>,
  verifications: GwcTestingRow["verifications"],
): GwcTestingRow {
  const c = raw.candidates;
  const candidate = Array.isArray(c) ? c[0] ?? null : c;
  const pc = raw.project_candidates;
  const projectCandidate = Array.isArray(pc) ? pc[0] ?? null : pc;
  const projectCandidateId =
    (raw.project_candidate_id as string | null) ?? null;
  const source_type = projectCandidateId ? "project" : "testimonial";
  return {
    id: raw.id as string,
    candidate_id: (raw.candidate_id as string | null) ?? null,
    project_candidate_id: projectCandidateId,
    source_type,
    poc: (raw.poc as string | null) ?? null,
    interested_in: (raw.interested_in as GwcInterestedIn[]) ?? [],
    workflow_stage: raw.workflow_stage as GwcTestingRow["workflow_stage"],
    created_at: raw.created_at as string,
    updated_at: raw.updated_at as string,
    candidates: candidate as GwcTestingRow["candidates"],
    project_candidates:
      projectCandidate as GwcTestingRow["project_candidates"],
    verifications,
  };
}

function GwcSourceTypeBadge({ source }: { source: GwcSourceType }) {
  return (
    <span className={gwcSourceTypeBadgeClass(source)}>
      {gwcSourceTypeLabel(source)}
    </span>
  );
}

function rowInTab(row: GwcTestingRow, tab: GwcTestingTab): boolean {
  if (tab === "dispatch") {
    return row.workflow_stage === "dispatch";
  }
  if (tab === "scheduled") {
    return (
      row.workflow_stage === "scheduled" ||
      row.interested_in.includes("video_interview")
    );
  }
  if (tab === "queue") {
    return row.workflow_stage === "active";
  }
  const channel = tabMatchesChannel(tab);
  if (!channel) return false;
  return (
    row.interested_in.includes(channel) &&
    row.workflow_stage !== "dispatch" &&
    !row.verifications.some((v) => v.channel === channel && v.verified)
  );
}

export function GwcTestingDashboard() {
  const { canEditCurrentPage, showViewOnlyBadge } = useAccessControl();
  const [rows, setRows] = useState<GwcTestingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<GwcTestingTab>("queue");
  const [trackFilter, setTrackFilter] = useState<"all" | GwcSourceType>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pocRoster, setPocRoster] = useState<string[]>([]);

  const [logCallRow, setLogCallRow] = useState<GwcTestingRow | null>(null);
  const [linkModal, setLinkModal] = useState<{
    row: GwcTestingRow;
    channel: GwcContentChannel;
    verify: boolean;
  } | null>(null);

  const supabase = useMemo(() => {
    try {
      return createBrowserSupabaseClient();
    } catch {
      return null;
    }
  }, []);

  const load = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    const { data: gwcRows, error: gwcErr } = await supabase
      .from("gwc_testing")
      .select(GWC_SELECT)
      .order("updated_at", { ascending: false });

    if (gwcErr) {
      setError(gwcErr.message);
      setLoading(false);
      return;
    }

    const ids = (gwcRows ?? []).map((r) => r.id as string);
    let verifications: GwcTestingRow["verifications"] = [];
    if (ids.length > 0) {
      const { data: verRows, error: verErr } = await supabase
        .from("gwc_content_verification")
        .select(
          "id, gwc_testing_id, channel, content_link, verified, verified_at, verified_by",
        )
        .in("gwc_testing_id", ids);
      if (verErr) {
        setError(verErr.message);
        setLoading(false);
        return;
      }
      verifications = (verRows ?? []) as GwcTestingRow["verifications"];
    }

    const byGwc = new Map<string, GwcTestingRow["verifications"]>();
    for (const v of verifications) {
      const list = byGwc.get(v.gwc_testing_id) ?? [];
      list.push(v);
      byGwc.set(v.gwc_testing_id, list);
    }

    setRows(
      (gwcRows ?? []).map((r) =>
        normalizeRow(r as Record<string, unknown>, byGwc.get(r.id as string) ?? []),
      ),
    );
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!supabase) return;
    void fetchTeamRosterNames(supabase, "poc").then(setPocRoster);
    const channel = supabase
      .channel("gwc-testing-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "gwc_testing" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "gwc_content_verification" },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, load]);

  const matchesTrackFilter = useCallback(
    (r: GwcTestingRow) =>
      trackFilter === "all" || r.source_type === trackFilter,
    [trackFilter],
  );

  const filteredRows = useMemo(
    () => rows.filter((r) => matchesTrackFilter(r) && rowInTab(r, tab)),
    [rows, tab, matchesTrackFilter],
  );

  const tabCounts = useMemo(() => {
    const counts: Record<GwcTestingTab, number> = {
      queue: 0,
      scheduled: 0,
      blog_post: 0,
      linkedin_post: 0,
      reddit_reply: 0,
      own_video: 0,
      dispatch: 0,
    };
    for (const r of rows) {
      if (!matchesTrackFilter(r)) continue;
      for (const t of GWC_TESTING_TABS) {
        if (rowInTab(r, t.id)) counts[t.id]++;
      }
    }
    return counts;
  }, [rows, matchesTrackFilter]);

  const trackCounts = useMemo(
    () => ({
      all: rows.length,
      testimonial: rows.filter((r) => r.source_type === "testimonial").length,
      project: rows.filter((r) => r.source_type === "project").length,
    }),
    [rows],
  );

  async function updatePoc(row: GwcTestingRow, poc: string) {
    if (!canEditCurrentPage || !supabase) return;
    setBusyId(row.id);
    const { error: uErr } = await supabase
      .from("gwc_testing")
      .update({ poc: poc || null })
      .eq("id", row.id);
    setBusyId(null);
    if (uErr) setError(uErr.message);
    else void load();
  }

  async function syncContentVerificationRows(
    gwcTestingId: string,
    interestedIn: GwcInterestedIn[],
  ) {
    if (!supabase) return;
    const channels = interestedIn.filter(isContentChannel);
    for (const channel of channels) {
      await supabase.from("gwc_content_verification").upsert(
        {
          gwc_testing_id: gwcTestingId,
          channel,
          verified: false,
        },
        { onConflict: "gwc_testing_id,channel", ignoreDuplicates: true },
      );
    }
  }

  async function updateInterestedIn(
    row: GwcTestingRow,
    next: GwcInterestedIn[],
  ) {
    if (!canEditCurrentPage || !supabase) return;
    setBusyId(row.id);
    const stage = workflowStageFromInterestedIn(next);
    const { error: uErr } = await supabase
      .from("gwc_testing")
      .update({
        interested_in: next,
        workflow_stage: stage,
      })
      .eq("id", row.id);
    if (uErr) {
      setError(uErr.message);
      setBusyId(null);
      return;
    }
    await syncContentVerificationRows(row.id, next);

    if (next.includes("video_interview")) {
      if (isProjectGwcRow(row) && row.project_candidate_id) {
        const { data: existingProjectInterview } = await supabase
          .from("project_interviews")
          .select("id")
          .eq("project_candidate_id", row.project_candidate_id)
          .in("interview_status", ["draft", "scheduled", "rescheduled"])
          .maybeSingle();
        if (!existingProjectInterview) {
          await supabase.from("project_interviews").insert({
            project_candidate_id: row.project_candidate_id,
            interview_status: "scheduled",
            interview_type: "project",
            poc: row.poc,
          });
        }
      } else if (row.candidate_id) {
        const { data: existingInterview } = await supabase
          .from("interviews")
          .select("id")
          .eq("candidate_id", row.candidate_id)
          .eq("interview_type", "testimonial")
          .in("interview_status", ["draft", "scheduled", "rescheduled"])
          .maybeSingle();
        if (!existingInterview) {
          await supabase.from("interviews").insert({
            candidate_id: row.candidate_id,
            interview_status: "scheduled",
            interview_type: "testimonial",
            poc: row.poc,
          });
        }
      }
    }

    const actor = await getUserSafe(supabase);
    if (actor) {
      const display = gwcEntryDisplayName(row);
      await logActivity({
        supabase,
        user: actor,
        action_type: "interviews",
        entity_type: "candidate",
        entity_id: gwcEntryEntityId(row),
        candidate_name: display,
        description: `Updated Interested In for ${display}`,
        metadata: { interested_in: next, workflow_stage: stage },
      });
    }

    setBusyId(null);
    void load();
  }

  function toggleInterested(row: GwcTestingRow, value: GwcInterestedIn) {
    const set = new Set(row.interested_in);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    void updateInterestedIn(row, [...set]);
  }

  function pocOptions(current: string | null) {
    return mergeRosterWithCurrent(pocRoster, current);
  }

  return (
    <main className="min-h-screen bg-[#f5f5f7] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1400px]">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-[#1d1d1f]">
            GWC Testing
          </h1>
          <p className="mt-1 text-sm text-[#6e6e73]">
            Manage GWC candidates, content channels, verification, and dispatch
          </p>
          {showViewOnlyBadge ? (
            <p className="mt-2 text-xs font-medium text-[#6e6e73]">
              View only — you cannot edit this section
            </p>
          ) : null}
        </header>

        {error ? (
          <p className="mb-4 rounded-xl bg-[#fef2f2] px-4 py-3 text-sm text-[#dc2626]">
            {error}
          </p>
        ) : null}

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
            Track
          </span>
          {(
            [
              { id: "all" as const, label: "All" },
              { id: "testimonial" as const, label: "Testimonial" },
              { id: "project" as const, label: "Project" },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setTrackFilter(f.id)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                trackFilter === f.id
                  ? "bg-[#1d1d1f] text-white"
                  : "bg-white text-[#6e6e73] shadow-sm hover:text-[#1d1d1f]"
              }`}
            >
              {f.label}
              <span className="ml-1 opacity-70">
                ({trackCounts[f.id]})
              </span>
            </button>
          ))}
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {GWC_TESTING_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                tab === t.id
                  ? "bg-[#1d1d1f] text-white"
                  : "bg-white text-[#6e6e73] shadow-sm hover:text-[#1d1d1f]"
              }`}
            >
              {t.label}
              <span className="ml-1.5 opacity-70">({tabCounts[t.id]})</span>
            </button>
          ))}
        </div>

        <div className={cardChrome}>
          {loading ? (
            <div className="flex items-center justify-center gap-2 px-4 py-16 text-[#6e6e73]">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading…
            </div>
          ) : filteredRows.length === 0 ? (
            <p className="px-4 py-16 text-center text-sm text-[#6e6e73]">
              No entries in this section.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead>
                  <tr className="border-b border-[#f0f0f0] text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                    <th className="px-4 py-3">Candidate</th>
                    <th className="px-4 py-3">Track</th>
                    {tab === "queue" ? (
                      <>
                        <th className="px-4 py-3">POC</th>
                        <th className="px-4 py-3">Interested in</th>
                        <th className="px-4 py-3">Actions</th>
                      </>
                    ) : null}
                    {tabMatchesChannel(tab) ? (
                      <>
                        <th className="px-4 py-3">Link</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Actions</th>
                      </>
                    ) : null}
                    {tab === "scheduled" ? (
                      <th className="px-4 py-3">Stage</th>
                    ) : null}
                    {tab === "dispatch" ? (
                      <th className="px-4 py-3">Channels</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => {
                    const display = gwcEntryDisplayName(row);
                    const email =
                      row.source_type === "project"
                        ? row.project_candidates?.email
                        : row.candidates?.email;
                    const channel = tabMatchesChannel(tab);

                    return (
                      <tr
                        key={row.id}
                        className="border-b border-[#f5f5f5] last:border-0"
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium text-[#1d1d1f]">{display}</p>
                          <p className="text-xs text-[#6e6e73]">
                            {email ?? "—"}
                            {row.source_type === "project" &&
                            row.project_candidates?.project_title ? (
                              <span className="block text-[#aeaeb2]">
                                {row.project_candidates.project_title}
                              </span>
                            ) : null}
                          </p>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <GwcSourceTypeBadge source={row.source_type} />
                        </td>

                        {tab === "queue" ? (
                          <>
                            <td className="px-4 py-3">
                              <select
                                disabled={
                                  !canEditCurrentPage || busyId === row.id
                                }
                                className="rounded-lg border border-[#e5e5e5] px-2 py-1.5 text-sm disabled:opacity-50"
                                value={row.poc ?? ""}
                                onChange={(e) =>
                                  void updatePoc(row, e.target.value)
                                }
                              >
                                <option value="">Assign POC</option>
                                {pocOptions(row.poc).map((name) => (
                                  <option key={name} value={name}>
                                    {name}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-1.5">
                                {GWC_INTERESTED_IN_OPTIONS.map((opt) => {
                                  const selected = row.interested_in.includes(
                                    opt.value,
                                  );
                                  return (
                                    <button
                                      key={opt.value}
                                      type="button"
                                      disabled={
                                        !canEditCurrentPage || busyId === row.id
                                      }
                                      onClick={() =>
                                        toggleInterested(row, opt.value)
                                      }
                                      className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                                        selected
                                          ? "bg-[#1d1d1f] text-white"
                                          : "bg-[#f5f5f5] text-[#6e6e73] hover:bg-[#e8e8ed]"
                                      }`}
                                    >
                                      {opt.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <button
                                type="button"
                                disabled={!canEditCurrentPage}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] px-3 py-1.5 text-sm font-medium text-[#1d1d1f] hover:bg-[#fafafa] disabled:opacity-50"
                                onClick={() => setLogCallRow(row)}
                              >
                                <Phone className="h-4 w-4" />
                                Log Call
                              </button>
                            </td>
                          </>
                        ) : null}

                        {channel ? (
                          <>
                            <td className="px-4 py-3">
                              {row.verifications.find(
                                (v) => v.channel === channel,
                              )?.content_link ? (
                                <a
                                  href={
                                    row.verifications.find(
                                      (v) => v.channel === channel,
                                    )!.content_link!
                                  }
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[#2563eb] hover:underline"
                                >
                                  View link
                                </a>
                              ) : (
                                <span className="text-[#6e6e73]">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {row.verifications.find(
                                (v) => v.channel === channel,
                              )?.verified ? (
                                <span className="rounded-full bg-[#f0fdf4] px-2.5 py-1 text-xs font-medium text-[#16a34a]">
                                  Verified
                                </span>
                              ) : (
                                <span className="rounded-full bg-[#fafafa] px-2.5 py-1 text-xs font-medium text-[#6e6e73]">
                                  Pending
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  disabled={!canEditCurrentPage}
                                  className="rounded-lg border border-[#e5e5e5] px-3 py-1.5 text-sm font-medium hover:bg-[#fafafa] disabled:opacity-50"
                                  onClick={() =>
                                    setLinkModal({
                                      row,
                                      channel,
                                      verify: false,
                                    })
                                  }
                                >
                                  Add Link
                                </button>
                                {row.verifications.find(
                                  (v) => v.channel === channel,
                                )?.content_link ? (
                                  <button
                                    type="button"
                                    disabled={!canEditCurrentPage}
                                    className="rounded-lg bg-[#16a34a] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                                    onClick={() =>
                                      setLinkModal({
                                        row,
                                        channel,
                                        verify: true,
                                      })
                                    }
                                  >
                                    Verify
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          </>
                        ) : null}

                        {tab === "scheduled" ? (
                          <td className="px-4 py-3">
                            <span className="rounded-full bg-[#eff6ff] px-2.5 py-1 text-xs font-medium text-[#2563eb]">
                              Video interview scheduled
                            </span>
                          </td>
                        ) : null}

                        {tab === "dispatch" ? (
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              {row.interested_in
                                .filter(isContentChannel)
                                .map((ch) => (
                                  <span
                                    key={ch}
                                    className="rounded-full bg-[#f5f5f5] px-2 py-0.5 text-xs text-[#6e6e73]"
                                  >
                                    {channelLabel(ch)}
                                  </span>
                                ))}
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {supabase ? (
        <>
          <LogGwcCallModal
            open={Boolean(logCallRow)}
            row={logCallRow}
            supabase={supabase}
            onClose={() => setLogCallRow(null)}
            onSaved={() => void load()}
          />
          <AddContentLinkModal
            open={Boolean(linkModal)}
            row={linkModal?.row ?? null}
            channel={linkModal?.channel ?? null}
            verifyOnSave={linkModal?.verify ?? false}
            supabase={supabase}
            onClose={() => setLinkModal(null)}
            onSaved={() => void load()}
          />
        </>
      ) : null}
    </main>
  );
}

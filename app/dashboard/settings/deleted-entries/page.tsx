"use client";

import { format, parseISO } from "date-fns";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useAccessControl } from "@/components/access-control-context";
import { logActivity } from "@/lib/activity-logger";
import { getUserSafe } from "@/lib/supabase-auth";
import { createBrowserSupabaseClient } from "@/lib/supabase-browser";

const cardChrome =
  "rounded-2xl bg-white shadow-[0_4px_16px_rgba(0,0,0,0.08)] border border-[#f0f0f0]";

type DeletedTestimonial = {
  id: string;
  full_name: string | null;
  email: string;
  whatsapp_number: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
};

type DeletedProject = {
  id: string;
  full_name: string | null;
  email: string;
  whatsapp_number: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
};

function formatDeletedAt(iso: string | null | undefined) {
  if (!iso?.trim()) return "—";
  try {
    return format(parseISO(iso), "MMM d, yyyy h:mm a");
  } catch {
    return "—";
  }
}

export default function DeletedEntriesPage() {
  const supabase = createBrowserSupabaseClient();
  const { canManageTeam, showViewOnlyBadge } = useAccessControl();
  const [testimonial, setTestimonial] = useState<DeletedTestimonial[]>([]);
  const [project, setProject] = useState<DeletedProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [tRes, pRes] = await Promise.all([
      supabase
        .from("candidates")
        .select(
          "id, full_name, email, whatsapp_number, deleted_at, deleted_by",
        )
        .eq("is_deleted", true)
        .order("deleted_at", { ascending: false }),
      supabase
        .from("project_candidates")
        .select(
          "id, full_name, email, whatsapp_number, deleted_at, deleted_by",
        )
        .eq("is_deleted", true)
        .order("deleted_at", { ascending: false }),
    ]);
    if (tRes.error) setError(tRes.error.message);
    else if (pRes.error) setError(pRes.error.message);
    else {
      setTestimonial((tRes.data ?? []) as DeletedTestimonial[]);
      setProject((pRes.data ?? []) as DeletedProject[]);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const restoreTestimonial = async (row: DeletedTestimonial) => {
    if (!canManageTeam) return;
    setBusyId(`t:${row.id}`);
    const { error: uErr } = await supabase
      .from("candidates")
      .update({
        is_deleted: false,
        deleted_at: null,
        deleted_by: null,
      })
      .eq("id", row.id)
      .eq("is_deleted", true);
    setBusyId(null);
    if (uErr) {
      setError(uErr.message);
      return;
    }
    const name =
      row.full_name?.trim() || row.email?.trim() || "Candidate";
    const actor = await getUserSafe(supabase);
    if (actor) {
      await logActivity({
        supabase,
        user: actor,
        action_type: "settings",
        entity_type: "candidate",
        entity_id: row.id,
        candidate_name: name,
        description: `Restored candidate ${name}`,
      });
    }
    setToast("Candidate restored successfully");
    void load();
  };

  const restoreProject = async (row: DeletedProject) => {
    if (!canManageTeam) return;
    setBusyId(`p:${row.id}`);
    const { error: uErr } = await supabase
      .from("project_candidates")
      .update({
        is_deleted: false,
        deleted_at: null,
        deleted_by: null,
      })
      .eq("id", row.id)
      .eq("is_deleted", true);
    setBusyId(null);
    if (uErr) {
      setError(uErr.message);
      return;
    }
    const name =
      row.full_name?.trim() || row.email?.trim() || "Project candidate";
    const actor = await getUserSafe(supabase);
    if (actor) {
      await logActivity({
        supabase,
        user: actor,
        action_type: "settings",
        entity_type: "project_candidate",
        entity_id: row.id,
        candidate_name: name,
        description: `Restored candidate ${name}`,
      });
    }
    setToast("Candidate restored successfully");
    void load();
  };

  const th =
    "border-b border-gray-100 bg-[#fafafa] px-3 py-3 text-left text-xs font-semibold tracking-wider text-gray-400";
  const td = "border-b border-gray-100 px-3 py-3 text-sm text-[#1d1d1f]";

  return (
    <>
      {toast ? (
        <div className="fixed bottom-6 left-1/2 z-[80] -translate-x-1/2 rounded-xl bg-[#1d1d1f] px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      ) : null}
      <header className="sticky top-14 z-30 bg-[#f5f5f7]/90 px-4 py-4 backdrop-blur-md sm:px-6 sm:py-5 lg:top-0 lg:px-8 lg:py-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[#1d1d1f]">
              Deleted entries
            </h1>
            <p className="mt-1 text-sm text-[#6e6e73]">
              Restore testimonial or project candidates removed from active
              views
            </p>
          </div>
          <div className="-mx-1 flex flex-nowrap items-center gap-3 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden">
            <Link
              href="/dashboard/settings/team"
              className="shrink-0 text-sm font-medium text-[#6e6e73] transition-all hover:text-[#1d1d1f]"
            >
              Team
            </Link>
            <Link
              href="/dashboard/settings/criteria"
              className="shrink-0 text-sm font-medium text-[#6e6e73] transition-all hover:text-[#1d1d1f]"
            >
              Criteria
            </Link>
            <Link
              href="/dashboard/settings/roster"
              className="shrink-0 text-sm font-medium text-[#6e6e73] transition-all hover:text-[#1d1d1f]"
            >
              Roster
            </Link>
            <span className="shrink-0 text-sm font-medium text-[#1d1d1f]">
              Deleted Entries
            </span>
            {showViewOnlyBadge ? (
              <span className="rounded-full bg-[#f3f4f6] px-3 py-1 text-xs font-medium text-[#6b7280]">
                View only
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-10 pt-2 sm:px-6 lg:px-8 lg:pb-12">
        {error ? (
          <p className="mb-4 rounded-xl border border-[#f0f0f0] bg-white px-4 py-2 text-sm text-[#dc2626]">
            {error}
            <button
              type="button"
              className="ml-2 font-medium text-[#3b82f6]"
              onClick={() => setError(null)}
            >
              Dismiss
            </button>
          </p>
        ) : null}

        <div className="space-y-10">
          <section className={`${cardChrome} overflow-hidden`}>
            <h2 className="border-b border-[#f0f0f0] px-4 py-3 text-sm font-semibold text-[#1d1d1f]">
              Testimonial candidates
            </h2>
            <div className="w-full overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left">
                <thead>
                  <tr>
                    <th className={th}>Name</th>
                    <th className={th}>Email</th>
                    <th className={th}>Phone</th>
                    <th className={th}>Deleted on</th>
                    <th className={th}>Deleted by</th>
                    <th className={`${th} text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td className={td} colSpan={6}>
                        Loading…
                      </td>
                    </tr>
                  ) : testimonial.length === 0 ? (
                    <tr>
                      <td className={td} colSpan={6}>
                        <span className="text-[#6e6e73]">
                          No deleted testimonial candidates.
                        </span>
                      </td>
                    </tr>
                  ) : (
                    testimonial.map((r) => (
                      <tr key={r.id}>
                        <td className={td}>{r.full_name?.trim() || "—"}</td>
                        <td className={`${td} text-[#6e6e73]`}>{r.email}</td>
                        <td className={`${td} text-[#6e6e73]`}>
                          {r.whatsapp_number?.trim() || "—"}
                        </td>
                        <td className={`${td} text-[#6e6e73]`}>
                          {formatDeletedAt(r.deleted_at)}
                        </td>
                        <td className={`${td} text-[#6e6e73]`}>
                          {r.deleted_by?.trim() || "—"}
                        </td>
                        <td className={`${td} text-right`}>
                          {canManageTeam ? (
                            <button
                              type="button"
                              disabled={busyId === `t:${r.id}`}
                              className="rounded-lg bg-[#16a34a] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#15803d] disabled:opacity-50"
                              onClick={() => void restoreTestimonial(r)}
                            >
                              Restore
                            </button>
                          ) : (
                            <span className="text-xs text-[#aeaeb2]">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className={`${cardChrome} overflow-hidden`}>
            <h2 className="border-b border-[#f0f0f0] px-4 py-3 text-sm font-semibold text-[#1d1d1f]">
              Project candidates
            </h2>
            <div className="w-full overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left">
                <thead>
                  <tr>
                    <th className={th}>Name</th>
                    <th className={th}>Email</th>
                    <th className={th}>Phone</th>
                    <th className={th}>Deleted on</th>
                    <th className={th}>Deleted by</th>
                    <th className={`${th} text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td className={td} colSpan={6}>
                        Loading…
                      </td>
                    </tr>
                  ) : project.length === 0 ? (
                    <tr>
                      <td className={td} colSpan={6}>
                        <span className="text-[#6e6e73]">
                          No deleted project candidates.
                        </span>
                      </td>
                    </tr>
                  ) : (
                    project.map((r) => (
                      <tr key={r.id}>
                        <td className={td}>{r.full_name?.trim() || "—"}</td>
                        <td className={`${td} text-[#6e6e73]`}>{r.email}</td>
                        <td className={`${td} text-[#6e6e73]`}>
                          {r.whatsapp_number?.trim() || "—"}
                        </td>
                        <td className={`${td} text-[#6e6e73]`}>
                          {formatDeletedAt(r.deleted_at)}
                        </td>
                        <td className={`${td} text-[#6e6e73]`}>
                          {r.deleted_by?.trim() || "—"}
                        </td>
                        <td className={`${td} text-right`}>
                          {canManageTeam ? (
                            <button
                              type="button"
                              disabled={busyId === `p:${r.id}`}
                              className="rounded-lg bg-[#16a34a] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#15803d] disabled:opacity-50"
                              onClick={() => void restoreProject(r)}
                            >
                              Restore
                            </button>
                          ) : (
                            <span className="text-xs text-[#aeaeb2]">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}

"use client";

import { Eye, EyeOff, Pencil, Plus, Trash2, X, Check } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAccessControl } from "@/components/access-control-context";
import { logActivity } from "@/lib/activity-logger";
import {
  type TeamRosterRole,
  type TeamRosterRow,
} from "@/lib/team-roster";
import { getUserSafe } from "@/lib/supabase-auth";
import { createBrowserSupabaseClient } from "@/lib/supabase-browser";

const cardChrome =
  "rounded-2xl bg-white shadow-[0_4px_16px_rgba(0,0,0,0.08)] border border-[#f0f0f0]";

const ROLE_TABS: { role: TeamRosterRole; label: string }[] = [
  { role: "poc", label: "POC" },
  { role: "interviewer", label: "Interviewer" },
  { role: "post_production", label: "Post Production" },
  { role: "operations", label: "Operations" },
];

type DraftAddState = Record<TeamRosterRole, { name: string; email: string; open: boolean }>;

const EMPTY_ADD: DraftAddState = {
  poc: { name: "", email: "", open: false },
  interviewer: { name: "", email: "", open: false },
  post_production: { name: "", email: "", open: false },
  operations: { name: "", email: "", open: false },
};

function roleLabel(role: TeamRosterRole): string {
  if (role === "poc") return "POC";
  if (role === "interviewer") return "interviewer";
  if (role === "post_production") return "post_production";
  return "operations";
}

export default function RosterSettingsPage() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const { canManageTeam, showViewOnlyBadge } = useAccessControl();

  const [rows, setRows] = useState<TeamRosterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeRole, setActiveRole] = useState<TeamRosterRole>("poc");
  const [addDraft, setAddDraft] = useState<DraftAddState>(EMPTY_ADD);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const loadRoster = useCallback(async () => {
    setLoading(true);
    const { data, error: qErr } = await supabase
      .from("team_roster")
      .select("id, created_at, name, email, role_type, is_active, display_order")
      .order("role_type", { ascending: true })
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (qErr) {
      setError(qErr.message);
      setRows([]);
      setLoading(false);
      return;
    }

    setRows((data ?? []) as TeamRosterRow[]);
    setError(null);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  async function logRosterActivity(description: string, row?: TeamRosterRow) {
    const user = await getUserSafe(supabase);
    if (!user) return;
    await logActivity({
      supabase,
      user,
      action_type: "settings",
      entity_type: "team_roster",
      entity_id: row?.id ?? null,
      candidate_name: row?.name ?? null,
      description,
    });
  }

  const roleRows = useMemo(
    () => rows.filter((r) => r.role_type === activeRole),
    [rows, activeRole],
  );

  const nextOrderForRole = useCallback(
    (role: TeamRosterRole) => {
      const maxOrder = rows
        .filter((r) => r.role_type === role)
        .reduce((mx, r) => Math.max(mx, Number(r.display_order ?? 0)), 0);
      return maxOrder + 1;
    },
    [rows],
  );

  const toggleActive = async (row: TeamRosterRow) => {
    if (!canManageTeam) return;
    setSavingKey(`toggle:${row.id}`);
    const { error: upErr } = await supabase
      .from("team_roster")
      .update({ is_active: !row.is_active })
      .eq("id", row.id);
    setSavingKey(null);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    await logRosterActivity(`Updated ${row.name} in roster`, row);
    void loadRoster();
  };

  const beginEdit = (row: TeamRosterRow) => {
    setEditingId(row.id);
    setEditName(row.name);
    setEditEmail(row.email ?? "");
  };

  const saveEdit = async (row: TeamRosterRow) => {
    if (!canManageTeam) return;
    const name = editName.trim();
    if (!name) {
      setError("Name is required.");
      return;
    }
    setSavingKey(`edit:${row.id}`);
    const { error: upErr } = await supabase
      .from("team_roster")
      .update({
        name,
        email: editEmail.trim() || null,
      })
      .eq("id", row.id);
    setSavingKey(null);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    await logRosterActivity(`Updated ${name} in roster`, row);
    setEditingId(null);
    setEditName("");
    setEditEmail("");
    void loadRoster();
  };

  const removeMember = async (row: TeamRosterRow) => {
    if (!canManageTeam) return;
    const ok = window.confirm(`Delete ${row.name} from ${roleLabel(row.role_type)} roster?`);
    if (!ok) return;
    setSavingKey(`delete:${row.id}`);
    const { error: delErr } = await supabase
      .from("team_roster")
      .delete()
      .eq("id", row.id);
    setSavingKey(null);
    if (delErr) {
      setError(delErr.message);
      return;
    }
    await logRosterActivity(
      `Removed ${row.name} from ${roleLabel(row.role_type)} roster`,
      row,
    );
    void loadRoster();
  };

  const addMember = async (role: TeamRosterRole) => {
    if (!canManageTeam) return;
    const draft = addDraft[role];
    const name = draft.name.trim();
    if (!name) {
      setError("Name is required.");
      return;
    }
    setSavingKey(`add:${role}`);
    const { data, error: insErr } = await supabase
      .from("team_roster")
      .insert({
        name,
        email: draft.email.trim() || null,
        role_type: role,
        is_active: true,
        display_order: nextOrderForRole(role),
      })
      .select("id, created_at, name, email, role_type, is_active, display_order")
      .single();
    setSavingKey(null);
    if (insErr) {
      setError(insErr.message);
      return;
    }
    await logRosterActivity(
      `Added ${name} to ${roleLabel(role)} roster`,
      (data ?? undefined) as TeamRosterRow | undefined,
    );
    setAddDraft((prev) => ({
      ...prev,
      [role]: { name: "", email: "", open: false },
    }));
    void loadRoster();
  };

  return (
    <>
      <header className="sticky top-0 z-30 bg-[#f5f5f7]/90 px-8 py-6 backdrop-blur-md">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[#1d1d1f]">
              Team Roster
            </h1>
            <p className="mt-1 text-sm text-[#6e6e73]">
              Manage team members for each role
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/dashboard/settings/team"
              className="text-sm font-medium text-[#6e6e73] transition-all hover:text-[#1d1d1f]"
            >
              Team
            </Link>
            <Link
              href="/dashboard/settings/roster"
              className="text-sm font-medium text-[#1d1d1f]"
            >
              Roster
            </Link>
            <Link
              href="/dashboard/settings/criteria"
              className="text-sm font-medium text-[#6e6e73] transition-all hover:text-[#1d1d1f]"
            >
              Criteria
            </Link>
            <Link
              href="/dashboard/settings/deleted-entries"
              className="text-sm font-medium text-[#6e6e73] transition-all hover:text-[#1d1d1f]"
            >
              Deleted Entries
            </Link>
            {showViewOnlyBadge ? (
              <span className="rounded-full bg-[#f3f4f6] px-3 py-1 text-xs font-medium text-[#6b7280]">
                View only
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-8 pb-12 pt-2">
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

        <div className="mb-4 flex flex-wrap gap-2">
          {ROLE_TABS.map((tab) => (
            <button
              key={tab.role}
              type="button"
              onClick={() => setActiveRole(tab.role)}
              className={`rounded-full px-4 py-2 text-sm font-medium ${
                activeRole === tab.role
                  ? "bg-[#1d1d1f] text-white"
                  : "bg-white text-[#6e6e73] border border-[#e5e5e5] hover:text-[#1d1d1f]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <section className={`${cardChrome} overflow-hidden`}>
          <div className="flex items-center justify-between border-b border-[#f0f0f0] px-4 py-3">
            <h2 className="text-sm font-semibold text-[#1d1d1f]">
              {ROLE_TABS.find((r) => r.role === activeRole)?.label}
            </h2>
            {canManageTeam ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg border border-[#e5e5e5] px-3 py-1.5 text-xs font-medium text-[#1d1d1f] hover:bg-[#fafafa]"
                onClick={() =>
                  setAddDraft((prev) => ({
                    ...prev,
                    [activeRole]: { ...prev[activeRole], open: !prev[activeRole].open },
                  }))
                }
              >
                <Plus className="h-3.5 w-3.5" />
                Add member
              </button>
            ) : null}
          </div>

          {canManageTeam && addDraft[activeRole].open ? (
            <div className="grid gap-2 border-b border-[#f0f0f0] bg-[#fafafa] px-4 py-3 sm:grid-cols-[1fr_1fr_auto]">
              <input
                value={addDraft[activeRole].name}
                onChange={(e) =>
                  setAddDraft((prev) => ({
                    ...prev,
                    [activeRole]: { ...prev[activeRole], name: e.target.value },
                  }))
                }
                className="rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm"
                placeholder="Name *"
              />
              <input
                value={addDraft[activeRole].email}
                onChange={(e) =>
                  setAddDraft((prev) => ({
                    ...prev,
                    [activeRole]: { ...prev[activeRole], email: e.target.value },
                  }))
                }
                className="rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm"
                placeholder="Email (optional)"
              />
              <button
                type="button"
                disabled={savingKey === `add:${activeRole}`}
                className="rounded-lg bg-[#1d1d1f] px-4 py-2 text-sm font-medium text-white hover:bg-[#2d2d2f] disabled:opacity-50"
                onClick={() => void addMember(activeRole)}
              >
                Save
              </button>
            </div>
          ) : null}

          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead>
                <tr>
                  <th className="border-b border-gray-100 bg-[#fafafa] px-4 py-3 text-xs font-semibold tracking-wider text-gray-400">
                    NAME
                  </th>
                  <th className="border-b border-gray-100 bg-[#fafafa] px-4 py-3 text-xs font-semibold tracking-wider text-gray-400">
                    EMAIL
                  </th>
                  <th className="border-b border-gray-100 bg-[#fafafa] px-4 py-3 text-xs font-semibold tracking-wider text-gray-400">
                    STATUS
                  </th>
                  <th className="border-b border-gray-100 bg-[#fafafa] px-4 py-3 text-right text-xs font-semibold tracking-wider text-gray-400">
                    ACTIONS
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="px-4 py-6 text-sm text-[#6e6e73]" colSpan={4}>
                      Loading...
                    </td>
                  </tr>
                ) : roleRows.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-sm text-[#6e6e73]" colSpan={4}>
                      No members in this roster.
                    </td>
                  </tr>
                ) : (
                  roleRows.map((row) => {
                    const isEditing = editingId === row.id;
                    return (
                      <tr key={row.id}>
                        <td className="border-b border-gray-100 px-4 py-3 text-sm text-[#1d1d1f]">
                          {isEditing ? (
                            <input
                              className="w-full rounded-lg border border-[#e5e5e5] px-2 py-1.5 text-sm"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                            />
                          ) : (
                            row.name
                          )}
                        </td>
                        <td className="border-b border-gray-100 px-4 py-3 text-sm text-[#6e6e73]">
                          {isEditing ? (
                            <input
                              className="w-full rounded-lg border border-[#e5e5e5] px-2 py-1.5 text-sm"
                              value={editEmail}
                              onChange={(e) => setEditEmail(e.target.value)}
                              placeholder="Email (optional)"
                            />
                          ) : (
                            row.email?.trim() || "—"
                          )}
                        </td>
                        <td className="border-b border-gray-100 px-4 py-3 text-sm">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                              row.is_active
                                ? "bg-[#f0fdf4] text-[#16a34a]"
                                : "bg-[#f4f4f5] text-[#6e6e73]"
                            }`}
                          >
                            {row.is_active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="border-b border-gray-100 px-4 py-3 text-right text-sm">
                          {canManageTeam ? (
                            <div className="inline-flex items-center gap-1">
                              {isEditing ? (
                                <>
                                  <button
                                    type="button"
                                    disabled={savingKey === `edit:${row.id}`}
                                    className="rounded-lg p-1.5 text-[#16a34a] hover:bg-[#f0fdf4]"
                                    title="Save edit"
                                    onClick={() => void saveEdit(row)}
                                  >
                                    <Check className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    className="rounded-lg p-1.5 text-[#6e6e73] hover:bg-[#f4f4f5]"
                                    title="Cancel edit"
                                    onClick={() => {
                                      setEditingId(null);
                                      setEditName("");
                                      setEditEmail("");
                                    }}
                                  >
                                    <X className="h-4 w-4" />
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    disabled={savingKey === `toggle:${row.id}`}
                                    className="rounded-lg p-1.5 text-[#6e6e73] hover:bg-[#f5f5f7]"
                                    title={row.is_active ? "Set inactive" : "Set active"}
                                    onClick={() => void toggleActive(row)}
                                  >
                                    {row.is_active ? (
                                      <Eye className="h-4 w-4" />
                                    ) : (
                                      <EyeOff className="h-4 w-4" />
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    className="rounded-lg p-1.5 text-[#3b82f6] hover:bg-[#eff6ff]"
                                    title="Edit"
                                    onClick={() => beginEdit(row)}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={savingKey === `delete:${row.id}`}
                                    className="rounded-lg p-1.5 text-[#dc2626] hover:bg-[#fef2f2]"
                                    title="Delete"
                                    onClick={() => void removeMember(row)}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-[#aeaeb2]">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  );
}

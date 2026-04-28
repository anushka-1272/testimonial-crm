"use client";

import { format, parseISO } from "date-fns";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAccessControl } from "@/components/access-control-context";
import { roleLabel, type TeamRole } from "@/lib/access-control";
import { getUserSafe } from "@/lib/supabase-auth";
import {
  modalOverlayZ70Class,
  modalPanelClass,
} from "@/lib/modal-responsive";
import { createBrowserSupabaseClient } from "@/lib/supabase-browser";

type TeamMemberRow = {
  id: string;
  created_at: string;
  user_id: string | null;
  email: string;
  full_name: string | null;
  role: TeamRole;
  invited_at: string | null;
  status: "invited" | "active" | "removed";
};

const ROLE_OPTIONS: { value: TeamRole; label: string; description: string }[] = [
  { value: "admin", label: "Admin", description: "Full access + team management" },
  { value: "interviewer", label: "Interviewer", description: "Interviews page + view access" },
  { value: "poc", label: "POC", description: "Eligible tab + interviews + view access" },
  { value: "operations", label: "Operations", description: "Scheduled tab + dispatch + view access" },
  { value: "post_production", label: "Post Production", description: "Post production page + view access" },
  { value: "viewer", label: "Viewer", description: "Read-only access to all pages" },
];

function initials(name: string | null, email: string): string {
  const n = name?.trim() ?? "";
  if (n) {
    const parts = n.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    return n.slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

function roleBadgeClass(role: TeamRole): string {
  if (role === "admin") return "bg-[#1d1d1f] text-white";
  if (role === "interviewer") return "bg-[#dbeafe] text-[#1d4ed8]";
  if (role === "poc") return "bg-[#dcfce7] text-[#166534]";
  if (role === "operations") return "bg-[#ffedd5] text-[#9a3412]";
  if (role === "post_production") return "bg-[#f3e8ff] text-[#7e22ce]";
  return "bg-[#f3f4f6] text-[#4b5563]";
}

function statusBadgeClass(status: TeamMemberRow["status"]): string {
  if (status === "active") return "bg-[#f0fdf4] text-[#16a34a]";
  if (status === "removed") return "bg-[#fef2f2] text-[#dc2626]";
  return "bg-[#fef9c3] text-[#854d0e]";
}

export default function TeamSettingsPage() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const { canManageTeam, showViewOnlyBadge } = useAccessControl();
  const [members, setMembers] = useState<TeamMemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePassword, setInvitePassword] = useState("");
  const [inviteRole, setInviteRole] = useState<TeamRole>("viewer");
  const [submitting, setSubmitting] = useState(false);

  const loadMembers = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    const { data, error: qErr } = await supabase
      .from("team_members")
      .select("id, created_at, user_id, email, full_name, role, invited_at, status")
      .order("created_at", { ascending: false });
    if (qErr) {
      setError(qErr.message);
    } else {
      setMembers((data ?? []) as TeamMemberRow[]);
      setError(null);
    }
    if (showLoading) setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    const channel = supabase
      .channel("team-members-settings")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "team_members" },
        () => {
          void loadMembers(false);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadMembers, supabase]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const selectedRole = ROLE_OPTIONS.find((r) => r.value === inviteRole);

  const inviteMember = async () => {
    if (!inviteEmail.trim()) {
      setError("Email is required.");
      return;
    }
    if (invitePassword.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    const user = await getUserSafe(supabase);
    if (!user) {
      setError("You must be signed in.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const res = await fetch("/api/team/invite", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({
          full_name: inviteName.trim() || null,
          email: inviteEmail.trim(),
          password: invitePassword,
          role: inviteRole,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        success?: string;
        member?: TeamMemberRow;
      };
      if (!res.ok) {
        setError(j.error ?? "Failed to invite member");
        setSubmitting(false);
        return;
      }
      const returnedMember = j.member;
      if (returnedMember) {
        setMembers((prev) => [
          returnedMember,
          ...prev.filter((m) => m.id !== returnedMember.id),
        ]);
      }
      setToast(j.success ?? `Member added: ${inviteEmail.trim()}`);
      setInviteOpen(false);
      setInviteName("");
      setInviteEmail("");
      setInvitePassword("");
      setInviteRole("viewer");
      await loadMembers(false);
    } finally {
      setSubmitting(false);
    }
  };

  const changeRole = async (id: string, role: TeamRole) => {
    const user = await getUserSafe(supabase);
    if (!user) {
      setError("You must be signed in.");
      return;
    }
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const res = await fetch("/api/team/members", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token ?? ""}`,
      },
      body: JSON.stringify({ id, role }),
    });
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(j.error ?? "Failed to update role");
      return;
    }
    void loadMembers();
  };

  const removeMember = async (m: TeamMemberRow) => {
    const user = await getUserSafe(supabase);
    if (!user) {
      setError("You must be signed in.");
      return;
    }
    const label = m.full_name?.trim() || m.email;
    const yes = window.confirm(
      `Are you sure you want to remove ${label}? They will lose access immediately.`,
    );
    if (!yes) return;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const res = await fetch("/api/team/members", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token ?? ""}`,
      },
      body: JSON.stringify({ id: m.id }),
    });
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(j.error ?? "Failed to remove member");
      return;
    }
    void loadMembers();
  };

  return (
    <>
      {toast ? (
        <div className="fixed bottom-6 left-1/2 z-[80] -translate-x-1/2 rounded-xl bg-[#1d1d1f] px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      ) : null}
      <header className="sticky top-14 z-30 bg-[#f5f5f7]/90 px-4 py-4 backdrop-blur-md sm:px-6 sm:py-5 lg:top-0 lg:px-8 lg:py-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[#1d1d1f]">
              Team Management
            </h1>
            <p className="mt-1 text-sm text-[#6e6e73]">Manage who has access to the CRM</p>
          </div>
          <div className="flex items-center gap-2">
            {showViewOnlyBadge ? (
              <span className="rounded-full bg-[#f3f4f6] px-3 py-1 text-xs font-medium text-[#6b7280]">
                View only
              </span>
            ) : null}
            {canManageTeam ? (
              <button
                type="button"
                onClick={() => setInviteOpen(true)}
                className="rounded-xl bg-[#1d1d1f] px-4 py-2 text-sm font-medium text-white hover:bg-[#2d2d2f]"
              >
                Add Member
              </button>
            ) : null}
          </div>
        </div>
        <div className="mt-3 flex flex-nowrap items-center gap-4 overflow-x-auto pb-1 text-sm [-ms-overflow-style:none] [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden">
          <Link
            href="/dashboard/settings/team"
            className="shrink-0 font-medium text-[#1d1d1f]"
          >
            Team
          </Link>
          <Link
            href="/dashboard/settings/roster"
            className="shrink-0 text-[#6e6e73] hover:text-[#1d1d1f]"
          >
            Roster
          </Link>
          <Link
            href="/dashboard/settings/criteria"
            className="shrink-0 text-[#6e6e73] hover:text-[#1d1d1f]"
          >
            Criteria
          </Link>
          <Link
            href="/dashboard/settings/deleted-entries"
            className="shrink-0 text-[#6e6e73] hover:text-[#1d1d1f]"
          >
            Deleted Entries
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-10 pt-2 sm:px-6 lg:px-8 lg:pb-12">
        {error ? (
          <p className="mb-3 rounded-xl border border-[#f0f0f0] bg-white px-4 py-2 text-sm text-[#dc2626]">
            {error}
          </p>
        ) : null}
        <div className="overflow-hidden rounded-2xl border border-[#f0f0f0] bg-white shadow-sm">
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse">
              <thead>
                <tr>
                  {["MEMBER", "EMAIL", "ROLE", "STATUS", "JOINED", canManageTeam ? "ACTIONS" : ""]
                    .filter(Boolean)
                    .map((h) => (
                      <th key={h} className="border-b border-gray-100 bg-[#fafafa] px-4 py-3 text-left text-xs font-semibold tracking-wider text-gray-400">
                        {h}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="px-4 py-6 text-sm text-[#6e6e73]" colSpan={canManageTeam ? 6 : 5}>
                      Loading...
                    </td>
                  </tr>
                ) : members.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-sm text-[#6e6e73]" colSpan={canManageTeam ? 6 : 5}>
                      No team members yet.
                    </td>
                  </tr>
                ) : (
                  members.map((m) => (
                    <tr key={m.id}>
                      <td className="border-b border-gray-100 px-4 py-4 text-sm">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#1d1d1f] text-xs font-semibold text-white">
                            {initials(m.full_name, m.email)}
                          </div>
                          <span>{m.full_name?.trim() || "—"}</span>
                        </div>
                      </td>
                      <td className="border-b border-gray-100 px-4 py-4 text-sm text-[#6e6e73]">{m.email}</td>
                      <td className="border-b border-gray-100 px-4 py-4 text-sm">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${roleBadgeClass(m.role)}`}>
                          {roleLabel(m.role)}
                        </span>
                      </td>
                      <td className="border-b border-gray-100 px-4 py-4 text-sm">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusBadgeClass(m.status)}`}>
                          {m.status === "invited" ? "Invited" : m.status === "active" ? "Active" : "Removed"}
                        </span>
                      </td>
                      <td className="border-b border-gray-100 px-4 py-4 text-sm text-[#6e6e73]">
                        {m.status === "invited"
                          ? "Pending"
                          : m.created_at
                            ? format(parseISO(m.created_at), "MMM d, yyyy")
                            : "Pending"}
                      </td>
                      {canManageTeam ? (
                        <td className="border-b border-gray-100 px-4 py-4 text-sm">
                          <div className="flex items-center gap-2">
                            <select
                              value={m.role}
                              onChange={(e) => void changeRole(m.id, e.target.value as TeamRole)}
                              className="rounded-lg border border-[#e5e5e5] px-2 py-1.5 text-xs text-[#1d1d1f]"
                            >
                              {ROLE_OPTIONS.map((r) => (
                                <option key={r.value} value={r.value}>
                                  {r.label}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => void removeMember(m)}
                              className="rounded-lg bg-[#dc2626] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#b91c1c]"
                            >
                              Remove
                            </button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {inviteOpen ? (
        <div className={modalOverlayZ70Class}>
          <button
            type="button"
            className="absolute inset-0"
            onClick={() => setInviteOpen(false)}
          />
          <div className={`${modalPanelClass} p-6 shadow-[0_4px_16px_rgba(0,0,0,0.08)]`}>
            <h2 className="text-lg font-semibold text-[#1d1d1f]">Add Team Member</h2>
            <div className="mt-4 space-y-4">
              <label className="block text-sm">
                <span className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">Full name</span>
                <input className="mt-1 w-full rounded-xl border border-[#e5e5e5] px-3 py-2.5 text-sm" value={inviteName} onChange={(e) => setInviteName(e.target.value)} />
              </label>
              <label className="block text-sm">
                <span className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">Email</span>
                <input type="email" className="mt-1 w-full rounded-xl border border-[#e5e5e5] px-3 py-2.5 text-sm" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
              </label>
              <label className="block text-sm">
                <span className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">Password</span>
                <input type="password" className="mt-1 w-full rounded-xl border border-[#e5e5e5] px-3 py-2.5 text-sm" value={invitePassword} onChange={(e) => setInvitePassword(e.target.value)} />
              </label>
              <label className="block text-sm">
                <span className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">Role</span>
                <select className="mt-1 w-full rounded-xl border border-[#e5e5e5] px-3 py-2.5 text-sm" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as TeamRole)}>
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-[#6e6e73]">
                {selectedRole?.description}. No invitation email will be sent.
              </p>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" className="rounded-xl border border-[#f0f0f0] bg-white px-4 py-2 text-sm font-medium text-[#1d1d1f]" onClick={() => setInviteOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void inviteMember()}
                className="rounded-xl bg-[#1d1d1f] px-4 py-2 text-sm font-medium text-white hover:bg-[#2d2d2f] disabled:opacity-50"
              >
                {submitting ? "Adding..." : "Add Member"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

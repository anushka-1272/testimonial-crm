"use client";

import Link from "next/link";

export default function SettingsHomePage() {
  return (
    <>
      <header className="sticky top-0 z-30 bg-[#f5f5f7]/90 px-8 py-6 backdrop-blur-md">
        <h1 className="text-2xl font-semibold tracking-tight text-[#1d1d1f]">
          Settings
        </h1>
        <p className="mt-1 text-sm text-[#6e6e73]">Configure CRM behavior and team access</p>
      </header>
      <main className="mx-auto max-w-5xl px-8 pb-12 pt-2">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Link
            href="/dashboard/settings/team"
            className="rounded-2xl border border-[#f0f0f0] bg-white p-6 shadow-[0_4px_16px_rgba(0,0,0,0.08)] transition-colors hover:bg-[#fafafa]"
          >
            <h2 className="text-base font-semibold text-[#1d1d1f]">Team Management</h2>
            <p className="mt-1 text-sm text-[#6e6e73]">Invite and manage CRM access</p>
          </Link>
          <Link
            href="/dashboard/settings/roster"
            className="rounded-2xl border border-[#f0f0f0] bg-white p-6 shadow-[0_4px_16px_rgba(0,0,0,0.08)] transition-colors hover:bg-[#fafafa]"
          >
            <h2 className="text-base font-semibold text-[#1d1d1f]">Team Roster</h2>
            <p className="mt-1 text-sm text-[#6e6e73]">Manage role-based member lists</p>
          </Link>
          <Link
            href="/dashboard/settings/criteria"
            className="rounded-2xl border border-[#f0f0f0] bg-white p-6 shadow-[0_4px_16px_rgba(0,0,0,0.08)] transition-colors hover:bg-[#fafafa]"
          >
            <h2 className="text-base font-semibold text-[#1d1d1f]">Eligibility Criteria</h2>
            <p className="mt-1 text-sm text-[#6e6e73]">Manage AI evaluation rules</p>
          </Link>
          <Link
            href="/dashboard/settings/deleted-entries"
            className="rounded-2xl border border-[#f0f0f0] bg-white p-6 shadow-[0_4px_16px_rgba(0,0,0,0.08)] transition-colors hover:bg-[#fafafa]"
          >
            <h2 className="text-base font-semibold text-[#1d1d1f]">Deleted Entries</h2>
            <p className="mt-1 text-sm text-[#6e6e73]">
              View and restore removed candidates
            </p>
          </Link>
        </div>
      </main>
    </>
  );
}

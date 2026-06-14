"use client";

import Link from "next/link";

export default function SettingsHomePage() {
  return (
    <>
      <header className="sticky top-14 z-30 bg-background/90 px-4 py-4 backdrop-blur-md sm:px-6 sm:py-5 lg:top-0 lg:px-8 lg:py-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Settings
        </h1>
        <p className="mt-1 text-sm text-muted">Configure CRM behavior and team access</p>
      </header>
      <main className="mx-auto max-w-5xl px-4 pb-10 pt-2 sm:px-6 lg:px-8 lg:pb-12">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Link
            href="/dashboard/settings/team"
            className="rounded-2xl border border-border-subtle bg-elevated p-6 shadow-card transition-colors hover:bg-background/80"
          >
            <h2 className="text-base font-semibold text-foreground">Team Management</h2>
            <p className="mt-1 text-sm text-muted">Invite and manage CRM access</p>
          </Link>
          <Link
            href="/dashboard/settings/roster"
            className="rounded-2xl border border-border-subtle bg-elevated p-6 shadow-card transition-colors hover:bg-background/80"
          >
            <h2 className="text-base font-semibold text-foreground">Team Roster</h2>
            <p className="mt-1 text-sm text-muted">Manage role-based member lists</p>
          </Link>
          <Link
            href="/dashboard/settings/criteria"
            className="rounded-2xl border border-border-subtle bg-elevated p-6 shadow-card transition-colors hover:bg-background/80"
          >
            <h2 className="text-base font-semibold text-foreground">Eligibility Criteria</h2>
            <p className="mt-1 text-sm text-muted">Manage AI evaluation rules</p>
          </Link>
          <Link
            href="/dashboard/settings/deleted-entries"
            className="rounded-2xl border border-border-subtle bg-elevated p-6 shadow-card transition-colors hover:bg-background/80"
          >
            <h2 className="text-base font-semibold text-foreground">Deleted Entries</h2>
            <p className="mt-1 text-sm text-muted">
              View and restore removed candidates
            </p>
          </Link>
        </div>
      </main>
    </>
  );
}

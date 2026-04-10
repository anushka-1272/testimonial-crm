"use client";

import {
  ArrowRight,
  BarChart2,
  Calendar,
  Film,
  FolderKanban,
  History,
  LayoutDashboard,
  Package,
  Settings,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { AccessControlProvider } from "@/components/access-control-context";
import { LogoOnDark } from "@/components/brand-logo";
import { canEditScope, type AccessScope, type TeamRole } from "@/lib/access-control";
import { getUserSafe } from "@/lib/supabase-auth";
import { createBrowserSupabaseClient } from "@/lib/supabase-browser";

const NAV = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    isActive: (p: string) => p === "/dashboard",
  },
  {
    href: "/dashboard/analytics",
    label: "Analytics",
    icon: BarChart2,
    isActive: (p: string) => p.startsWith("/dashboard/analytics"),
  },
  {
    href: "/dashboard/eligibility",
    label: "Eligibility",
    icon: Users,
    isActive: (p: string) => p.startsWith("/dashboard/eligibility"),
  },
  {
    href: "/dashboard/interviews",
    label: "Testimonial Interviews",
    icon: Calendar,
    isActive: (p: string) =>
      p.startsWith("/dashboard/interviews") &&
      !p.startsWith("/dashboard/project-interviews"),
  },
  {
    href: "/dashboard/project-interviews",
    label: "Project Interviews",
    icon: FolderKanban,
    isActive: (p: string) => p.startsWith("/dashboard/project-interviews"),
  },
  {
    href: "/dashboard/dispatch",
    label: "Dispatch",
    icon: Package,
    isActive: (p: string) => p.startsWith("/dashboard/dispatch"),
  },
  {
    href: "/dashboard/activity",
    label: "Activity",
    icon: History,
    isActive: (p: string) => p.startsWith("/dashboard/activity"),
  },
  {
    href: "/dashboard/post-production",
    label: "Post Production",
    icon: Film,
    isActive: (p: string) => p.startsWith("/dashboard/post-production"),
  },
  {
    href: "/dashboard/settings",
    label: "Settings",
    icon: Settings,
    isActive: (p: string) => p.startsWith("/dashboard/settings"),
  },
] as const;

function userInitials(name: string, email: string | undefined): string {
  const n = name.trim();
  if (n) {
    const parts = n.split(/\s+/).filter(Boolean);
    if (parts.length >= 2)
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return n.slice(0, 2).toUpperCase();
  }
  if (email) return email.slice(0, 2).toUpperCase();
  return "?";
}

function sidebarNameFromEmail(email: string | undefined): string {
  if (!email) return "Account";
  const local = email.split("@")[0] ?? "";
  if (!local) return "Account";
  return local.charAt(0).toUpperCase() + local.slice(1);
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = useMemo(() => {
    try {
      return createBrowserSupabaseClient();
    } catch {
      return null;
    }
  }, []);

  const [userLabel, setUserLabel] = useState("");
  const [userEmail, setUserEmail] = useState<string | undefined>();
  const [role, setRole] = useState<TeamRole>("admin");

  function scopeFromPath(path: string): AccessScope {
    if (path.startsWith("/dashboard/analytics")) return "analytics";
    if (path.startsWith("/dashboard/eligibility")) return "eligibility";
    if (path.startsWith("/dashboard/project-interviews")) return "interviews";
    if (path.startsWith("/dashboard/interviews")) return "interviews";
    if (path.startsWith("/dashboard/dispatch")) return "dispatch";
    if (path.startsWith("/dashboard/activity")) return "activity";
    if (path.startsWith("/dashboard/post-production")) return "post_production";
    if (path.startsWith("/dashboard/settings")) return "settings";
    return "dashboard";
  }

  useEffect(() => {
    if (!supabase) return;
    const ctrl = new AbortController();
    void (async () => {
      const user = await getUserSafe(supabase);
      if (ctrl.signal.aborted || !user) return;
      await supabase
        .from("team_members")
        .update({ user_id: user.id, status: "active" })
        .eq("email", (user.email ?? "").toLowerCase())
        .neq("status", "removed");
      setUserEmail(user.email ?? undefined);
      setUserLabel(sidebarNameFromEmail(user.email ?? undefined));
      const { data: tm } = await supabase
        .from("team_members")
        .select("role, status")
        .eq("user_id", user.id)
        .neq("status", "removed")
        .maybeSingle();
      if (!ctrl.signal.aborted && tm?.role) {
        setRole(tm.role as TeamRole);
      }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (ctrl.signal.aborted) return;
      const u = session?.user;
      if (!u) {
        setUserLabel("");
        setUserEmail(undefined);
        setRole("admin");
        return;
      }
      setUserEmail(u.email ?? undefined);
      setUserLabel(sidebarNameFromEmail(u.email ?? undefined));
      void (async () => {
        await supabase
          .from("team_members")
          .update({ user_id: u.id, status: "active" })
          .eq("email", (u.email ?? "").toLowerCase())
          .neq("status", "removed");
        const { data: tm } = await supabase
          .from("team_members")
          .select("role, status")
          .eq("user_id", u.id)
          .neq("status", "removed")
          .maybeSingle();
        if (!ctrl.signal.aborted && tm?.role) {
          setRole(tm.role as TeamRole);
        }
      })();
    });
    return () => {
      ctrl.abort();
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  async function handleSignOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const initials = userInitials(userLabel, userEmail);
  const currentScope = scopeFromPath(pathname);
  const canEditCurrentPage = canEditScope(role, currentScope);
  const canManageTeam = role === "admin";
  const showViewOnlyBadge = !canEditCurrentPage;

  return (
    <AccessControlProvider
      value={{ role, canManageTeam, canEditCurrentPage, showViewOnlyBadge }}
    >
      <div className="flex min-h-screen bg-[#f5f5f7] font-sans">
      <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col bg-[#0a0a0f]">
        <div className="px-4 py-5">
          <div className="flex items-center gap-2.5">
            <LogoOnDark className="h-8 w-8 shrink-0 rounded-lg" />
            <span className="text-sm font-semibold text-white">Testimonial CRM</span>
          </div>
        </div>

        <div className="flex flex-1 flex-col px-3 pt-1">
          <p className="mb-2 px-3 text-[10px] font-medium uppercase tracking-widest text-[#4b5563]">
            Navigation
          </p>
          <nav className="flex flex-col gap-0.5">
            {NAV.map(({ href, label, icon: Icon, isActive }) => {
              const active = isActive(pathname);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-3 rounded-lg py-1.5 pl-3 pr-3 text-sm transition-all duration-200 ease-in-out ${
                    active
                      ? "bg-[#1c1c2e] font-medium text-white"
                      : "text-[#6b7280] hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="mt-auto border-t border-[#1f2937] px-3 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1c1c2e] text-xs font-medium text-white">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">
                {userLabel || "…"}
              </p>
              {userEmail ? (
                <p className="truncate text-xs text-[#6b7280]">{userEmail}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="shrink-0 rounded-lg p-2 text-[#6b7280] transition-all duration-200 ease-in-out hover:bg-white/5 hover:text-white"
              aria-label="Sign out"
            >
              <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </aside>

      <div className="ml-64 flex min-h-screen flex-1 flex-col bg-[#f5f5f7]">
        {children}
      </div>
      </div>
    </AccessControlProvider>
  );
}

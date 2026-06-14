"use client";

import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

type LogoutButtonProps = {
  className?: string;
  label?: string;
  children?: ReactNode;
};

const defaultClassName =
  "rounded-lg border border-border bg-elevated px-3 py-2 text-sm font-medium text-foreground/80 shadow-sm hover:bg-background/80";

export function LogoutButton({
  className,
  label = "Sign out",
  children,
}: LogoutButtonProps) {
  const router = useRouter();
  const supabase = createClientComponentClient();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={() => void handleLogout()}
      className={className ?? defaultClassName}
    >
      {children ?? label}
    </button>
  );
}

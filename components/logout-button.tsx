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
  "rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50";

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

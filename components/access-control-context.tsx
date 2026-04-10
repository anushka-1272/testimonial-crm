"use client";

import { createContext, useContext } from "react";

import type { TeamRole } from "@/lib/access-control";

type AccessControlValue = {
  role: TeamRole;
  canManageTeam: boolean;
  canEditCurrentPage: boolean;
  showViewOnlyBadge: boolean;
};

const AccessControlContext = createContext<AccessControlValue>({
  role: "admin",
  canManageTeam: true,
  canEditCurrentPage: true,
  showViewOnlyBadge: false,
});

export function AccessControlProvider({
  value,
  children,
}: {
  value: AccessControlValue;
  children: React.ReactNode;
}) {
  return (
    <AccessControlContext.Provider value={value}>
      {children}
    </AccessControlContext.Provider>
  );
}

export function useAccessControl() {
  return useContext(AccessControlContext);
}

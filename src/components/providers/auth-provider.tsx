"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";
import { SessionSecurityGuard } from "@/components/providers/session-security-guard";

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <SessionSecurityGuard />
      {children}
    </SessionProvider>
  );
}

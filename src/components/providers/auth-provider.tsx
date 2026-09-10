"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";
import { SessionSecurityGuard } from "@/components/providers/session-security-guard";
import { RealtimeProvider } from "@/components/providers/realtime-provider";

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <SessionSecurityGuard />
      <RealtimeProvider>{children}</RealtimeProvider>
    </SessionProvider>
  );
}

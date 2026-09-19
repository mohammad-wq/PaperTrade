"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";
import { SessionSecurityGuard } from "@/components/providers/session-security-guard";
import { RealtimeProvider } from "@/components/providers/realtime-provider";
import { ConfirmProvider } from "@/components/providers/confirm-provider";

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <SessionSecurityGuard />
      <RealtimeProvider>
        <ConfirmProvider>{children}</ConfirmProvider>
      </RealtimeProvider>
    </SessionProvider>
  );
}

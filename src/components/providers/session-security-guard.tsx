"use client";

import { useEffect, useRef } from "react";
import { useSession, signOut } from "next-auth/react";
import { usePathname } from "next/navigation";

// SessionSecurityGuard:
// Relaxed for single-PC persistent office workflow.
// Maintains cross-tab sync for explicit user logouts without aggressive
// sleep detection, tab-freezing disconnects, or short idle timeouts.
const BROADCAST_CHANNEL_NAME = "paper_trade_session";

export function SessionSecurityGuard() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const isLoggingOutRef = useRef(false);

  useEffect(() => {
    if (status !== "authenticated" || !session?.user) {
      return;
    }
    if (pathname?.startsWith("/login")) {
      return;
    }

    let channel: BroadcastChannel | null = null;

    // Listen for deliberate user sign-out from other tabs
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      try {
        channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
        channel.onmessage = (event) => {
          const data = event.data;
          if (!data || typeof data !== "object") return;

          if (data.type === "FORCE_LOGOUT" && !isLoggingOutRef.current) {
            isLoggingOutRef.current = true;
            signOut({ redirect: false }).finally(() => {
              window.location.href = `/login?reason=${data.reason || "signed_out"}`;
            });
          }
        };
      } catch {
        channel = null;
      }
    }

    return () => {
      if (channel) {
        channel.close();
      }
    };
  }, [status, session, pathname]);

  return null;
}


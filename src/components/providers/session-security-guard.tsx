"use client";

import { useEffect, useRef } from "react";
import { useSession, signOut } from "next-auth/react";
import { usePathname } from "next/navigation";

const BROADCAST_CHANNEL_NAME = "paper_trade_session";
const SESSION_FLAG = "pt_browser_session";

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
    let checkTimeout: NodeJS.Timeout | null = null;

    const triggerLogout = (reason: string) => {
      if (isLoggingOutRef.current) return;
      isLoggingOutRef.current = true;
      try {
        sessionStorage.removeItem(SESSION_FLAG);
        sessionStorage.removeItem("pt_session_login_time");
      } catch {}
      signOut({ redirect: false }).finally(() => {
        window.location.href = `/login?reason=${reason}`;
      });
    };

    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      try {
        channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
        channel.onmessage = (event) => {
          const data = event.data;
          if (!data || typeof data !== "object") return;

          if (data.type === "FORCE_LOGOUT") {
            triggerLogout(data.reason || "signed_out");
          } else if (data.type === "CHECK_BROWSER_SESSION") {
            // Another tab is querying if this browser session is active
            if (sessionStorage.getItem(SESSION_FLAG) === "active") {
              channel?.postMessage({ type: "BROWSER_SESSION_PONG" });
            }
          }
        };
      } catch {
        channel = null;
      }
    }

    // Check if this window/tab has active session in this browser process
    const isSessionActive = sessionStorage.getItem(SESSION_FLAG) === "active";

    if (!isSessionActive) {
      // sessionStorage is empty! This happens when:
      // 1) The browser was closed and reopened (even if Chrome restores windows/tabs).
      // 2) A brand new tab was opened via URL while the browser was already running with another tab.
      if (channel) {
        let hasActiveSiblingTab = false;

        const onPong = (event: MessageEvent) => {
          if (event.data?.type === "BROWSER_SESSION_PONG") {
            hasActiveSiblingTab = true;
            try {
              sessionStorage.setItem(SESSION_FLAG, "active");
            } catch {}
          }
        };

        channel.addEventListener("message", onPong);
        channel.postMessage({ type: "CHECK_BROWSER_SESSION" });

        // Wait 150ms for any sibling tab in the current browser session to respond
        checkTimeout = setTimeout(() => {
          channel?.removeEventListener("message", onPong);
          if (!hasActiveSiblingTab && sessionStorage.getItem(SESSION_FLAG) !== "active") {
            // No other tabs in this browser process are active: the browser was closed!
            triggerLogout("browser_closed");
          }
        }, 150);
      } else {
        // Fallback if BroadcastChannel is unsupported
        sessionStorage.setItem(SESSION_FLAG, "active");
      }
    }

    return () => {
      if (checkTimeout) clearTimeout(checkTimeout);
      if (channel) {
        channel.close();
      }
    };
  }, [status, session, pathname]);

  return null;
}



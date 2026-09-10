"use client";

import { useEffect, useRef } from "react";
import { useSession, signOut } from "next-auth/react";
import { usePathname } from "next/navigation";

// 15 minutes inactivity limit
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;
// Sleep detection threshold: a timer tick expected every 1s delayed by > 4.5s
const SLEEP_THRESHOLD_MS = 4500;
const SESSION_STORAGE_KEY = "pt_browser_session";
const BROADCAST_CHANNEL_NAME = "paper_trade_session";

export function SessionSecurityGuard() {
  const { data: session, status } = useSession();
  const pathname = usePathname();

  const isLoggingOutRef = useRef(false);
  const lastHeartbeatRef = useRef(Date.now());
  const lastActivityRef = useRef(Date.now());

  useEffect(() => {
    // Only enforce session security for authenticated users on protected pages
    if (status !== "authenticated" || !session?.user) {
      return;
    }
    if (pathname?.startsWith("/login")) {
      return;
    }

    let isSubscribed = true;
    let worker: Worker | null = null;
    let windowIntervalId: NodeJS.Timeout | null = null;
    let channel: BroadcastChannel | null = null;

    function handleExpire(reason: "sleep" | "browser_closed" | "inactive") {
      if (isLoggingOutRef.current || !isSubscribed) return;
      isLoggingOutRef.current = true;

      try {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
        sessionStorage.removeItem("pt_session_login_time");
      } catch {
        // Storage might be restricted
      }

      if (channel) {
        try {
          channel.postMessage({ type: "FORCE_LOGOUT", reason });
        } catch {
          // Channel might be closing
        }
      }

      signOut({ redirect: false }).finally(() => {
        window.location.href = `/login?reason=${reason}`;
      });
    }

    // 1. Cross-tab communication for coordinated logout handling
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      try {
        channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
        channel.onmessage = (event) => {
          const data = event.data;
          if (!data || typeof data !== "object") return;

          if (data.type === "FORCE_LOGOUT") {
            if (!isLoggingOutRef.current) {
              isLoggingOutRef.current = true;
              try {
                sessionStorage.removeItem(SESSION_STORAGE_KEY);
              } catch {}
              signOut({ redirect: false }).finally(() => {
                window.location.href = `/login?reason=${data.reason || "expired"}`;
              });
            }
          }
        };
      } catch {
        channel = null;
      }
    }

    // Ensure the current browser tab owns a local marker so duplicate tabs can share
    // the same session state without triggering erroneous expiry on refresh.
    const hasLocalMarker = typeof window !== "undefined" && sessionStorage.getItem(SESSION_STORAGE_KEY) === "active";

    if (!hasLocalMarker) {
      try {
        sessionStorage.setItem(SESSION_STORAGE_KEY, "active");
      } catch {}
    }

    // 2. Sleep / Lid-Close Detection via Web Worker Heartbeat
    // Web Workers are immune to aggressive background tab timer throttling
    try {
      const workerBlob = new Blob(
        [
          `
          var lastTick = Date.now();
          setInterval(function() {
            var now = Date.now();
            var delta = now - lastTick;
            if (delta > ${SLEEP_THRESHOLD_MS}) {
              postMessage({ type: "SLEEP_DETECTED", delta: delta });
            }
            lastTick = now;
          }, 1000);
        `,
        ],
        { type: "application/javascript" }
      );
      const workerUrl = URL.createObjectURL(workerBlob);
      worker = new Worker(workerUrl);
      worker.onmessage = (e) => {
        if (e.data?.type === "SLEEP_DETECTED") {
          handleExpire("sleep");
        }
      };
    } catch {
      worker = null;
    }

    // Fallback/secondary window heartbeat
    lastHeartbeatRef.current = Date.now();
    windowIntervalId = setInterval(() => {
      const now = Date.now();
      const heartbeatDelta = now - lastHeartbeatRef.current;

      // Detect sleep if delta exceeds threshold while tab was visible or active
      if (heartbeatDelta > SLEEP_THRESHOLD_MS && !document.hidden) {
        handleExpire("sleep");
        return;
      }

      // Check inactivity timeout
      if (now - lastActivityRef.current > INACTIVITY_TIMEOUT_MS) {
        handleExpire("inactive");
        return;
      }

      lastHeartbeatRef.current = now;
    }, 1000);

    // 3. Document visibility & focus change detection
    const handleVisibilityOrFocus = () => {
      const now = Date.now();
      const delta = now - lastHeartbeatRef.current;

      // If document wakes up after long freeze, computer was asleep/lid closed
      if (delta > SLEEP_THRESHOLD_MS) {
        handleExpire("sleep");
        return;
      }

      // Check if user was inactive for longer than limit while away
      if (now - lastActivityRef.current > INACTIVITY_TIMEOUT_MS) {
        handleExpire("inactive");
        return;
      }

      lastHeartbeatRef.current = now;
    };

    document.addEventListener("visibilitychange", handleVisibilityOrFocus);
    window.addEventListener("focus", handleVisibilityOrFocus);

    // 4. User activity tracking (throttled to avoid excessive work)
    let lastActivityRecord = Date.now();
    const handleUserActivity = () => {
      const now = Date.now();
      if (now - lastActivityRecord > 2000) {
        lastActivityRecord = now;
        lastActivityRef.current = now;
      }
    };

    const activityEvents = ["mousedown", "keydown", "touchstart", "scroll", "click"];
    activityEvents.forEach((evt) => {
      window.addEventListener(evt, handleUserActivity, { passive: true });
    });

    return () => {
      isSubscribed = false;
      if (worker) {
        worker.terminate();
      }
      if (windowIntervalId) {
        clearInterval(windowIntervalId);
      }
      if (channel) {
        channel.close();
      }
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
      window.removeEventListener("focus", handleVisibilityOrFocus);
      activityEvents.forEach((evt) => {
        window.removeEventListener(evt, handleUserActivity);
      });
    };
  }, [status, session, pathname]);

  return null;
}


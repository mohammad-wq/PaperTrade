"use client";

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { Radio, Wifi, WifiOff } from "lucide-react";
import type { RealtimeEvent, RealtimeModule } from "@/lib/realtime";

export type RealtimeStatus = "connected" | "connecting" | "disconnected";

interface RealtimeContextValue {
  status: RealtimeStatus;
  lastEvent: RealtimeEvent | null;
  subscribe: (modules: RealtimeModule[], callback: (event: RealtimeEvent) => void) => () => void;
  broadcastLocalChange: (modules: RealtimeModule[], action?: RealtimeEvent["action"], entity?: string) => void;
}

const RealtimeContext = createContext<RealtimeContextValue>({
  status: "disconnected",
  lastEvent: null,
  subscribe: () => () => {},
  broadcastLocalChange: () => {},
});

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const [lastEvent, setLastEvent] = useState<RealtimeEvent | null>(null);
  const listenersRef = useRef<Map<string, { modules: Set<RealtimeModule>; callback: (event: RealtimeEvent) => void }>>(
    new Map()
  );
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);
  const processedEventIdsRef = useRef<Set<string>>(new Set());
  const retryAttemptRef = useRef<number>(0);

  const notifyListeners = useCallback((event: RealtimeEvent) => {
    // 1. Deduplicate by event ID to prevent multi-event trigger storms
    if (event.id) {
      if (processedEventIdsRef.current.has(event.id)) {
        return;
      }
      processedEventIdsRef.current.add(event.id);
      // Keep memory bounded to latest 200 event IDs
      if (processedEventIdsRef.current.size > 200) {
        const first = processedEventIdsRef.current.values().next().value;
        if (first) processedEventIdsRef.current.delete(first);
      }
    }

    setLastEvent(event);
    listenersRef.current.forEach(({ modules, callback }) => {
      // Check if any of the event's modules match the subscriber's modules
      const match = event.modules.some((m) => modules.has(m));
      if (match) {
        callback(event);
      }
    });
  }, []);

  const broadcastLocalChange = useCallback((modules: RealtimeModule[], action: RealtimeEvent["action"] = "update", entity = "local") => {
    const event: RealtimeEvent = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      modules,
      action,
      entity,
      timestamp: Date.now(),
    };
    notifyListeners(event);
    if (broadcastChannelRef.current) {
      try {
        broadcastChannelRef.current.postMessage(event);
      } catch {}
    }
  }, [notifyListeners]);

  const connect = useCallback(() => {
    if (typeof window === "undefined") return;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setStatus("connecting");

    try {
      const es = new EventSource("/api/realtime");
      eventSourceRef.current = es;

      es.addEventListener("open", () => {
        setStatus("connected");
        retryAttemptRef.current = 0;
      });

      es.addEventListener("change", (msg) => {
        try {
          const event: RealtimeEvent = JSON.parse(msg.data);
          notifyListeners(event);
          // Note: Server-Sent Events already arrive independently at all open tabs on this device.
          // We intentionally DO NOT echo SSE events into BroadcastChannel to avoid compounding storms.
        } catch (err) {
          console.error("Failed to parse realtime event payload:", err);
        }
      });

      es.addEventListener("error", () => {
        setStatus("disconnected");
        es.close();
        eventSourceRef.current = null;

        // Progressive backoff: 3s -> 4.5s -> 6.75s ... up to max 30s
        const backoffDelay = Math.min(30000, Math.round(3000 * Math.pow(1.5, retryAttemptRef.current)));
        retryAttemptRef.current = Math.min(retryAttemptRef.current + 1, 8);

        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, backoffDelay);
      });
    } catch {
      setStatus("disconnected");
    }
  }, [notifyListeners]);

  useEffect(() => {
    // Setup cross-tab BroadcastChannel (only for local optimistic client broadcasts)
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      try {
        const bc = new BroadcastChannel("papertrade_realtime");
        broadcastChannelRef.current = bc;
        bc.onmessage = (e) => {
          if (e.data && Array.isArray(e.data.modules)) {
            notifyListeners(e.data);
          }
        };
      } catch (err) {
        console.warn("BroadcastChannel not supported or restricted:", err);
      }
    }

    connect();

    // Re-verify stream when browser comes online or tab regains focus
    const handleOnline = () => {
      retryAttemptRef.current = 0;
      connect();
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Pause stream and clear reconnect timers while tab is hidden to save resources
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }
        setStatus("disconnected");
      } else {
        // Tab is visible again: reconnect immediately
        retryAttemptRef.current = 0;
        connect();
      }
    };

    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (broadcastChannelRef.current) {
        broadcastChannelRef.current.close();
        broadcastChannelRef.current = null;
      }
    };
  }, [connect, notifyListeners]);

  const subscribe = useCallback(
    (modules: RealtimeModule[], callback: (event: RealtimeEvent) => void) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      listenersRef.current.set(id, {
        modules: new Set(modules),
        callback,
      });

      return () => {
        listenersRef.current.delete(id);
      };
    },
    []
  );

  return (
    <RealtimeContext.Provider value={{ status, lastEvent, subscribe, broadcastLocalChange }}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime() {
  return useContext(RealtimeContext);
}

/**
 * Visual badge showing live connection status to connected users.
 */
export function RealtimeStatusBadge({ className }: { className?: string }) {
  const { status } = useRealtime();

  if (status === "connected") {
    return (
      <div
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200/80 shadow-2xs select-none ${className || ""}`}
        title="Live Sync Active: Data changes on any connected device update here immediately."
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
        </span>
        <span className="font-semibold tracking-wide">Live</span>
      </div>
    );
  }

  if (status === "connecting") {
    return (
      <div
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200/80 shadow-2xs select-none ${className || ""}`}
        title="Reconnecting to real-time stream..."
      >
        <span className="inline-block h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
        <span>Syncing...</span>
      </div>
    );
  }

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-500 border border-slate-200 shadow-2xs select-none ${className || ""}`}
      title="Disconnected from real-time stream. Click to reconnect."
    >
      <span className="inline-block h-2 w-2 rounded-full bg-slate-400" />
      <span>Offline</span>
    </div>
  );
}

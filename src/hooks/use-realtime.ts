"use client";

import { useEffect, useRef } from "react";
import { useRealtime } from "@/components/providers/realtime-provider";
import type { RealtimeEvent, RealtimeModule } from "@/lib/realtime";

/**
 * Subscribes to real-time events for specified modules and executes onUpdate callback.
 * Events are debounced by debounceMs (default 200ms) to prevent UI jitter during bursts.
 */
export function useRealtimeListener(
  modules: RealtimeModule | RealtimeModule[],
  onUpdate: (event?: RealtimeEvent) => void,
  debounceMs = 200
) {
  const { subscribe } = useRealtime();
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const modulesKey = Array.isArray(modules) ? modules.slice().sort().join(",") : modules;

  useEffect(() => {
    const moduleList = (modulesKey ? modulesKey.split(",") : []) as RealtimeModule[];

    const unsubscribe = subscribe(moduleList, (event) => {
      if (typeof document !== "undefined" && document.hidden) {
        return; // Pause processing events while tab is hidden
      }
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        onUpdateRef.current(event);
      }, debounceMs);
    });

    return () => {
      unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [modulesKey, subscribe, debounceMs]);
}

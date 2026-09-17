import { EventEmitter } from "events";

export type RealtimeModule =
  | "sales"
  | "purchases"
  | "inventory"
  | "delivery-orders"
  | "purchase-orders"
  | "payments"
  | "expenses"
  | "parties"
  | "products"
  | "returns"
  | "stock-movements"
  | "storage-charges"
  | "dashboard"
  | "ledger"
  | "financial-years"
  | "locations"
  | "warehouse-lots";

export interface RealtimeEvent {
  id: string;
  modules: RealtimeModule[];
  action: "create" | "update" | "delete" | "status";
  entity: string;
  data?: Record<string, unknown>;
  timestamp: number;
}

// Global singleton EventEmitter to survive Fast Refresh in Next.js development
const globalForRealtime = globalThis as unknown as {
  realtimeEmitter: EventEmitter | undefined;
};

export const realtimeEmitter =
  globalForRealtime.realtimeEmitter ?? new EventEmitter();

if (process.env.NODE_ENV !== "production") {
  globalForRealtime.realtimeEmitter = realtimeEmitter;
}

// Ensure infinite listeners without warnings for multiple concurrent SSE connections
realtimeEmitter.setMaxListeners(0);

/**
 * Emits a real-time event that will be broadcast via Server-Sent Events to all connected clients.
 */
export function emitRealtimeEvent(
  modules: RealtimeModule[],
  action: RealtimeEvent["action"],
  entity: string,
  data?: Record<string, unknown>
) {
  const event: RealtimeEvent = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    modules,
    action,
    entity,
    data,
    timestamp: Date.now(),
  };

  try {
    realtimeEmitter.emit("realtime-event", event);
  } catch (err) {
    console.error("Failed to emit realtime event:", err);
  }
}

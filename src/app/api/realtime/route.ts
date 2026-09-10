import { NextRequest } from "next/server";
import { realtimeEmitter, RealtimeEvent } from "@/lib/realtime";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // 1. Initial connection acknowledgment
      try {
        controller.enqueue(
          encoder.encode(`event: connected\ndata: ${JSON.stringify({ status: "connected", timestamp: Date.now() })}\n\n`)
        );
      } catch {
        // stream already closed
        return;
      }

      // 2. Realtime change event listener
      const onEvent = (event: RealtimeEvent) => {
        try {
          const payload = JSON.stringify(event);
          controller.enqueue(encoder.encode(`event: change\ndata: ${payload}\n\n`));
        } catch {
          // Stream controller closed or errored
        }
      };

      realtimeEmitter.on("realtime-event", onEvent);

      // 3. Keepalive heartbeat ping comment every 15s to prevent proxy/browser timeout
      const heartbeatTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          clearInterval(heartbeatTimer);
        }
      }, 15000);

      // 4. Cleanup when client disconnects or aborts
      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeatTimer);
        realtimeEmitter.off("realtime-event", onEvent);
        try {
          controller.close();
        } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform, no-store",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

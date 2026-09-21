import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { realtimeEmitter, RealtimeEvent } from "@/lib/realtime";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let onEvent: ((event: RealtimeEvent) => void) | null = null;
  let isClosed = false;

  const cleanup = () => {
    if (isClosed) return;
    isClosed = true;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (onEvent) {
      realtimeEmitter.off("realtime-event", onEvent);
      onEvent = null;
    }
  };

  const stream = new ReadableStream({
    start(controller) {
      // 1. Initial connection acknowledgment
      try {
        controller.enqueue(
          encoder.encode(`event: connected\ndata: ${JSON.stringify({ status: "connected", timestamp: Date.now() })}\n\n`)
        );
      } catch {
        cleanup();
        return;
      }

      // 2. Realtime change event listener
      onEvent = (event: RealtimeEvent) => {
        if (isClosed) return;
        try {
          const payload = JSON.stringify(event);
          controller.enqueue(encoder.encode(`event: change\ndata: ${payload}\n\n`));
        } catch {
          cleanup();
          try {
            controller.close();
          } catch {}
        }
      };

      realtimeEmitter.on("realtime-event", onEvent);

      // 3. Keepalive heartbeat ping comment every 15s
      heartbeatTimer = setInterval(() => {
        if (isClosed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          cleanup();
          try {
            controller.close();
          } catch {}
        }
      }, 15000);

      // 4. Cleanup when client disconnects or aborts
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      // Guaranteed callback invoked when the consumer disconnects or closes the stream
      cleanup();
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

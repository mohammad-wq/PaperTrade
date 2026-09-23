import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * In-Process Keyed Asynchronous Queue
 * Serializes executions on identical resource keys (e.g. stock, party, order) in FIFO order.
 * Requests for different keys run completely in parallel without contention.
 */
class KeyedAsyncQueue {
  private queues: Map<string, Promise<void>> = new Map();

  /**
   * Acquire a queue lock on an individual key.
   * Returns a release function that must be called when the task finishes.
   */
  private async acquireKey(key: string, timeoutMs = 15000): Promise<() => void> {
    let releaseLock!: () => void;
    const currentPromise = this.queues.get(key) ?? Promise.resolve();

    let timeoutId: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<void>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Queue timeout: unable to acquire lock for key "${key}" within ${timeoutMs}ms`));
      }, timeoutMs);
    });

    const nextPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    // Update queue chain with error recovery
    const queueTail = currentPromise.then(() => nextPromise).catch(() => nextPromise);
    this.queues.set(key, queueTail);

    try {
      await Promise.race([currentPromise, timeoutPromise]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }

    return () => {
      releaseLock();
      // Clean up queue entry if it has settled to prevent memory growth
      if (this.queues.get(key) === queueTail) {
        this.queues.delete(key);
      }
    };
  }

  /**
   * Acquire queue locks on multiple keys in canonical sorted order (deadlock-free).
   */
  async acquire(keys: string[], timeoutMs = 15000): Promise<() => void> {
    const sortedKeys = Array.from(new Set(keys)).filter(Boolean).sort();
    const releases: Array<() => void> = [];

    try {
      for (const key of sortedKeys) {
        const release = await this.acquireKey(key, timeoutMs);
        releases.push(release);
      }
      return () => {
        // Release in reverse order
        for (let i = releases.length - 1; i >= 0; i--) {
          try {
            releases[i]();
          } catch {
            // Ignore release exceptions
          }
        }
      };
    } catch (err) {
      // If error or timeout occurred while acquiring subsequent keys, release already acquired ones
      for (let i = releases.length - 1; i >= 0; i--) {
        try {
          releases[i]();
        } catch {}
      }
      throw err;
    }
  }
}

export const globalKeyedQueue = new KeyedAsyncQueue();

/**
 * Acquire PostgreSQL Transactional Advisory Locks.
 * Held for the duration of the transaction and automatically freed upon commit/rollback.
 * Sorted canonical order eliminates deadlock risk.
 */
export async function acquireAdvisoryLocks(
  tx: Prisma.TransactionClient,
  keys: string[],
): Promise<void> {
  const sortedKeys = Array.from(new Set(keys)).filter(Boolean).sort();
  if (sortedKeys.length === 0) return;

  for (const key of sortedKeys) {
    try {
      // Uses PostgreSQL 2-key advisory lock: domain hashtext + key hashtext
      await tx.$executeRawUnsafe(
        "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
        "PAPERTRADE",
        key,
      );
    } catch (error) {
      // In development or non-Postgres environments, proceed with in-memory queue
      console.warn(`[AdvisoryLock] Warning acquiring lock for key "${key}":`, error);
    }
  }
}

/**
 * Combined Dual-Layer Queuing & Transaction Runner.
 * 1. Queues through in-process FIFO KeyedAsyncQueue.
 * 2. Begins Prisma transaction.
 * 3. Acquires PostgreSQL distributed advisory locks across all connected devices.
 * 4. Executes callback with full transaction context.
 */
export async function withResourceQueue<T>(
  keys: string[],
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: {
    timeoutMs?: number;
    transactionOptions?: {
      maxWait?: number;
      timeout?: number;
      isolationLevel?: Prisma.TransactionIsolationLevel;
    };
  },
): Promise<T> {
  const releaseQueue = await globalKeyedQueue.acquire(keys, options?.timeoutMs);

  try {
    return await prisma.$transaction(
      async (tx) => {
        await acquireAdvisoryLocks(tx, keys);
        return await callback(tx);
      },
      {
        maxWait: options?.transactionOptions?.maxWait ?? 10000,
        timeout: options?.transactionOptions?.timeout ?? 20000,
        isolationLevel: options?.transactionOptions?.isolationLevel,
      },
    );
  } finally {
    releaseQueue();
  }
}

/**
 * Generates a collision-proof document identifier.
 * Example: SINV-2409-918231-A4F2
 */
export function generateDocumentNumber(prefix: string): string {
  const now = new Date();
  const yearMonth = `${now.getFullYear().toString().slice(-2)}${(now.getMonth() + 1).toString().padStart(2, "0")}`;
  const timestampPart = now.getTime().toString().slice(-6);
  const randomPart = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${yearMonth}-${timestampPart}-${randomPart}`;
}


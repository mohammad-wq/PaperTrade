import { z } from "zod";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { logServerError, toUserError } from "@/lib/errors";

import { serializeDecimals } from "@/lib/serialization";

export async function handleServerActionError<T>(
  scope: string,
  fn: () => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return ok(serializeDecimals(data));
  } catch (error) {
    logServerError({ scope, error });
    return toUserError(error);
  }
}

export async function runAction<T>(
  scope: string,
  fn: () => Promise<T>,
): Promise<ActionResult<T>> {
  return handleServerActionError(scope, fn);
}

export function parseInput<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid input";
    throw new Error(`USER: ${message}`);
  }
  return parsed.data;
}

export { fail, ok };

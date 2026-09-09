import { Prisma } from "@prisma/client";
import { fail, type ActionFailure } from "@/lib/action-result";

type LogContext = {
  scope: string;
  error: unknown;
  extra?: Record<string, unknown>;
};

export function logServerError({ scope, error, extra }: LogContext) {
  console.error(
    JSON.stringify({
      level: "error",
      scope,
      extra: extra ?? {},
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : "UnknownError",
    }),
  );
}

export function toUserError(error: unknown, fallback = "Something went wrong. Please try again."): ActionFailure {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      const target = Array.isArray(error.meta?.target) ? error.meta.target.join(", ") : "this value";
      if (String(target).includes("productNo")) {
        return fail("A product with this Product No already exists.");
      }
      if (String(target).includes("invoiceNo")) {
        return fail("An invoice with this number already exists.");
      }
      if (String(target).includes("orderNo") || String(target).includes("doNo")) {
        return fail("An order with this number already exists.");
      }
      if (String(target).includes("returnNo")) {
        return fail("A return with this number already exists.");
      }
      if (String(target).includes("email")) {
        return fail("This email is already in use.");
      }
      return fail(`A record with this ${target} already exists.`);
    }
    if (error.code === "P2003") {
      return fail("This record is linked to other data and cannot be changed that way.");
    }
    if (error.code === "P2025") {
      return fail("The requested record was not found.");
    }
  }

  if (error instanceof Error && error.message.startsWith("USER:")) {
    return fail(error.message.replace(/^USER:\s*/, ""));
  }

  return fail(fallback);
}

export function userError(message: string): Error {
  return new Error(`USER: ${message}`);
}

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaWarmPromise?: Promise<void>;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

globalForPrisma.prisma = prisma;

// On server start, connect and run a trivial query so the first request does not pay the cold start.
if (!globalForPrisma.prismaWarmPromise && typeof window === "undefined") {
  globalForPrisma.prismaWarmPromise = (async () => {
    try {
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      // Ignored if offline during build
    }
  })();
}


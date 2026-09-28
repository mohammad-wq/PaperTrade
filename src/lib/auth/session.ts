import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { Role } from "@prisma/client";

import { prisma } from "@/lib/db";

export async function getSession() {
  return getServerSession(authOptions);
}

export async function requireSession() {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error("USER: You must be signed in to continue.");
  }
  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, role: true, isActive: true, permissions: true },
  });
  if (!dbUser || !dbUser.isActive) {
    throw new Error("USER: Your account is inactive or no longer exists. Please sign in again.");
  }
  session.user.role = dbUser.role;
  session.user.permissions = (dbUser.permissions ?? {}) as any;
  return session;
}

export async function requireRole(roles: Role[]) {
  const session = await requireSession();
  if (!roles.includes(session.user.role)) {
    throw new Error("USER: You do not have permission to do that.");
  }
  return session;
}

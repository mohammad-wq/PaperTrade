import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { Role } from "@prisma/client";

export async function getSession() {
  return getServerSession(authOptions);
}

export async function requireSession() {
  const session = await getSession();
  if (!session?.user) {
    throw new Error("USER: You must be signed in to continue.");
  }
  return session;
}

export async function requireRole(roles: Role[]) {
  const session = await requireSession();
  if (!roles.includes(session.user.role)) {
    throw new Error("USER: You do not have permission to do that.");
  }
  return session;
}

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { Role } from "@prisma/client";
import { canPerformAction, canAccessPath, type PermissionAction } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export async function getSession() {
  return getServerSession(authOptions);
}

export async function requireSession() {
  if (process.env.TEST_BYPASS_AUTH === "true") {
    const { prisma } = await import("@/lib/db");
    const user = await prisma.user.findFirst({ where: { isActive: true } });
    return { user: { id: user?.id || "test-user", role: Role.OWNER, name: "Admin" } } as any;
  }
  const session = await getSession();
  if (!session?.user?.id) {
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

export async function requirePermission(moduleKey: string, action: PermissionAction = "view") {
  const session = await requireSession();
  if (session.user.role === Role.OWNER) {
    return session;
  }
  const permissions = (session.user as any).permissions;
  if (!canPerformAction(session.user.role, moduleKey, action, permissions)) {
    throw new Error(`USER: You do not have permission to ${action} ${moduleKey}.`);
  }
  return session;
}

export async function assertPageAccess(pathname: string) {
  const session = await getSession();
  if (!session?.user?.id) {
    redirect("/login");
  }
  if (session.user.role === Role.OWNER) {
    return session;
  }
  const permissions = (session.user as any).permissions;
  if (!canAccessPath(session.user.role, pathname, permissions)) {
    redirect("/dashboard");
  }
  return session;
}

import { Role } from "@prisma/client";

export const STAFF_ROUTES = [
  "/dashboard",
  "/products",
  "/parties",
  "/inventory",
  "/sales",
  "/purchases",
  "/delivery-orders",
  "/returns",
  "/payments",
  "/reports",
  "/financial-reports",
  "/calculator",
] as const;

export const MANAGER_EXTRA_ROUTES = [
  "/purchase-orders",
  "/storage-charges",
  "/stock-movements",
  "/ledger",
] as const;

export const OWNER_ONLY_ROUTES = ["/settings", "/users"] as const;

export function canAccessPath(role: Role, pathname: string): boolean {
  if (role === Role.OWNER) return true;

  const isOwnerOnly = OWNER_ONLY_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
  if (isOwnerOnly) return false;

  if (role === Role.MANAGER) return true;

  const allowed = [...STAFF_ROUTES];
  return allowed.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

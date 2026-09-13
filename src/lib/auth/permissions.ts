import { Role } from "@prisma/client";

export type PermissionAction = "view" | "create" | "update" | "delete";

export type ModulePermission = {
  view: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
};

export type UserPermissions = Record<string, ModulePermission>;

export const MODULE_DEFINITIONS = [
  { key: "dashboard", label: "Dashboard", routes: ["/dashboard"] },
  { key: "products", label: "Products", routes: ["/products"] },
  { key: "parties", label: "Parties", routes: ["/parties"] },
  { key: "inventory", label: "Inventory", routes: ["/inventory"] },
  { key: "sales", label: "Sales", routes: ["/sales"] },
  { key: "purchases", label: "Purchases", routes: ["/purchases"] },
  { key: "delivery-orders", label: "Delivery Orders", routes: ["/delivery-orders"] },
  { key: "returns", label: "Returns", routes: ["/returns"] },
  { key: "payments", label: "Payments", routes: ["/payments"] },
  { key: "expenses", label: "Expenses", routes: ["/expenses"] },
  { key: "reports", label: "Reports", routes: ["/reports", "/financial-reports"] },
  { key: "purchase-orders", label: "Purchase Orders", routes: ["/purchase-orders"] },
  { key: "stock-movements", label: "Stock Movements", routes: ["/stock-movements"] },
  { key: "ledger", label: "Ledger", routes: ["/ledger", "/receivables-payables"] },
  { key: "storage-charges", label: "Storage Charges", routes: ["/storage-charges"] },
  { key: "users", label: "Users", routes: ["/users"] },
  { key: "settings", label: "Settings", routes: ["/settings"] },
  { key: "calculator", label: "Calculator", routes: ["/calculator"] },
] as const;

const PERMISSION_TEMPLATE: ModulePermission = {
  view: true,
  create: true,
  update: true,
  delete: true,
};

export const DEFAULT_USER_PERMISSIONS: UserPermissions = Object.fromEntries(
  MODULE_DEFINITIONS.map(({ key }) => [key, { ...PERMISSION_TEMPLATE }]),
) as UserPermissions;

export function normalizeUserPermissions(permissions?: Record<string, any> | null): UserPermissions {
  const normalized: UserPermissions = Object.fromEntries(
    MODULE_DEFINITIONS.map(({ key }) => [key, { ...PERMISSION_TEMPLATE }]),
  ) as UserPermissions;

  if (!permissions) {
    return normalized;
  }

  for (const [moduleKey, modulePermissions] of Object.entries(permissions)) {
    if (!normalized[moduleKey]) {
      continue;
    }

    const incoming = modulePermissions as Partial<ModulePermission> | undefined;
    normalized[moduleKey] = {
      view: incoming?.view ?? normalized[moduleKey].view,
      create: incoming?.create ?? normalized[moduleKey].create,
      update: incoming?.update ?? normalized[moduleKey].update,
      delete: incoming?.delete ?? normalized[moduleKey].delete,
    };
  }

  return normalized;
}

function getModuleKeyFromPath(pathname: string): string | undefined {
  const normalizedPath = pathname.split("?")[0].replace(/\/+$/, "") || "/";

  for (const definition of MODULE_DEFINITIONS) {
    const matched = definition.routes.some(
      (route) => normalizedPath === route || normalizedPath.startsWith(`${route}/`),
    );

    if (matched) {
      return definition.key;
    }
  }

  return undefined;
}

export function canAccessPath(role: Role, pathname: string, permissions?: UserPermissions | null): boolean {
  if (role === Role.OWNER) {
    return true;
  }

  const moduleKey = getModuleKeyFromPath(pathname);
  if (!moduleKey) {
    return true;
  }

  const normalizedPermissions = normalizeUserPermissions(permissions);
  return Boolean(normalizedPermissions[moduleKey]?.view ?? true);
}

export function canPerformAction(
  role: Role,
  moduleKey: string,
  action: PermissionAction,
  permissions?: UserPermissions | null,
): boolean {
  if (role === Role.OWNER) {
    return true;
  }

  const normalizedPermissions = normalizeUserPermissions(permissions);
  return Boolean(normalizedPermissions[moduleKey]?.[action] ?? true);
}

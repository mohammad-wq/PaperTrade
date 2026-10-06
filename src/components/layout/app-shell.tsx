"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  Menu,
  LayoutDashboard,
  Calculator,
  Boxes,
  Users,
  PackageSearch,
  ShoppingCart,
  Truck,
  Receipt,
  RotateCcw,
  CreditCard,
  ArrowRightLeft,
  BookOpen,
  BarChart3,
  Warehouse,
  ShieldAlert,
  Settings,
  LogOut,
  Layers,
  Banknote,
  Wallet,
  Calendar,
  MapPin,
  TrendingUp,
} from "lucide-react";
import { Role } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { RealtimeStatusBadge } from "@/components/providers/realtime-provider";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: Role[];
  badge?: string;
  moduleKey?: string;
};

type NavGroup = {
  title: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    title: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: [Role.OWNER, Role.MANAGER, Role.STAFF], moduleKey: "dashboard" },
      { href: "/analytics", label: "Executive Analytics", icon: TrendingUp, roles: [Role.OWNER, Role.MANAGER], moduleKey: "reports" },
      { href: "/calculator", label: "Paper Calculator", icon: Calculator, roles: [Role.OWNER, Role.MANAGER, Role.STAFF], moduleKey: "calculator" },
    ],
  },
  {
    title: "Catalog & Parties",
    items: [
      { href: "/products", label: "Products", icon: Boxes, roles: [Role.OWNER, Role.MANAGER, Role.STAFF], moduleKey: "products" },
      { href: "/parties", label: "Parties", icon: Users, roles: [Role.OWNER, Role.MANAGER, Role.STAFF], moduleKey: "parties" },
    ],
  },
  {
    title: "Operations",
    items: [
      { href: "/sales", label: "Sales Invoices", icon: Receipt, roles: [Role.OWNER, Role.MANAGER, Role.STAFF], moduleKey: "sales" },
      { href: "/delivery-orders", label: "Delivery Orders", icon: Truck, roles: [Role.OWNER, Role.MANAGER, Role.STAFF], moduleKey: "delivery-orders" },
      { href: "/purchases", label: "Purchase Invoices", icon: ShoppingCart, roles: [Role.OWNER, Role.MANAGER, Role.STAFF], moduleKey: "purchases" },
      { href: "/purchase-orders", label: "Purchase Orders", icon: Layers, roles: [Role.OWNER, Role.MANAGER], moduleKey: "purchase-orders" },
      { href: "/returns", label: "Returns & Notes", icon: RotateCcw, roles: [Role.OWNER, Role.MANAGER, Role.STAFF], moduleKey: "returns" },
    ],
  },
  {
    title: "Inventory & Warehousing",
    items: [
      { href: "/inventory", label: "Inventory Stock", icon: PackageSearch, roles: [Role.OWNER, Role.MANAGER, Role.STAFF], moduleKey: "inventory" },
      { href: "/partnerships", label: "Partnership Hub", icon: Warehouse, roles: [Role.OWNER, Role.MANAGER], moduleKey: "inventory" },
      { href: "/stock-movements", label: "Stock Movements", icon: ArrowRightLeft, roles: [Role.OWNER, Role.MANAGER], moduleKey: "stock-movements" },
      { href: "/settings/locations", label: "Locations & Lots", icon: MapPin, roles: [Role.OWNER], moduleKey: "inventory" },
      { href: "/storage-charges", label: "Storage Charges", icon: Warehouse, roles: [Role.OWNER, Role.MANAGER], moduleKey: "storage-charges" },
    ],
  },
  {
    title: "Finance & Accounts",
    items: [
      { href: "/payments", label: "Payments", icon: CreditCard, roles: [Role.OWNER, Role.MANAGER, Role.STAFF], moduleKey: "payments" },
      { href: "/expenses", label: "Expenses", icon: Banknote, roles: [Role.OWNER, Role.MANAGER, Role.STAFF], moduleKey: "expenses" },
      { href: "/receivables-payables", label: "Receivables & Payables", icon: Wallet, roles: [Role.OWNER, Role.MANAGER, Role.STAFF], moduleKey: "ledger" },
      { href: "/ledger", label: "General Ledger", icon: BookOpen, roles: [Role.OWNER, Role.MANAGER], moduleKey: "ledger" },
      { href: "/reports", label: "Financial Reports", icon: BarChart3, roles: [Role.OWNER, Role.MANAGER, Role.STAFF], moduleKey: "reports" },
    ],
  },
  {
    title: "System Admin",
    items: [
      { href: "/users", label: "Staff & Users", icon: ShieldAlert, roles: [Role.OWNER], moduleKey: "users" },
      { href: "/settings/financial-years", label: "Financial Years", icon: Calendar, roles: [Role.OWNER], moduleKey: "settings" },
      { href: "/settings", label: "Settings", icon: Settings, roles: [Role.OWNER], moduleKey: "settings" },
    ],
  },
];

function NavLinks({ role, onNavigate, permissions }: { role: Role; onNavigate?: () => void; permissions?: Record<string, { view: boolean; create: boolean; update: boolean; delete: boolean }> }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-5">
      {NAV_GROUPS.map((group) => {
        const visibleItems = group.items.filter((item) => {
          if (!item.roles.includes(role)) return false;
          if (role === Role.OWNER) return true;
          if (!item.moduleKey) return true;
          return permissions?.[item.moduleKey]?.view ?? true;
        });
        if (visibleItems.length === 0) return null;

        return (
          <div key={group.title} className="space-y-1">
            <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {group.title}
            </p>
            <div className="space-y-0.5">
              {visibleItems.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));
                const shouldPrefetch = item.href === "/dashboard" || item.href === "/sales" || item.href === "/products";

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch={shouldPrefetch}
                    onClick={onNavigate}
                    className={cn(
                      "group flex min-h-10 items-center justify-between rounded-lg px-3 py-2 text-xs font-medium transition-colors",
                      active
                        ? "bg-emerald-900/10 text-emerald-800 font-semibold shadow-xs"
                        : "text-slate-600 hover:bg-slate-100/80 hover:text-slate-900",
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <Icon
                        className={cn(
                          "h-4 w-4 shrink-0 transition-colors",
                          active ? "text-emerald-700" : "text-slate-500 group-hover:text-slate-800",
                        )}
                      />
                      <span>{item.label}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

export function AppShell({
  children,
  user,
}: {
  children: ReactNode;
  user: { name?: string | null; email?: string | null; role: Role; permissions?: Record<string, { view: boolean; create: boolean; update: boolean; delete: boolean }> };
}) {
  const roleBadgeStyle =
    user.role === Role.OWNER
      ? "bg-amber-100 text-amber-900 border-amber-300"
      : user.role === Role.MANAGER
        ? "bg-sky-100 text-sky-900 border-sky-300"
        : "bg-slate-100 text-slate-800 border-slate-300";

  const handleSignOut = () => {
    try {
      sessionStorage.removeItem("pt_browser_session");
      sessionStorage.removeItem("pt_session_login_time");
      if (typeof window !== "undefined" && "BroadcastChannel" in window) {
        const channel = new BroadcastChannel("paper_trade_session");
        channel.postMessage({ type: "FORCE_LOGOUT", reason: "manual" });
        channel.close();
      }
    } catch {
      // Ignore cleanup exceptions
    }
    signOut({ callbackUrl: "/login" });
  };

  return (
    <div className="min-h-screen bg-[#faf8f5]">
      {/* Mobile Top Header */}
      <header className="sticky top-0 z-40 border-b border-amber-950/10 bg-[#faf8f5]/95 backdrop-blur-md md:hidden print:hidden">
        <div className="flex min-h-14 items-center justify-between px-4">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open navigation menu">
                <Menu className="h-5 w-5 text-slate-700" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0 flex flex-col bg-[#faf8f5]">
              <SheetHeader className="border-b border-amber-950/10 p-4 text-left">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-800 text-amber-200 shadow-sm font-bold text-base">
                    PT
                  </div>
                  <div>
                    <SheetTitle className="text-base font-bold tracking-tight text-slate-900">Paper Trade</SheetTitle>
                    <p className="text-[11px] text-slate-600">Shop & Warehouse ERP</p>
                  </div>
                </div>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto px-3 py-4">
                <NavLinks role={user.role} permissions={user.permissions} />
              </div>
              <div className="border-t border-amber-950/10 p-4">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start text-xs border-amber-950/15 text-slate-700"
                  onClick={handleSignOut}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </Button>
              </div>
            </SheetContent>
          </Sheet>

          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-800 text-xs font-bold text-amber-200">
              PT
            </span>
            <span className="font-semibold text-slate-900">Paper Trade</span>
          </div>

          <div className="flex items-center gap-2">
            <RealtimeStatusBadge />
            <span className={cn("rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", roleBadgeStyle)}>
              {user.role}
            </span>
          </div>
        </div>
      </header>

      {/* Desktop Sidebar + Content Layout */}
      <div className="md:grid md:grid-cols-[16.5rem_minmax(0,1fr)] min-h-screen print:block">
        <aside className="hidden border-r border-amber-950/10 bg-[#f7f4ee]/80 backdrop-blur-sm md:flex md:flex-col md:justify-between p-4 sticky top-0 h-screen overflow-y-auto print:hidden">
          <div>
            {/* Brand Card */}
            <div className="mb-6 flex items-center justify-between rounded-xl border border-emerald-900/10 bg-white/70 p-3 shadow-xs">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-800 font-bold text-amber-200 shadow-sm text-sm">
                  PT
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-sm tracking-tight text-slate-900">Paper Trade</p>
                  <p className="text-[11px] text-slate-600 truncate">{user.name || "Paper Merchant"}</p>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <span className={cn("rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider", roleBadgeStyle)}>
                  {user.role}
                </span>
                <RealtimeStatusBadge />
              </div>
            </div>

            {/* Categorized Nav links */}
            <NavLinks role={user.role} permissions={user.permissions} />
          </div>

          {/* User Signout */}
          <div className="mt-6 border-t border-amber-950/10 pt-4">
            <Button
              className="w-full justify-start text-xs text-slate-600 hover:text-red-700 hover:bg-red-50/70 border-amber-950/10"
              variant="outline"
              onClick={handleSignOut}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign out ({user.name?.split(" ")[0] || "User"})
            </Button>
          </div>
        </aside>

        <main className="min-w-0 p-4 md:p-8 print:p-0 print:m-0 print:w-full">{children}</main>
      </div>
    </div>
  );
}

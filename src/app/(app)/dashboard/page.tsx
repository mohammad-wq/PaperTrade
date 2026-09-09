"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Wallet,
  Plus,
  ArrowRight,
  Receipt,
  ShoppingCart,
  Truck,
  PackageSearch,
  ArrowRightLeft,
  CheckCircle2,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getDashboardMetricsAction } from "@/actions/dashboard";
import { format } from "date-fns";

type DashboardData = {
  todaySalesTotal: number;
  todaySalesCount: number;
  todayPurchasesTotal: number;
  todayPurchasesCount: number;
  totalReceivables: number;
  totalPayables: number;
  lowStockCount: number;
  lowStockAlerts: Array<{
    productId: string;
    productNo: string;
    name: string;
    locationName: string;
    available: number;
    reorderLevel: number;
    unit: string;
  }>;
  recentSales: Array<{
    id: string;
    invoiceNo: string;
    customerName: string;
    locationName: string;
    date: Date;
    totalAmount: number;
    status: string;
  }>;
  recentPurchases: Array<{
    id: string;
    invoiceNo: string;
    supplierName: string;
    locationName: string;
    date: Date;
    totalAmount: number;
    status: string;
  }>;
};

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await getDashboardMetricsAction();
        if (res.success && res.data) {
          setData(res.data);
        }
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  return (
    <div className="space-y-8">
      {/* Header with Quick Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Live Trading Hub</p>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 mt-1">Dashboard</h1>
          <p className="text-sm text-slate-600">Daily turnover, stock alerts, cashflow, and recent trading documents.</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" className="bg-emerald-800 text-white hover:bg-emerald-700 shadow-sm">
            <Link href="/sales">
              <Receipt className="mr-1.5 h-4 w-4" />
              New Sale
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="border-amber-950/20 bg-white/80 text-slate-800 hover:bg-slate-100">
            <Link href="/purchases">
              <ShoppingCart className="mr-1.5 h-4 w-4" />
              New Purchase
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="border-amber-950/20 bg-white/80 text-slate-800 hover:bg-slate-100">
            <Link href="/inventory">
              <ArrowRightLeft className="mr-1.5 h-4 w-4" />
              Transfer Stock
            </Link>
          </Button>
        </div>
      </div>

      {/* Primary KPI Metrics */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* Today's Sales */}
        <Card className="border-emerald-900/15 bg-gradient-to-br from-emerald-50/70 via-white to-white shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-emerald-800">Today&apos;s Sales</CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
              <TrendingUp className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">
              PKR {data ? data.todaySalesTotal.toLocaleString() : "..."}
            </div>
            <p className="text-xs text-slate-600 mt-1">
              {data?.todaySalesCount || 0} invoice{data?.todaySalesCount === 1 ? "" : "s"} generated today
            </p>
          </CardContent>
        </Card>

        {/* Today's Purchases */}
        <Card className="border-amber-900/15 bg-gradient-to-br from-amber-50/70 via-white to-white shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-amber-800">Today&apos;s Purchases</CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
              <ShoppingCart className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">
              PKR {data ? data.todayPurchasesTotal.toLocaleString() : "..."}
            </div>
            <p className="text-xs text-slate-600 mt-1">
              {data?.todayPurchasesCount || 0} order{data?.todayPurchasesCount === 1 ? "" : "s"} received today
            </p>
          </CardContent>
        </Card>

        {/* Low Stock Alerts */}
        <Card className="border-rose-900/15 bg-gradient-to-br from-rose-50/70 via-white to-white shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-rose-800">Low Stock Items</CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-100 text-rose-700">
              <AlertTriangle className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">
              {data ? data.lowStockCount : "..."}
            </div>
            <p className="text-xs text-slate-600 mt-1">
              {data?.lowStockCount ? "Items below reorder threshold" : "All products within safe levels"}
            </p>
          </CardContent>
        </Card>

        {/* Outstanding Receivables */}
        <Card className="border-sky-900/15 bg-gradient-to-br from-sky-50/70 via-white to-white shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-sky-800">Receivables / Payables</CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
              <Wallet className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-bold text-sky-900">
              +PKR {data ? data.totalReceivables.toLocaleString() : "..."}
            </div>
            <p className="text-xs text-slate-600 mt-0.5">
              Payables: PKR {data ? data.totalPayables.toLocaleString() : "..."}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Low Stock Alerts Banner (if any) */}
      {data && data.lowStockAlerts.length > 0 && (
        <Card className="border-amber-400/40 bg-amber-50/40">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                <CardTitle className="text-base text-amber-900 font-semibold">Low Stock Threshold Warnings</CardTitle>
              </div>
              <Button asChild variant="ghost" size="sm" className="text-xs text-amber-800 hover:text-amber-950">
                <Link href="/inventory">
                  Manage inventory <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
            <CardDescription className="text-amber-800/80 text-xs">
              These paper specifications are currently at or below the minimum reorder quantity.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {data.lowStockAlerts.map((item, idx) => (
                <div key={idx} className="rounded-lg border border-amber-200 bg-white/90 p-3 shadow-2xs">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-xs text-slate-900">{item.productNo}</p>
                      <p className="text-xs text-slate-600 truncate max-w-[160px]">{item.name}</p>
                    </div>
                    <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-800">
                      {item.available} {item.unit}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500 border-t border-slate-100 pt-1.5">
                    <span>{item.locationName}</span>
                    <span className="font-medium text-slate-700">Reorder: {item.reorderLevel} Pkts</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Trading Activity */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Sales Invoices */}
        <Card className="border-amber-950/10 shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-base font-semibold text-slate-900">Recent Sales Invoices</CardTitle>
              <CardDescription className="text-xs">Latest customer billing documents</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm" className="text-xs text-emerald-800 hover:text-emerald-950">
              <Link href="/sales">
                View all <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <p className="text-xs text-slate-500 py-4 text-center">Loading sales...</p>
            ) : !data?.recentSales.length ? (
              <p className="text-xs text-slate-500 py-4 text-center">No sales invoices recorded yet.</p>
            ) : (
              data.recentSales.map((sale) => (
                <div
                  key={sale.id}
                  className="flex items-center justify-between rounded-lg border border-slate-200/70 p-3 hover:bg-slate-50/80 transition-colors"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-xs text-slate-900">{sale.invoiceNo}</span>
                      <span className="rounded-full bg-emerald-100 px-2 py-0.2 text-[10px] font-semibold text-emerald-800">
                        {sale.status}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600">{sale.customerName} • {sale.locationName}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-xs text-slate-900">PKR {sale.totalAmount.toLocaleString()}</p>
                    <p className="text-[10px] text-slate-400">{format(new Date(sale.date), "dd MMM yyyy")}</p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Recent Purchase Invoices */}
        <Card className="border-amber-950/10 shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-base font-semibold text-slate-900">Recent Purchase Invoices</CardTitle>
              <CardDescription className="text-xs">Latest inventory arrivals from suppliers</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm" className="text-xs text-amber-800 hover:text-amber-950">
              <Link href="/purchases">
                View all <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <p className="text-xs text-slate-500 py-4 text-center">Loading purchases...</p>
            ) : !data?.recentPurchases.length ? (
              <p className="text-xs text-slate-500 py-4 text-center">No purchase invoices recorded yet.</p>
            ) : (
              data.recentPurchases.map((purchase) => (
                <div
                  key={purchase.id}
                  className="flex items-center justify-between rounded-lg border border-slate-200/70 p-3 hover:bg-slate-50/80 transition-colors"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-xs text-slate-900">{purchase.invoiceNo}</span>
                      <span className="rounded-full bg-amber-100 px-2 py-0.2 text-[10px] font-semibold text-amber-800">
                        {purchase.status}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600">{purchase.supplierName} • {purchase.locationName}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-xs text-slate-900">PKR {purchase.totalAmount.toLocaleString()}</p>
                    <p className="text-[10px] text-slate-400">{format(new Date(purchase.date), "dd MMM yyyy")}</p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

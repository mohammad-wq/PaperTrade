"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import {
  Wallet,
  ArrowUpRight,
  ArrowDownLeft,
  AlertTriangle,
  Search,
  Users,
  Building2,
  FileText,
  CreditCard,
  Phone,
  Mail,
  MapPin,
  ExternalLink,
  ShieldAlert,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getReceivablesPayablesBreakdownAction } from "@/actions/dashboard";
import { useRealtimeListener } from "@/hooks/use-realtime";

type ReceivableParty = {
  id: string;
  name: string;
  type: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  creditLimit: number | null;
  balance: number;
  isOverCreditLimit: boolean;
  creditLimitUsagePercent: number | null;
  isActive: boolean;
};

type PayableParty = {
  id: string;
  name: string;
  type: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  creditLimit: number | null;
  balanceDue: number;
  rawBalance: number;
  isActive: boolean;
};

type BreakdownData = {
  totalReceivables: number;
  totalPayables: number;
  receivablesCount: number;
  payablesCount: number;
  totalOverCreditLimitCount: number;
  receivables: ReceivableParty[];
  payables: PayableParty[];
};

export default function ReceivablesPayablesPage() {
  const [data, setData] = useState<BreakdownData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"receivables" | "payables">("receivables");
  const [searchQuery, setSearchQuery] = useState("");
  const [onlyOverLimit, setOnlyOverLimit] = useState(false);

  async function loadData(isSilent = false) {
    if (!isSilent) setLoading(true);
    try {
      const res = await getReceivablesPayablesBreakdownAction();
      if (res.success && res.data) {
        setData(res.data);
      }
    } finally {
      if (!isSilent) setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  // Listen to realtime ledger, invoice, payment, and party changes
  useRealtimeListener(["sales", "purchases", "payments", "parties", "dashboard"], () => {
    void loadData(true);
  });

  const filteredReceivables = useMemo(() => {
    if (!data) return [];
    return data.receivables.filter((party) => {
      if (onlyOverLimit && !party.isOverCreditLimit) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        party.name.toLowerCase().includes(q) ||
        (party.phone && party.phone.toLowerCase().includes(q)) ||
        (party.email && party.email.toLowerCase().includes(q)) ||
        (party.address && party.address.toLowerCase().includes(q))
      );
    });
  }, [data, searchQuery, onlyOverLimit]);

  const filteredPayables = useMemo(() => {
    if (!data) return [];
    return data.payables.filter((party) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        party.name.toLowerCase().includes(q) ||
        (party.phone && party.phone.toLowerCase().includes(q)) ||
        (party.email && party.email.toLowerCase().includes(q)) ||
        (party.address && party.address.toLowerCase().includes(q))
      );
    });
  }, [data, searchQuery]);

  const netBalance = (data?.totalReceivables ?? 0) - (data?.totalPayables ?? 0);

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-sky-100 flex items-center justify-center text-sky-800 border border-sky-200">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                Receivables & Payables Breakdown
              </h1>
              <p className="text-xs sm:text-sm text-slate-600">
                Itemized account balances: see who owes you money and who you owe.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => loadData()}
            className="text-xs border-slate-200"
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Refresh
          </Button>
          <Button asChild size="sm" className="bg-emerald-800 text-white hover:bg-emerald-700 text-xs shadow-sm">
            <Link href="/payments">
              <CreditCard className="mr-1.5 h-3.5 w-3.5" />
              Record Payment
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="text-xs">
            <Link href="/financial-reports">
              <FileText className="mr-1.5 h-3.5 w-3.5" />
              Balance Sheet
            </Link>
          </Button>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* Receivables Card */}
        <Card className="border-emerald-200/80 bg-gradient-to-br from-emerald-50/70 via-white to-white shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-emerald-800">
              Total Receivables
            </CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
              <ArrowDownLeft className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-extrabold text-emerald-900">
              PKR {data ? data.totalReceivables.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "..."}
            </div>
            <p className="text-xs text-slate-600 mt-1 flex items-center justify-between">
              <span>{data?.receivablesCount || 0} customer account{data?.receivablesCount === 1 ? "" : "s"}</span>
              <span className="font-semibold text-emerald-700">Owed to you</span>
            </p>
          </CardContent>
        </Card>

        {/* Payables Card */}
        <Card className="border-amber-200/80 bg-gradient-to-br from-amber-50/70 via-white to-white shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-amber-800">
              Total Payables
            </CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
              <ArrowUpRight className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-extrabold text-amber-900">
              PKR {data ? data.totalPayables.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "..."}
            </div>
            <p className="text-xs text-slate-600 mt-1 flex items-center justify-between">
              <span>{data?.payablesCount || 0} supplier account{data?.payablesCount === 1 ? "" : "s"}</span>
              <span className="font-semibold text-amber-700">Owed by you</span>
            </p>
          </CardContent>
        </Card>

        {/* Net Outstanding Balance */}
        <Card className="border-sky-200/80 bg-gradient-to-br from-sky-50/70 via-white to-white shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-sky-800">
              Net Outstanding
            </CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
              <Wallet className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-extrabold ${
                netBalance >= 0 ? "text-sky-900" : "text-rose-700"
              }`}
            >
              PKR {Math.abs(netBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <p className="text-xs text-slate-600 mt-1">
              {netBalance >= 0 ? "Net surplus receivable" : "Net deficit payable"}
            </p>
          </CardContent>
        </Card>

        {/* Credit Limit Warnings */}
        <Card className="border-rose-200/80 bg-gradient-to-br from-rose-50/70 via-white to-white shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-rose-800">
              Over Credit Limit
            </CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-100 text-rose-700">
              <ShieldAlert className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-extrabold text-rose-900">
              {data ? data.totalOverCreditLimitCount : "..."}
            </div>
            <p className="text-xs text-rose-700 mt-1">
              {data?.totalOverCreditLimitCount
                ? "Customers exceeding assigned limit"
                : "All customers within credit bounds"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Navigation Tabs & Search Toolbar */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 pb-3">
          {/* Tab Buttons */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setActiveTab("receivables");
                setOnlyOverLimit(false);
              }}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
                activeTab === "receivables"
                  ? "bg-emerald-800 text-white shadow-xs"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              <Users className="h-3.5 w-3.5" />
              <span>Receivables (Who Owes You)</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${
                  activeTab === "receivables"
                    ? "bg-emerald-700 text-white"
                    : "bg-white text-slate-700 border border-slate-200"
                }`}
              >
                {data?.receivablesCount || 0}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("payables")}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
                activeTab === "payables"
                  ? "bg-amber-800 text-white shadow-xs"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              <Building2 className="h-3.5 w-3.5" />
              <span>Payables (Who You Owe)</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${
                  activeTab === "payables"
                    ? "bg-amber-700 text-white"
                    : "bg-white text-slate-700 border border-slate-200"
                }`}
              >
                {data?.payablesCount || 0}
              </span>
            </button>
          </div>

          {/* Quick Filter Badges */}
          {activeTab === "receivables" && data && data.totalOverCreditLimitCount > 0 && (
            <button
              type="button"
              onClick={() => setOnlyOverLimit(!onlyOverLimit)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors border ${
                onlyOverLimit
                  ? "bg-rose-600 text-white border-rose-700"
                  : "bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100"
              }`}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {onlyOverLimit ? "Showing Over-Limit Only" : `Filter Over-Limit (${data.totalOverCreditLimitCount})`}
            </button>
          )}
        </div>

        {/* Search Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search ${activeTab === "receivables" ? "customers" : "suppliers"} by name, phone, email, or address...`}
              className="pl-9 h-9 text-xs"
            />
          </div>
          {searchQuery && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSearchQuery("")}
              className="text-xs text-slate-500 hover:text-slate-800"
            >
              Clear Search
            </Button>
          )}
        </div>

        {/* Breakdown Tables */}
        {loading ? (
          <div className="py-16 text-center text-xs text-slate-500">
            Calculating running ledger balances and party accounts...
          </div>
        ) : activeTab === "receivables" ? (
          /* RECEIVABLES TABLE */
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                  <th className="py-3 px-3.5">Customer Name</th>
                  <th className="py-3 px-3">Contact Information</th>
                  <th className="py-3 px-3 text-right">Credit Limit</th>
                  <th className="py-3 px-3 text-right">Amount Owed (Receivable)</th>
                  <th className="py-3 px-3 text-center">Credit Exposure</th>
                  <th className="py-3 px-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredReceivables.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-slate-500">
                      {searchQuery
                        ? "No customers found matching your search term."
                        : onlyOverLimit
                        ? "No customers are currently over their credit limit."
                        : "No outstanding receivables! All customer accounts are fully settled."}
                    </td>
                  </tr>
                ) : (
                  filteredReceivables.map((customer) => (
                    <tr
                      key={customer.id}
                      className={`hover:bg-slate-50/70 transition-colors ${
                        customer.isOverCreditLimit ? "bg-rose-50/30" : ""
                      }`}
                    >
                      {/* Name & Type */}
                      <td className="py-3 px-3.5 font-semibold text-slate-900">
                        <div className="flex items-center gap-2">
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span>{customer.name}</span>
                              {customer.isOverCreditLimit && (
                                <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[9px] font-bold text-rose-800 border border-rose-200">
                                  OVER LIMIT
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-slate-500 font-normal">
                              {customer.type} • {customer.isActive ? "Active" : "Inactive"}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Contact */}
                      <td className="py-3 px-3 text-slate-600">
                        <div className="space-y-0.5 text-[11px]">
                          {customer.phone && (
                            <p className="flex items-center gap-1">
                              <Phone className="h-3 w-3 text-slate-400" />
                              <span>{customer.phone}</span>
                            </p>
                          )}
                          {customer.email && (
                            <p className="flex items-center gap-1">
                              <Mail className="h-3 w-3 text-slate-400" />
                              <span>{customer.email}</span>
                            </p>
                          )}
                          {customer.address && (
                            <p className="flex items-center gap-1 text-slate-500 truncate max-w-[200px]">
                              <MapPin className="h-3 w-3 text-slate-400 shrink-0" />
                              <span className="truncate">{customer.address}</span>
                            </p>
                          )}
                          {!customer.phone && !customer.email && !customer.address && (
                            <span className="text-slate-400 text-[10px]">—</span>
                          )}
                        </div>
                      </td>

                      {/* Credit Limit */}
                      <td className="py-3 px-3 text-right font-medium text-slate-700">
                        {customer.creditLimit ? (
                          <span>PKR {customer.creditLimit.toLocaleString()}</span>
                        ) : (
                          <span className="text-slate-400 text-[10px]">Unlimited</span>
                        )}
                      </td>

                      {/* Outstanding Balance */}
                      <td className="py-3 px-3 text-right">
                        <span className="text-sm font-extrabold text-emerald-800">
                          PKR {customer.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </td>

                      {/* Credit Exposure */}
                      <td className="py-3 px-3 text-center">
                        {customer.creditLimit ? (
                          <div className="inline-flex flex-col items-center">
                            <div className="w-24 bg-slate-200 rounded-full h-1.5 overflow-hidden">
                              <div
                                className={`h-1.5 rounded-full ${
                                  (customer.creditLimitUsagePercent ?? 0) > 100
                                    ? "bg-rose-600"
                                    : (customer.creditLimitUsagePercent ?? 0) > 80
                                    ? "bg-amber-500"
                                    : "bg-emerald-500"
                                }`}
                                style={{
                                  width: `${Math.min(100, customer.creditLimitUsagePercent ?? 0)}%`,
                                }}
                              />
                            </div>
                            <span
                              className={`text-[10px] font-bold mt-1 ${
                                (customer.creditLimitUsagePercent ?? 0) > 100
                                  ? "text-rose-700 font-extrabold"
                                  : "text-slate-600"
                              }`}
                            >
                              {customer.creditLimitUsagePercent}% utilized
                            </span>
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-400">No limit set</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <Button
                            asChild
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[10px] text-slate-700 hover:text-emerald-800"
                          >
                            <Link href={`/ledger?partyId=${customer.id}`}>
                              <FileText className="mr-1 h-3 w-3" />
                              Statement
                            </Link>
                          </Button>
                          <Button
                            asChild
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[10px] text-emerald-700 hover:bg-emerald-50 border-emerald-200"
                          >
                            <Link href={`/payments?partyId=${customer.id}`}>
                              <CreditCard className="mr-1 h-3 w-3" />
                              Receive
                            </Link>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          /* PAYABLES TABLE */
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                  <th className="py-3 px-3.5">Supplier / Paper Mill</th>
                  <th className="py-3 px-3">Contact Information</th>
                  <th className="py-3 px-3">Account Type</th>
                  <th className="py-3 px-3 text-right">Amount Owed (Payable)</th>
                  <th className="py-3 px-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredPayables.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-slate-500">
                      {searchQuery
                        ? "No suppliers found matching your search term."
                        : "No outstanding payables! All supplier bills are completely settled."}
                    </td>
                  </tr>
                ) : (
                  filteredPayables.map((supplier) => (
                    <tr key={supplier.id} className="hover:bg-slate-50/70 transition-colors">
                      {/* Name */}
                      <td className="py-3 px-3.5 font-semibold text-slate-900">
                        <div>
                          <span>{supplier.name}</span>
                          <p className="text-[10px] text-slate-500 font-normal">
                            {supplier.isActive ? "Active Supplier" : "Inactive"}
                          </p>
                        </div>
                      </td>

                      {/* Contact */}
                      <td className="py-3 px-3 text-slate-600">
                        <div className="space-y-0.5 text-[11px]">
                          {supplier.phone && (
                            <p className="flex items-center gap-1">
                              <Phone className="h-3 w-3 text-slate-400" />
                              <span>{supplier.phone}</span>
                            </p>
                          )}
                          {supplier.email && (
                            <p className="flex items-center gap-1">
                              <Mail className="h-3 w-3 text-slate-400" />
                              <span>{supplier.email}</span>
                            </p>
                          )}
                          {supplier.address && (
                            <p className="flex items-center gap-1 text-slate-500 truncate max-w-[200px]">
                              <MapPin className="h-3 w-3 text-slate-400 shrink-0" />
                              <span className="truncate">{supplier.address}</span>
                            </p>
                          )}
                          {!supplier.phone && !supplier.email && !supplier.address && (
                            <span className="text-slate-400 text-[10px]">—</span>
                          )}
                        </div>
                      </td>

                      {/* Account Type */}
                      <td className="py-3 px-3">
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700 border border-slate-200">
                          {supplier.type}
                        </span>
                      </td>

                      {/* Amount Owed */}
                      <td className="py-3 px-3 text-right">
                        <span className="text-sm font-extrabold text-amber-800">
                          PKR {supplier.balanceDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <Button
                            asChild
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[10px] text-slate-700 hover:text-amber-800"
                          >
                            <Link href={`/ledger?partyId=${supplier.id}`}>
                              <FileText className="mr-1 h-3 w-3" />
                              Statement
                            </Link>
                          </Button>
                          <Button
                            asChild
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[10px] text-amber-800 hover:bg-amber-50 border-amber-200"
                          >
                            <Link href={`/payments?partyId=${supplier.id}`}>
                              <CreditCard className="mr-1 h-3 w-3" />
                              Pay Supplier
                            </Link>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}


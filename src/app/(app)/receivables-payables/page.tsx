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
  MessageSquare,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getReceivablesPayablesBreakdownAction } from "@/actions/dashboard";
import { useRealtimeListener } from "@/hooks/use-realtime";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { canPerformAction } from "@/lib/auth/permissions";

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
  const router = useRouter();
  const { data: session } = useSession();
  const canView = !session?.user ? true : canPerformAction(session.user.role, "ledger", "view", (session.user as any).permissions);

  useEffect(() => {
    if (session?.user && !canView) {
      router.replace("/dashboard");
    }
  }, [session, canView, router]);

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

  // Keyboard shortcut '/' to search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        const searchInput = document.getElementById("search-receivables-payables");
        searchInput?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function exportToCSV() {
    if (!data) return;
    if (activeTab === "receivables") {
      const headers = ["Customer Name", "Type", "Status", "Phone", "Email", "Address", "Credit Limit", "Amount Owed (PKR)", "Limit Utilized %"];
      const rows = filteredReceivables.map((c) => [
        `"${c.name.replace(/"/g, '""')}"`,
        `"${c.type}"`,
        `"${c.isActive ? "Active" : "Inactive"}"`,
        `"${c.phone || ""}"`,
        `"${c.email || ""}"`,
        `"${(c.address || "").replace(/"/g, '""')}"`,
        c.creditLimit ?? "Unlimited",
        c.balance.toFixed(2),
        c.creditLimitUsagePercent ?? "N/A",
      ]);
      const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `Receivables_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      const headers = ["Supplier Name", "Type", "Status", "Phone", "Email", "Address", "Amount Owed (PKR)"];
      const rows = filteredPayables.map((s) => [
        `"${s.name.replace(/"/g, '""')}"`,
        `"${s.type}"`,
        `"${s.isActive ? "Active" : "Inactive"}"`,
        `"${s.phone || ""}"`,
        `"${s.email || ""}"`,
        `"${(s.address || "").replace(/"/g, '""')}"`,
        s.balanceDue.toFixed(2),
      ]);
      const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `Payables_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }

  return (
    <div className="space-y-3">
      {/* Top Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-2.5 rounded-md shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-sky-50 dark:bg-sky-950/40 rounded-md border border-sky-200 dark:border-sky-800 text-sky-800 dark:text-sky-300">
            <Wallet className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900 dark:text-slate-100 tracking-tight">
              Receivables & Payables Breakdown
            </h1>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Live balances, credit limits, and running exposure across all parties
            </p>
          </div>
        </div>

        {/* Live Aggregate Metrics Chips */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-mono">
          <span className="px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            Receivables: <strong>PKR {data ? data.totalReceivables.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : "..."}</strong>
            <span className="text-[10px] text-slate-400 font-sans ml-1">({data?.receivablesCount ?? 0})</span>
          </span>
          <span className="px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            Payables: <strong>PKR {data ? data.totalPayables.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : "..."}</strong>
            <span className="text-[10px] text-slate-400 font-sans ml-1">({data?.payablesCount ?? 0})</span>
          </span>
          <span className={`px-2 py-0.5 rounded-md border ${netBalance >= 0 ? "bg-sky-50 dark:bg-sky-950/40 text-sky-800 dark:text-sky-300 border-sky-200 dark:border-sky-800" : "bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-800"}`}>
            Net: <strong>PKR {Math.abs(netBalance).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</strong>
            <span className="text-[10px] font-sans ml-1">({netBalance >= 0 ? "Surplus" : "Deficit"})</span>
          </span>
          {Boolean(data && data.totalOverCreditLimitCount > 0) && (
            <span className="px-2 py-0.5 rounded-md bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 flex items-center gap-1 animate-pulse">
              <ShieldAlert className="h-3 w-3" />
              <strong>{data?.totalOverCreditLimitCount}</strong> Over Limit
            </span>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => loadData()}
            className="h-8 text-xs border-slate-200 dark:border-slate-800"
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Refresh
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={exportToCSV}
            className="h-8 text-xs border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300"
          >
            Export CSV
          </Button>
          <Button asChild size="sm" className="h-8 bg-emerald-800 text-white hover:bg-emerald-700 text-xs shadow-xs">
            <Link href="/payments">
              <CreditCard className="mr-1.5 h-3.5 w-3.5" />
              Record Payment
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="h-8 text-xs border-slate-200 dark:border-slate-800">
            <Link href="/reports">
              <FileText className="mr-1.5 h-3.5 w-3.5" />
              Financial Reports
            </Link>
          </Button>
        </div>
      {/* Search & Filter Toolbar */}
      <div className="flex flex-col sm:flex-row gap-2 items-center justify-between bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2.5 rounded-md shadow-xs">
        {/* Tab Pills */}
        <div className="flex items-center gap-1.5 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => {
              setActiveTab("receivables");
              setOnlyOverLimit(false);
            }}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
              activeTab === "receivables"
                ? "bg-emerald-800 text-white shadow-xs"
                : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200"
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            <span>Receivables (Customers)</span>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-mono font-bold ${
                activeTab === "receivables"
                  ? "bg-emerald-700 text-white"
                  : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
              }`}
            >
              {data?.receivablesCount || 0}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("payables")}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
              activeTab === "payables"
                ? "bg-amber-800 text-white shadow-xs"
                : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200"
            }`}
          >
            <Building2 className="h-3.5 w-3.5" />
            <span>Payables (Suppliers)</span>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-mono font-bold ${
                activeTab === "payables"
                  ? "bg-amber-700 text-white"
                  : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
              }`}
            >
              {data?.payablesCount || 0}
            </span>
          </button>

          {activeTab === "receivables" && data && data.totalOverCreditLimitCount > 0 && (
            <button
              type="button"
              onClick={() => setOnlyOverLimit(!onlyOverLimit)}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors border ${
                onlyOverLimit
                  ? "bg-rose-600 text-white border-rose-700"
                  : "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800 hover:bg-rose-100"
              }`}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {onlyOverLimit ? "Over-Limit Only" : `Over-Limit (${data.totalOverCreditLimitCount})`}
            </button>
          )}
        </div>

        {/* Search Field */}
        <div className="relative flex-1 max-w-md w-full">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <Input
            id="search-receivables-payables"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search ${activeTab === "receivables" ? "customers" : "suppliers"} by name, phone, address (Press / to focus)...`}
            className="pl-8 h-8 text-xs bg-slate-50 dark:bg-slate-950"
          />
          {searchQuery && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSearchQuery("")}
              className="absolute right-1 top-1 h-6 px-1.5 text-[10px] text-slate-500"
            >
              Clear
            </Button>
          )}
        </div>
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
                            className="h-7 px-2 text-[10px] text-slate-700 hover:text-emerald-800 border-slate-200 dark:border-slate-800"
                          >
                            <Link href={`/ledger?partyId=${customer.id}`}>
                              <FileText className="mr-1 h-3 w-3" />
                              Statement
                            </Link>
                          </Button>
                          {customer.phone && (
                            <Button
                              asChild
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-[10px] text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800"
                              title="Send WhatsApp payment reminder"
                            >
                              <a
                                href={`https://wa.me/${customer.phone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(`Assalam-o-Alaikum / Hello ${customer.name},\nThis is a friendly reminder that your outstanding balance is PKR ${customer.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.\nPlease arrange settlement at your earliest convenience.\nThank you!`)}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <MessageSquare className="mr-1 h-3 w-3 text-emerald-600" />
                                WhatsApp
                              </a>
                            </Button>
                          )}
                          <Button
                            asChild
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[10px] text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800"
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
                            className="h-7 px-2 text-[10px] text-slate-700 hover:text-amber-800 border-slate-200 dark:border-slate-800"
                          >
                            <Link href={`/ledger?partyId=${supplier.id}`}>
                              <FileText className="mr-1 h-3 w-3" />
                              Statement
                            </Link>
                          </Button>
                          {supplier.phone && (
                            <Button
                              asChild
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-[10px] text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800"
                              title="Chat on WhatsApp"
                            >
                              <a
                                href={`https://wa.me/${supplier.phone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(`Assalam-o-Alaikum / Hello ${supplier.name},\nRegarding our pending account balance of PKR ${supplier.balanceDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`)}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <MessageSquare className="mr-1 h-3 w-3 text-emerald-600" />
                                WhatsApp
                              </a>
                            </Button>
                          )}
                          <Button
                            asChild
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[10px] text-amber-800 hover:bg-amber-50 dark:hover:bg-amber-950/40 border-amber-200 dark:border-amber-800"
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


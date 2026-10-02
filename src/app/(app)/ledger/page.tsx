"use client";

import { useEffect, useState, useMemo, useRef, Suspense } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  BookOpen,
  Search,
  Printer,
  FileText,
  FileSpreadsheet,
  X,
  Calendar,
  RotateCcw,
  ArrowUpDown,
  Download,
  Share2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { listLedgerEntriesAction } from "@/actions/ledger";
import { listPartiesAction } from "@/actions/parties";
import { getBusinessInfoAction } from "@/actions/settings";
import { AccountType } from "@prisma/client";
import { formatDateTime } from "@/lib/utils";
import { useRealtimeListener } from "@/hooks/use-realtime";
import { format } from "date-fns";

type LedgerRow = {
  id: string;
  accountType: AccountType;
  debit: number;
  credit: number;
  runningBalance: number;
  voucherType: string;
  docNo: string;
  date: Date | string;
  description: string;
  referenceType: string;
  referenceId: string;
  party: { id: string; name: string; type: string; phone?: string | null } | null;
  createdBy: { name: string };
};

type SummaryVoucherRow = {
  id: string;
  date: Date;
  dateFormatted: string;
  tranNo: string;
  description: string;
  debit: number;
  credit: number;
  runningBalance: number;
  balanceFormatted: string;
  referenceType: string;
  referenceId: string;
  party: { id: string; name: string; type: string; phone?: string | null } | null;
};

export default function LedgerPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-xs text-slate-500 font-mono">
          Loading General Ledger...
        </div>
      }
    >
      <LedgerContent />
    </Suspense>
  );
}

function LedgerContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [entries, setEntries] = useState<LedgerRow[]>([]);
  const [totalDebit, setTotalDebit] = useState(0);
  const [totalCredit, setTotalCredit] = useState(0);
  const [openingBalance, setOpeningBalance] = useState(0);
  const [closingBalance, setClosingBalance] = useState(0);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [parties, setParties] = useState<Array<{ id: string; name: string; type: string; phone?: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [businessName, setBusinessName] = useState("Sughra Trader");

  // View mode: detailed (Internal Audit) vs summary (Shareable Statement)
  const initialView = searchParams.get("view") === "summary" ? "summary" : "detailed";
  const [viewMode, setViewMode] = useState<"detailed" | "summary">(initialView);

  // Filters
  const initialParty = searchParams.get("partyId") || "ALL";
  const initialStartDate = searchParams.get("startDate") || "";
  const initialEndDate = searchParams.get("endDate") || "";

  const [partyId, setPartyId] = useState(initialParty);
  const [accountType, setAccountType] = useState<string>("ALL");
  const [referenceType, setReferenceType] = useState<string>("ALL");
  const [datePreset, setDatePreset] = useState<"ALL" | "TODAY" | "THIS_WEEK" | "THIS_MONTH" | "THIS_QUARTER" | "THIS_YEAR" | "CUSTOM">(
    initialStartDate || initialEndDate ? "CUSTOM" : "ALL"
  );
  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(initialEndDate);
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Sync viewMode changes to URL params
  const updateViewMode = (newMode: "detailed" | "summary") => {
    setViewMode(newMode);
    const params = new URLSearchParams(window.location.search);
    params.set("view", newMode);
    router.replace(`${pathname}?${params.toString()}`);
  };

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Fetch business info for statement header
  useEffect(() => {
    async function loadInfo() {
      try {
        const res = await getBusinessInfoAction();
        if (res.success && res.data?.businessName) {
          setBusinessName(res.data.businessName);
        }
      } catch {
        // keep default
      }
    }
    void loadInfo();
  }, []);

  async function loadLedger(isBackground = false) {
    if (!isBackground) setLoading(true);
    try {
      const res = await listLedgerEntriesAction({
        partyId: partyId === "ALL" ? undefined : partyId,
        accountType: accountType === "ALL" ? undefined : (accountType as AccountType),
        referenceType: referenceType === "ALL" ? undefined : referenceType,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        sortOrder,
      });

      if (res.success && res.data) {
        setEntries(res.data.entries as unknown as LedgerRow[]);
        setTotalDebit(res.data.totalDebit);
        setTotalCredit(res.data.totalCredit);
        setOpeningBalance(res.data.openingBalance);
        setClosingBalance(res.data.closingBalance);
      }
    } finally {
      if (!isBackground) setLoading(false);
    }
  }

  useRealtimeListener(["ledger", "sales", "purchases", "payments", "expenses", "returns"], () => {
    void loadLedger(true);
  });

  useEffect(() => {
    async function loadParties() {
      const res = await listPartiesAction();
      if (res.success && res.data) {
        setParties(res.data as Array<{ id: string; name: string; type: string; phone?: string | null }>);
      }
    }
    void loadParties();
  }, []);

  useEffect(() => {
    void loadLedger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyId, accountType, referenceType, startDate, endDate, sortOrder]);

  function applyDatePreset(preset: "ALL" | "TODAY" | "THIS_WEEK" | "THIS_MONTH" | "THIS_QUARTER" | "THIS_YEAR") {
    setDatePreset(preset);
    const now = new Date();
    if (preset === "ALL") {
      setStartDate("");
      setEndDate("");
    } else if (preset === "TODAY") {
      const todayStr = now.toISOString().slice(0, 10);
      setStartDate(todayStr);
      setEndDate(todayStr);
    } else if (preset === "THIS_WEEK") {
      const d = new Date(now);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(d.setDate(diff));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      setStartDate(monday.toISOString().slice(0, 10));
      setEndDate(sunday.toISOString().slice(0, 10));
    } else if (preset === "THIS_MONTH") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      setStartDate(start.toISOString().slice(0, 10));
      setEndDate(end.toISOString().slice(0, 10));
    } else if (preset === "THIS_QUARTER") {
      const currentQuarter = Math.floor(now.getMonth() / 3);
      const start = new Date(now.getFullYear(), currentQuarter * 3, 1);
      const end = new Date(now.getFullYear(), (currentQuarter + 1) * 3, 0);
      setStartDate(start.toISOString().slice(0, 10));
      setEndDate(end.toISOString().slice(0, 10));
    } else if (preset === "THIS_YEAR") {
      const start = new Date(now.getFullYear(), 0, 1);
      const end = new Date(now.getFullYear(), 11, 31);
      setStartDate(start.toISOString().slice(0, 10));
      setEndDate(end.toISOString().slice(0, 10));
    }
  }

  // Raw Filtered Entries
  const filteredEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.description.toLowerCase().includes(q) ||
        e.referenceType.toLowerCase().includes(q) ||
        (e.voucherType && e.voucherType.toLowerCase().includes(q)) ||
        (e.docNo && e.docNo.toLowerCase().includes(q)) ||
        (e.party && e.party.name.toLowerCase().includes(q)),
    );
  }, [entries, query]);

  const selectedPartyObj = useMemo(
    () => (partyId !== "ALL" ? parties.find((p) => p.id === partyId) : null),
    [parties, partyId]
  );

  // Summary Ledger Aggregation: Collapse multi-line vouchers into single row per transaction
  const summaryVouchers = useMemo(() => {
    // 1. Group entries by transaction voucher
    const voucherMap = new Map<
      string,
      {
        id: string;
        date: Date;
        referenceType: string;
        referenceId: string;
        docNo: string;
        description: string;
        debit: number;
        credit: number;
        party: LedgerRow["party"];
      }
    >();

    for (const e of entries) {
      const key = e.referenceId ? `${e.referenceType}:${e.referenceId}` : e.id;
      const parsedDate = new Date(e.date);

      if (!voucherMap.has(key)) {
        // Clean Tran No format (e.g. SV 6328, PI 001)
        let tranNo = e.docNo || e.referenceId;
        if (e.referenceType === "SALE_INVOICE") {
          const rawNum = (e.docNo || "").replace(/^#/, "");
          tranNo = rawNum.startsWith("SV") ? rawNum : `SV ${rawNum}`;
        } else if (e.referenceType === "PURCHASE_INVOICE") {
          const rawNum = (e.docNo || "").replace(/^#/, "");
          tranNo = rawNum.startsWith("PI") || rawNum.startsWith("PV") ? rawNum : `PI ${rawNum}`;
        } else if (e.referenceType === "PAYMENT") {
          const rawNum = (e.docNo || "").replace(/^#/, "");
          tranNo = rawNum || "RCPT";
        }

        // Clean label
        let description = "Voucher Transaction";
        if (e.referenceType === "SALE_INVOICE") {
          description = "Total Bill Amount";
        } else if (e.referenceType === "PURCHASE_INVOICE") {
          description = "Total Purchase Amount";
        } else if (e.referenceType === "PAYMENT") {
          const lower = (e.description || "").toLowerCase();
          if (lower.includes("cheque")) {
            description = e.debit > 0 ? "Cheque Paid - Invoices Chq" : "Cheque Rcvd - Invoices Chq Rec";
          } else if (lower.includes("bank")) {
            description = e.debit > 0 ? "Bank Paid - Invoices Bank" : "Bank Rcvd - Invoices Bank Rec";
          } else {
            description = e.debit > 0 ? "Cash Paid - Invoices" : "Cash Rcvd - Invoices Cash Rec";
          }
        } else if (e.referenceType === "SALE_RETURN") {
          description = "Total Bill Return";
        } else if (e.referenceType === "PURCHASE_RETURN") {
          description = "Total Purchase Return";
        } else if (e.description) {
          // If custom voucher note, keep clean note
          description = e.description.split(" • ")[0] || e.description;
        }

        voucherMap.set(key, {
          id: e.id,
          date: parsedDate,
          referenceType: e.referenceType,
          referenceId: e.referenceId,
          docNo: tranNo,
          description,
          debit: Number(e.debit) || 0,
          credit: Number(e.credit) || 0,
          party: e.party,
        });
      } else {
        const item = voucherMap.get(key)!;
        item.debit += Number(e.debit) || 0;
        item.credit += Number(e.credit) || 0;
      }
    }

    // 2. Sort chronologically by date asc to calculate running balance step-by-step
    const list = Array.from(voucherMap.values()).sort((a, b) => a.date.getTime() - b.date.getTime());

    let running = openingBalance;
    const computed: SummaryVoucherRow[] = [];

    for (const v of list) {
      running += v.debit - v.credit;
      const drCr = running >= 0 ? "Dr" : "Cr";
      const formattedDate = format(v.date, "dd-MM-yyyy");

      computed.push({
        ...v,
        dateFormatted: formattedDate,
        tranNo: v.docNo,
        runningBalance: running,
        balanceFormatted: `${Math.abs(running).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} ${drCr}`,
      });
    }

    // 3. Filter by search query if applicable
    const q = query.trim().toLowerCase();
    const filtered = q
      ? computed.filter(
          (c) =>
            c.description.toLowerCase().includes(q) ||
            c.tranNo.toLowerCase().includes(q) ||
            (c.party && c.party.name.toLowerCase().includes(q)),
        )
      : computed;

    // 4. Return order matching user's sort selection
    return sortOrder === "desc" ? [...filtered].reverse() : filtered;
  }, [entries, openingBalance, query, sortOrder]);

  // Total sums for summary mode
  const summaryTotalDebit = useMemo(() => summaryVouchers.reduce((s, v) => s + v.debit, 0), [summaryVouchers]);
  const summaryTotalCredit = useMemo(() => summaryVouchers.reduce((s, v) => s + v.credit, 0), [summaryVouchers]);

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* ========================================================================= */}
      {/* DEDICATED PRINT STATIONERY: Matches standard professional accounting print */}
      {/* ========================================================================= */}
      <div className="hidden print:block mb-4 text-black font-sans">
        {/* Header Block */}
        <div className="border-b-2 border-black pb-3">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-bold uppercase tracking-tight">{businessName}</h1>
              <p className="text-xs font-semibold uppercase text-slate-700">Statement of Account / Ledger</p>
            </div>
            <div className="text-right">
              {selectedPartyObj ? (
                <div>
                  <p className="text-base font-bold uppercase">
                    {selectedPartyObj.phone || selectedPartyObj.id.slice(-8).toUpperCase()}{" "}
                    {selectedPartyObj.name}
                  </p>
                  <p className="text-xs text-slate-600">Account Type: {selectedPartyObj.type}</p>
                </div>
              ) : (
                <div>
                  <p className="text-base font-bold uppercase">All Party Accounts</p>
                  <p className="text-xs text-slate-600">Consolidated Register</p>
                </div>
              )}
            </div>
          </div>

          <div className="mt-3 flex justify-between items-end border-t border-black pt-1.5 text-xs font-mono">
            <div>
              <span className="font-bold">Ledger For The Period From:</span>{" "}
              {startDate ? format(new Date(startDate), "dd-MM-yyyy") : "Beginning"} To{" "}
              {endDate ? format(new Date(endDate), "dd-MM-yyyy") : "Present"}
            </div>
            <div className="text-[10px]">
              Printed: {format(new Date(), "dd-MM-yyyy hh:mm a")}
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* SCREEN TOP BANNER: Title, Counters, View Mode Switch, and Primary Actions */}
      {/* ========================================================================= */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-2.5 rounded-md shadow-xs print:hidden">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-400 rounded-md">
            <BookOpen className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100">
                {viewMode === "summary" ? "Shareable Party Statement" : "General Ledger"}
              </h1>
              <span
                className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                  viewMode === "summary"
                    ? "bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800"
                    : "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
                }`}
              >
                {viewMode === "summary" ? "Condensed Statement" : "Detailed Audit"}
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              {viewMode === "summary"
                ? "Compact, customer & supplier-facing statement with rolled up vouchers and running balances."
                : "Internal columnar audit register with individual item lines, SKUs, and accounting vouchers."}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Counters */}
          <div className="hidden sm:flex items-center gap-2 text-xs font-mono">
            {openingBalance !== 0 && (
              <span className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 px-2 py-1 rounded">
                B/F: <strong>PKR {Math.abs(openingBalance).toLocaleString()} {openingBalance >= 0 ? "Dr" : "Cr"}</strong>
              </span>
            )}
            <span className="bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 px-2 py-1 rounded">
              Debits: <strong>PKR {totalDebit.toLocaleString()}</strong>
            </span>
            <span className="bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 px-2 py-1 rounded">
              Credits: <strong>PKR {totalCredit.toLocaleString()}</strong>
            </span>
            <span
              className={`px-2 py-1 rounded border font-mono ${
                closingBalance >= 0
                  ? "bg-emerald-50 text-emerald-900 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
                  : "bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800"
              }`}
            >
              Closing: <strong>PKR {Math.abs(closingBalance).toLocaleString()} {closingBalance >= 0 ? "Dr" : "Cr"}</strong>
            </span>
          </div>

          {/* VIEW MODE TOGGLE SWITCH */}
          <div className="flex items-center p-0.5 bg-slate-100 dark:bg-slate-800 rounded-md border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() => updateViewMode("detailed")}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded transition-all ${
                viewMode === "detailed"
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
              title="Show detailed lines with product descriptions and SKUs"
            >
              <FileText className="h-3.5 w-3.5" />
              Detailed
            </button>
            <button
              type="button"
              onClick={() => updateViewMode("summary")}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded transition-all ${
                viewMode === "summary"
                  ? "bg-indigo-600 text-white shadow-xs font-bold"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
              title="Show compact shareable statement (1 row per invoice / voucher)"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Summary
            </button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setSortOrder((s) => (s === "asc" ? "desc" : "asc"))}
            className="h-8 text-xs border-slate-300 text-slate-700 gap-1.5"
            title="Toggle chronological / reverse order"
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
            {sortOrder === "asc" ? "Oldest First" : "Newest First"}
          </Button>

          {/* PDF Statement link if party is selected */}
          {partyId !== "ALL" && (
            <a
              href={`/api/pdf/reports/party-statement?download=true&partyId=${partyId}&view=${viewMode}${
                startDate ? `&startDate=${startDate}` : ""
              }${endDate ? `&endDate=${endDate}` : ""}`}
              target="_blank"
              rel="noreferrer"
            >
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs border-slate-300 text-rose-700 hover:bg-rose-50 gap-1.5 font-medium shadow-xs"
                title="Download Clean PDF Statement"
              >
                <Download className="h-3.5 w-3.5" />
                PDF
              </Button>
            </a>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            className="h-8 text-xs bg-slate-900 hover:bg-slate-800 text-white border-slate-900 gap-1.5 font-medium shadow-xs"
            title="Print Stationery Statement"
          >
            <Printer className="h-3.5 w-3.5" />
            Print Statement
          </Button>
        </div>
      </div>

      {/* Filter Bar */}
      <Card className="border-slate-200/80 bg-white dark:bg-slate-900 shadow-xs print:hidden">
        <CardContent className="p-3 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-4">
            {/* Universal Search */}
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-slate-500">Universal Search</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <Input
                  ref={searchInputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search ledger... (/)"
                  className="h-8 pl-8 pr-7 text-xs bg-slate-50 dark:bg-slate-950 border-slate-300"
                />
                {query && (
                  <button
                    onClick={() => setQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Party Account */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Party Account</label>
              <select
                value={partyId}
                onChange={(e) => {
                  setPartyId(e.target.value);
                  const p = new URLSearchParams(window.location.search);
                  if (e.target.value === "ALL") p.delete("partyId");
                  else p.set("partyId", e.target.value);
                  router.replace(`${pathname}?${p.toString()}`);
                }}
                className="w-full h-8 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 text-xs font-medium"
              >
                <option value="ALL">All Parties / General Accounts</option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.type ? `[${p.type}]` : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* Account Type */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Account Type</label>
              <select
                value={accountType}
                onChange={(e) => setAccountType(e.target.value)}
                className="w-full h-8 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 text-xs font-medium"
              >
                <option value="ALL">All Account Types</option>
                {Object.values(AccountType).map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>

            {/* Transaction / Reference Type */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Transaction Type</label>
              <select
                value={referenceType}
                onChange={(e) => setReferenceType(e.target.value)}
                className="w-full h-8 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 text-xs font-medium"
              >
                <option value="ALL">All Transaction Types</option>
                <option value="SALE_INVOICE">Sale Invoices (Estimates)</option>
                <option value="PURCHASE_INVOICE">Purchase Invoices</option>
                <option value="PAYMENT">Payments (Receipts & Vouchers)</option>
                <option value="EXPENSE">Expenses</option>
                <option value="SALE_RETURN">Sale Returns (Credit Notes)</option>
                <option value="PURCHASE_RETURN">Purchase Returns (Debit Notes)</option>
                <option value="STORAGE_CHARGE">Storage Charges</option>
                <option value="OPENING_BALANCE">Opening Balances</option>
              </select>
            </div>
          </div>

          {/* Date Period Presets & Custom Pickers */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[11px] font-semibold text-slate-500 mr-1 flex items-center gap-1">
                <Calendar className="h-3 w-3" /> Period:
              </span>
              {[
                { key: "ALL", label: "All Time" },
                { key: "TODAY", label: "Today" },
                { key: "THIS_WEEK", label: "This Week" },
                { key: "THIS_MONTH", label: "This Month" },
                { key: "THIS_QUARTER", label: "This Quarter" },
                { key: "THIS_YEAR", label: "This Year" },
              ].map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => applyDatePreset(p.key as any)}
                  className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors ${
                    datePreset === p.key && (!startDate || p.key !== "ALL")
                      ? "bg-emerald-800 text-white shadow-xs"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <span className="text-[10px] uppercase text-slate-400 font-bold">From:</span>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    setDatePreset("CUSTOM");
                  }}
                  className="h-8 text-xs w-40 min-w-[155px] px-2.5 bg-white dark:bg-slate-950 border-slate-300"
                />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] uppercase text-slate-400 font-bold">To:</span>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    setDatePreset("CUSTOM");
                  }}
                  className="h-8 text-xs w-40 min-w-[155px] px-2.5 bg-white dark:bg-slate-950 border-slate-300"
                />
              </div>
              {(startDate || endDate || partyId !== "ALL" || accountType !== "ALL" || referenceType !== "ALL") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPartyId("ALL");
                    setAccountType("ALL");
                    setReferenceType("ALL");
                    applyDatePreset("ALL");
                    setQuery("");
                    const p = new URLSearchParams();
                    p.set("view", viewMode);
                    router.replace(`${pathname}?${p.toString()}`);
                  }}
                  className="h-8 px-2 text-[11px] text-slate-500 hover:text-slate-800"
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Reset
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ========================================================================= */}
      {/* TABLE 1: SUMMARY MODE (Shareable Statement — 6 Accounting Stationery Columns) */}
      {/* ========================================================================= */}
      {viewMode === "summary" && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md shadow-xs overflow-hidden print:border-none print:shadow-none print:overflow-visible print:w-full">
          <div className="overflow-x-auto max-h-[calc(100vh-270px)] print:overflow-visible print:max-h-none print:w-full">
            <table className="w-full text-left text-xs border-collapse print:text-[9pt] print:table-auto">
              <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700 text-[11px] font-bold uppercase tracking-wider print:static print:bg-slate-100 print:text-black">
                <tr className="border-b border-slate-300 print:border-black">
                  <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap w-28 print:border-black print:px-2">
                    Date
                  </th>
                  <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap w-36 print:border-black print:px-2">
                    Tran. No.
                  </th>
                  <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700 min-w-[240px] print:min-w-0 print:border-black print:px-2">
                    Description
                  </th>
                  <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap w-32 font-bold text-emerald-800 dark:text-emerald-400 print:border-black print:text-black print:px-2">
                    Debit (PKR)
                  </th>
                  <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap w-32 font-bold text-amber-800 dark:text-amber-400 print:border-black print:text-black print:px-2">
                    Credit (PKR)
                  </th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap w-36 font-bold text-slate-900 dark:text-slate-100 print:text-black print:px-2">
                    Balance (PKR)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-500 font-sans font-medium">
                      Loading statement transactions...
                    </td>
                  </tr>
                ) : (
                  <>
                    {/* Row 1: Balance Brought Forward (Opening Balance) */}
                    <tr className="bg-amber-50/50 dark:bg-amber-950/20 font-semibold border-b border-slate-200/80 dark:border-slate-700 print:bg-slate-50">
                      <td className="py-2.5 px-3 border-r border-slate-200/60 dark:border-slate-800 whitespace-nowrap text-slate-600 print:border-black print:px-2 text-[11px]">
                        {startDate ? format(new Date(startDate), "dd-MM-yyyy") : "—"}
                      </td>
                      <td className="py-2.5 px-3 border-r border-slate-200/60 dark:border-slate-800 whitespace-nowrap font-bold text-slate-700 print:border-black print:px-2 text-[11px]">
                        B/F
                      </td>
                      <td className="py-2.5 px-3 border-r border-slate-200/60 dark:border-slate-800 font-sans font-bold text-slate-900 dark:text-slate-100 print:border-black print:px-2">
                        Balance Brought Forward ...
                      </td>
                      <td className="py-2.5 px-3 border-r border-slate-200/60 dark:border-slate-800 text-right whitespace-nowrap font-bold text-emerald-700 dark:text-emerald-400 print:border-black print:text-black print:px-2">
                        {openingBalance > 0
                          ? openingBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                          : "—"}
                      </td>
                      <td className="py-2.5 px-3 border-r border-slate-200/60 dark:border-slate-800 text-right whitespace-nowrap font-bold text-amber-700 dark:text-amber-400 print:border-black print:text-black print:px-2">
                        {openingBalance < 0
                          ? Math.abs(openingBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                          : "—"}
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap font-bold text-slate-900 dark:text-slate-100 print:text-black print:px-2">
                        {Math.abs(openingBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
                        {openingBalance >= 0 ? "Dr" : "Cr"}
                      </td>
                    </tr>

                    {/* Subsequent rows: One line per transaction voucher */}
                    {summaryVouchers.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-10 text-center text-slate-400 font-sans">
                          No voucher transactions found for this period.
                        </td>
                      </tr>
                    ) : (
                      summaryVouchers.map((row) => (
                        <tr
                          key={row.id}
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors print:hover:bg-transparent"
                        >
                          <td className="py-2 px-3 border-r border-slate-200/60 dark:border-slate-800 whitespace-nowrap text-slate-700 dark:text-slate-300 print:border-black print:text-black print:px-2 text-[11px]">
                            {row.dateFormatted}
                          </td>
                          <td className="py-2 px-3 border-r border-slate-200/60 dark:border-slate-800 whitespace-nowrap font-bold text-slate-800 dark:text-slate-200 print:border-black print:text-black print:px-2 text-[11px]">
                            {row.tranNo}
                          </td>
                          <td className="py-2 px-3 border-r border-slate-200/60 dark:border-slate-800 font-sans font-medium text-slate-800 dark:text-slate-200 print:border-black print:text-black print:px-2">
                            <div className="flex items-center justify-between gap-2">
                              <span>{row.description}</span>
                              {row.party && partyId === "ALL" && (
                                <span className="text-[10px] text-slate-400 font-normal">
                                  ({row.party.name})
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2 px-3 border-r border-slate-200/60 dark:border-slate-800 text-right whitespace-nowrap font-bold text-emerald-700 dark:text-emerald-400 print:border-black print:text-black print:px-2">
                            {row.debit > 0
                              ? row.debit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                              : "—"}
                          </td>
                          <td className="py-2 px-3 border-r border-slate-200/60 dark:border-slate-800 text-right whitespace-nowrap font-bold text-amber-700 dark:text-amber-400 print:border-black print:text-black print:px-2">
                            {row.credit > 0
                              ? row.credit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                              : "—"}
                          </td>
                          <td className="py-2 px-3 text-right whitespace-nowrap font-bold text-slate-900 dark:text-slate-100 print:text-black print:px-2">
                            {row.balanceFormatted}
                          </td>
                        </tr>
                      ))
                    )}
                  </>
                )}
              </tbody>

              {/* Footer Block: Totals PKR */}
              <tfoot className="bg-slate-100 dark:bg-slate-800 font-bold border-t-2 border-slate-300 dark:border-slate-700 font-mono text-xs print:bg-slate-100 print:border-black print:text-black">
                <tr className="border-b border-black">
                  <td colSpan={3} className="py-2.5 px-3 text-right font-sans uppercase font-bold print:border-black">
                    Totals PKR:
                  </td>
                  <td className="py-2.5 px-3 text-right text-emerald-800 dark:text-emerald-400 print:text-black print:border-black">
                    PKR {summaryTotalDebit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="py-2.5 px-3 text-right text-amber-800 dark:text-amber-400 print:text-black print:border-black">
                    PKR {summaryTotalCredit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-900 dark:text-slate-100 print:text-black font-extrabold">
                    PKR {Math.abs(closingBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
                    {closingBalance >= 0 ? "Dr" : "Cr"}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TABLE 2: DETAILED MODE (Internal Audit — SKUs, Quantities, Rates Breakdown) */}
      {/* ========================================================================= */}
      {viewMode === "detailed" && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md shadow-xs overflow-hidden print:border-none print:shadow-none print:overflow-visible print:w-full">
          <div className="overflow-x-auto max-h-[calc(100vh-270px)] print:overflow-visible print:max-h-none print:w-full">
            <table className="w-full text-left text-xs border-collapse print:text-[8pt] print:table-auto">
              <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700 text-[11px] font-bold uppercase tracking-wider print:static print:bg-slate-200 print:text-black">
                <tr>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap w-10 text-center print:border-black print:px-1.5">
                    #
                  </th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap w-36 print:border-black print:px-1.5">
                    Date & Time
                  </th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 min-w-[220px] print:min-w-0 print:border-black print:px-1.5">
                    Particulars / Account
                  </th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap w-36 print:border-black print:px-1.5">
                    Voucher Type & No
                  </th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap w-28 font-bold text-emerald-800 dark:text-emerald-400 print:border-black print:text-black print:px-1.5">
                    Debit (PKR)
                  </th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap w-28 font-bold text-amber-800 dark:text-amber-400 print:border-black print:text-black print:px-1.5">
                    Credit (PKR)
                  </th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap w-32 font-bold text-slate-900 dark:text-slate-100 print:border-black print:text-black print:px-1.5">
                    Balance
                  </th>
                  <th className="py-2 px-2.5 whitespace-nowrap text-right w-20 text-slate-500 print:border-black print:text-black print:px-1.5">
                    By
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-500 font-sans font-medium">
                      Loading ledger transactions...
                    </td>
                  </tr>
                ) : filteredEntries.length === 0 && openingBalance === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-500 font-sans font-medium">
                      No ledger entries found matching your selected criteria.
                    </td>
                  </tr>
                ) : (
                  <>
                    {openingBalance !== 0 && (
                      <tr className="bg-slate-50/80 dark:bg-slate-800/40 font-semibold border-b border-slate-200/80 dark:border-slate-700">
                        <td className="py-2 px-2.5 border-r border-slate-200/60 dark:border-slate-800 text-center text-slate-400 font-sans text-[11px]">
                          —
                        </td>
                        <td className="py-2 px-2.5 border-r border-slate-200/60 dark:border-slate-800 whitespace-nowrap text-slate-500 text-[11px]">
                          {startDate ? `Prior to ${startDate}` : "Beginning"}
                        </td>
                        <td className="py-2 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-sans">
                          <span className="font-bold text-slate-900 dark:text-slate-100">Opening Balance (b/f)</span>
                          <span className="text-[10px] text-slate-400 ml-1.5">Cumulative balance brought forward</span>
                        </td>
                        <td className="py-2 px-2.5 border-r border-slate-200/60 dark:border-slate-800 whitespace-nowrap text-slate-400 text-[11px]">
                          —
                        </td>
                        <td className="py-2 px-2.5 border-r border-slate-200/60 dark:border-slate-800 text-right whitespace-nowrap font-bold text-emerald-700 dark:text-emerald-400">
                          {openingBalance > 0
                            ? openingBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                            : "—"}
                        </td>
                        <td className="py-2 px-2.5 border-r border-slate-200/60 dark:border-slate-800 text-right whitespace-nowrap font-bold text-amber-700 dark:text-amber-400">
                          {openingBalance < 0
                            ? Math.abs(openingBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                            : "—"}
                        </td>
                        <td className="py-2 px-2.5 border-r border-slate-200/60 dark:border-slate-800 text-right whitespace-nowrap font-bold text-slate-900 dark:text-slate-100">
                          {Math.abs(openingBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
                          {openingBalance >= 0 ? "Dr" : "Cr"}
                        </td>
                        <td className="py-2 px-2.5 whitespace-nowrap text-right text-[10px] text-slate-400 font-sans">—</td>
                      </tr>
                    )}
                    {filteredEntries.map((entry, idx) => (
                      <tr
                        key={entry.id}
                        className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors"
                      >
                        <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 text-center text-slate-400 font-sans text-[11px]">
                          {idx + 1}
                        </td>
                        <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 whitespace-nowrap text-slate-700 dark:text-slate-300 text-[11px]">
                          {formatDateTime(entry.date)}
                        </td>
                        <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-sans">
                          <div className="flex flex-col">
                            <div className="flex items-center gap-1.5">
                              {entry.party ? (
                                <span className="font-semibold text-emerald-800 dark:text-emerald-400">
                                  {entry.party.name}{" "}
                                  <span className="text-[10px] font-normal text-slate-500">[{entry.party.type}]</span>
                                </span>
                              ) : (
                                <span className="text-slate-600 dark:text-slate-300 font-medium">General Account</span>
                              )}
                              <span className="text-[10px] px-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 font-mono">
                                {entry.accountType}
                              </span>
                            </div>
                            {entry.description && (
                              <span className="text-[11px] text-slate-600 dark:text-slate-400">
                                {entry.description}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 whitespace-nowrap text-slate-700 dark:text-slate-300 font-mono text-[11px]">
                          <span className="font-medium text-slate-800 dark:text-slate-200">
                            {entry.voucherType || entry.referenceType}
                          </span>{" "}
                          <span className="text-slate-500">
                            {entry.docNo || (entry.referenceId.length > 10 ? `#${entry.referenceId.slice(-6)}` : entry.referenceId)}
                          </span>
                        </td>
                        <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 text-right whitespace-nowrap font-bold text-emerald-700 dark:text-emerald-400">
                          {entry.debit > 0
                            ? entry.debit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                            : "—"}
                        </td>
                        <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 text-right whitespace-nowrap font-bold text-amber-700 dark:text-amber-400">
                          {entry.credit > 0
                            ? entry.credit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                            : "—"}
                        </td>
                        <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 text-right whitespace-nowrap font-bold text-slate-900 dark:text-slate-100">
                          {typeof entry.runningBalance === "number"
                            ? `${Math.abs(entry.runningBalance).toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })} ${entry.runningBalance >= 0 ? "Dr" : "Cr"}`
                            : "—"}
                        </td>
                        <td className="py-1.5 px-2.5 whitespace-nowrap text-right text-[10px] text-slate-400 font-sans truncate">
                          {entry.createdBy?.name || "System"}
                        </td>
                      </tr>
                    ))}
                  </>
                )}
              </tbody>
              {(filteredEntries.length > 0 || openingBalance !== 0) && (
                <tfoot className="bg-slate-100 dark:bg-slate-800 font-bold border-t-2 border-slate-300 dark:border-slate-700 font-mono text-xs">
                  <tr>
                    <td colSpan={4} className="py-2.5 px-3 text-right font-sans uppercase">
                      Period Total Activity & Closing Balance:
                    </td>
                    <td className="py-2.5 px-2.5 text-right text-emerald-800 dark:text-emerald-400">
                      PKR {totalDebit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="py-2.5 px-2.5 text-right text-amber-800 dark:text-amber-400">
                      PKR {totalCredit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="py-2.5 px-2.5 text-right text-slate-900 dark:text-slate-100">
                      PKR {Math.abs(closingBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
                      {closingBalance >= 0 ? "Dr" : "Cr"}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

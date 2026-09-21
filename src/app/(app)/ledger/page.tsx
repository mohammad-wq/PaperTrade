"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import {
  BookOpen,
  Search,
  ArrowDownRight,
  ArrowUpRight,
  Printer,
  FileText,
  FileSpreadsheet,
  X,
  Eye,
  Download,
  Calendar,
  RotateCcw,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listLedgerEntriesAction } from "@/actions/ledger";
import { listPartiesAction } from "@/actions/parties";
import { AccountType } from "@prisma/client";
import { format } from "date-fns";
import { useRealtimeListener } from "@/hooks/use-realtime";

type LedgerRow = {
  id: string;
  accountType: AccountType;
  debit: number;
  credit: number;
  date: Date;
  description: string;
  referenceType: string;
  referenceId: string;
  party: { id: string; name: string; type: string } | null;
  createdBy: { name: string };
};

export default function LedgerPage() {
  const [entries, setEntries] = useState<LedgerRow[]>([]);
  const [totalDebit, setTotalDebit] = useState(0);
  const [totalCredit, setTotalCredit] = useState(0);
  const [parties, setParties] = useState<Array<{ id: string; name: string; type: string }>>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [partyId, setPartyId] = useState("ALL");
  const [accountType, setAccountType] = useState<string>("ALL");
  const [referenceType, setReferenceType] = useState<string>("ALL");
  const [datePreset, setDatePreset] = useState<"ALL" | "TODAY" | "THIS_WEEK" | "THIS_MONTH" | "THIS_QUARTER" | "THIS_YEAR" | "CUSTOM">("ALL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Live PDF Preview Modal
  const [showPdfPreviewModal, setShowPdfPreviewModal] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

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

  async function loadLedger(isBackground = false) {
    if (!isBackground) setLoading(true);
    try {
      const res = await listLedgerEntriesAction({
        partyId: partyId === "ALL" ? undefined : partyId,
        accountType: accountType === "ALL" ? undefined : (accountType as AccountType),
        referenceType: referenceType === "ALL" ? undefined : referenceType,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });

      if (res.success && res.data) {
        setEntries(res.data.entries as LedgerRow[]);
        setTotalDebit(res.data.totalDebit);
        setTotalCredit(res.data.totalCredit);
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
        setParties(res.data as Array<{ id: string; name: string; type: string }>);
      }
    }
    void loadParties();
  }, []);

  useEffect(() => {
    void loadLedger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyId, accountType, referenceType, startDate, endDate]);

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

  async function handlePreviewPdf() {
    setPreviewLoading(true);
    try {
      const url = `/api/pdf/reports/general-ledger?startDate=${startDate}&endDate=${endDate}&partyId=${partyId !== "ALL" ? partyId : ""}&accountType=${accountType !== "ALL" ? accountType : ""}&referenceType=${referenceType !== "ALL" ? referenceType : ""}`;
      const res = await fetch(url);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to render General Ledger PDF");
      }
      if (pdfPreviewUrl) {
        try { URL.revokeObjectURL(pdfPreviewUrl); } catch {}
      }
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      setPdfPreviewUrl(objUrl);
      setShowPdfPreviewModal(true);
    } catch (err: any) {
      alert(err.message || "Failed to preview PDF");
    } finally {
      setPreviewLoading(false);
    }
  }

  const filteredEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.description.toLowerCase().includes(q) ||
        e.referenceType.toLowerCase().includes(q) ||
        (e.party && e.party.name.toLowerCase().includes(q)),
    );
  }, [entries, query]);

  const selectedPartyObj = useMemo(
    () => (partyId !== "ALL" ? parties.find((p) => p.id === partyId) : null),
    [parties, partyId]
  );

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Printable Black & White Header (Only visible when printing) */}
      <div className="hidden print:block mb-4 border-b-2 border-black pb-2 text-black">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-xl font-bold uppercase tracking-tight">Paper Trade Management</h1>
            <p className="text-xs font-semibold uppercase">General Ledger Audit Statement</p>
          </div>
          <div className="text-right text-[10px] space-y-0.5">
            <p>Printed: {new Date().toLocaleString()}</p>
            <p>Party Account: {selectedPartyObj ? `${selectedPartyObj.name} (${selectedPartyObj.type})` : "All Accounts"}</p>
            <p>Account Type: {accountType === "ALL" ? "All Types" : accountType}</p>
            <p>Period: {startDate ? startDate : "Beginning"} to {endDate ? endDate : "Present"}</p>
          </div>
        </div>
        <div className="mt-2 flex gap-4 text-xs font-mono border-t border-black pt-1">
          <span>Entries: <strong>{filteredEntries.length}</strong></span>
          <span>Total Debits: <strong>PKR {totalDebit.toLocaleString()}</strong></span>
          <span>Total Credits: <strong>PKR {totalCredit.toLocaleString()}</strong></span>
          <span>Net Difference: <strong>PKR {Math.abs(totalDebit - totalCredit).toLocaleString()}</strong></span>
        </div>
      </div>

      {/* Top Banner: Title, Counters, and Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-2.5 rounded-md shadow-xs print:hidden">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-400 rounded-md">
            <BookOpen className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100">
              General Ledger
            </h1>
            <p className="text-[11px] text-slate-500">
              Double-entry bookkeeping journal. Filter by party, date, transaction type, or account.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Counters */}
          <div className="hidden sm:flex items-center gap-2 text-xs font-mono">
            <span className="bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 px-2 py-1 rounded">
              Debits: <strong>PKR {totalDebit.toLocaleString()}</strong>
            </span>
            <span className="bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 px-2 py-1 rounded">
              Credits: <strong>PKR {totalCredit.toLocaleString()}</strong>
            </span>
            <span
              className={`px-2 py-1 rounded border font-mono ${
                totalDebit === totalCredit
                  ? "bg-slate-100 text-slate-700 border-slate-200"
                  : "bg-amber-50 text-amber-800 border-amber-200"
              }`}
            >
              Var: <strong>PKR {Math.abs(totalDebit - totalCredit).toLocaleString()}</strong>
            </span>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            className="h-8 text-xs border-slate-300 text-slate-700 gap-1.5"
            title="Print B&W Ledger Statement"
          >
            <Printer className="h-3.5 w-3.5" />
            Print
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handlePreviewPdf}
            disabled={previewLoading}
            className="h-8 text-xs border-emerald-600 text-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 gap-1.5 font-semibold"
            title="Preview Ledger in PDF Format"
          >
            <Eye className="h-3.5 w-3.5 text-emerald-700" />
            {previewLoading ? "Rendering..." : "Preview PDF"}
          </Button>

          <a
            href={`/api/pdf/reports/general-ledger?download=true&startDate=${startDate}&endDate=${endDate}&partyId=${partyId !== "ALL" ? partyId : ""}&accountType=${accountType !== "ALL" ? accountType : ""}&referenceType=${referenceType !== "ALL" ? referenceType : ""}`}
            target="_blank"
            rel="noreferrer"
          >
            <Button
              size="sm"
              className="h-8 text-xs bg-emerald-800 hover:bg-emerald-900 text-white font-medium shadow-xs gap-1"
            >
              <Download className="h-3.5 w-3.5" />
              Download PDF
            </Button>
          </a>
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
                onChange={(e) => setPartyId(e.target.value)}
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
                <option value="SALE_INVOICE">Sale Invoices</option>
                <option value="PURCHASE_INVOICE">Purchase Invoices</option>
                <option value="PAYMENT">Payments Received / Paid</option>
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
                  className="h-7 text-xs w-36 min-w-[145px] px-2 bg-white dark:bg-slate-950"
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
                  className="h-7 text-xs w-36 min-w-[145px] px-2 bg-white dark:bg-slate-950"
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
                  }}
                  className="h-7 px-2 text-[11px] text-slate-500 hover:text-slate-800"
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Reset
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Ledger Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md shadow-xs overflow-hidden print:border-none print:shadow-none print:overflow-visible print:w-full">
        <div className="overflow-x-auto max-h-[calc(100vh-270px)] print:overflow-visible print:max-h-none print:w-full">
          <table className="w-full text-left text-xs border-collapse print:text-[8pt] print:table-auto">
            <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700 text-[11px] font-bold uppercase tracking-wider print:static print:bg-slate-200 print:text-black">
              <tr>
                <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap w-10 text-center print:border-black print:px-1.5">#</th>
                <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap w-24 print:border-black print:px-1.5">Date</th>
                <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap w-24 print:border-black print:px-1.5">Account</th>
                <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 min-w-[160px] print:min-w-0 print:border-black print:px-1.5">Party Account</th>
                <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap w-28 print:border-black print:px-1.5">Reference</th>
                <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 min-w-[200px] print:min-w-0 print:border-black print:px-1.5">Description</th>
                <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap w-28 font-bold text-emerald-800 dark:text-emerald-400 print:border-black print:text-black print:px-1.5">Debit (PKR)</th>
                <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap w-28 font-bold text-amber-800 dark:text-amber-400 print:border-black print:text-black print:px-1.5">Credit (PKR)</th>
                <th className="py-2 px-2.5 whitespace-nowrap text-right w-24 text-slate-500 print:border-black print:text-black print:px-1.5">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-500 font-sans font-medium">
                    Loading ledger transactions...
                  </td>
                </tr>
              ) : filteredEntries.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-500 font-sans font-medium">
                    No ledger entries found matching your selected criteria.
                  </td>
                </tr>
              ) : (
                filteredEntries.map((entry, idx) => (
                  <tr
                    key={entry.id}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors"
                  >
                    <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 text-center text-slate-400 font-sans text-[11px]">
                      {idx + 1}
                    </td>
                    <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 whitespace-nowrap text-slate-700 dark:text-slate-300">
                      {format(new Date(entry.date), "dd/MM/yyyy")}
                    </td>
                    <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 whitespace-nowrap font-sans font-semibold text-[11px] text-slate-900 dark:text-slate-100">
                      {entry.accountType}
                    </td>
                    <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-sans">
                      {entry.party ? (
                        <span className="font-semibold text-emerald-800 dark:text-emerald-400">
                          {entry.party.name}{" "}
                          <span className="text-[10px] font-normal text-slate-500">({entry.party.type})</span>
                        </span>
                      ) : (
                        <span className="text-slate-400 italic text-[11px]">General Ledger</span>
                      )}
                    </td>
                    <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 whitespace-nowrap text-slate-600 dark:text-slate-400 text-[11px]">
                      {entry.referenceType}
                    </td>
                    <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-sans text-slate-700 dark:text-slate-300">
                      {entry.description}
                    </td>
                    <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 text-right whitespace-nowrap font-bold text-emerald-700 dark:text-emerald-400">
                      {entry.debit > 0 ? entry.debit.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—"}
                    </td>
                    <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 text-right whitespace-nowrap font-bold text-amber-700 dark:text-amber-400">
                      {entry.credit > 0 ? entry.credit.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—"}
                    </td>
                    <td className="py-1.5 px-2.5 whitespace-nowrap text-right text-[10px] text-slate-400 font-sans truncate">
                      {entry.createdBy?.name || "System"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {filteredEntries.length > 0 && (
              <tfoot className="bg-slate-100 dark:bg-slate-800 font-bold border-t-2 border-slate-300 dark:border-slate-700 font-mono text-xs">
                <tr>
                  <td colSpan={6} className="py-2 px-2.5 text-right font-sans uppercase">
                    Total Period Activity ({filteredEntries.length} entries):
                  </td>
                  <td className="py-2 px-2.5 text-right text-emerald-800 dark:text-emerald-400">
                    PKR {totalDebit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-2 px-2.5 text-right text-amber-800 dark:text-amber-400">
                    PKR {totalCredit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Live PDF Preview Modal */}
      {showPdfPreviewModal && pdfPreviewUrl && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 backdrop-blur-xs p-4">
          <div className="w-full max-w-5xl h-[90vh] bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-700 rounded-lg shadow-2xl flex flex-col overflow-hidden">
            <div className="bg-slate-900 text-slate-100 px-4 py-2 flex items-center justify-between border-b border-slate-800 select-none">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-emerald-400" />
                <span className="font-bold text-xs">General Ledger Statement PDF Preview</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (pdfPreviewUrl) {
                      const win = window.open(pdfPreviewUrl, "_blank");
                      win?.focus();
                    }
                  }}
                  className="h-7 text-xs border-slate-700 text-slate-200 hover:bg-slate-800 gap-1"
                  title="Open in dedicated tab for safe printing"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print / Open Tab
                </Button>
                <a
                  href={pdfPreviewUrl}
                  download={`General-Ledger-Statement-${new Date().toISOString().slice(0, 10)}.pdf`}
                  className="inline-flex items-center gap-1 h-7 px-2.5 text-xs bg-emerald-700 hover:bg-emerald-800 text-white rounded font-medium"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download
                </a>
                <button
                  onClick={() => {
                    setShowPdfPreviewModal(false);
                    if (pdfPreviewUrl) {
                      try { URL.revokeObjectURL(pdfPreviewUrl); } catch {}
                      setPdfPreviewUrl(null);
                    }
                  }}
                  className="rounded text-slate-400 hover:text-white hover:bg-slate-800 p-1"
                  title="Close Preview"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 bg-slate-100 dark:bg-slate-950 p-2">
              <iframe
                id="ledgerPdfPreviewIframe"
                src={pdfPreviewUrl}
                className="w-full h-full rounded border border-slate-200 dark:border-slate-800 bg-white"
                title="General Ledger PDF Preview"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

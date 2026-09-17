"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  Users,
  ArrowLeft,
  FileText,
  FileSpreadsheet,
  Edit2,
  Sliders,
  CheckCircle2,
  AlertCircle,
  Receipt,
  CreditCard,
  Building2,
  Phone,
  Mail,
  MapPin,
  RefreshCw,
  Printer,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getPartyDetailsAction, adjustPartyBalanceAction } from "@/actions/parties";
import { useRealtimeListener } from "@/hooks/use-realtime";
import { PartyType, Role } from "@prisma/client";
import { formatDate } from "@/lib/utils";

type PartyData = {
  id: string;
  name: string;
  type: PartyType;
  phone: string | null;
  email: string | null;
  address: string | null;
  creditLimit: number | null;
  isActive: boolean;
  balance: number;
};

type LedgerItem = {
  id: string;
  date: string;
  accountType: string;
  debit: number;
  credit: number;
  referenceType: string;
  referenceId: string;
  description: string;
  sourceYear: string | null;
};

type PaymentItem = {
  id: string;
  receiptNo: string | null;
  date: string;
  amount: number;
  method: string;
  notes: string | null;
  financialYearLabel: string | null;
  invoiceNo: string | null;
};

export default function PartyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const partyId = params.id as string;
  const isOwner = session?.user?.role === Role.OWNER;

  const [party, setParty] = useState<PartyData | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerItem[]>([]);
  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"LEDGER" | "PAYMENTS">("LEDGER");
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Adjust Balance Modal state
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [adjAmount, setAdjAmount] = useState<number | "">("");
  const [adjType, setAdjType] = useState<"DEBIT" | "CREDIT">("DEBIT");
  const [adjReason, setAdjReason] = useState("");
  const [submittingAdj, setSubmittingAdj] = useState(false);

  const loadData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const res = await getPartyDetailsAction(partyId);
      if (res.success) {
        setParty(res.data.party as PartyData);
        setLedgerEntries(res.data.ledgerEntries);
        setPayments(res.data.payments);
      } else {
        setStatusMessage({ type: "error", text: res.error || "Failed to load party details." });
      }
    } catch {
      setStatusMessage({ type: "error", text: "An error occurred while fetching party details." });
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, [partyId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useRealtimeListener(["parties", "payments", "sales", "purchases", "ledger"], () => {
    void loadData(true);
  });

  async function handleAdjustBalance(e: React.FormEvent) {
    e.preventDefault();
    if (!adjAmount || Number(adjAmount) <= 0 || !adjReason.trim()) return;
    setSubmittingAdj(true);
    setStatusMessage(null);
    try {
      const res = await adjustPartyBalanceAction({
        partyId,
        amount: Number(adjAmount),
        type: adjType,
        reason: adjReason.trim(),
      });
      if (res.success) {
        setStatusMessage({ type: "success", text: "Balance adjustment successfully posted to ledger." });
        setShowAdjustModal(false);
        setAdjAmount("");
        setAdjReason("");
        void loadData(true);
      } else {
        setStatusMessage({ type: "error", text: res.error || "Adjustment failed." });
      }
    } finally {
      setSubmittingAdj(false);
    }
  }

  // Calculate Running Balance forward
  const chronologicalEntriesWithBalance = useMemo(() => {
    // Sort oldest first to calculate running balance
    const sorted = [...ledgerEntries].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );
    let current = 0;
    const computed = sorted.map((entry) => {
      current += entry.debit - entry.credit;
      return { ...entry, runningBalance: current };
    });
    // Return newest first for display
    return computed.reverse();
  }, [ledgerEntries]);

  if (loading && !party) {
    return (
      <div className="p-8 text-center text-xs text-slate-500">
        <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-slate-400" />
        Loading party account details...
      </div>
    );
  }

  if (!party) {
    return (
      <div className="p-8 max-w-xl mx-auto text-center space-y-4">
        <AlertCircle className="h-8 w-8 text-rose-600 mx-auto" />
        <h2 className="text-base font-bold text-slate-900">Party Account Not Found</h2>
        <p className="text-xs text-slate-500">The requested party record may have been removed or does not exist.</p>
        <Button onClick={() => router.push("/parties")} size="sm" variant="outline" className="text-xs">
          <ArrowLeft className="h-3.5 w-3.5 mr-1" />
          Back to Parties Directory
        </Button>
      </div>
    );
  }

  const isCustomer = party.type === PartyType.CUSTOMER;
  const isPositive = party.balance > 0;
  const isNegative = party.balance < 0;

  return (
    <div className="space-y-6 pb-12">
      {/* Top Breadcrumbs & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/parties")}
            className="h-8 px-2 text-xs text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Parties
          </Button>
          <span className="text-slate-300">/</span>
          <span className="text-xs font-semibold text-slate-900">{party.name}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isOwner && (
            <Button
              size="sm"
              onClick={() => setShowAdjustModal(true)}
              className="text-xs h-8 bg-amber-700 hover:bg-amber-800 text-white font-medium"
            >
              <Sliders className="h-3.5 w-3.5 mr-1" />
              Adjust Balance
            </Button>
          )}

          <Link href={`/parties/${party.id}/edit`}>
            <Button variant="outline" size="sm" className="text-xs h-8 border-slate-300">
              <Edit2 className="h-3.5 w-3.5 mr-1" />
              Edit Details
            </Button>
          </Link>

          <a
            href={`/api/pdf/reports/party-statement?download=true&partyId=${party.id}`}
            target="_blank"
            rel="noreferrer"
          >
            <Button variant="outline" size="sm" className="text-xs h-8 border-slate-300 text-rose-700 hover:bg-rose-50">
              <FileText className="h-3.5 w-3.5 mr-1" />
              PDF Statement
            </Button>
          </a>

          <a href={`/api/excel/reports/party-statement?partyId=${party.id}`} download>
            <Button variant="outline" size="sm" className="text-xs h-8 border-slate-300 text-emerald-700 hover:bg-emerald-50">
              <FileSpreadsheet className="h-3.5 w-3.5 mr-1" />
              Excel Export
            </Button>
          </a>
        </div>
      </div>

      {/* Status Messages */}
      {statusMessage && (
        <div
          className={`flex items-center justify-between p-3 rounded-lg text-xs font-medium border ${
            statusMessage.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-rose-50 border-rose-200 text-rose-800"
          }`}
        >
          <div className="flex items-center gap-2">
            {statusMessage.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            ) : (
              <AlertCircle className="h-4 w-4 text-rose-600" />
            )}
            <span>{statusMessage.text}</span>
          </div>
          <button onClick={() => setStatusMessage(null)} className="text-slate-400 hover:text-slate-700 text-xs">
            ✕
          </button>
        </div>
      )}

      {/* Profile Overview Card */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Contact Info */}
        <Card className="lg:col-span-2 border-slate-200 shadow-xs bg-white">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-bold text-slate-900">{party.name}</h1>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                      isCustomer
                        ? "bg-purple-100 text-purple-800 border border-purple-200"
                        : "bg-blue-100 text-blue-800 border border-blue-200"
                    }`}
                  >
                    {party.type}
                  </span>
                  {!party.isActive && (
                    <span className="bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded text-[10px] font-bold">
                      INACTIVE
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 font-mono mt-0.5">Account ID: {party.id}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-100 text-xs text-slate-600">
              <div className="flex items-center gap-2">
                <Phone className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                <span>{party.phone || <span className="text-slate-400 italic">No phone</span>}</span>
              </div>
              <div className="flex items-center gap-2">
                <Mail className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                <span className="truncate">{party.email || <span className="text-slate-400 italic">No email</span>}</span>
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                <span className="truncate">{party.address || <span className="text-slate-400 italic">No address</span>}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Right: Balance & Credit */}
        <Card
          className={`border shadow-xs ${
            isCustomer
              ? isPositive
                ? "border-emerald-200 bg-emerald-50/40"
                : "border-slate-200 bg-white"
              : isNegative
              ? "border-rose-200 bg-rose-50/40"
              : "border-slate-200 bg-white"
          }`}
        >
          <CardContent className="p-4 flex flex-col justify-between h-full">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Current Ledger Balance
              </p>
              <div className="mt-1">
                <span className="text-2xl font-bold font-mono text-slate-900">
                  PKR {Math.abs(party.balance).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
                <span
                  className={`ml-2 text-xs font-bold ${
                    isCustomer
                      ? isPositive
                        ? "text-emerald-700"
                        : "text-slate-500"
                      : isNegative
                      ? "text-rose-700"
                      : "text-slate-500"
                  }`}
                >
                  {isCustomer
                    ? isPositive
                      ? "(Receivable)"
                      : party.balance === 0
                      ? "(Settled)"
                      : "(Credit Balance)"
                    : isNegative
                    ? "(Payable)"
                    : party.balance === 0
                    ? "(Settled)"
                    : "(Debit Balance)"}
                </span>
              </div>
            </div>

            {isCustomer && (
              <div className="mt-3 pt-2 border-t border-slate-200/60 flex items-center justify-between text-xs">
                <span className="text-slate-500">Credit Limit:</span>
                <span className="font-semibold text-slate-800">
                  {party.creditLimit ? `PKR ${party.creditLimit.toLocaleString()}` : "No Limit"}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex items-center border-b border-slate-200 gap-6">
        <button
          onClick={() => setActiveTab("LEDGER")}
          className={`pb-3 text-xs font-semibold uppercase tracking-wider transition-colors border-b-2 ${
            activeTab === "LEDGER"
              ? "border-slate-900 text-slate-900"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <span className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Ledger & Transactions ({ledgerEntries.length})
          </span>
        </button>

        <button
          onClick={() => setActiveTab("PAYMENTS")}
          className={`pb-3 text-xs font-semibold uppercase tracking-wider transition-colors border-b-2 ${
            activeTab === "PAYMENTS"
              ? "border-blue-700 text-blue-700"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <span className="flex items-center gap-2">
            <Receipt className="h-4 w-4" />
            Payments & Receipts ({payments.length})
          </span>
        </button>
      </div>

      {/* TAB 1: LEDGER ENTRIES */}
      {activeTab === "LEDGER" && (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3">Reference / Document</th>
                  <th className="py-2.5 px-3">Particulars / Description</th>
                  <th className="py-2.5 px-3 text-right">Debit (Dr)</th>
                  <th className="py-2.5 px-3 text-right">Credit (Cr)</th>
                  <th className="py-2.5 px-3 text-right">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {chronologicalEntriesWithBalance.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400">
                      No ledger transactions recorded for this account.
                    </td>
                  </tr>
                ) : (
                  chronologicalEntriesWithBalance.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">
                        {formatDate(row.date)}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-slate-100 text-slate-800 border border-slate-200">
                          {row.referenceType}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-700">
                        {row.referenceId}
                      </td>
                      <td className="py-2.5 px-3 text-slate-800 max-w-sm truncate">
                        {row.description}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-900 font-semibold">
                        {row.debit > 0
                          ? `PKR ${row.debit.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                          : "—"}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-900 font-semibold">
                        {row.credit > 0
                          ? `PKR ${row.credit.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                          : "—"}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                        PKR {row.runningBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: PAYMENTS & RECEIPTS */}
      {activeTab === "PAYMENTS" && (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                  <th className="py-2.5 px-3">Receipt No</th>
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Method</th>
                  <th className="py-2.5 px-3">Linked Invoice</th>
                  <th className="py-2.5 px-3">Notes</th>
                  <th className="py-2.5 px-3 text-right">Amount (PKR)</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payments.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400">
                      No payments or receipts recorded for this account.
                    </td>
                  </tr>
                ) : (
                  payments.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-3 font-mono font-bold text-blue-900">
                        {p.receiptNo || `RCT-${p.id.slice(0, 8)}`}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">
                        {formatDate(p.date)}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-800">
                          {p.method}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-700">
                        {p.invoiceNo || "—"}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 max-w-xs truncate">
                        {p.notes || "—"}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-900">
                        PKR {p.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <a
                          href={`/api/pdf/payment-receipt/${p.id}?download=true`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-blue-700 hover:text-blue-900 hover:bg-blue-50"
                          >
                            <Download className="h-3 w-3 mr-1" />
                            PDF Receipt
                          </Button>
                        </a>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ADJUST BALANCE MODAL (Owner Only) */}
      {showAdjustModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-lg border border-slate-200 shadow-xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Sliders className="h-4 w-4 text-amber-700" />
                Manual Balance Adjustment (Owner Only)
              </h3>
              <button
                onClick={() => setShowAdjustModal(false)}
                className="text-slate-400 hover:text-slate-700 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAdjustBalance} className="space-y-4">
              <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 border border-amber-200/70">
                <p className="font-semibold">Double-Entry Audit Integrity Notice:</p>
                <p className="mt-1 text-[11px] text-amber-800">
                  This action posts an explicit <code className="font-mono">LedgerEntry</code> with an auditable reason note. Balances are derived strictly from ledger transactions.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Adjustment Amount (PKR) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  placeholder="0.00"
                  value={adjAmount}
                  onChange={(e) => setAdjAmount(e.target.value === "" ? "" : Number(e.target.value))}
                  className="h-8 text-xs font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Adjustment Direction *</Label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setAdjType("DEBIT")}
                    className={`p-2.5 rounded border text-left transition-all ${
                      adjType === "DEBIT"
                        ? "border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <p className="text-xs font-bold text-emerald-950">DEBIT (Dr)</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {isCustomer ? "Increases amount owed to us" : "Decreases amount we owe supplier"}
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAdjType("CREDIT")}
                    className={`p-2.5 rounded border text-left transition-all ${
                      adjType === "CREDIT"
                        ? "border-blue-600 bg-blue-50 ring-1 ring-blue-600"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <p className="text-xs font-bold text-blue-950">CREDIT (Cr)</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {isCustomer ? "Decreases amount owed (discount/credit)" : "Increases amount we owe supplier"}
                    </p>
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">
                  Mandatory Audit Reason / Explanation *
                </Label>
                <Input
                  required
                  placeholder="e.g. Correcting opening balance mismatch or write-off"
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAdjustModal(false)}
                  className="h-8 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={submittingAdj || !adjAmount || !adjReason.trim()}
                  className="h-8 text-xs bg-amber-700 hover:bg-amber-800 text-white"
                >
                  {submittingAdj ? "Posting..." : "Post Balance Adjustment"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

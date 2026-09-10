"use client";

import { useEffect, useState, useMemo } from "react";
import {
  BookOpen,
  Search,
  ArrowDownRight,
  ArrowUpRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  const [parties, setParties] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [partyId, setPartyId] = useState("ALL");
  const [accountType, setAccountType] = useState<string>("ALL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [query, setQuery] = useState("");

  async function loadLedger(isBackground = false) {
    if (!isBackground) setLoading(true);
    try {
      const res = await listLedgerEntriesAction({
        partyId: partyId === "ALL" ? undefined : partyId,
        accountType: accountType === "ALL" ? undefined : (accountType as AccountType),
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
        setParties(res.data as Array<{ id: string; name: string }>);
      }
    }
    void loadParties();
  }, []);

  useEffect(() => {
    void loadLedger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyId, accountType, startDate, endDate]);

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

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-emerald-800" />
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">General Ledger</h1>
        </div>
        <p className="text-sm text-slate-600">
          Double-entry bookkeeping journal. Every financial change is recorded as an immutable ledger transaction.
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-emerald-900/15 bg-white/80">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-emerald-800 uppercase tracking-wider">Total Debits</p>
              <p className="text-xl font-bold text-slate-900 mt-0.5">PKR {totalDebit.toLocaleString()}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
              <ArrowDownRight className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-amber-900/15 bg-white/80">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-amber-800 uppercase tracking-wider">Total Credits</p>
              <p className="text-xl font-bold text-slate-900 mt-0.5">PKR {totalCredit.toLocaleString()}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
              <ArrowUpRight className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white/80">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Trial Balance Variance</p>
              <p className="text-xl font-bold text-slate-900 mt-0.5">PKR {Math.abs(totalDebit - totalCredit).toLocaleString()}</p>
            </div>
            <span className={`text-xs font-bold px-2 py-1 rounded-md ${totalDebit === totalCredit ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
              {totalDebit === totalCredit ? "Balanced" : "Active Journal"}
            </span>
          </CardContent>
        </Card>
      </div>

      {/* Filter Bar */}
      <Card className="border-slate-200/80 bg-white shadow-xs">
        <CardContent className="p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-600">Account Type</label>
              <select
                value={accountType}
                onChange={(e) => setAccountType(e.target.value)}
                className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium"
              >
                <option value="ALL">All Account Types</option>
                {Object.values(AccountType).map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-600">Party Account</label>
              <select
                value={partyId}
                onChange={(e) => setPartyId(e.target.value)}
                className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium"
              >
                <option value="ALL">All Parties</option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-600">From Date</label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-600">To Date</label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>

          <div className="relative pt-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search description, reference, or party..."
              className="pl-9 h-9 text-xs bg-slate-50/60"
            />
          </div>
        </CardContent>
      </Card>

      {/* Ledger Entries List */}
      {loading ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500 text-sm">Loading ledger entries...</CardContent>
        </Card>
      ) : filteredEntries.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500 text-sm">No ledger entries found.</CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredEntries.map((entry) => (
            <div
              key={entry.id}
              className="rounded-xl border border-slate-200/80 bg-white p-3.5 hover:bg-slate-50/80 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs"
            >
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                    {entry.accountType}
                  </span>
                  {entry.party && (
                    <span className="font-semibold text-xs text-emerald-800 truncate">
                      {entry.party.name} ({entry.party.type})
                    </span>
                  )}
                  <span className="text-[11px] text-slate-400">
                    {format(new Date(entry.date), "dd MMM yyyy")}
                  </span>
                </div>
                <p className="text-xs text-slate-700">{entry.description}</p>
                <p className="text-[10px] text-slate-400">
                  Ref: {entry.referenceType} • By: {entry.createdBy.name}
                </p>
              </div>

              <div className="flex sm:flex-col items-center sm:items-end justify-between border-t sm:border-0 border-slate-100 pt-2 sm:pt-0 shrink-0">
                {entry.debit > 0 ? (
                  <span className="font-bold text-xs text-emerald-700">
                    Dr: PKR {entry.debit.toLocaleString()}
                  </span>
                ) : (
                  <span className="font-bold text-xs text-amber-800">
                    Cr: PKR {entry.credit.toLocaleString()}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

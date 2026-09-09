"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Plus, Search, Users, Phone, Mail, MapPin, FileText, Filter, CheckCircle2 } from "lucide-react";
import { listPartiesAction } from "@/actions/parties";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PartyType } from "@prisma/client";

type PartyRecord = {
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

export default function PartiesPage() {
  const [parties, setParties] = useState<PartyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selectedType, setSelectedType] = useState<"ALL" | PartyType>("ALL");
  const [showActiveOnly, setShowActiveOnly] = useState(true);

  useEffect(() => {
    void fetchParties();
  }, []);

  async function fetchParties() {
    setLoading(true);
    try {
      const result = await listPartiesAction();
      if (result.success) {
        setParties(result.data as PartyRecord[]);
      }
    } finally {
      setLoading(false);
    }
  }

  const customerCount = useMemo(() => parties.filter((p) => p.type === PartyType.CUSTOMER).length, [parties]);
  const supplierCount = useMemo(() => parties.filter((p) => p.type === PartyType.SUPPLIER).length, [parties]);
  const totalReceivable = useMemo(
    () => parties.filter((p) => p.type === PartyType.CUSTOMER && p.balance > 0).reduce((sum, p) => sum + p.balance, 0),
    [parties],
  );
  const totalPayable = useMemo(
    () => parties.filter((p) => p.type === PartyType.SUPPLIER && p.balance > 0).reduce((sum, p) => sum + p.balance, 0),
    [parties],
  );

  const filteredParties = useMemo(() => {
    const search = query.trim().toLowerCase();
    return parties.filter((party) => {
      const matchesType = selectedType === "ALL" || party.type === selectedType;
      const matchesActive = !showActiveOnly || party.isActive;
      const matchesSearch =
        !search ||
        [party.name, party.email ?? "", party.phone ?? "", party.address ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(search);
      return matchesType && matchesActive && matchesSearch;
    });
  }, [parties, query, selectedType, showActiveOnly]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-emerald-800" />
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Party Management</h1>
          </div>
          <p className="text-sm text-slate-600">
            Customers and suppliers directory, credit limit enforcement, running ledger balances, and statements.
          </p>
        </div>
        <Button asChild className="bg-emerald-800 text-white hover:bg-emerald-700 shadow-sm sm:w-auto w-full">
          <Link href="/parties/new">
            <Plus className="mr-2 h-4 w-4" />
            Add New Party
          </Link>
        </Button>
      </div>

      {/* KPI Metrics */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-emerald-100 bg-gradient-to-br from-emerald-50/60 to-white p-4 shadow-xs">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Total Customers</p>
          <p className="mt-1 text-2xl font-extrabold text-emerald-900">{customerCount}</p>
          <p className="text-[11px] text-emerald-700 mt-0.5">Active accounts</p>
        </div>
        <div className="rounded-xl border border-sky-100 bg-gradient-to-br from-sky-50/60 to-white p-4 shadow-xs">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Total Suppliers</p>
          <p className="mt-1 text-2xl font-extrabold text-sky-900">{supplierCount}</p>
          <p className="text-[11px] text-sky-700 mt-0.5">Trade vendors</p>
        </div>
        <div className="rounded-xl border border-amber-100 bg-gradient-to-br from-amber-50/60 to-white p-4 shadow-xs">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Receivables</p>
          <p className="mt-1 text-xl font-extrabold text-amber-900">PKR {totalReceivable.toLocaleString()}</p>
          <p className="text-[11px] text-amber-700 mt-0.5">Due from customers</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4 shadow-xs">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Payables</p>
          <p className="mt-1 text-xl font-extrabold text-slate-800">PKR {totalPayable.toLocaleString()}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">Due to suppliers</p>
        </div>
      </div>

      {/* Directory & Filters */}
      <Card className="border-slate-200/80 bg-white shadow-xs">
        <CardHeader className="pb-3 border-b border-slate-100">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="text-base font-bold text-slate-900">Directory</CardTitle>
            {/* Filter Tabs */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => setSelectedType("ALL")}
                className={`px-3 py-1 rounded-md font-semibold transition-colors ${
                  selectedType === "ALL"
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                All ({parties.length})
              </button>
              <button
                type="button"
                onClick={() => setSelectedType(PartyType.CUSTOMER)}
                className={`px-3 py-1 rounded-md font-semibold transition-colors ${
                  selectedType === PartyType.CUSTOMER
                    ? "bg-emerald-800 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                Customers ({customerCount})
              </button>
              <button
                type="button"
                onClick={() => setSelectedType(PartyType.SUPPLIER)}
                className={`px-3 py-1 rounded-md font-semibold transition-colors ${
                  selectedType === PartyType.SUPPLIER
                    ? "bg-sky-800 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                Suppliers ({supplierCount})
              </button>
              <label className="flex items-center gap-1.5 ml-2 cursor-pointer text-slate-600 text-xs select-none">
                <input
                  type="checkbox"
                  checked={showActiveOnly}
                  onChange={(e) => setShowActiveOnly(e.target.checked)}
                  className="rounded border-slate-300 text-emerald-800 focus:ring-emerald-700 h-3.5 w-3.5"
                />
                Active only
              </label>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pl-9 text-xs h-9 border-slate-200 bg-white focus-visible:ring-emerald-200"
              placeholder="Search by party name, phone number, email, or address..."
              aria-label="Search parties"
            />
          </div>

          <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
            {loading ? (
              <p className="text-sm text-slate-500 py-12 text-center col-span-full">Loading directory…</p>
            ) : filteredParties.length === 0 ? (
              <p className="text-sm text-slate-500 py-12 text-center col-span-full">No matching parties found.</p>
            ) : (
              filteredParties.map((party) => {
                const isCustomer = party.type === PartyType.CUSTOMER;
                const isNearLimit =
                  isCustomer &&
                  party.creditLimit &&
                  party.creditLimit > 0 &&
                  party.balance >= party.creditLimit * 0.85;

                return (
                  <div
                    key={party.id}
                    className="group rounded-xl border border-slate-200/90 bg-white p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md flex flex-col justify-between"
                  >
                    <div>
                      {/* Card Header */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link href={`/parties/${party.id}/edit`} className="font-bold text-sm text-slate-900 hover:text-emerald-800 transition-colors">
                            {party.name}
                          </Link>
                          <div className="flex items-center gap-1.5 mt-1">
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                                isCustomer ? "bg-emerald-100 text-emerald-800" : "bg-sky-100 text-sky-800"
                              }`}
                            >
                              {party.type}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                party.isActive ? "bg-slate-100 text-slate-600" : "bg-rose-100 text-rose-700"
                              }`}
                            >
                              {party.isActive ? "Active" : "Inactive"}
                            </span>
                          </div>
                        </div>

                        <Link
                          href={`/parties/${party.id}/edit`}
                          className="text-slate-400 hover:text-emerald-700 transition-colors p-1"
                          title="Edit Party"
                        >
                          <ArrowUpRight className="h-4 w-4" />
                        </Link>
                      </div>

                      {/* Contact Info */}
                      <div className="mt-3 space-y-1 text-xs text-slate-600">
                        {party.phone && (
                          <div className="flex items-center gap-1.5">
                            <Phone className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                            <span>{party.phone}</span>
                          </div>
                        )}
                        {party.email && (
                          <div className="flex items-center gap-1.5">
                            <Mail className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                            <span className="truncate">{party.email}</span>
                          </div>
                        )}
                        {party.address && (
                          <div className="flex items-center gap-1.5">
                            <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                            <span className="truncate">{party.address}</span>
                          </div>
                        )}
                      </div>

                      {/* Balance & Credit Limit */}
                      <div className="mt-3.5 rounded-lg bg-slate-50/80 p-2.5 border border-slate-100 space-y-1.5 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500 font-medium">Running Balance:</span>
                          <span
                            className={`font-bold ${
                              party.balance > 0
                                ? isCustomer
                                  ? "text-amber-800"
                                  : "text-slate-800"
                                : party.balance < 0
                                ? "text-rose-700"
                                : "text-slate-600"
                            }`}
                          >
                            PKR {Math.abs(party.balance).toLocaleString()} {party.balance >= 0 ? "Dr" : "Cr"}
                          </span>
                        </div>

                        {isCustomer && (
                          <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-200/60">
                            <span className="text-slate-500">Credit Limit:</span>
                            <span className={`font-semibold ${isNearLimit ? "text-rose-700" : "text-slate-700"}`}>
                              {party.creditLimit ? `PKR ${party.creditLimit.toLocaleString()}` : "No Limit"}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Bottom Actions */}
                    <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2">
                      <Link
                        href={`/parties/${party.id}/edit`}
                        className="text-xs font-semibold text-emerald-800 hover:text-emerald-950 transition-colors"
                      >
                        Edit Details
                      </Link>
                      <a
                        href={`/api/pdf/reports/party-statement?download=true&partyId=${party.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-800 hover:border-emerald-200 border border-slate-200 transition-colors"
                      >
                        <FileText className="h-3 w-3 text-rose-600" />
                        PDF Statement
                      </a>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

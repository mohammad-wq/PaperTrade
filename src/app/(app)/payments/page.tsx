"use client";

import { useEffect, useState, useMemo } from "react";
import {
  CreditCard,
  Plus,
  Search,
  AlertCircle,
  X,
  Wallet,
  Building,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listPaymentsAction, createPaymentAction } from "@/actions/payments";
import { listPartiesAction } from "@/actions/parties";
import { listSaleInvoicesAction, listPurchaseInvoicesAction } from "@/actions/invoices";
import { PaymentMethod, PartyType } from "@prisma/client";
import { format } from "date-fns";

type PaymentRow = {
  id: string;
  amount: number;
  method: PaymentMethod;
  date: Date;
  notes: string | null;
  party: { id: string; name: string; type: PartyType };
  saleInvoice?: { id: string; invoiceNo: string } | null;
  purchaseInvoice?: { id: string; invoiceNo: string } | null;
};

type PartyOption = {
  id: string;
  name: string;
  type: PartyType;
  balance: number;
};

type InvoiceOption = {
  id: string;
  invoiceNo: string;
  customerId?: string;
  supplierId?: string;
  totalAmount: number;
  amountPaid?: number;
  balanceDue?: number;
};

export default function PaymentsPage() {
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [parties, setParties] = useState<PartyOption[]>([]);
  const [saleInvoices, setSaleInvoices] = useState<InvoiceOption[]>([]);
  const [purchaseInvoices, setPurchaseInvoices] = useState<InvoiceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Form state
  const [partyId, setPartyId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState<number | "">("");
  const [method, setMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const [payRes, partyRes, sInvRes, pInvRes] = await Promise.all([
        listPaymentsAction(),
        listPartiesAction(),
        listSaleInvoicesAction(),
        listPurchaseInvoicesAction(),
      ]);

      if (payRes.success && payRes.data) {
        setPayments(payRes.data as PaymentRow[]);
      }
      if (partyRes.success && partyRes.data) {
        setParties(partyRes.data as PartyOption[]);
      }
      if (sInvRes.success && sInvRes.data) {
        setSaleInvoices(sInvRes.data as InvoiceOption[]);
      }
      if (pInvRes.success && pInvRes.data) {
        setPurchaseInvoices(pInvRes.data as InvoiceOption[]);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  const selectedParty = useMemo(() => parties.find((p) => p.id === partyId), [parties, partyId]);

  const candidateInvoices = useMemo(() => {
    if (!selectedParty) return [];
    if (selectedParty.type === PartyType.CUSTOMER) {
      return saleInvoices.filter((i) => i.customerId === selectedParty.id);
    } else {
      return purchaseInvoices.filter((i) => i.supplierId === selectedParty.id);
    }
  }, [selectedParty, saleInvoices, purchaseInvoices]);

  const filteredPayments = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return payments;
    return payments.filter(
      (p) =>
        p.party.name.toLowerCase().includes(q) ||
        p.method.toLowerCase().includes(q) ||
        (p.saleInvoice && p.saleInvoice.invoiceNo.toLowerCase().includes(q)) ||
        (p.purchaseInvoice && p.purchaseInvoice.invoiceNo.toLowerCase().includes(q)),
    );
  }, [payments, query]);

  const totalCollected = useMemo(
    () =>
      filteredPayments
        .filter((p) => p.party.type === PartyType.CUSTOMER)
        .reduce((sum, p) => sum + p.amount, 0),
    [filteredPayments],
  );

  const totalDisbursed = useMemo(
    () =>
      filteredPayments
        .filter((p) => p.party.type === PartyType.SUPPLIER)
        .reduce((sum, p) => sum + p.amount, 0),
    [filteredPayments],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!partyId) {
      setFormError("Please select a party.");
      return;
    }
    if (!amount || amount <= 0) {
      setFormError("Amount must be greater than 0.");
      return;
    }

    setSubmitting(true);
    try {
      const isCust = selectedParty?.type === PartyType.CUSTOMER;
      const res = await createPaymentAction({
        partyId,
        saleInvoiceId: isCust && invoiceId ? invoiceId : null,
        purchaseInvoiceId: !isCust && invoiceId ? invoiceId : null,
        amount: Number(amount),
        method,
        date: new Date(paymentDate),
        notes,
      });

      if (!res.success) {
        setFormError(res.error || "Failed to record payment.");
      } else {
        setIsDialogOpen(false);
        setPartyId("");
        setInvoiceId("");
        setAmount("");
        setNotes("");
        await loadData();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-emerald-800" />
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Payments</h1>
          </div>
          <p className="text-sm text-slate-600">
            Record customer receipts and supplier settlements with immediate cash/bank ledger integration.
          </p>
        </div>

        <Button
          onClick={() => setIsDialogOpen(true)}
          className="bg-emerald-800 text-white hover:bg-emerald-700 shadow-sm"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Record Payment
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="border-emerald-900/15 bg-white/80">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-emerald-800 uppercase tracking-wider">Customer Receipts (Inflows)</p>
              <p className="text-xl font-bold text-slate-900 mt-0.5">PKR {totalCollected.toLocaleString()}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
              <Wallet className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-amber-900/15 bg-white/80">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-amber-800 uppercase tracking-wider">Supplier Payments (Outflows)</p>
              <p className="text-xl font-bold text-slate-900 mt-0.5">PKR {totalDisbursed.toLocaleString()}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
              <Building className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by party name, payment method, or invoice number..."
          className="pl-9 bg-white"
        />
      </div>

      {/* Payments List */}
      {loading ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500 text-sm">Loading payments...</CardContent>
        </Card>
      ) : filteredPayments.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500 text-sm">No payments found.</CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredPayments.map((p) => {
            const isCustomer = p.party.type === PartyType.CUSTOMER;

            return (
              <Card key={p.id} className="border-slate-200/80 hover:shadow-md transition-shadow bg-white flex flex-col justify-between">
                <CardHeader className="pb-3 border-b border-slate-100">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base font-bold text-slate-900">{p.party.name}</CardTitle>
                      <span className={`text-[10px] font-bold uppercase tracking-wider ${isCustomer ? "text-emerald-700" : "text-amber-800"}`}>
                        {p.party.type}
                      </span>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                      {p.method}
                    </span>
                  </div>
                </CardHeader>

                <CardContent className="py-3 space-y-2 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>Date:</span>
                    <span>{format(new Date(p.date), "dd MMM yyyy")}</span>
                  </div>
                  {p.saleInvoice && (
                    <div className="flex justify-between text-slate-600">
                      <span>Against Sale Invoice:</span>
                      <span className="font-semibold text-slate-800">{p.saleInvoice.invoiceNo}</span>
                    </div>
                  )}
                  {p.purchaseInvoice && (
                    <div className="flex justify-between text-slate-600">
                      <span>Against Purchase Bill:</span>
                      <span className="font-semibold text-slate-800">{p.purchaseInvoice.invoiceNo}</span>
                    </div>
                  )}
                  {p.notes && (
                    <div className="text-slate-500 italic text-[11px]">
                      &quot;{p.notes}&quot;
                    </div>
                  )}
                  <div className="flex justify-between border-t border-slate-100 pt-2 font-bold text-base">
                    <span>Amount:</span>
                    <span className={isCustomer ? "text-emerald-800" : "text-amber-900"}>
                      PKR {p.amount.toLocaleString()}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Record Payment Dialog */}
      {isDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Record Payment</h2>
                <p className="text-xs text-slate-500">Post cash, bank, or cheque transaction to party ledger</p>
              </div>
              <button
                onClick={() => setIsDialogOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {formError && (
              <div className="mt-4 rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div className="space-y-1">
                <Label htmlFor="payparty" className="text-xs font-semibold">Party (Customer or Supplier) *</Label>
                <select
                  id="payparty"
                  value={partyId}
                  onChange={(e) => {
                    setPartyId(e.target.value);
                    setInvoiceId("");
                  }}
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs"
                  required
                >
                  <option value="">Select party</option>
                  {parties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.type}) — Bal: PKR {p.balance.toLocaleString()}
                    </option>
                  ))}
                </select>
              </div>

              {candidateInvoices.length > 0 && (
                <div className="space-y-1">
                  <Label htmlFor="payinvoice" className="text-xs font-semibold">
                    Link to Specific Invoice (Optional)
                  </Label>
                  <select
                    id="payinvoice"
                    value={invoiceId}
                    onChange={(e) => setInvoiceId(e.target.value)}
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs"
                  >
                    <option value="">General account payment (no invoice)</option>
                    {candidateInvoices.map((inv) => (
                      <option key={inv.id} value={inv.id}>
                        {inv.invoiceNo} (Total: PKR {inv.totalAmount.toLocaleString()})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="payamount" className="text-xs font-semibold">Amount (PKR) *</Label>
                  <Input
                    id="payamount"
                    type="number"
                    min="1"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(Number(e.target.value) || "")}
                    placeholder="e.g. 50000"
                    className="text-xs"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="paymethod" className="text-xs font-semibold">Payment Method *</Label>
                  <select
                    id="paymethod"
                    value={method}
                    onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs"
                  >
                    {Object.values(PaymentMethod).map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="paydate" className="text-xs font-semibold">Payment Date *</Label>
                <Input
                  id="paydate"
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="text-xs"
                  required
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="paynotes" className="text-xs">Notes / Cheque Number</Label>
                <Input
                  id="paynotes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. HBL Cheque #918231"
                  className="text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)} className="text-xs">
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting} className="bg-emerald-800 text-white hover:bg-emerald-700 text-xs">
                  {submitting ? "Posting..." : "Confirm Payment"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

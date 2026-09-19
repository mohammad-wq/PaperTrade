"use client";

import { useEffect, useState, useMemo, useRef } from "react";
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
import { listPaymentsAction, createMiscExpenseAction, createPaymentAction } from "@/actions/payments";
import { listPartiesAction } from "@/actions/parties";
import { listSaleInvoicesAction, listPurchaseInvoicesAction } from "@/actions/invoices";
import { PaymentMethod, PartyType } from "@prisma/client";
import { format } from "date-fns";
import { useRealtimeListener } from "@/hooks/use-realtime";
import { useConfirm } from "@/components/providers/confirm-provider";

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
  const confirm = useConfirm();
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [parties, setParties] = useState<PartyOption[]>([]);
  const [saleInvoices, setSaleInvoices] = useState<InvoiceOption[]>([]);
  const [purchaseInvoices, setPurchaseInvoices] = useState<InvoiceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isExpenseDialogOpen, setIsExpenseDialogOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "F2" || e.key === "Insert") {
        e.preventDefault();
        setIsDialogOpen(true);
      } else if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Form state
  const [partyId, setPartyId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState<number | "">("");
  const [method, setMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [expenseDescription, setExpenseDescription] = useState("");
  const [expenseAmount, setExpenseAmount] = useState<number | "">("");
  const [expenseMethod, setExpenseMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10));
  const [formError, setFormError] = useState<string | null>(null);
  const [expenseFormError, setExpenseFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [expenseSubmitting, setExpenseSubmitting] = useState(false);

  async function loadData(isBackground = false) {
    if (!isBackground) setLoading(true);
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
      if (!isBackground) setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  useRealtimeListener(["payments", "parties", "sales", "purchases", "expenses"], () => {
    void loadData(true);
  });

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

    const ok = await confirm({
      title: "Record Payment",
      description: "Are you sure you want to record this payment in the accounts ledger?",
      confirmText: "Record Payment",
      variant: "primary",
    });
    if (!ok) return;

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
        setMethod(PaymentMethod.CASH);
        setPaymentDate(new Date().toISOString().slice(0, 10));
        setNotes("");
        await loadData();
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleExpenseSubmit(e: React.FormEvent) {
    e.preventDefault();
    setExpenseFormError(null);

    if (!expenseDescription.trim()) {
      setExpenseFormError("Please enter an expense description.");
      return;
    }
    if (!expenseAmount || expenseAmount <= 0) {
      setExpenseFormError("Expense amount must be greater than 0.");
      return;
    }

    const okExpense = await confirm({
      title: "Record Miscellaneous Expense",
      description: "Are you sure you want to record this miscellaneous expense?",
      confirmText: "Record Expense",
      variant: "primary",
    });
    if (!okExpense) return;

    setExpenseSubmitting(true);
    try {
      const res = await createMiscExpenseAction({
        amount: Number(expenseAmount),
        method: expenseMethod,
        date: new Date(expenseDate),
        description: expenseDescription.trim(),
      });

      if (!res.success) {
        setExpenseFormError(res.error || "Failed to record expense.");
      } else {
        setIsExpenseDialogOpen(false);
        setExpenseDescription("");
        setExpenseAmount("");
        setExpenseMethod(PaymentMethod.CASH);
        setExpenseDate(new Date().toISOString().slice(0, 10));
        await loadData();
      }
    } finally {
      setExpenseSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Top Banner: Title, Counters, and Action Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-2.5 rounded-md shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-400 rounded-md">
            <CreditCard className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Payments & Vouchers
            </h1>
            <p className="text-[11px] text-slate-500">
              Record customer receipts and supplier settlements with immediate cash/bank ledger integration
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Counters */}
          <div className="hidden sm:flex items-center gap-2 text-xs font-mono">
            <span className="bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 px-2 py-1 rounded">
              Receipts: <strong>PKR {totalCollected.toLocaleString()}</strong>
            </span>
            <span className="bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 px-2 py-1 rounded">
              Disbursed: <strong>PKR {totalDisbursed.toLocaleString()}</strong>
            </span>
            <span className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-300 px-2 py-1 rounded">
              Vouchers: <strong>{filteredPayments.length}</strong>
            </span>
          </div>

          <Button
            variant="outline"
            onClick={() => setIsExpenseDialogOpen(true)}
            className="h-8 border-amber-300 text-amber-900 hover:bg-amber-50 text-xs font-semibold shadow-xs px-2.5"
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Misc Expense
          </Button>

          <Button
            onClick={() => setIsDialogOpen(true)}
            className="h-8 bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-bold shadow-xs px-3"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Record Payment <span className="ml-1.5 text-[10px] opacity-75 font-mono">[F2]</span>
          </Button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-2 items-center justify-between bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2.5 rounded-md shadow-xs">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <Input
            ref={searchInputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by party name, payment method, or invoice number... (Press / to focus)"
            className="h-8 pl-8 pr-8 text-xs bg-slate-50 dark:bg-slate-950/50 border-slate-300 dark:border-slate-700 font-medium"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
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
                    <span>{format(new Date(p.date), "dd/MM/yyyy")}</span>
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

      {/* Record Misc Expense Dialog */}
      {isExpenseDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Record Miscellaneous Expense</h2>
                <p className="text-xs text-slate-500">Post general business expenses directly to the ledger so reports reflect true operating costs.</p>
              </div>
              <button
                onClick={() => setIsExpenseDialogOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {expenseFormError && (
              <div className="mt-4 rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{expenseFormError}</span>
              </div>
            )}

            <form onSubmit={handleExpenseSubmit} className="mt-4 space-y-4">
              <div className="space-y-1">
                <Label htmlFor="expense-description" className="text-xs font-semibold">
                  Expense Description <span className="text-rose-500">*</span>
                </Label>
                <Input
                  id="expense-description"
                  value={expenseDescription}
                  onChange={(e) => setExpenseDescription(e.target.value)}
                  placeholder="e.g. Office stationery, courier charges, maintenance"
                  className="text-xs"
                  required
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="expense-amount" className="text-xs font-semibold">
                    Amount (PKR) <span className="text-rose-500">*</span>
                  </Label>
                  <Input
                    id="expense-amount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={expenseAmount}
                    onChange={(e) => setExpenseAmount(e.target.value === "" ? "" : Number(e.target.value))}
                    placeholder="0.00"
                    className="text-xs"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="expense-method" className="text-xs font-semibold">
                    Payment Method <span className="text-rose-500">*</span>
                  </Label>
                  <select
                    id="expense-method"
                    value={expenseMethod}
                    onChange={(e) => setExpenseMethod(e.target.value as PaymentMethod)}
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs"
                  >
                    <option value={PaymentMethod.CASH}>Cash</option>
                    <option value={PaymentMethod.BANK}>Bank</option>
                    <option value={PaymentMethod.CHEQUE}>Cheque</option>
                    <option value={PaymentMethod.OTHER}>Other</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="expense-date" className="text-xs font-semibold">
                  Expense Date <span className="text-rose-500">*</span>
                </Label>
                <Input
                  id="expense-date"
                  type="date"
                  value={expenseDate}
                  onChange={(e) => setExpenseDate(e.target.value)}
                  className="text-xs"
                  required
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setIsExpenseDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={expenseSubmitting} className="bg-amber-800 text-white hover:bg-amber-700">
                  {expenseSubmitting ? "Posting..." : "Post Expense"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record Payment Dialog */}
      {isDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs overflow-y-auto">
          <div className="w-[96vw] max-w-2xl rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 max-h-[92vh] overflow-y-auto">
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
                <Label htmlFor="payparty" className="text-xs font-semibold">
                  Party (Customer or Supplier) <span className="text-rose-500">*</span>
                </Label>
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
                {selectedParty && (
                  <div className="mt-1.5 rounded-lg bg-slate-50 border border-slate-200 p-2.5 flex items-center justify-between text-xs">
                    <span className="text-slate-600">Current Ledger Balance:</span>
                    <span className={`font-bold ${selectedParty.balance > 0 ? "text-amber-800" : "text-slate-900"}`}>
                      PKR {selectedParty.balance.toLocaleString()} ({selectedParty.type === PartyType.CUSTOMER ? "Receivable" : "Payable"})
                    </span>
                  </div>
                )}
              </div>

              {candidateInvoices.length > 0 && (
                <div className="space-y-1">
                  <Label htmlFor="payinvoice" className="text-xs font-semibold">
                    Link to Specific Invoice <span className="text-slate-400 font-normal text-xs">(Optional)</span>
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
                  <Label htmlFor="payamount" className="text-xs font-semibold">
                    Amount (PKR) <span className="text-rose-500">*</span>
                  </Label>
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
                  <Label htmlFor="paymethod" className="text-xs font-semibold">
                    Payment Method <span className="text-rose-500">*</span>
                  </Label>
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
                <Label htmlFor="paydate" className="text-xs font-semibold">
                  Payment Date <span className="text-rose-500">*</span>
                </Label>
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
                <Label htmlFor="paynotes" className="text-xs">
                  Notes / Cheque Number <span className="text-slate-400 font-normal text-xs">(Optional)</span>
                </Label>
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

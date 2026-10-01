"use client";

import React, { useEffect, useState, useMemo, useRef, createRef } from "react";
import {
  CreditCard,
  Plus,
  Search,
  AlertCircle,
  X,
  Wallet,
  Building,
  CheckCircle2,
  Printer,
  ArrowDownLeft,
  ArrowUpRight,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  listPaymentsAction,
  createMiscExpenseAction,
  createPaymentAction,
  updatePaymentAction,
  deletePaymentAction,
} from "@/actions/payments";
import { listPartiesAction } from "@/actions/parties";
import { listSaleInvoicesAction, listPurchaseInvoicesAction } from "@/actions/invoices";
import { PaymentMethod, PartyType } from "@prisma/client";
import { cn, formatDateTime } from "@/lib/utils";
import { formatSequenceDisplay } from "@/lib/financial-year";
import { SearchCombobox } from "@/components/ui/search-combobox";
import { useRealtimeListener } from "@/hooks/use-realtime";
import { useConfirm } from "@/components/providers/confirm-provider";
import { printDocumentPdf } from "@/lib/print-pdf";
import { handleFormEnterKeyDown } from "@/lib/keyboard-nav";

type PaymentSplitRow = {
  id: string;
  method: PaymentMethod;
  amount: number;
  reference?: string | null;
};

type PaymentRow = {
  id: string;
  receiptNo?: string | null;
  sequenceNo?: number | null;
  direction?: string;
  amount: number;
  remainingBalance?: number | null;
  method: PaymentMethod;
  date: Date;
  notes: string | null;
  party: { id: string; name: string; type: PartyType; phone?: string | null };
  saleInvoice?: { id: string; invoiceNo: string; sequenceNo?: number | null; totalAmount?: number } | null;
  purchaseInvoice?: { id: string; invoiceNo: string; sequenceNo?: number | null; totalAmount?: number } | null;
  financialYear?: { id: string; label: string; isActive?: boolean } | null;
  splits: PaymentSplitRow[];
};

type PartyOption = {
  id: string;
  name: string;
  type: PartyType;
  balance: number;
  phone?: string | null;
};

type InvoiceOption = {
  id: string;
  invoiceNo: string;
  sequenceNo?: number;
  customerId?: string;
  supplierId?: string;
  totalAmount: number;
  amountPaid?: number;
  balanceDue?: number;
};

type SplitEntry = {
  method: PaymentMethod;
  amount: number | "";
  reference: string;
};

export default function PaymentsPage() {
  const confirm = useConfirm();
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [parties, setParties] = useState<PartyOption[]>([]);
  const [saleInvoices, setSaleInvoices] = useState<InvoiceOption[]>([]);
  const [purchaseInvoices, setPurchaseInvoices] = useState<InvoiceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [directionFilter, setDirectionFilter] = useState<"ALL" | "IN" | "OUT">("ALL");
  const [yearFilter, setYearFilter] = useState<"CURRENT" | "ALL">("CURRENT");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isExpenseDialogOpen, setIsExpenseDialogOpen] = useState(false);
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Form input refs for sequential Enter-key navigation
  const partyRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLInputElement>(null);
  const splitAmountRefs = useRef<React.RefObject<HTMLInputElement>[]>([]);
  const splitRefRefs = useRef<React.RefObject<HTMLInputElement>[]>([]);

  const handleSubmitRef = useRef<(e: React.FormEvent) => Promise<void>>(() => Promise.resolve());

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "F2" || e.key === "Insert") {
        e.preventDefault();
        setIsDialogOpen(true);
      } else if (
        e.key === "/" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === "Escape" && isDialogOpen) {
        e.preventDefault();
        setIsDialogOpen(false);
      } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && isDialogOpen) {
        e.preventDefault();
        const fakeEv = { preventDefault: () => {} } as React.FormEvent;
        void handleSubmitRef.current(fakeEv);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDialogOpen]);

  // Form state
  const [direction, setDirection] = useState<"IN" | "OUT">("IN");
  const [partyId, setPartyId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [paymentDate, setPaymentDate] = useState(() => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  });
  const [notes, setNotes] = useState("");
  const [splits, setSplits] = useState<SplitEntry[]>([
    { method: PaymentMethod.CASH, amount: "", reference: "" },
  ]);

  // Expense dialog state
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

  // Parties can act as both customer and supplier: all parties available regardless of direction
  const availableParties = useMemo(() => {
    return parties;
  }, [parties]);

  const candidateInvoices = useMemo(() => {
    if (!selectedParty) return [];
    const sales = saleInvoices
      .filter((i) => i.customerId === selectedParty.id)
      .map((i) => ({ ...i, invType: "SALE" as const }));
    const purchases = purchaseInvoices
      .filter((i) => i.supplierId === selectedParty.id)
      .map((i) => ({ ...i, invType: "PURCHASE" as const }));

    if (direction === "IN") {
      // Receiving money: prioritize sales invoices, but also show any purchase invoices
      return [...sales, ...purchases];
    } else {
      // Paying money: prioritize purchase invoices, but also show any sale invoices
      return [...purchases, ...sales];
    }
  }, [selectedParty, direction, saleInvoices, purchaseInvoices]);

  const totalSplitAmount = useMemo(() => {
    return splits.reduce((sum, s) => sum + (typeof s.amount === "number" ? s.amount : 0), 0);
  }, [splits]);

  function handleInvoiceSelect(invId: string) {
    setInvoiceId(invId);
    if (!invId) return;
    const inv = candidateInvoices.find((i) => i.id === invId);
    if (inv) {
      const due = inv.balanceDue != null && inv.balanceDue > 0 ? inv.balanceDue : inv.totalAmount;
      if (splits.length === 1 && (!splits[0].amount || splits[0].amount <= 0)) {
        setSplits([{ ...splits[0], amount: due }]);
      }
    }
  }

  function handleSplitChange(index: number, field: keyof SplitEntry, value: any) {
    const updated = [...splits];
    updated[index] = { ...updated[index], [field]: value };
    setSplits(updated);
  }

  function addSplitRow() {
    setSplits([...splits, { method: PaymentMethod.BANK, amount: "", reference: "" }]);
  }

  function removeSplitRow(index: number) {
    if (splits.length <= 1) return;
    setSplits(splits.filter((_, idx) => idx !== index));
  }

  const filteredPayments = useMemo(() => {
    const q = query.trim().toLowerCase();
    return payments.filter((p) => {
      // Financial year filter
      if (yearFilter === "CURRENT" && p.financialYear && p.financialYear.isActive === false) {
        return false;
      }
      // Direction filter
      const pDirection = p.direction || (p.party.type === PartyType.CUSTOMER ? "IN" : "OUT");
      if (directionFilter !== "ALL" && pDirection !== directionFilter) {
        return false;
      }

      if (!q) return true;
      const receiptStr = p.receiptNo ? p.receiptNo.toLowerCase() : "";
      const seqStr = p.sequenceNo ? String(p.sequenceNo) : "";
      return (
        p.party.name.toLowerCase().includes(q) ||
        p.method.toLowerCase().includes(q) ||
        receiptStr.includes(q) ||
        seqStr.includes(q) ||
        (p.saleInvoice && p.saleInvoice.invoiceNo.toLowerCase().includes(q)) ||
        (p.purchaseInvoice && p.purchaseInvoice.invoiceNo.toLowerCase().includes(q)) ||
        (p.splits && p.splits.some((s) => s.reference && s.reference.toLowerCase().includes(q)))
      );
    });
  }, [payments, query, directionFilter, yearFilter]);

  const totalCollected = useMemo(
    () =>
      filteredPayments
        .filter((p) => (p.direction || (p.party.type === PartyType.CUSTOMER ? "IN" : "OUT")) === "IN")
        .reduce((sum, p) => sum + p.amount, 0),
    [filteredPayments],
  );

  const totalDisbursed = useMemo(
    () =>
      filteredPayments
        .filter((p) => (p.direction || (p.party.type === PartyType.CUSTOMER ? "IN" : "OUT")) === "OUT")
        .reduce((sum, p) => sum + p.amount, 0),
    [filteredPayments],
  );

  function openPaymentEditor(payment: PaymentRow) {
    setEditingPaymentId(payment.id);
    setDirection((payment.direction || (payment.party.type === PartyType.CUSTOMER ? "IN" : "OUT")) as "IN" | "OUT");
    setPartyId(payment.party.id);
    setInvoiceId(
      payment.saleInvoice?.id || payment.purchaseInvoice?.id || ""
    );
    setPaymentDate(new Date(payment.date).toISOString().slice(0, 16));
    setNotes(payment.notes || "");
    setSplits(
      payment.splits.length > 0
        ? payment.splits.map((split) => ({
            method: split.method,
            amount: split.amount,
            reference: split.reference || "",
          }))
        : [{ method: PaymentMethod.CASH, amount: payment.amount, reference: "" }],
    );
    setIsDialogOpen(true);
    setFormError(null);
  }

  async function handleDeletePayment(payment: PaymentRow) {
    const ok = await confirm({
      title: "Delete payment",
      description: `Are you sure you want to delete payment ${payment.receiptNo || "voucher"}? This will remove the linked ledger entries and adjust invoice balances.`,
      confirmText: "Delete",
      variant: "destructive",
    });
    if (!ok) return;

    try {
      const res = await deletePaymentAction({ id: payment.id });
      if (!res.success) {
        await confirm.alert(res.error || "Failed to delete payment", { variant: "destructive" });
      } else {
        await loadData();
      }
    } catch (err: any) {
      await confirm.alert(err?.message || "Failed to delete payment", { variant: "destructive" });
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!partyId) {
      setFormError("Please select a party.");
      return;
    }

    if (totalSplitAmount <= 0) {
      setFormError("Total payment amount must be greater than 0.");
      return;
    }

    const missingAmount = splits.find((s) => typeof s.amount !== "number" || s.amount <= 0);
    if (missingAmount) {
      setFormError("All split payment rows must have an amount greater than 0.");
      return;
    }

    const directionLabel = direction === "IN" ? "Customer Receipt" : "Supplier Payment Voucher";
    const ok = await confirm({
      title: `${editingPaymentId ? "Update" : "Record"} ${directionLabel}`,
      description: `Confirm ${editingPaymentId ? "updating" : "recording"} ${directionLabel} of PKR ${totalSplitAmount.toLocaleString()} for ${selectedParty?.name || "party"}?`,
      confirmText: `${editingPaymentId ? "Update" : "Record"} ${directionLabel}`,
      variant: "primary",
    });
    if (!ok) return;

    setSubmitting(true);
    try {
      const isSaleInv = saleInvoices.some((i) => i.id === invoiceId);
      const isPurchaseInv = purchaseInvoices.some((i) => i.id === invoiceId);
      const payload = {
        ...(editingPaymentId ? { id: editingPaymentId } : {}),
        partyId,
        direction,
        saleInvoiceId: isSaleInv ? invoiceId : null,
        purchaseInvoiceId: isPurchaseInv ? invoiceId : null,
        amount: totalSplitAmount,
        method: splits[0].method,
        splits: splits.map((s) => ({
          method: s.method,
          amount: Number(s.amount),
          reference: s.reference.trim() || undefined,
        })),
        date: new Date(paymentDate),
        notes: notes.trim() || undefined,
      };

      const res = editingPaymentId ? await updatePaymentAction(payload) : await createPaymentAction(payload);

      if (!res.success) {
        setFormError(res.error || `Failed to ${editingPaymentId ? "update" : "record"} payment.`);
      } else {
        const createdId = (res as any).data?.id || editingPaymentId;
        setIsDialogOpen(false);
        setEditingPaymentId(null);
        setPartyId("");
        setInvoiceId("");
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, "0");
        setPaymentDate(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`);
        setNotes("");
        setSplits([{ method: PaymentMethod.CASH, amount: "", reference: "" }]);
        await loadData();
        if (createdId && !editingPaymentId) {
          printDocumentPdf(`/api/pdf/payment-receipt/${createdId}`).catch(() => {});
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  handleSubmitRef.current = handleSubmit;

  // Initialize and synchronize split input refs
  splits.forEach((_, idx) => {
    if (!splitAmountRefs.current[idx]) splitAmountRefs.current[idx] = { current: null };
    if (!splitRefRefs.current[idx]) splitRefRefs.current[idx] = { current: null };
  });

  // Autofocus party input on dialog open
  useEffect(() => {
    if (isDialogOpen) {
      setTimeout(() => {
        partyRef.current?.focus();
      }, 80);
    }
  }, [isDialogOpen]);

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
              Receipts (IN) and payment disbursements (OUT) with split methods and immediate ledger integration
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
            placeholder="Search by party, receipt #, split reference, or invoice... (Press / to focus)"
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

        <div className="flex items-center gap-2 text-xs shrink-0">
          <div className="inline-flex rounded-md border border-slate-300 p-0.5 bg-slate-100 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setDirectionFilter("ALL")}
              className={cn(
                "px-2.5 py-1 rounded text-[11px] font-semibold transition-all",
                directionFilter === "ALL"
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              )}
            >
              All Types
            </button>
            <button
              type="button"
              onClick={() => setDirectionFilter("IN")}
              className={cn(
                "px-2.5 py-1 rounded text-[11px] font-semibold transition-all",
                directionFilter === "IN"
                  ? "bg-emerald-700 text-white shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              )}
            >
              Receipts (IN)
            </button>
            <button
              type="button"
              onClick={() => setDirectionFilter("OUT")}
              className={cn(
                "px-2.5 py-1 rounded text-[11px] font-semibold transition-all",
                directionFilter === "OUT"
                  ? "bg-amber-700 text-white shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              )}
            >
              Disbursed (OUT)
            </button>
          </div>

          <div className="inline-flex rounded-md border border-slate-300 p-0.5 bg-slate-100 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setYearFilter("CURRENT")}
              className={cn(
                "px-2.5 py-1 rounded text-[11px] font-semibold transition-all",
                yearFilter === "CURRENT"
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              )}
            >
              Current Year
            </button>
            <button
              type="button"
              onClick={() => setYearFilter("ALL")}
              className={cn(
                "px-2.5 py-1 rounded text-[11px] font-semibold transition-all",
                yearFilter === "ALL"
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              )}
            >
              All Years
            </button>
          </div>
        </div>
      </div>

      {/* Dense Searchable Payments Table */}
      {loading ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500 text-sm">Loading payments...</CardContent>
        </Card>
      ) : filteredPayments.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500 text-sm">No payment records found.</CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                <th className="py-2.5 px-3">Date & Time</th>
                <th className="py-2.5 px-3">Voucher #</th>
                <th className="py-2.5 px-3">Party Name</th>
                <th className="py-2.5 px-3 text-center">Direction</th>
                <th className="py-2.5 px-3">Allocation / Note</th>
                <th className="py-2.5 px-3">Method / Splits</th>
                <th className="py-2.5 px-3 text-right">Amount (PKR)</th>
                <th className="py-2.5 px-3 text-right">Balance Due</th>
                <th className="py-2.5 px-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredPayments.map((p) => {
                const isCustomer = p.party.type === PartyType.CUSTOMER;
                const isMoneyIn = (p.direction || (isCustomer ? "IN" : "OUT")) === "IN";
                const voucherDisplay = formatSequenceDisplay(p.sequenceNo, p.receiptNo);

                return (
                  <tr
                    key={p.id}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors"
                  >
                    <td className="py-2 px-3 whitespace-nowrap text-slate-700 dark:text-slate-300 font-mono text-[11px]">
                      {formatDateTime(p.date)}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <div className="flex items-center gap-1 font-mono font-bold text-slate-900 dark:text-slate-100">
                        <span>#{voucherDisplay}</span>
                        {p.financialYear && (
                          <span className="text-[9px] px-1 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 font-normal">
                            {p.financialYear.label}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 px-3">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">{p.party.name}</div>
                      <div className="text-[10px] text-slate-400">{p.party.type}</div>
                    </td>
                    <td className="py-2 px-3 text-center whitespace-nowrap">
                      {isMoneyIn ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                          <ArrowDownLeft className="h-3 w-3" /> Receipt (IN)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                          <ArrowUpRight className="h-3 w-3" /> Payment (OUT)
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 max-w-[200px]">
                      {p.saleInvoice ? (
                        <span className="text-emerald-800 font-medium">
                          Estimate #{formatSequenceDisplay(p.saleInvoice.sequenceNo, p.saleInvoice.invoiceNo)}
                        </span>
                      ) : p.purchaseInvoice ? (
                        <span className="text-sky-800 font-medium">
                          Bill #{formatSequenceDisplay(p.purchaseInvoice.sequenceNo, p.purchaseInvoice.invoiceNo)}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic">On Account Settlement</span>
                      )}
                      {p.notes && (
                        <div className="text-[10px] text-slate-500 truncate" title={p.notes}>
                          &quot;{p.notes}&quot;
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      {p.splits && p.splits.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {p.splits.map((s, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                              title={s.reference || undefined}
                            >
                              <strong>{s.method}</strong>: {s.amount.toLocaleString()}
                              {s.reference ? ` (${s.reference})` : ""}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                          {p.method}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      <span className={cn(
                        "font-bold font-mono text-sm",
                        isMoneyIn ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"
                      )}>
                        PKR {p.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap font-mono text-slate-700 dark:text-slate-300">
                      {p.remainingBalance != null ? (
                        <span className="font-semibold">
                          PKR {Math.abs(p.remainingBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          <span className="text-[9px] ml-1 text-slate-400 font-sans">
                            {p.remainingBalance > 0 ? (isCustomer ? "Dr" : "Cr") : p.remainingBalance < 0 ? (isCustomer ? "Cr" : "Dr") : ""}
                          </span>
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openPaymentEditor(p)}
                          className="h-7 text-[10px] gap-1 border-sky-200 text-sky-700 hover:bg-sky-50 font-medium px-2"
                          title="Edit payment"
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleDeletePayment(p)}
                          className="h-7 text-[10px] gap-1 border-rose-200 text-rose-700 hover:bg-rose-50 font-medium px-2"
                          title="Delete payment"
                        >
                          Delete
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            printDocumentPdf(`/api/pdf/payment-receipt/${p.id}`).catch((e) =>
                              confirm.alert(e.message, { variant: "destructive" })
                            );
                          }}
                          className="h-7 text-xs gap-1 border-slate-300 hover:bg-slate-100 font-medium px-2"
                          title={isMoneyIn ? "Print Payment Receipt" : "Print Payment Voucher"}
                        >
                          <Printer className="h-3 w-3 text-slate-600" />
                          <span>{isMoneyIn ? "Receipt" : "Voucher"}</span>
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Record Payment Dialog */}
      {isDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs overflow-y-auto">
          <div className="w-[96vw] max-w-2xl rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-2xl border border-slate-200 dark:border-slate-800 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">{editingPaymentId ? "Update" : "Record"} Payment / Voucher</h2>
                <p className="text-xs text-slate-500">Post cash, bank, or cheque transaction to party ledger with split methods</p>
              </div>
              <button
                onClick={() => setIsDialogOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600"
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

            <form onSubmit={handleSubmit} onKeyDown={handleFormEnterKeyDown} className="mt-4 space-y-4">
              {/* Direction Toggle */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-2.5">
                <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-2">
                  Transaction Direction
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDirection("IN");
                      setPartyId("");
                      setInvoiceId("");
                    }}
                    className={cn(
                      "flex items-center justify-center gap-2 rounded-md py-2 px-3 text-xs font-bold transition-all",
                      direction === "IN"
                        ? "bg-emerald-700 text-white shadow-sm"
                        : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 border border-slate-200 dark:border-slate-700"
                    )}
                  >
                    <ArrowDownLeft className="h-4 w-4" />
                    <span>Customer Receipt (Money IN)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDirection("OUT");
                      setPartyId("");
                      setInvoiceId("");
                    }}
                    className={cn(
                      "flex items-center justify-center gap-2 rounded-md py-2 px-3 text-xs font-bold transition-all",
                      direction === "OUT"
                        ? "bg-amber-700 text-white shadow-sm"
                        : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 border border-slate-200 dark:border-slate-700"
                    )}
                  >
                    <ArrowUpRight className="h-4 w-4" />
                    <span>Supplier Payment (Money OUT)</span>
                  </button>
                </div>
              </div>

              {/* Party Selection with Live Balance */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold">
                    Party (Customer or Supplier) <span className="text-rose-500">*</span>
                  </Label>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {direction === "IN" ? "Receiving from party" : "Paying to party"}
                  </span>
                </div>
                <SearchCombobox
                  options={availableParties.map((p) => {
                    const isReceivable = p.balance > 0;
                    const isPayable = p.balance < 0;
                    const balLabel = isReceivable ? "Receivable" : isPayable ? "Payable" : "Settled";
                    return {
                      id: p.id,
                      label: p.name,
                      sublabel: `${p.type} • Bal: PKR ${Math.abs(p.balance).toLocaleString()} (${balLabel})`,
                      badge: p.type === PartyType.CUSTOMER ? "Customer" : "Supplier",
                      badgeColor: p.type === PartyType.CUSTOMER ? "green" : "amber",
                    };
                  })}
                  value={partyId}
                  onChange={(val) => {
                    setPartyId(val);
                    setInvoiceId("");
                  }}
                  inputRef={partyRef}
                  onEnterPress={() => {
                    dateRef.current?.focus();
                  }}
                  placeholder="Search party by name (Customer or Supplier)..."
                  className="text-xs h-9"
                />
                {selectedParty && (
                  <div className="mt-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 p-2.5 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500">Live Ledger Balance:</span>
                      <span
                        className={cn(
                          "font-bold text-sm",
                          selectedParty.balance > 0
                            ? "text-emerald-700 dark:text-emerald-400"
                            : selectedParty.balance < 0
                            ? "text-rose-700 dark:text-rose-400"
                            : "text-slate-700 dark:text-slate-300"
                        )}
                      >
                        PKR {Math.abs(selectedParty.balance).toLocaleString()}
                      </span>
                      <span
                        className={cn(
                          "text-[10px] font-bold px-1.5 py-0.5 rounded",
                          selectedParty.balance > 0
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                            : selectedParty.balance < 0
                            ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                            : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                        )}
                      >
                        {selectedParty.balance > 0
                          ? "RECEIVABLE (OWES YOU)"
                          : selectedParty.balance < 0
                          ? "PAYABLE (YOU OWE)"
                          : "SETTLED / ZERO"}
                      </span>
                    </div>
                    {selectedParty.phone && (
                      <span className="text-[11px] text-slate-400 font-mono">{selectedParty.phone}</span>
                    )}
                  </div>
                )}
              </div>

              {/* Optional Linked Invoice */}
              {candidateInvoices.length > 0 && (
                <div className="space-y-1">
                  <Label htmlFor="payinvoice" className="text-xs font-semibold">
                    Link to Specific Invoice / Bill <span className="text-slate-400 font-normal text-xs">(Optional)</span>
                  </Label>
                  <select
                    id="payinvoice"
                    value={invoiceId}
                    onChange={(e) => handleInvoiceSelect(e.target.value)}
                    className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
                  >
                    <option value="">General account payment (no invoice)</option>
                    {candidateInvoices.map((inv) => (
                      <option key={inv.id} value={inv.id}>
                        [{inv.invType === "SALE" ? "Estimate" : "Purchase Bill"}] #{formatSequenceDisplay(inv.sequenceNo, inv.invoiceNo)} — Total: PKR {inv.totalAmount.toLocaleString()} {inv.balanceDue != null ? `(Bal: PKR ${inv.balanceDue.toLocaleString()})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Date & Time */}
              <div className="space-y-1">
                <Label htmlFor="paydate" className="text-xs font-semibold">
                  Date & Time <span className="text-rose-500">*</span>
                </Label>
                <Input
                  ref={dateRef}
                  id="paydate"
                  type="datetime-local"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      splitAmountRefs.current[0]?.current?.focus();
                      splitAmountRefs.current[0]?.current?.select();
                    }
                  }}
                  className="text-xs h-8"
                  required
                />
              </div>

              {/* Split Payment Breakdown */}
              <div className="space-y-2 border-t border-slate-100 dark:border-slate-800 pt-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    Payment Breakdown / Methods
                  </Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addSplitRow}
                    className="h-7 text-xs gap-1"
                  >
                    <Plus className="h-3 w-3" /> Add Split Method
                  </Button>
                </div>

                <div className="space-y-2">
                  {splits.map((split, idx) => (
                    <div
                      key={idx}
                      className="grid grid-cols-[130px_1fr_1fr_32px] gap-2 items-center rounded-lg border border-slate-100 dark:border-slate-800 p-2 bg-slate-50/50 dark:bg-slate-900/50"
                    >
                      <select
                        value={split.method}
                        onChange={(e) => handleSplitChange(idx, "method", e.target.value as PaymentMethod)}
                        className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs font-medium"
                      >
                        <option value={PaymentMethod.CASH}>Cash</option>
                        <option value={PaymentMethod.BANK}>Bank Transfer</option>
                        <option value={PaymentMethod.CHEQUE}>Cheque</option>
                        <option value={PaymentMethod.OTHER}>Other</option>
                      </select>

                      <Input
                        ref={splitAmountRefs.current[idx]}
                        type="number"
                        min="0.01"
                        step="any"
                        value={split.amount}
                        onChange={(e) =>
                          handleSplitChange(idx, "amount", e.target.value === "" ? "" : Number(e.target.value))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            splitRefRefs.current[idx]?.current?.focus();
                            splitRefRefs.current[idx]?.current?.select();
                          }
                        }}
                        placeholder="Amount (PKR) *"
                        className="h-8 text-xs font-mono text-right"
                        required
                      />

                      <Input
                        ref={splitRefRefs.current[idx]}
                        type="text"
                        value={split.reference}
                        onChange={(e) => handleSplitChange(idx, "reference", e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            if (idx === splits.length - 1) {
                              notesRef.current?.focus();
                              notesRef.current?.select();
                            } else {
                              splitAmountRefs.current[idx + 1]?.current?.focus();
                              splitAmountRefs.current[idx + 1]?.current?.select();
                            }
                          }
                        }}
                        placeholder={
                          split.method === PaymentMethod.CHEQUE
                            ? "Cheque # (e.g. HBL-91823)"
                            : "Reference / Slip #"
                        }
                        className="h-8 text-xs"
                      />

                      <button
                        type="button"
                        onClick={() => removeSplitRow(idx)}
                        disabled={splits.length <= 1}
                        className="flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:text-rose-600 disabled:opacity-30"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-xs">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">Total Payment Amount:</span>
                  <span className="font-bold text-sm text-slate-900 dark:text-slate-100 font-mono">
                    PKR {totalSplitAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-1">
                <Label htmlFor="paynotes" className="text-xs">
                  Remarks / Internal Notes <span className="text-slate-400 font-normal text-xs">(Optional)</span>
                </Label>
                <Input
                  ref={notesRef}
                  id="paynotes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleSubmit(e);
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      const lastIdx = splits.length - 1;
                      splitRefRefs.current[lastIdx]?.current?.focus();
                      splitRefRefs.current[lastIdx]?.current?.select();
                    }
                  }}
                  placeholder="e.g. Received by cashier Ali, cleared bank deposit"
                  className="text-xs h-8"
                />
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-100 dark:border-slate-800 pt-4">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)} className="text-xs">
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={submitting}
                  className={cn(
                    "text-white text-xs font-bold",
                    direction === "IN" ? "bg-emerald-800 hover:bg-emerald-700" : "bg-amber-800 hover:bg-amber-700"
                  )}
                >
                  {submitting
                    ? "Posting..."
                    : direction === "IN" ? "Post Customer Receipt" : "Post Supplier Voucher"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record Misc Expense Dialog */}
      {isExpenseDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-2xl border border-slate-200 dark:border-slate-800 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Record Miscellaneous Expense</h2>
                <p className="text-xs text-slate-500">Post operating expenses directly to the ledger</p>
              </div>
              <button
                onClick={() => setIsExpenseDialogOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600"
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

            <form onSubmit={handleExpenseSubmit} onKeyDown={handleFormEnterKeyDown} className="mt-4 space-y-4">
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
                    className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
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
    </div>
  );
}

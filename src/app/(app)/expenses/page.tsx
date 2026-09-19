"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import {
  Receipt,
  Plus,
  Search,
  AlertCircle,
  X,
  Wallet,
  Building2,
  Calendar,
  Filter,
  DollarSign,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { listExpensesAction, createExpenseAction } from "@/actions/expenses";
import { ExpenseCategory, PaymentMethod } from "@prisma/client";
import { format } from "date-fns";
import { useRealtimeListener } from "@/hooks/use-realtime";
import { useConfirm } from "@/components/providers/confirm-provider";

type ExpenseRow = {
  id: string;
  expenseNo: string;
  category: ExpenseCategory;
  amount: number;
  method: PaymentMethod;
  date: Date;
  description: string;
  notes: string | null;
  createdBy: { id: string; name: string };
};

const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  OFFICE_SUPPLIES: "Office Supplies & Stationery",
  UTILITIES: "Electricity & Utilities",
  RENT: "Shop & Warehouse Rent",
  SALARIES: "Staff Salaries & Wages",
  TRANSPORT_FUEL: "Vehicle Fuel & Delivery",
  MAINTENANCE: "Repairs & Maintenance",
  TEA_REFRESHMENTS: "Tea & Office Refreshments",
  TAXES_FEES: "Government Taxes & Fees",
  OTHER: "Miscellaneous Expenses",
};

export default function ExpensesPage() {
  const confirm = useConfirm();
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
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

  // Form State
  const [category, setCategory] = useState<ExpenseCategory>(ExpenseCategory.OTHER);
  const [amount, setAmount] = useState<number | "">("");
  const [method, setMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadData(isBackground = false) {
    if (!isBackground) setLoading(true);
    try {
      const res = await listExpensesAction();
      if (res.success && res.data) {
        setExpenses(res.data as ExpenseRow[]);
      }
    } finally {
      if (!isBackground) setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  useRealtimeListener(["expenses", "payments"], () => {
    void loadData(true);
  });

  const totalExpenses = useMemo(
    () => expenses.reduce((sum, e) => sum + e.amount, 0),
    [expenses]
  );

  const cashExpenses = useMemo(
    () => expenses.filter((e) => e.method === PaymentMethod.CASH).reduce((sum, e) => sum + e.amount, 0),
    [expenses]
  );

  const bankExpenses = useMemo(
    () => expenses.filter((e) => e.method !== PaymentMethod.CASH).reduce((sum, e) => sum + e.amount, 0),
    [expenses]
  );

  const filteredExpenses = useMemo(() => {
    const q = query.trim().toLowerCase();
    return expenses.filter((e) => {
      const matchesCategory = categoryFilter === "ALL" || e.category === categoryFilter;
      const matchesQuery =
        !q ||
        e.expenseNo.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        (e.notes && e.notes.toLowerCase().includes(q));
      return matchesCategory && matchesQuery;
    });
  }, [expenses, query, categoryFilter]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!amount || Number(amount) <= 0) {
      setFormError("Expense amount must be greater than zero.");
      return;
    }
    if (!description.trim()) {
      setFormError("Expense description is required.");
      return;
    }

    const ok = await confirm({
      title: "Record Expense",
      description: "Are you sure you want to record this business expense in the general ledger?",
      confirmText: "Record Expense",
      variant: "primary",
    });
    if (!ok) {
      return;
    }

    setSubmitting(true);
    try {
      const res = await createExpenseAction({
        category,
        amount: Number(amount),
        method,
        date: new Date(date),
        description: description.trim(),
        notes: notes.trim() || null,
      });

      if (!res.success) {
        setFormError(res.error || "Failed to record expense.");
      } else {
        // Reset form fields
        setCategory(ExpenseCategory.OTHER);
        setAmount("");
        setMethod(PaymentMethod.CASH);
        setDate(new Date().toISOString().slice(0, 10));
        setDescription("");
        setNotes("");
        setIsDialogOpen(false);
        await loadData();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Top Banner: Title, Counters, and Action Button */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-2.5 rounded-md shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-400 rounded-md">
            <Receipt className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Miscellaneous Expenses
            </h1>
            <p className="text-[11px] text-slate-500">
              Track daily operating expenses, utilities, tea, transport, and shop maintenance
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Counters */}
          <div className="hidden sm:flex items-center gap-2 text-xs font-mono">
            <span className="bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 px-2 py-1 rounded">
              Total: <strong>PKR {totalExpenses.toLocaleString()}</strong>
            </span>
            <span className="bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 px-2 py-1 rounded">
              Cash: <strong>PKR {cashExpenses.toLocaleString()}</strong>
            </span>
            <span className="bg-sky-50 dark:bg-sky-950/40 text-sky-800 dark:text-sky-300 border border-sky-200 dark:border-sky-800 px-2 py-1 rounded">
              Bank: <strong>PKR {bankExpenses.toLocaleString()}</strong>
            </span>
            <span className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-300 px-2 py-1 rounded">
              Vouchers: <strong>{expenses.length}</strong>
            </span>
          </div>

          <Button
            onClick={() => setIsDialogOpen(true)}
            className="h-8 bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-bold shadow-xs px-3"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Record Expense <span className="ml-1.5 text-[10px] opacity-75 font-mono">[F2]</span>
          </Button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-2 items-center justify-between bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2.5 rounded-md shadow-xs">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <Input
            ref={searchInputRef}
            placeholder="Search expenses by voucher, description, or notes... (Press / to focus)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
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

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1 text-xs text-slate-700 dark:text-slate-200 h-8 font-medium"
        >
          <option value="ALL">All Categories</option>
          {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/* Expense List Card */}
      <Card className="border-slate-200/80 bg-white shadow-xs">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400">Loading expenses...</div>
          ) : filteredExpenses.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No expenses recorded yet. Click &quot;Record New Expense&quot; above to log an expense.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-100 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Expense #</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3">Payment Method</th>
                    <th className="px-4 py-3 text-right">Amount (PKR)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {filteredExpenses.map((exp) => (
                    <tr key={exp.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-4 py-3 font-semibold text-slate-900">{exp.expenseNo}</td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                        {format(new Date(exp.date), "dd/MM/yyyy")}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 border border-emerald-200/60">
                          {CATEGORY_LABELS[exp.category]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{exp.description}</p>
                        {exp.notes && <p className="text-[11px] text-slate-400 mt-0.5">{exp.notes}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                          {exp.method}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-slate-900 whitespace-nowrap">
                        PKR {exp.amount.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Record Expense Dialog */}
      {isDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Record Business Expense</h2>
                <p className="text-xs text-slate-500">Post operating cost to general ledger and P&amp;L</p>
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
                <Label htmlFor="category" className="text-xs font-semibold">
                  Expense Category <span className="text-rose-500">*</span>
                </Label>
                <select
                  id="category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs"
                  required
                >
                  {Object.entries(CATEGORY_LABELS).map(([val, label]) => (
                    <option key={val} value={val}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="amount" className="text-xs font-semibold">
                    Amount (PKR) <span className="text-rose-500">*</span>
                  </Label>
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="e.g. 2500"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value === "" ? "" : Number(e.target.value))}
                    className="text-xs bg-white"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="method" className="text-xs font-semibold">
                    Payment Mode <span className="text-rose-500">*</span>
                  </Label>
                  <select
                    id="method"
                    value={method}
                    onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs"
                    required
                  >
                    <option value={PaymentMethod.CASH}>Cash Drawer</option>
                    <option value={PaymentMethod.BANK}>Bank Transfer</option>
                    <option value={PaymentMethod.CHEQUE}>Bank Cheque</option>
                    <option value={PaymentMethod.OTHER}>Other Mode</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="date" className="text-xs font-semibold">
                  Expense Date <span className="text-rose-500">*</span>
                </Label>
                <Input
                  id="date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="text-xs bg-white"
                  required
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="description" className="text-xs font-semibold">
                  Description / Purpose <span className="text-rose-500">*</span>
                </Label>
                <Input
                  id="description"
                  placeholder="e.g. Electricity bill for shop / Generator diesel / Office tea"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="text-xs bg-white"
                  required
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="notes" className="text-xs font-semibold">
                  Internal Notes <span className="text-slate-400 font-normal text-xs">(Optional)</span>
                </Label>
                <Textarea
                  id="notes"
                  placeholder="e.g. Paid to building caretaker, receipt #418"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="text-xs bg-white resize-none"
                  rows={2}
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsDialogOpen(false)}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={submitting}
                  className="bg-emerald-800 hover:bg-emerald-700 text-white"
                >
                  {submitting ? "Posting to Ledger..." : "Confirm & Record Expense"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}


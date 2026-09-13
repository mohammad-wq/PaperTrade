"use client";

import { useEffect, useState, useMemo } from "react";
import {
  RotateCcw,
  Plus,
  Search,
  FileText,
  AlertCircle,
  X,
  ArrowDownLeft,
  ArrowUpRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  listReturnsAction,
  createSaleReturnAction,
  createPurchaseReturnAction,
} from "@/actions/returns";
import { listSaleInvoicesAction, listPurchaseInvoicesAction } from "@/actions/invoices";
import { format } from "date-fns";
import { useRealtimeListener } from "@/hooks/use-realtime";

type SaleReturnRow = {
  id: string;
  returnNo: string;
  date: Date;
  reason: string;
  totalAmount: number;
  customer: { id: string; name: string };
  location: { id: string; name: string };
  saleInvoice: { id: string; invoiceNo: string };
  items: Array<{
    id: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    product: { id: string; productNo: string; name: string; unit: string };
  }>;
};

type PurchaseReturnRow = {
  id: string;
  returnNo: string;
  date: Date;
  reason: string;
  totalAmount: number;
  supplier: { id: string; name: string };
  location: { id: string; name: string };
  purchaseInvoice: { id: string; invoiceNo: string };
  items: Array<{
    id: string;
    quantity: number;
    unitCost: number;
    lineTotal: number;
    product: { id: string; productNo: string; name: string; unit: string };
  }>;
};

type InvoiceOption = {
  id: string;
  invoiceNo: string;
  customerId?: string;
  supplierId?: string;
  items: Array<{
    productId: string;
    quantity: number;
    unitPrice?: number;
    unitCost?: number;
    product: { id: string; productNo: string; name: string; unit: string };
  }>;
};

export default function ReturnsPage() {
  const [tab, setTab] = useState<"SALES" | "PURCHASES">("SALES");
  const [saleReturns, setSaleReturns] = useState<SaleReturnRow[]>([]);
  const [purchaseReturns, setPurchaseReturns] = useState<PurchaseReturnRow[]>([]);
  const [saleInvoices, setSaleInvoices] = useState<InvoiceOption[]>([]);
  const [purchaseInvoices, setPurchaseInvoices] = useState<InvoiceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  // Dialog state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [reason, setReason] = useState("");
  const [returnDate, setReturnDate] = useState(new Date().toISOString().slice(0, 10));
  const [returnItems, setReturnItems] = useState<
    Array<{ productId: string; quantity: number; unitRate: number; maxQty: number; name: string; unit: string }>
  >([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadData(isBackground = false) {
    if (!isBackground) setLoading(true);
    try {
      const [retRes, sInvRes, pInvRes] = await Promise.all([
        listReturnsAction(),
        listSaleInvoicesAction(),
        listPurchaseInvoicesAction(),
      ]);

      if (retRes.success && retRes.data) {
        setSaleReturns(retRes.data.saleReturns as SaleReturnRow[]);
        setPurchaseReturns(retRes.data.purchaseReturns as PurchaseReturnRow[]);
      }
      if (sInvRes.success && sInvRes.data) {
        setSaleInvoices(sInvRes.data as unknown as InvoiceOption[]);
      }
      if (pInvRes.success && pInvRes.data) {
        setPurchaseInvoices(pInvRes.data as unknown as InvoiceOption[]);
      }
    } finally {
      if (!isBackground) setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  useRealtimeListener(["returns", "sales", "purchases"], () => {
    void loadData(true);
  });

  function handleInvoiceSelect(invId: string) {
    setSelectedInvoiceId(invId);
    if (!invId) {
      setReturnItems([]);
      return;
    }

    if (tab === "SALES") {
      const inv = saleInvoices.find((i) => i.id === invId);
      if (inv) {
        setReturnItems(
          inv.items.map((i) => ({
            productId: i.productId,
            name: `${i.product.productNo} - ${i.product.name}`,
            unit: i.product.unit,
            quantity: 0,
            unitRate: i.unitPrice || 0,
            maxQty: i.quantity,
          })),
        );
      }
    } else {
      const inv = purchaseInvoices.find((i) => i.id === invId);
      if (inv) {
        setReturnItems(
          inv.items.map((i) => ({
            productId: i.productId,
            name: `${i.product.productNo} - ${i.product.name}`,
            unit: i.product.unit,
            quantity: 0,
            unitRate: i.unitCost || 0,
            maxQty: i.quantity,
          })),
        );
      }
    }
  }

  function handleReturnQtyChange(index: number, qty: number) {
    const updated = [...returnItems];
    updated[index].quantity = Math.min(qty, updated[index].maxQty);
    setReturnItems(updated);
  }

  const returnSubtotal = useMemo(
    () => returnItems.reduce((sum, item) => sum + item.quantity * item.unitRate, 0),
    [returnItems],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!selectedInvoiceId) {
      setFormError("Please select an original invoice.");
      return;
    }
    if (!reason.trim()) {
      setFormError("Please provide a reason for the return.");
      return;
    }

    const validItems = returnItems.filter((i) => i.quantity > 0);
    if (validItems.length === 0) {
      setFormError("Please specify a return quantity (> 0) for at least one item.");
      return;
    }

    if (!window.confirm(`Confirm: create this ${tab === "SALES" ? "customer return" : "supplier return"}?`)) return;

    setSubmitting(true);
    try {
      if (tab === "SALES") {
        const res = await createSaleReturnAction({
          saleInvoiceId: selectedInvoiceId,
          date: new Date(returnDate),
          reason,
          items: validItems.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            unitPrice: i.unitRate,
          })),
        });

        if (!res.success) {
          setFormError(res.error || "Failed to process sale return.");
        } else {
          setIsDialogOpen(false);
          setSelectedInvoiceId("");
          setReason("");
          setReturnItems([]);
          await loadData();
        }
      } else {
        const res = await createPurchaseReturnAction({
          purchaseInvoiceId: selectedInvoiceId,
          date: new Date(returnDate),
          reason,
          items: validItems.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            unitCost: i.unitRate,
          })),
        });

        if (!res.success) {
          setFormError(res.error || "Failed to process purchase return.");
        } else {
          setIsDialogOpen(false);
          setSelectedInvoiceId("");
          setReason("");
          setReturnItems([]);
          await loadData();
        }
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
            <RotateCcw className="h-5 w-5 text-rose-700" />
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Returns & Credit/Debit Notes</h1>
          </div>
          <p className="text-sm text-slate-600">
            Process customer returns and supplier rejections with automatic stock restocking/debiting and ledger reversals.
          </p>
        </div>

        <Button
          onClick={() => {
            setSelectedInvoiceId("");
            setReturnItems([]);
            setReason("");
            setIsDialogOpen(true);
          }}
          className="bg-rose-800 text-white hover:bg-rose-700 shadow-sm"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          {tab === "SALES" ? "New Customer Return" : "New Supplier Return"}
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex rounded-lg border border-slate-200 bg-white p-1 max-w-md">
        <button
          onClick={() => setTab("SALES")}
          className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${
            tab === "SALES" ? "bg-rose-100 text-rose-900 shadow-2xs" : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <ArrowDownLeft className="h-4 w-4 text-rose-700" />
          Sale Returns (Credit Notes)
        </button>
        <button
          onClick={() => setTab("PURCHASES")}
          className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${
            tab === "PURCHASES" ? "bg-amber-100 text-amber-900 shadow-2xs" : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <ArrowUpRight className="h-4 w-4 text-amber-700" />
          Purchase Returns (Debit Notes)
        </button>
      </div>

      {/* Cards Display */}
      {loading ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500 text-sm">Loading returns...</CardContent>
        </Card>
      ) : tab === "SALES" ? (
        saleReturns.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-slate-500 text-sm">No sale returns recorded.</CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {saleReturns.map((ret) => (
              <Card key={ret.id} className="border-rose-950/10 hover:shadow-md transition-shadow bg-white flex flex-col justify-between">
                <CardHeader className="pb-3 border-b border-slate-100">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base font-bold text-slate-900">{ret.returnNo}</CardTitle>
                      <p className="text-xs font-medium text-rose-800">{ret.customer.name}</p>
                    </div>
                    <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800">
                      CREDIT NOTE
                    </span>
                  </div>
                </CardHeader>

                <CardContent className="py-3 space-y-2 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>Original Invoice:</span>
                    <span className="font-semibold text-slate-800">{ret.saleInvoice.invoiceNo}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Date:</span>
                    <span>{format(new Date(ret.date), "dd/MM/yyyy")}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Reason:</span>
                    <span className="italic truncate max-w-[160px]">{ret.reason}</span>
                  </div>
                  <div className="flex justify-between border-t border-slate-100 pt-2 font-bold text-sm">
                    <span>Restocked Value:</span>
                    <span className="text-rose-900">PKR {ret.totalAmount.toLocaleString()}</span>
                  </div>
                </CardContent>

                <div className="p-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-end rounded-b-xl">
                  <Button asChild variant="outline" size="sm" className="h-8 text-xs border-slate-200 text-slate-700 hover:bg-white">
                    <a href={`/api/pdf/sale-return/${ret.id}`} target="_blank" rel="noreferrer">
                      <FileText className="mr-1 h-3.5 w-3.5 text-rose-700" />
                      Download PDF
                    </a>
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )
      ) : purchaseReturns.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500 text-sm">No purchase returns recorded.</CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {purchaseReturns.map((ret) => (
            <Card key={ret.id} className="border-amber-950/10 hover:shadow-md transition-shadow bg-white flex flex-col justify-between">
              <CardHeader className="pb-3 border-b border-slate-100">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base font-bold text-slate-900">{ret.returnNo}</CardTitle>
                    <p className="text-xs font-medium text-amber-800">{ret.supplier.name}</p>
                  </div>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                    DEBIT NOTE
                  </span>
                </div>
              </CardHeader>

              <CardContent className="py-3 space-y-2 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Original Bill:</span>
                  <span className="font-semibold text-slate-800">{ret.purchaseInvoice.invoiceNo}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Date:</span>
                  <span>{format(new Date(ret.date), "dd/MM/yyyy")}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Reason:</span>
                  <span className="italic truncate max-w-[160px]">{ret.reason}</span>
                </div>
                <div className="flex justify-between border-t border-slate-100 pt-2 font-bold text-sm">
                  <span>Returned Value:</span>
                  <span className="text-amber-950">PKR {ret.totalAmount.toLocaleString()}</span>
                </div>
              </CardContent>

              <div className="p-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-end rounded-b-xl">
                <Button asChild variant="outline" size="sm" className="h-8 text-xs border-slate-200 text-slate-700 hover:bg-white">
                  <a href={`/api/pdf/purchase-return/${ret.id}`} target="_blank" rel="noreferrer">
                    <FileText className="mr-1 h-3.5 w-3.5 text-amber-700" />
                    Download PDF
                  </a>
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Return Dialog Modal */}
      {isDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs overflow-y-auto">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  {tab === "SALES" ? "Record Customer Sale Return" : "Record Supplier Purchase Return"}
                </h2>
                <p className="text-xs text-slate-500">
                  Select the original invoice and specify the returning item quantities
                </p>
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
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="targetInvoice" className="text-xs font-semibold">
                    Original {tab === "SALES" ? "Sale Invoice" : "Purchase Invoice"} <span className="text-rose-500">*</span>
                  </Label>
                  <select
                    id="targetInvoice"
                    value={selectedInvoiceId}
                    onChange={(e) => handleInvoiceSelect(e.target.value)}
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs"
                    required
                  >
                    <option value="">Select invoice</option>
                    {tab === "SALES"
                      ? saleInvoices.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.invoiceNo}
                          </option>
                        ))
                      : purchaseInvoices.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.invoiceNo}
                          </option>
                        ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="rdate" className="text-xs font-semibold">
                    Date <span className="text-rose-500">*</span>
                  </Label>
                  <Input
                    id="rdate"
                    type="date"
                    value={returnDate}
                    onChange={(e) => setReturnDate(e.target.value)}
                    className="text-xs"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="reason" className="text-xs font-semibold">
                  Reason for Return <span className="text-rose-500">*</span>
                </Label>
                <Input
                  id="reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Defective paper finish / transit damage"
                  className="text-xs"
                  required
                />
              </div>

              {/* Items from selected invoice */}
              {returnItems.length > 0 && (
                <div className="space-y-2 border-t border-slate-100 pt-3">
                  <Label className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Return Quantities (Max Allowed from Original Invoice)
                  </Label>
                  <div className="space-y-2">
                    {returnItems.map((item, idx) => (
                      <div
                        key={idx}
                        className="grid gap-2 sm:grid-cols-[1fr_120px_100px] items-center rounded-lg border border-slate-100 p-2.5 bg-slate-50/50 text-xs"
                      >
                        <div>
                          <p className="font-semibold text-slate-900">{item.name}</p>
                          <p className="text-[11px] text-slate-500">
                            Rate: PKR {item.unitRate} • Invoiced Qty: {item.maxQty} {item.unit}
                          </p>
                        </div>
                        <div>
                          <Input
                            type="number"
                            min="0"
                            max={item.maxQty}
                            value={item.quantity}
                            onChange={(e) => handleReturnQtyChange(idx, Number(e.target.value) || 0)}
                            className="h-8 text-xs text-right"
                            placeholder="Qty to return"
                          />
                        </div>
                        <div className="text-right font-bold text-slate-900">
                          PKR {(item.quantity * item.unitRate).toFixed(2)}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex justify-between items-center border-t border-slate-100 pt-3 text-sm font-bold">
                    <span>Total Return Credit:</span>
                    <span className="text-rose-900">PKR {returnSubtotal.toLocaleString()}</span>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)} className="text-xs">
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting} className="bg-rose-800 text-white hover:bg-rose-700 text-xs">
                  {submitting ? "Processing..." : "Confirm Return"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

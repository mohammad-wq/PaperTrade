"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  RotateCcw,
  Plus,
  Search,
  FileText,
  AlertCircle,
  X,
  ArrowDownLeft,
  ArrowUpRight,
  Printer,
  Download,
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
import { formatDateTime } from "@/lib/utils";
import { useRealtimeListener } from "@/hooks/use-realtime";
import { useConfirm } from "@/components/providers/confirm-provider";
import { printDocumentPdf, printDraftPdf } from "@/lib/print-pdf";
import { PrintPaperSizeControl, type PrintPaperSize } from "@/components/print/PrintPaperSizeControl";
import { withPaperSizeQuery } from "@/components/ui/print-with-paper-size";
import { handleFormKeyDown } from "@/lib/keyboard-nav";
import { useSession } from "next-auth/react";
import { canPerformAction } from "@/lib/auth/permissions";

type SaleReturnRow = {
  id: string;
  returnNo: string;
  date: Date;
  reason: string;
  totalAmount: number;
  customer: { id: string; name: string };
  location: { id: string; name: string };
  saleInvoice: { id: string; invoiceNo: string };
  financialYear?: { id: string; label: string; isActive?: boolean } | null;
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
  financialYear?: { id: string; label: string; isActive?: boolean } | null;
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
  customer?: { id: string; name: string; phone?: string | null };
  supplier?: { id: string; name: string; phone?: string | null };
  location?: { id: string; name: string };
  items: Array<{
    productId: string;
    quantity: number;
    unitPrice?: number;
    unitCost?: number;
    product: { id: string; productNo: string; name: string; unit: string };
  }>;
};

export default function ReturnsPage() {
  const router = useRouter();
  const confirm = useConfirm();
  const { data: session } = useSession();
  const canView = !session?.user ? true : canPerformAction(session.user.role, "returns", "view", (session.user as any).permissions);
  const canCreate = !session?.user ? false : canPerformAction(session.user.role, "returns", "create", (session.user as any).permissions);

  useEffect(() => {
    if (session?.user && !canView) {
      router.replace("/dashboard");
    }
  }, [session, canView, router]);

  const [tab, setTab] = useState<"SALES" | "PURCHASES">("SALES");
  const [saleReturns, setSaleReturns] = useState<SaleReturnRow[]>([]);
  const [purchaseReturns, setPurchaseReturns] = useState<PurchaseReturnRow[]>([]);
  const [saleInvoices, setSaleInvoices] = useState<InvoiceOption[]>([]);
  const [purchaseInvoices, setPurchaseInvoices] = useState<InvoiceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [docPaperSize, setDocPaperSize] = useState<PrintPaperSize>("A4");
  const [yearFilter, setYearFilter] = useState<"CURRENT" | "ALL">("CURRENT");
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.key === "F2" || e.key === "Insert") && canCreate) {
        e.preventDefault();
        setSelectedInvoiceId("");
        setReturnItems([]);
        setReason("");
        setIsDialogOpen(true);
      } else if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canCreate]);

  const displayedSaleReturns = useMemo(() => {
    return saleReturns.filter((r) => {
      if (yearFilter === "CURRENT" && r.financialYear && r.financialYear.isActive === false) {
        return false;
      }
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (
        r.returnNo.toLowerCase().includes(q) ||
        r.customer.name.toLowerCase().includes(q) ||
        r.saleInvoice.invoiceNo.toLowerCase().includes(q)
      );
    });
  }, [saleReturns, yearFilter, query]);

  const displayedPurchaseReturns = useMemo(() => {
    return purchaseReturns.filter((r) => {
      if (yearFilter === "CURRENT" && r.financialYear && r.financialYear.isActive === false) {
        return false;
      }
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (
        r.returnNo.toLowerCase().includes(q) ||
        r.supplier.name.toLowerCase().includes(q) ||
        r.purchaseInvoice.invoiceNo.toLowerCase().includes(q)
      );
    });
  }, [purchaseReturns, yearFilter, query]);

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
  const [previewLoading, setPreviewLoading] = useState(false);

  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get("action") === "new") {
      setIsDialogOpen(true);
    }
  }, [searchParams]);

  // Pre-posting PDF preview
  async function handlePreviewPdf() {
    if (!selectedInvoiceId) {
      setFormError("Please select the original invoice before previewing.");
      return;
    }
    const itemsToReturn = returnItems.filter((i) => i.quantity > 0);
    if (itemsToReturn.length === 0) {
      setFormError("Enter at least one return quantity > 0 before previewing.");
      return;
    }
    setPreviewLoading(true);
    try {
      const invList = tab === "SALES" ? saleInvoices : purchaseInvoices;
      const originalInv = invList.find((i) => i.id === selectedInvoiceId);
      const totalAmount = itemsToReturn.reduce((sum, i) => sum + i.quantity * i.unitRate, 0);

      const activeDocNo = tab === "SALES"
        ? saleReturns[0]?.returnNo
          ? saleReturns[0].returnNo.replace(/\d+$/, (n) => String(Number(n) + 1).padStart(n.length, "0"))
          : `${new Date().getFullYear()}-001`
        : purchaseReturns[0]?.returnNo
        ? purchaseReturns[0].returnNo.replace(/\d+$/, (n) => String(Number(n) + 1).padStart(n.length, "0"))
        : `${new Date().getFullYear()}-001`;

      const payload = {
        type: tab === "SALES" ? "sale-return" : "purchase-return",
        paperSize: docPaperSize,
        docNumber: activeDocNo,
        date: returnDate,
        partyName: originalInv?.customer?.name || originalInv?.supplier?.name || "Party",
        partyPhone: originalInv?.customer?.phone || originalInv?.supplier?.phone || null,
        locationName: originalInv?.location?.name || "Shop",
        referenceNo: originalInv ? `Original Invoice: ${originalInv.invoiceNo}` : null,
        totalAmount,
        amountPaid: 0,
        notes: reason || null,
        items: itemsToReturn.map((item) => ({
          name: item.name,
          specs: item.unit,
          quantity: item.quantity,
          unit: item.unit,
          unitPrice: item.unitRate,
          lineTotal: item.quantity * item.unitRate,
        })),
      };

      await printDraftPdf(payload as Record<string, unknown>);
    } catch (err: any) {
      await confirm.alert(err.message || "Failed to print return", { variant: "destructive" });
    } finally {
      setPreviewLoading(false);
    }
  }

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

    const ok = await confirm({
      title: tab === "SALES" ? "Create Customer Return" : "Create Supplier Return",
      description: `Are you sure you want to create this ${tab === "SALES" ? "customer return note" : "supplier return debit note"}?`,
      confirmText: "Create Return",
      variant: "primary",
    });
    if (!ok) return;

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
    <div className="flex flex-col gap-3 p-4">
      {/* Top Banner: Title, Counters, and Action Button */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-2.5 rounded-md shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-400 rounded-md">
            <RotateCcw className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Returns & Credit/Debit Notes
            </h1>
            <p className="text-[11px] text-slate-500">
              Process customer returns and supplier rejections with automatic stock restocking and ledger reversals
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Counters */}
          <div className="hidden sm:flex items-center gap-2 text-xs font-mono">
            <span className="bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800 px-2 py-1 rounded">
              Credit Notes: <strong>{saleReturns.length}</strong>
            </span>
            <span className="bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 px-2 py-1 rounded">
              Debit Notes: <strong>{purchaseReturns.length}</strong>
            </span>
          </div>

          {canCreate && (
            <Button
              onClick={() => {
                setSelectedInvoiceId("");
                setReturnItems([]);
                setReason("");
                setIsDialogOpen(true);
              }}
              className="h-8 bg-rose-800 hover:bg-rose-900 text-white text-xs font-bold shadow-xs px-3"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              {tab === "SALES" ? "New Sale Return" : "New Purchase Return"} <span className="ml-1.5 text-[10px] opacity-75 font-mono">[F2]</span>
            </Button>
          )}
        </div>
      </div>

      {/* Tabs & Search / Filter Row */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2.5 rounded-md shadow-xs">
        <div className="flex rounded-md border border-slate-200 p-0.5 bg-slate-50 text-xs w-full sm:w-auto">
          <button
            onClick={() => setTab("SALES")}
            className={`flex-1 sm:flex-none px-3 rounded py-1 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${
              tab === "SALES" ? "bg-white text-rose-900 shadow-2xs" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <ArrowDownLeft className="h-3.5 w-3.5 text-rose-700" />
            Sale Returns (Credit Notes)
          </button>
          <button
            onClick={() => setTab("PURCHASES")}
            className={`flex-1 sm:flex-none px-3 rounded py-1 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${
              tab === "PURCHASES" ? "bg-white text-amber-900 shadow-2xs" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <ArrowUpRight className="h-3.5 w-3.5 text-amber-700" />
            Purchase Returns (Debit Notes)
          </button>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <PrintPaperSizeControl value={docPaperSize} onChange={setDocPaperSize} />
          <div className="relative flex-1 sm:w-72">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <Input
              ref={searchInputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search returns... (Press / to focus)"
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

          <div className="inline-flex rounded-md border border-slate-300 p-0.5 bg-slate-100 shrink-0">
            <button
              type="button"
              onClick={() => setYearFilter("CURRENT")}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-all ${
                yearFilter === "CURRENT"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Current Year
            </button>
            <button
              type="button"
              onClick={() => setYearFilter("ALL")}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-all ${
                yearFilter === "ALL"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              All Years (Archive)
            </button>
          </div>
        </div>
      </div>

      {/* Cards Display */}
      {loading ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500 text-sm">Loading returns...</CardContent>
        </Card>
      ) : tab === "SALES" ? (
        displayedSaleReturns.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-slate-500 text-sm">No sale returns match filters.</CardContent>
          </Card>
        ) : (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md shadow-xs overflow-hidden">
            <div className="overflow-x-auto max-h-[calc(100vh-230px)]">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700 text-[11px] font-bold uppercase tracking-wider">
                  <tr>
                    <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap">Return #</th>
                    <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap">Date</th>
                    <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 min-w-[180px]">Customer</th>
                    <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap">Original Invoice</th>
                    <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap">Value (PKR)</th>
                    <th className="py-2 px-2.5 text-center whitespace-nowrap">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {displayedSaleReturns.map((ret) => (
                    <tr key={ret.id} className="hover:bg-rose-50/60 dark:hover:bg-slate-800/60 transition-colors even:bg-slate-50/40 dark:even:bg-slate-900/40">
                      <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-slate-900 dark:text-slate-100">{ret.returnNo}</span>
                          {ret.financialYear && (
                            <span className="text-[9px] px-1 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-mono">{ret.financialYear.label}</span>
                          )}
                        </div>
                      </td>
                      <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono whitespace-nowrap text-slate-600 dark:text-slate-400 text-[11px]">
                        {formatDateTime(ret.date)}
                      </td>
                      <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-medium text-slate-800 dark:text-slate-200">
                        {ret.customer.name}
                      </td>
                      <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono whitespace-nowrap text-slate-600 dark:text-slate-400">
                        {ret.saleInvoice.invoiceNo}
                      </td>
                      <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono text-right whitespace-nowrap font-bold text-rose-900 dark:text-rose-400">
                        PKR {ret.totalAmount.toLocaleString()}
                      </td>
                      <td className="py-1 px-2 text-center whitespace-nowrap">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-xs text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                          title="Print Return"
                          onClick={() => {
                            printDocumentPdf(withPaperSizeQuery(`/api/pdf/sale-return/${ret.id}`, docPaperSize)).catch((e) =>
                              confirm.alert(e.message, { variant: "destructive" })
                            );
                          }}
                        >
                          <Printer className="h-3 w-3 mr-1" />
                          Print
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : displayedPurchaseReturns.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500 text-sm">No purchase returns match filters.</CardContent>
        </Card>
      ) : (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md shadow-xs overflow-hidden">
          <div className="overflow-x-auto max-h-[calc(100vh-230px)]">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700 text-[11px] font-bold uppercase tracking-wider">
                <tr>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap">Return #</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap">Date</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 min-w-[180px]">Supplier</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap">Original Bill</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap">Value (PKR)</th>
                  <th className="py-2 px-2.5 text-center whitespace-nowrap">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {displayedPurchaseReturns.map((ret) => (
                  <tr key={ret.id} className="hover:bg-amber-50/60 dark:hover:bg-slate-800/60 transition-colors even:bg-slate-50/40 dark:even:bg-slate-900/40">
                    <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-slate-900 dark:text-slate-100">{ret.returnNo}</span>
                        {ret.financialYear && (
                          <span className="text-[9px] px-1 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-mono">{ret.financialYear.label}</span>
                        )}
                      </div>
                    </td>
                    <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono whitespace-nowrap text-slate-600 dark:text-slate-400 text-[11px]">
                      {formatDateTime(ret.date)}
                    </td>
                    <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-medium text-slate-800 dark:text-slate-200">
                      {ret.supplier.name}
                    </td>
                    <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono whitespace-nowrap text-slate-600 dark:text-slate-400">
                      {ret.purchaseInvoice.invoiceNo}
                    </td>
                    <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono text-right whitespace-nowrap font-bold text-amber-900 dark:text-amber-400">
                      PKR {ret.totalAmount.toLocaleString()}
                    </td>
                    <td className="py-1 px-2 text-center whitespace-nowrap">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-1.5 text-xs text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/40"
                        title="Print Return"
                        onClick={() => {
                          printDocumentPdf(withPaperSizeQuery(`/api/pdf/purchase-return/${ret.id}`, docPaperSize)).catch((e) =>
                            confirm.alert(e.message, { variant: "destructive" })
                          );
                        }}
                      >
                        <Printer className="h-3 w-3 mr-1" />
                        Print
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Return Dialog Modal */}
      {isDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs overflow-y-auto">
          <div className="w-[96vw] max-w-5xl rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 max-h-[92vh] overflow-y-auto">
            {/* Quick Navigation Strip */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-slate-100 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-slate-500">Quick Jump:</span>
                <a
                  href="/sales"
                  className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-200"
                >
                  + Sales Invoice
                </a>
                <a
                  href="/purchases"
                  className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-200"
                >
                  + Purchase Invoice
                </a>
                <a
                  href="/delivery-orders"
                  className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-200"
                >
                  + Delivery Order
                </a>
              </div>
              <span className="text-[11px] text-slate-400 font-mono">Press [Esc] to close</span>
            </div>

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

            <form onSubmit={handleSubmit} onKeyDown={(e) => handleFormKeyDown(e)} className="mt-4 space-y-4">
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
                            step="any"
                            max={item.maxQty}
                            value={item.quantity}
                            onChange={(e) => handleReturnQtyChange(idx, parseFloat(e.target.value) || 0)}
                            className="h-8 text-xs text-right"
                            placeholder="Qty to return"
                          />
                        </div>
                        <div className="text-right font-bold text-slate-900">
                          PKR {(((item.quantity || 0) * (item.unitRate || 0))).toFixed(2)}
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

              <div className="flex items-center justify-between border-t border-slate-100 pt-4">
                <span className="text-[11px] text-slate-400 font-mono hidden sm:inline">
                  Print the debit or credit note
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handlePreviewPdf}
                    disabled={previewLoading || !selectedInvoiceId || returnItems.filter((i) => i.quantity > 0).length === 0}
                    className="text-xs border-rose-300 text-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/40 gap-1.5"
                    title="Print credit or debit note"
                  >
                    <Printer className="h-3.5 w-3.5 text-rose-700" />
                    {previewLoading ? "Printing..." : "Print"}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)} className="text-xs">
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting} className="bg-rose-800 text-white hover:bg-rose-700 text-xs font-semibold">
                    {submitting ? "Processing..." : "Confirm Return"}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

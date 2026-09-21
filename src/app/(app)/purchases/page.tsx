"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import {
  ShoppingCart,
  Plus,
  Search,
  FileText,
  AlertCircle,
  Trash2,
  X,
  Layers,
  Eye,
  Printer,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listPurchaseInvoicesAction, createPurchaseInvoiceAction } from "@/actions/invoices";
import { listPurchaseOrdersAction } from "@/actions/orders";
import { listLocationsAction } from "@/actions/locations";
import { listPartiesAction } from "@/actions/parties";
import { listProductsAction } from "@/actions/products";
import { listWarehouseLotsAction, createWarehouseLotAction } from "@/actions/warehouse-lots";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useRealtimeListener } from "@/hooks/use-realtime";
import { useConfirm } from "@/components/providers/confirm-provider";

type PurchaseInvoiceRow = {
  id: string;
  invoiceNo: string;
  date: Date;
  status: string;
  totalAmount: number;
  supplier: { id: string; name: string; phone: string | null };
  location: { id: string; name: string };
  purchaseOrder?: { id: string; orderNo: string } | null;
  financialYear?: { id: string; label: string; isActive?: boolean } | null;
  items: Array<{
    id: string;
    quantity: number;
    unitCost: number;
    lineTotal: number;
    warehouseLot?: { id: string; lotNumber: string } | null;
    product: { id: string; productNo: string; name: string; unit: string };
  }>;
};

type PartyOption = {
  id: string;
  name: string;
  type: string;
  balance?: number;
};

type ProductOption = {
  id: string;
  productNo: string;
  name: string;
  unit: string;
  costPrice: number;
};

type POOption = {
  id: string;
  orderNo: string;
  supplierId: string;
  locationId: string;
  status: string;
};

type LineItem = {
  productId: string;
  warehouseLotId?: string;
  quantity: number;
  unitCost: number;
};

type LocationOption = {
  id: string;
  name: string;
  type: string;
  address?: string | null;
};

type WarehouseLotOption = {
  id: string;
  locationId: string;
  lotNumber: string;
  description: string | null;
};

export default function PurchasesPage() {
  const confirm = useConfirm();
  const [invoices, setInvoices] = useState<PurchaseInvoiceRow[]>([]);
  const [suppliers, setSuppliers] = useState<PartyOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [pos, setPos] = useState<POOption[]>([]);
  const [dbLocations, setDbLocations] = useState<LocationOption[]>([]);
  const [warehouseLots, setWarehouseLots] = useState<WarehouseLotOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"OPEN" | "ALL">("OPEN");
  const [yearFilter, setYearFilter] = useState<"CURRENT" | "ALL">("CURRENT");
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

  // Quick lot creation modal state
  const [quickLotModalOpen, setQuickLotModalOpen] = useState(false);
  const [quickLotLineIndex, setQuickLotLineIndex] = useState<number | null>(null);
  const [quickLotNumber, setQuickLotNumber] = useState("");
  const [quickLotDesc, setQuickLotDesc] = useState("");
  const [submittingQuickLot, setSubmittingQuickLot] = useState(false);

  // Form state
  const [supplierType, setSupplierType] = useState<"REGISTERED" | "ONE_TIME">("REGISTERED");
  const [oneTimeSupplierName, setOneTimeSupplierName] = useState("");
  const [oneTimeSupplierPhone, setOneTimeSupplierPhone] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [purchaseOrderId, setPurchaseOrderId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItem[]>([{ productId: "", warehouseLotId: "", quantity: 1, unitCost: 0 }]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPdfPreviewModal, setShowPdfPreviewModal] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get("action") === "new") {
      setIsDialogOpen(true);
    }
    if (searchParams.get("fromInvoice") === "1") {
      try {
        const stored = sessionStorage.getItem("draft_from_invoice");
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed.locationId) setLocationId(parsed.locationId);
          if (Array.isArray(parsed.items) && parsed.items.length > 0) {
            setItems(
              parsed.items.map((item: any) => ({
                productId: item.productId || "",
                quantity: Number(item.quantity) || 1,
                unitCost: Number(item.unitCost) || 0,
                warehouseLotId: item.warehouseLotId || "",
              }))
            );
          }
        }
      } catch (e) {
        console.error("Failed to load draft_from_invoice in purchases", e);
      }
    }
  }, [searchParams]);

  // Pre-posting PDF preview
  async function handlePreviewPdf() {
    if (items.length === 0 || items.some((i) => !i.productId || i.quantity <= 0)) {
      setFormError("Please select valid items with quantities > 0 before previewing.");
      return;
    }
    setPreviewLoading(true);
    try {
      const selectedLoc = dbLocations.find((l) => l.id === locationId);
      const totalCost = items.reduce((sum, i) => sum + (i.quantity || 0) * (i.unitCost || 0), 0);

      let partyName = "Market Vendor";
      let partyPhone: string | null = null;
      if (supplierType === "REGISTERED") {
        const selectedSupplier = suppliers.find((s) => s.id === supplierId);
        partyName = selectedSupplier?.name || "Paper Mill / Supplier";
        partyPhone = selectedSupplier ? (selectedSupplier as any).phone || null : null;
      } else {
        partyName = oneTimeSupplierName.trim() || "Market Vendor";
        partyPhone = oneTimeSupplierPhone.trim() || null;
      }

      const activeDocNo = invoices[0]?.invoiceNo
        ? invoices[0].invoiceNo.replace(/\d+$/, (n) => String(Number(n) + 1).padStart(n.length, "0"))
        : `${new Date().getFullYear()}-001`;

      const payload = {
        type: "purchase-invoice",
        docNumber: activeDocNo,
        date: invoiceDate,
        partyName,
        partyPhone,
        locationName: selectedLoc?.name || "Shop",
        referenceNo: purchaseOrderId ? `PO: ${pos.find((p) => p.id === purchaseOrderId)?.orderNo}` : null,
        totalAmount: totalCost,
        amountPaid: 0,
        notes: notes || null,
        items: items.map((item) => {
          const prod = products.find((p) => p.id === item.productId);
          return {
            name: prod ? `${prod.productNo} - ${prod.name}` : "Product",
            specs: prod?.unit || "Unit",
            quantity: item.quantity,
            unit: prod?.unit || "Unit",
            unitPrice: item.unitCost,
            lineTotal: (item.quantity || 0) * (item.unitCost || 0),
          };
        }),
      };

      const res = await fetch("/api/pdf/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || "Failed to generate preview PDF");
      }

      if (pdfPreviewUrl) {
        try { URL.revokeObjectURL(pdfPreviewUrl); } catch {}
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPdfPreviewUrl(url);
      setShowPdfPreviewModal(true);
    } catch (err: any) {
      await confirm.alert(err.message || "Failed to preview Purchase Invoice PDF", { variant: "destructive" });
    } finally {
      setPreviewLoading(false);
    }
  }

  async function loadData(isBackground = false) {
    if (!isBackground) setLoading(true);
    try {
      const [invRes, partyRes, prodRes, poRes, locRes, lotRes] = await Promise.all([
        listPurchaseInvoicesAction(),
        listPartiesAction(),
        listProductsAction(),
        listPurchaseOrdersAction(),
        listLocationsAction(),
        listWarehouseLotsAction(undefined, false),
      ]);

      if (invRes.success && invRes.data) {
        setInvoices(invRes.data as PurchaseInvoiceRow[]);
      }
      if (partyRes.success && partyRes.data) {
        const suppList = partyRes.data as PartyOption[];
        setSuppliers(suppList);
      }
      if (prodRes.success && prodRes.data) {
        setProducts(prodRes.data as ProductOption[]);
      }
      if (poRes.success && poRes.data) {
        setPos(poRes.data as POOption[]);
      }
      if (lotRes.success && lotRes.data) {
        setWarehouseLots(lotRes.data as WarehouseLotOption[]);
      }
      if (locRes.success && locRes.data) {
        const locs = locRes.data as LocationOption[];
        setDbLocations(locs);
        if (locs.length > 0) {
          const shop = locs.find((l) => l.name.toLowerCase() === "shop") ?? locs[0];
          setLocationId((prev) => prev || shop.id);
        }
      }
    } finally {
      if (!isBackground) setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  useRealtimeListener(["purchases", "inventory", "parties", "purchase-orders", "payments"], () => {
    void loadData(true);
  });

  const locations = useMemo(() => {
    if (dbLocations.length > 0) return dbLocations;
    const map = new Map<string, LocationOption>();
    invoices.forEach((i) =>
      map.set(i.location.id, { id: i.location.id, name: i.location.name, type: "WAREHOUSE" }),
    );
    return Array.from(map.values());
  }, [dbLocations, invoices]);

  const selectedLocation = useMemo(
    () => locations.find((l) => l.id === locationId),
    [locations, locationId],
  );

  const locationLots = useMemo(
    () => warehouseLots.filter((lot) => lot.locationId === locationId),
    [warehouseLots, locationId],
  );

  const showLotSelector = selectedLocation?.type === "WAREHOUSE" || locationLots.length > 0;

  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      // 1. Status Filter (default: OPEN)
      if (statusFilter === "OPEN" && inv.status === "SETTLED") {
        return false;
      }

      // 2. Financial Year Filter (default: CURRENT)
      if (yearFilter === "CURRENT") {
        if (inv.financialYear && inv.financialYear.isActive === false) {
          return false;
        }
      }

      // 3. Query Filter
      const q = query.trim().toLowerCase();
      if (!q) return true;

      return (
        inv.invoiceNo.toLowerCase().includes(q) ||
        inv.supplier.name.toLowerCase().includes(q) ||
        inv.location.name.toLowerCase().includes(q)
      );
    });
  }, [invoices, statusFilter, yearFilter, query]);

  const totalPurchases = useMemo(
    () => filteredInvoices.reduce((sum, i) => sum + i.totalAmount, 0),
    [filteredInvoices],
  );

  const invoiceSubtotal = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0),
    [items],
  );

  const selectedSupplier = useMemo(
    () => suppliers.find((s) => s.id === supplierId),
    [suppliers, supplierId],
  );

  function handleLocationChange(newLocId: string) {
    setLocationId(newLocId);
    setItems((prev) =>
      prev.map((it) => {
        const lotMatches = warehouseLots.some(
          (l) => l.id === it.warehouseLotId && l.locationId === newLocId,
        );
        return lotMatches ? it : { ...it, warehouseLotId: "" };
      }),
    );
  }

  function handleProductChange(index: number, pId: string) {
    const product = products.find((p) => p.id === pId);
    const updated = [...items];
    updated[index].productId = pId;
    if (product) {
      updated[index].unitCost = product.costPrice || 0;
    }
    setItems(updated);
  }

  function handleLotChange(index: number, lotId: string) {
    const updated = [...items];
    updated[index].warehouseLotId = lotId;
    setItems(updated);
  }

  function handleQuantityChange(index: number, qty: number) {
    const updated = [...items];
    updated[index].quantity = qty;
    setItems(updated);
  }

  function handleCostChange(index: number, cost: number) {
    const updated = [...items];
    updated[index].unitCost = cost;
    setItems(updated);
  }

  function addItem() {
    setItems([...items, { productId: "", warehouseLotId: "", quantity: 1, unitCost: 0 }]);
  }

  function removeItem(index: number) {
    if (items.length <= 1) return;
    setItems(items.filter((_, idx) => idx !== index));
  }

  async function handleCreateQuickLot(e: React.FormEvent) {
    e.preventDefault();
    if (!locationId || !quickLotNumber.trim()) return;
    setSubmittingQuickLot(true);
    try {
      const res = await createWarehouseLotAction({
        locationId,
        lotNumber: quickLotNumber.trim(),
        description: quickLotDesc.trim() || undefined,
      });
      if (res.success && res.data) {
        const newLot = res.data as WarehouseLotOption;
        setWarehouseLots((prev) => [...prev, newLot]);
        if (quickLotLineIndex !== null) {
          handleLotChange(quickLotLineIndex, newLot.id);
        }
        setQuickLotModalOpen(false);
        setQuickLotNumber("");
        setQuickLotDesc("");
        setQuickLotLineIndex(null);
      } else {
        await confirm.alert(!res.success ? res.error : "Failed to create lot", { variant: "destructive" });
      }
    } catch (err: any) {
      await confirm.alert(err.message || "Failed to create lot", { variant: "destructive" });
    } finally {
      setSubmittingQuickLot(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (supplierType === "REGISTERED" && !supplierId) {
      setFormError("Please select a registered supplier.");
      return;
    }
    if (supplierType === "ONE_TIME" && !oneTimeSupplierName.trim()) {
      setOneTimeSupplierName("Market Vendor");
    }
    if (!locationId) {
      setFormError("Please select a receiving location.");
      return;
    }
    if (items.some((i) => !i.productId || i.quantity <= 0)) {
      setFormError("All line items must have a valid product and quantity > 0.");
      return;
    }

    const ok = await confirm({
      title: "Confirm Purchase Invoice",
      description: "Are you sure you want to record this purchase invoice and receive inventory?",
      confirmText: "Record Invoice",
      variant: "primary",
    });
    if (!ok) return;

    setSubmitting(true);
    try {
      const res = await createPurchaseInvoiceAction({
        supplierType,
        supplierId: supplierType === "REGISTERED" ? supplierId : undefined,
        oneTimeSupplierName: supplierType === "ONE_TIME" ? (oneTimeSupplierName.trim() || "Market Vendor") : undefined,
        oneTimeSupplierPhone: supplierType === "ONE_TIME" ? (oneTimeSupplierPhone.trim() || null) : undefined,
        locationId,
        purchaseOrderId: purchaseOrderId || null,
        date: new Date(invoiceDate),
        notes,
        items: items.map((i) => ({
          productId: i.productId,
          warehouseLotId: i.warehouseLotId || undefined,
          quantity: i.quantity,
          unitCost: i.unitCost,
        })),
      });

      if (!res.success) {
        setFormError(res.error || "Failed to record purchase invoice.");
      } else {
        setIsDialogOpen(false);
        setSupplierId("");
        setLocationId("");
        setPurchaseOrderId("");
        setInvoiceDate(new Date().toISOString().slice(0, 10));
        setItems([{ productId: "", warehouseLotId: "", quantity: 1, unitCost: 0 }]);
        setNotes("");
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
          <div className="p-2 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-400 rounded-md">
            <ShoppingCart className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Purchase Invoices
            </h1>
            <p className="text-[11px] text-slate-500">
              Receive paper shipments from suppliers, credit payables, and increase warehouse stock
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Counters */}
          <div className="hidden sm:flex items-center gap-2 text-xs font-mono">
            <span className="bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 px-2 py-1 rounded">
              Total: <strong>PKR {totalPurchases.toLocaleString()}</strong>
            </span>
            <span className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-300 px-2 py-1 rounded">
              Invoices: <strong>{filteredInvoices.length}</strong>
            </span>
          </div>

          <Button
            onClick={() => {
              if (!locationId && locations.length > 0) setLocationId(locations[0].id);
              setIsDialogOpen(true);
            }}
            className="h-8 bg-amber-800 hover:bg-amber-900 text-white text-xs font-bold shadow-xs px-3"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Receive Purchase <span className="ml-1.5 text-[10px] opacity-75 font-mono">[F2]</span>
          </Button>
        </div>
      </div>

      {/* Search Filter & Archive Toggles */}
      <div className="flex flex-col md:flex-row gap-2 items-center justify-between bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2.5 rounded-md shadow-xs">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <Input
            ref={searchInputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by invoice number, supplier, or location... (Press / to focus)"
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

        {/* Status & Year Toggles */}
        <div className="flex items-center gap-1.5 shrink-0 self-end md:self-auto text-xs">
          <div className="inline-flex rounded-md border border-slate-300 p-0.5 bg-slate-100">
            <button
              type="button"
              onClick={() => setStatusFilter("OPEN")}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-all ${
                statusFilter === "OPEN"
                  ? "bg-white text-amber-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Open Invoices
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("ALL")}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-all ${
                statusFilter === "ALL"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              All (inc. Settled)
            </button>
          </div>

          <div className="inline-flex rounded-md border border-slate-300 p-0.5 bg-slate-100">
            <button
              type="button"
              onClick={() => setYearFilter("CURRENT")}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-all ${
                yearFilter === "CURRENT"
                  ? "bg-white text-amber-900 shadow-xs"
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

      {/* Invoices List / Responsive Cards */}
      {loading ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500 text-sm">
            Loading purchase invoices...
          </CardContent>
        </Card>
      ) : filteredInvoices.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500 text-sm">
            No purchase invoices match your filters.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredInvoices.map((inv) => (
            <Card key={inv.id} className="border-amber-950/10 hover:shadow-md transition-shadow bg-white flex flex-col justify-between">
              <CardHeader className="pb-3 border-b border-slate-100">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <CardTitle className="text-base font-bold text-slate-900">{inv.invoiceNo}</CardTitle>
                      {inv.financialYear && (
                        <span className="text-[9px] px-1 py-0.2 rounded bg-slate-100 text-slate-600 font-mono">
                          {inv.financialYear.label}
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-medium text-amber-800">{inv.supplier.name}</p>
                    {inv.supplier.phone && (
                      <p className="text-[11px] text-slate-400">{inv.supplier.phone}</p>
                    )}
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      inv.status === "SETTLED"
                        ? "bg-emerald-100 text-emerald-800"
                        : inv.status === "CANCELLED"
                        ? "bg-rose-100 text-rose-800"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {inv.status}
                  </span>
                </div>
              </CardHeader>

              <CardContent className="py-3 space-y-2 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Received at:</span>
                  <span className="font-semibold text-slate-800">{inv.location.name}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Date:</span>
                  <span>{format(new Date(inv.date), "dd/MM/yyyy")}</span>
                </div>
                {inv.purchaseOrder && (
                  <div className="flex justify-between text-slate-600">
                    <span>Linked PO:</span>
                    <span className="font-semibold text-emerald-800">{inv.purchaseOrder.orderNo}</span>
                  </div>
                )}
                <div className="flex justify-between items-center text-slate-600">
                  <span>Items:</span>
                  <div className="text-right">
                    <span>{inv.items.length} product(s)</span>
                    {inv.items.some((it) => it.warehouseLot) && (
                      <span className="ml-1.5 inline-block text-[10px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                        Lot: {Array.from(new Set(inv.items.filter((it) => it.warehouseLot).map((it) => it.warehouseLot!.lotNumber))).join(", ")}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex justify-between border-t border-slate-100 pt-2 font-bold text-sm">
                  <span>Total Amount:</span>
                  <span className="text-slate-900">PKR {inv.totalAmount.toLocaleString()}</span>
                </div>
              </CardContent>

              <div className="p-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-end rounded-b-xl">
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs border-slate-200 text-slate-700 hover:bg-white"
                >
                  <a href={`/api/pdf/purchase-invoice/${inv.id}`} target="_blank" rel="noreferrer">
                    <FileText className="mr-1 h-3.5 w-3.5 text-amber-700" />
                    Download PDF
                  </a>
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* New Purchase Invoice Modal */}
      {isDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs overflow-y-auto">
          <div className="w-[96vw] max-w-6xl rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 max-h-[92vh] overflow-y-auto">
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
                  href="/purchase-orders"
                  className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-200"
                >
                  + Purchase Order
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
                <h2 className="text-lg font-bold text-slate-900">Record Purchase Invoice</h2>
                <p className="text-xs text-slate-500">Receive stock from paper mill/supplier and post to payables</p>
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
              {/* Supplier Type Toggle */}
              <div className="flex items-center gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-md w-fit">
                <button
                  type="button"
                  onClick={() => setSupplierType("REGISTERED")}
                  className={`px-3 py-1 rounded text-xs font-semibold transition-all ${
                    supplierType === "REGISTERED"
                      ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                  }`}
                >
                  Registered Supplier
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSupplierType("ONE_TIME");
                    if (!oneTimeSupplierName) setOneTimeSupplierName("Market Vendor");
                  }}
                  className={`px-3 py-1 rounded text-xs font-semibold transition-all ${
                    supplierType === "ONE_TIME"
                      ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                  }`}
                >
                  One-Time / Market Vendor
                </button>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
                {supplierType === "REGISTERED" ? (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="supplier" className="text-xs font-semibold">
                        Supplier Party <span className="text-rose-500">*</span>
                      </Label>
                      {selectedSupplier && (
                        <span className="text-[11px] text-slate-500">
                          Payable: <strong className="text-amber-800">PKR {Number(selectedSupplier.balance || 0).toLocaleString()}</strong>
                        </span>
                      )}
                    </div>
                    <select
                      id="supplier"
                      value={supplierId}
                      onChange={(e) => setSupplierId(e.target.value)}
                      className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs"
                      required={supplierType === "REGISTERED"}
                    >
                      <option value="">Select party from directory</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} {s.type ? `[${s.type}]` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold">
                        Vendor Name <span className="text-rose-500">*</span>
                      </Label>
                      <div className="flex gap-1">
                        {["Market Vendor", "Cash Supplier"].map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setOneTimeSupplierName(preset)}
                            className="text-[10px] text-emerald-700 hover:text-emerald-900 hover:underline"
                          >
                            +{preset}
                          </button>
                        ))}
                      </div>
                    </div>
                    <Input
                      value={oneTimeSupplierName}
                      onChange={(e) => setOneTimeSupplierName(e.target.value)}
                      placeholder="e.g. Market Vendor, Cash Supplier"
                      className="h-8 text-xs bg-white"
                      required={supplierType === "ONE_TIME"}
                    />
                  </div>
                )}

                <div className="space-y-1">
                  <Label htmlFor="location" className="text-xs font-semibold">
                    Receiving Location <span className="text-rose-500">*</span>
                  </Label>
                  <select
                    id="location"
                    value={locationId}
                    onChange={(e) => handleLocationChange(e.target.value)}
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs"
                    required
                  >
                    <option value="">Select location</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name} {loc.type === "WAREHOUSE" ? "(Warehouse)" : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="linked-po" className="text-xs font-semibold">
                    Link to PO <span className="text-slate-400 font-normal text-xs">(Optional)</span>
                  </Label>
                  <select
                    id="linked-po"
                    value={purchaseOrderId}
                    onChange={(e) => setPurchaseOrderId(e.target.value)}
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs"
                  >
                    <option value="">No PO link</option>
                    {pos.map((po) => (
                      <option key={po.id} value={po.id}>
                        {po.orderNo} ({po.status})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="pdate" className="text-xs font-semibold">
                    Date <span className="text-rose-500">*</span>
                  </Label>
                  <Input
                    id="pdate"
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                    className="text-xs"
                    required
                  />
                </div>
              </div>

              {/* Line items */}
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs font-bold uppercase tracking-wider text-slate-700">Stock Arrival Items</Label>
                    {showLotSelector && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
                        Lot Tracking Active
                      </span>
                    )}
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={addItem} className="h-7 text-xs">
                    <Plus className="mr-1 h-3 w-3" /> Add Product
                  </Button>
                </div>

                <div className="space-y-3">
                  {items.map((item, idx) => (
                    <div
                      key={idx}
                      className={cn(
                        "grid gap-2 items-center rounded-lg border border-slate-100 p-2.5 bg-slate-50/50",
                        showLotSelector
                          ? "sm:grid-cols-[1fr_150px_90px_110px_90px_36px]"
                          : "sm:grid-cols-[1fr_100px_120px_100px_36px]"
                      )}
                    >
                      <div>
                        <select
                          value={item.productId}
                          onChange={(e) => handleProductChange(idx, e.target.value)}
                          className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                          required
                        >
                          <option value="">Select paper item</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.productNo} - {p.name} ({p.unit})
                            </option>
                          ))}
                        </select>
                      </div>

                      {showLotSelector && (
                        <div className="flex items-center gap-1">
                          <select
                            value={item.warehouseLotId || ""}
                            onChange={(e) => handleLotChange(idx, e.target.value)}
                            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"
                          >
                            <option value="">No Lot</option>
                            {locationLots.map((lot) => (
                              <option key={lot.id} value={lot.id}>
                                {lot.lotNumber} {lot.description ? `(${lot.description})` : ""}
                              </option>
                            ))}
                          </select>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            title="Quick create new lot for this warehouse"
                            onClick={() => {
                              setQuickLotLineIndex(idx);
                              setQuickLotModalOpen(true);
                            }}
                            className="h-7 w-7 shrink-0 p-0 text-amber-800 hover:bg-amber-100"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}

                      <div>
                        <Input
                          type="number"
                          min="0.0001"
                          step="any"
                          value={item.quantity}
                          onChange={(e) => handleQuantityChange(idx, parseFloat(e.target.value) || 0)}
                          className="h-8 text-xs text-right"
                          placeholder="Qty"
                          required
                        />
                      </div>

                      <div>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.unitCost}
                          onChange={(e) => handleCostChange(idx, Number(e.target.value) || 0)}
                          className="h-8 text-xs text-right"
                          placeholder="Unit Cost"
                          required
                        />
                      </div>

                      <div className="text-right text-xs font-semibold text-slate-800">
                        PKR {(((item.quantity || 0) * (item.unitCost || 0))).toFixed(2)}
                      </div>

                      <button
                        type="button"
                        onClick={() => removeItem(idx)}
                        disabled={items.length <= 1}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:text-rose-600 disabled:opacity-30"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Subtotal & Notes */}
              <div className="border-t border-slate-100 pt-3 flex flex-col sm:flex-row justify-between items-start gap-4">
                <div className="w-full sm:max-w-xs space-y-1">
                  <Label htmlFor="pnotes" className="text-xs">
                    Supplier Notes / Bill Reference <span className="text-slate-400 font-normal text-xs">(Optional)</span>
                  </Label>
                  <Input
                    id="pnotes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. Mill consignment #442"
                    className="text-xs"
                  />
                </div>

                <div className="w-full sm:w-60 rounded-xl bg-amber-50/50 p-3 border border-amber-100 space-y-1 text-right">
                  <p className="text-xs text-amber-800">Purchase Grand Total</p>
                  <p className="text-xl font-bold text-amber-950">PKR {invoiceSubtotal.toLocaleString()}</p>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-4">
                <span className="text-[11px] text-slate-400 font-mono hidden sm:inline">
                  Preview official purchase invoice before posting
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handlePreviewPdf}
                    disabled={previewLoading || items.length === 0}
                    className="text-xs border-amber-400 text-amber-800 hover:bg-amber-50 dark:hover:bg-amber-950/40 gap-1.5"
                    title="Preview Purchase Invoice in PDF format"
                  >
                    <Eye className="h-3.5 w-3.5 text-amber-700" />
                    {previewLoading ? "Rendering..." : "Preview PDF"}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)} className="text-xs">
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting} className="bg-amber-800 text-white hover:bg-amber-700 text-xs font-semibold">
                    {submitting ? "Processing..." : "Save & Receive Stock"}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quick Create Lot Modal */}
      {quickLotModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Add Warehouse Lot</h3>
                <p className="text-[11px] text-slate-500">
                  Quick-create lot for <strong className="text-slate-700">{selectedLocation?.name || "Selected Location"}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setQuickLotModalOpen(false);
                  setQuickLotLineIndex(null);
                }}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateQuickLot} className="mt-4 space-y-3">
              <div className="space-y-1">
                <Label htmlFor="quickLotNo" className="text-xs font-medium text-slate-700">
                  Lot Number / Tag <span className="text-rose-500">*</span>
                </Label>
                <Input
                  id="quickLotNo"
                  placeholder="e.g. Lot-12, Bin-4, Reel-01"
                  value={quickLotNumber}
                  onChange={(e) => setQuickLotNumber(e.target.value)}
                  className="text-xs h-8"
                  required
                  autoFocus
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="quickLotDesc" className="text-xs font-medium text-slate-700">
                  Description / Sub-batch <span className="text-slate-400 font-normal">(Optional)</span>
                </Label>
                <Input
                  id="quickLotDesc"
                  placeholder="e.g. 80 GSM imported paper consignment"
                  value={quickLotDesc}
                  onChange={(e) => setQuickLotDesc(e.target.value)}
                  className="text-xs h-8"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setQuickLotModalOpen(false);
                    setQuickLotLineIndex(null);
                  }}
                  className="text-xs h-8"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={submittingQuickLot || !quickLotNumber.trim()}
                  className="bg-amber-800 text-white hover:bg-amber-700 text-xs h-8"
                >
                  {submittingQuickLot ? "Adding..." : "Save Lot"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Pre-Posting Live PDF Document Preview Modal */}
      {showPdfPreviewModal && pdfPreviewUrl && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 backdrop-blur-xs p-4">
          <div className="w-full max-w-5xl h-[90vh] bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-700 rounded-lg shadow-2xl flex flex-col overflow-hidden">
            <div className="bg-slate-900 text-slate-100 px-4 py-2 flex items-center justify-between border-b border-slate-800 select-none">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-amber-400" />
                <span className="font-bold text-xs">Purchase Invoice Document Preview (Pre-Posting)</span>
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
                  download={`Purchase-Invoice-Preview-${new Date().toISOString().slice(0, 10)}.pdf`}
                  className="inline-flex items-center gap-1 h-7 px-2.5 text-xs bg-amber-700 hover:bg-amber-800 text-white rounded font-medium"
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
                id="purPdfPreviewIframe"
                src={pdfPreviewUrl}
                className="w-full h-full rounded border border-slate-300 dark:border-slate-800 bg-white"
                title="Purchase Invoice Preview"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

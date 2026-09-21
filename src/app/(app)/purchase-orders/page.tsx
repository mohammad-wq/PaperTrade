"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import {
  Layers,
  Plus,
  Search,
  FileText,
  AlertCircle,
  Trash2,
  X,
  CheckCircle2,
  Send,
  Ban,
  Eye,
  Printer,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  listPurchaseOrdersAction,
  createPurchaseOrderAction,
  updatePurchaseOrderStatusAction,
  listLocationsAction,
} from "@/actions/orders";
import { listPartiesAction } from "@/actions/parties";
import { listProductsAction } from "@/actions/products";
import { PurchaseOrderStatus } from "@prisma/client";
import { format } from "date-fns";
import { useRealtimeListener } from "@/hooks/use-realtime";
import { useConfirm } from "@/components/providers/confirm-provider";

type PORow = {
  id: string;
  orderNo: string;
  date: Date;
  status: PurchaseOrderStatus;
  notes: string | null;
  financialYear?: { id: string; label: string; isActive?: boolean } | null;
  supplier: { id: string; name: string; phone: string | null };
  location: { id: string; name: string };
  items: Array<{
    id: string;
    quantity: number;
    unitCost: number;
    lineTotal: number;
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
  costPrice: number;
  unit: string;
};

type LineItem = {
  productId: string;
  quantity: number;
  unitCost: number;
};

export default function PurchaseOrdersPage() {
  const confirm = useConfirm();
  const [orders, setOrders] = useState<PORow[]>([]);
  const [suppliers, setSuppliers] = useState<PartyOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [dbLocations, setDbLocations] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
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

  // Form state
  const [supplierType, setSupplierType] = useState<"REGISTERED" | "ONE_TIME">("REGISTERED");
  const [oneTimeSupplierName, setOneTimeSupplierName] = useState("");
  const [oneTimeSupplierPhone, setOneTimeSupplierPhone] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItem[]>([{ productId: "", quantity: 1, unitCost: 0 }]);
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
              }))
            );
          }
        }
      } catch (e) {
        console.error("Failed to load draft_from_invoice in purchase orders", e);
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

      const activeDocNo = orders[0]?.orderNo
        ? orders[0].orderNo.replace(/\d+$/, (n) => String(Number(n) + 1).padStart(n.length, "0"))
        : `${new Date().getFullYear()}-001`;

      const payload = {
        type: "purchase-order",
        docNumber: activeDocNo,
        date: orderDate,
        partyName,
        partyPhone,
        locationName: selectedLoc?.name || "Shop",
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
      await confirm.alert(err.message || "Failed to preview PO PDF", { variant: "destructive" });
    } finally {
      setPreviewLoading(false);
    }
  }

  async function loadData(isBackground = false) {
    if (!isBackground) setLoading(true);
    try {
      const [poRes, partyRes, prodRes, locRes] = await Promise.all([
        listPurchaseOrdersAction(),
        listPartiesAction(),
        listProductsAction(),
        listLocationsAction(),
      ]);

      if (poRes.success && poRes.data) {
        setOrders(poRes.data as PORow[]);
      }
      if (partyRes.success && partyRes.data) {
        const suppList = partyRes.data as PartyOption[];
        setSuppliers(suppList);
      }
      if (prodRes.success && prodRes.data) {
        setProducts(prodRes.data as ProductOption[]);
      }
      if (locRes.success && locRes.data) {
        const locs = locRes.data as Array<{ id: string; name: string }>;
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

  useRealtimeListener(["purchase-orders", "purchases", "inventory"], () => {
    void loadData(true);
  });

  const locations = useMemo(() => {
    if (dbLocations.length > 0) return dbLocations;
    const map = new Map<string, string>();
    orders.forEach((o) => map.set(o.location.id, o.location.name));
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [dbLocations, orders]);

  const filteredOrders = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((order) => {
      // Financial year filter
      if (yearFilter === "CURRENT" && order.financialYear && order.financialYear.isActive === false) {
        return false;
      }
      const matchesQuery =
        !q ||
        order.orderNo.toLowerCase().includes(q) ||
        order.supplier.name.toLowerCase().includes(q) ||
        order.location.name.toLowerCase().includes(q);
      const matchesStatus = statusFilter === "ALL" || order.status === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [orders, query, statusFilter, yearFilter]);

  const orderSubtotal = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0),
    [items],
  );

  const selectedSupplier = useMemo(
    () => suppliers.find((s) => s.id === supplierId),
    [suppliers, supplierId],
  );

  function handleProductChange(index: number, pId: string) {
    const prod = products.find((p) => p.id === pId);
    const updated = [...items];
    updated[index].productId = pId;
    if (prod) {
      updated[index].unitCost = prod.costPrice || 0;
    }
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
    setItems([...items, { productId: "", quantity: 1, unitCost: 0 }]);
  }

  function removeItem(index: number) {
    if (items.length <= 1) return;
    setItems(items.filter((_, idx) => idx !== index));
  }

  async function handleStatusChange(id: string, status: PurchaseOrderStatus) {
    const actionName =
      status === PurchaseOrderStatus.FULFILLED
        ? "fulfill this purchase order and receive inventory stock"
        : `change status to ${status}`;
    const ok = await confirm({
      title: "Purchase Order Status",
      description: `Are you sure you want to ${actionName}?`,
      confirmText: status === PurchaseOrderStatus.FULFILLED ? "Fulfill & Receive Stock" : "Update Status",
      variant: status === PurchaseOrderStatus.FULFILLED ? "primary" : status === PurchaseOrderStatus.CANCELLED ? "destructive" : "default",
    });
    if (!ok) return;

    const res = await updatePurchaseOrderStatusAction({ id, status });
    if (res.success) {
      await loadData();
    } else {
      await confirm.alert(res.error || "Failed to update status", { variant: "destructive" });
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
      setFormError("Please select a destination location.");
      return;
    }
    if (items.some((i) => !i.productId || i.quantity <= 0)) {
      setFormError("All line items must have a valid product and quantity > 0.");
      return;
    }

    const ok = await confirm({
      title: "Confirm Purchase Order",
      description: "Are you sure you want to create this purchase order?",
      confirmText: "Create Order",
      variant: "primary",
    });
    if (!ok) return;

    setSubmitting(true);
    try {
      const res = await createPurchaseOrderAction({
        supplierType,
        supplierId: supplierType === "REGISTERED" ? supplierId : undefined,
        oneTimeSupplierName: supplierType === "ONE_TIME" ? (oneTimeSupplierName.trim() || "Market Vendor") : undefined,
        oneTimeSupplierPhone: supplierType === "ONE_TIME" ? (oneTimeSupplierPhone.trim() || null) : undefined,
        locationId,
        date: new Date(orderDate),
        status: PurchaseOrderStatus.DRAFT,
        notes,
        items: items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          unitCost: i.unitCost,
        })),
      });

      if (!res.success) {
        setFormError(res.error || "Failed to create purchase order.");
      } else {
        setIsDialogOpen(false);
        setSupplierId("");
        setLocationId("");
        setOrderDate(new Date().toISOString().slice(0, 10));
        setItems([{ productId: "", quantity: 1, unitCost: 0 }]);
        setNotes("");
        await loadData();
      }
    } finally {
      setSubmitting(false);
    }
  }

  function getStatusBadge(status: PurchaseOrderStatus) {
    switch (status) {
      case PurchaseOrderStatus.DRAFT:
        return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">DRAFT</span>;
      case PurchaseOrderStatus.SENT:
        return <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-800">SENT</span>;
      case PurchaseOrderStatus.FULFILLED:
        return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">FULFILLED</span>;
      case PurchaseOrderStatus.CANCELLED:
        return <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800">CANCELLED</span>;
    }
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Top Banner: Title, Counters, and Action Button */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-2.5 rounded-md shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-sky-50 dark:bg-sky-950/40 text-sky-800 dark:text-sky-400 rounded-md">
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Purchase Orders
            </h1>
            <p className="text-[11px] text-slate-500">
              Issue procurement orders to paper mills and suppliers with official dual signature blocks
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Counters */}
          <div className="hidden sm:flex items-center gap-2 text-xs font-mono">
            <span className="bg-sky-50 dark:bg-sky-950/40 text-sky-800 dark:text-sky-300 border border-sky-200 dark:border-sky-800 px-2 py-1 rounded">
              Orders: <strong>{filteredOrders.length}</strong>
            </span>
          </div>

          <Button
            onClick={() => {
              if (!locationId && locations.length > 0) setLocationId(locations[0].id);
              setIsDialogOpen(true);
            }}
            className="h-8 bg-sky-800 hover:bg-sky-900 text-white text-xs font-bold shadow-xs px-3"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Create Purchase Order <span className="ml-1.5 text-[10px] opacity-75 font-mono">[F2]</span>
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
            placeholder="Search by PO number, supplier, or location... (Press / to focus)"
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

        <div className="flex items-center gap-2 self-end sm:self-auto text-xs shrink-0">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 h-8"
          >
            <option value="ALL">All Statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="SENT">Sent</option>
            <option value="FULFILLED">Fulfilled</option>
            <option value="CANCELLED">Cancelled</option>
          </select>

          <div className="inline-flex rounded-md border border-slate-300 p-0.5 bg-slate-100">
            <button
              type="button"
              onClick={() => setYearFilter("CURRENT")}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-all ${
                yearFilter === "CURRENT"
                  ? "bg-white text-sky-900 shadow-xs"
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

      {/* PO List */}
      {loading ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500 text-sm">
            Loading purchase orders...
          </CardContent>
        </Card>
      ) : filteredOrders.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500 text-sm">
            No purchase orders found.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredOrders.map((order) => {
            const total = order.items.reduce((s, i) => s + i.lineTotal, 0);

            return (
              <Card key={order.id} className="border-slate-200/80 hover:shadow-md transition-shadow bg-white flex flex-col justify-between">
                <CardHeader className="pb-3 border-b border-slate-100">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <CardTitle className="text-base font-bold text-slate-900">{order.orderNo}</CardTitle>
                        {order.financialYear && (
                          <span className="text-[9px] px-1 py-0.2 rounded bg-slate-100 text-slate-600 font-mono">
                            {order.financialYear.label}
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-medium text-sky-900">{order.supplier.name}</p>
                    </div>
                    {getStatusBadge(order.status)}
                  </div>
                </CardHeader>

                <CardContent className="py-3 space-y-2 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>Target Location:</span>
                    <span className="font-semibold text-slate-800">{order.location.name}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Date:</span>
                    <span>{format(new Date(order.date), "dd/MM/yyyy")}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Ordered Items:</span>
                    <span>{order.items.length} product(s)</span>
                  </div>
                  <div className="flex justify-between border-t border-slate-100 pt-2 font-bold text-sm">
                    <span>Estimated Total:</span>
                    <span className="text-slate-900">PKR {total.toLocaleString()}</span>
                  </div>
                </CardContent>

                {/* Status action + PDF */}
                <div className="p-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between gap-2 rounded-b-xl">
                  <div className="flex items-center gap-1">
                    {order.status === PurchaseOrderStatus.DRAFT && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleStatusChange(order.id, PurchaseOrderStatus.SENT)}
                        className="h-7 text-[11px] text-sky-700 hover:bg-sky-50 px-2"
                      >
                        <Send className="mr-1 h-3 w-3" />
                        Mark Sent
                      </Button>
                    )}
                    {order.status !== PurchaseOrderStatus.CANCELLED && order.status !== PurchaseOrderStatus.FULFILLED && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleStatusChange(order.id, PurchaseOrderStatus.CANCELLED)}
                        className="h-7 text-[11px] text-rose-600 hover:bg-rose-50 px-2"
                      >
                        <Ban className="mr-1 h-3 w-3" />
                        Cancel
                      </Button>
                    )}
                  </div>

                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs border-slate-200 text-slate-700 hover:bg-white"
                  >
                    <a href={`/api/pdf/purchase-order/${order.id}`} target="_blank" rel="noreferrer">
                      <FileText className="mr-1 h-3.5 w-3.5 text-sky-700" />
                      PDF
                    </a>
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* New Purchase Order Modal */}
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
                <h2 className="text-lg font-bold text-slate-900">New Purchase Order</h2>
                <p className="text-xs text-slate-500">Draft order to send to paper mills or suppliers</p>
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

              <div className="grid gap-4 sm:grid-cols-3">
                {supplierType === "REGISTERED" ? (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="posupplier" className="text-xs font-semibold">
                        Supplier Party <span className="text-rose-500">*</span>
                      </Label>
                      {selectedSupplier && (
                        <span className="text-[11px] text-slate-500">
                          Payable: <strong className="text-amber-800">PKR {Number(selectedSupplier.balance || 0).toLocaleString()}</strong>
                        </span>
                      )}
                    </div>
                    <select
                      id="posupplier"
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
                  <Label htmlFor="polocation" className="text-xs font-semibold">
                    Destination Location <span className="text-rose-500">*</span>
                  </Label>
                  <select
                    id="polocation"
                    value={locationId}
                    onChange={(e) => setLocationId(e.target.value)}
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs"
                    required
                  >
                    <option value="">Select location</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="podate" className="text-xs font-semibold">
                    Order Date <span className="text-rose-500">*</span>
                  </Label>
                  <Input
                    id="podate"
                    type="date"
                    value={orderDate}
                    onChange={(e) => setOrderDate(e.target.value)}
                    className="text-xs"
                    required
                  />
                </div>
              </div>

              {/* Line items */}
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-bold uppercase tracking-wider text-slate-700">Ordered Items</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addItem} className="h-7 text-xs">
                    <Plus className="mr-1 h-3 w-3" /> Add Item
                  </Button>
                </div>

                <div className="space-y-3">
                  {items.map((item, idx) => (
                    <div
                      key={idx}
                      className="grid gap-2 sm:grid-cols-[1fr_100px_120px_100px_36px] items-center rounded-lg border border-slate-100 p-2.5 bg-slate-50/50"
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
                  <Label htmlFor="ponotes" className="text-xs">
                    Instructions / Notes <span className="text-slate-400 font-normal text-xs">(Optional)</span>
                  </Label>
                  <Input
                    id="ponotes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. Delivery required by Friday"
                    className="text-xs"
                  />
                </div>

                <div className="w-full sm:w-60 rounded-xl bg-sky-50/50 p-3 border border-sky-100 space-y-1 text-right">
                  <p className="text-xs text-sky-800">Estimated Total</p>
                  <p className="text-xl font-bold text-sky-950">PKR {orderSubtotal.toLocaleString()}</p>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-4">
                <span className="text-[11px] text-slate-400 font-mono hidden sm:inline">
                  Preview official purchase order before submitting
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handlePreviewPdf}
                    disabled={previewLoading || items.length === 0}
                    className="text-xs border-sky-400 text-sky-800 hover:bg-sky-50 dark:hover:bg-sky-950/40 gap-1.5"
                    title="Preview PO in PDF format"
                  >
                    <Eye className="h-3.5 w-3.5 text-sky-700" />
                    {previewLoading ? "Rendering..." : "Preview PDF"}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)} className="text-xs">
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting} className="bg-sky-800 text-white hover:bg-sky-700 text-xs font-semibold">
                    {submitting ? "Saving..." : "Create Purchase Order"}
                  </Button>
                </div>
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
                <FileText className="h-4 w-4 text-sky-400" />
                <span className="font-bold text-xs">Purchase Order Document Preview (Pre-Posting)</span>
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
                  download={`Purchase-Order-Preview-${new Date().toISOString().slice(0, 10)}.pdf`}
                  className="inline-flex items-center gap-1 h-7 px-2.5 text-xs bg-sky-700 hover:bg-sky-800 text-white rounded font-medium"
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
                id="poPdfPreviewIframe"
                src={pdfPreviewUrl}
                className="w-full h-full rounded border border-slate-300 dark:border-slate-800 bg-white"
                title="Purchase Order Preview"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import React, { useEffect, useState, useMemo, useRef, createRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
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
  ShoppingCart,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  listPurchaseOrdersAction,
  createPurchaseOrderAction,
  updatePurchaseOrderAction,
  deletePurchaseOrderAction,
  updatePurchaseOrderStatusAction,
} from "@/actions/orders";
import { listLocationsAction } from "@/actions/locations";
import { listPartiesAction, listInventoryAction } from "@/actions/parties";
import { listProductsAction } from "@/actions/products";
import { listWarehouseLotsAction } from "@/actions/warehouse-lots";
import { PurchaseOrderStatus } from "@prisma/client";
import { format } from "date-fns";
import { formatDateTime, getLocalDateTimeInputValue } from "@/lib/utils";
import { formatSequenceDisplay } from "@/lib/financial-year";
import { SearchCombobox } from "@/components/ui/search-combobox";
import { useRealtimeListener } from "@/hooks/use-realtime";
import { useConfirm } from "@/components/providers/confirm-provider";
import { printDocumentPdf } from "@/lib/print-pdf";
import { useSession } from "next-auth/react";
import { canPerformAction } from "@/lib/auth/permissions";

type PORow = {
  id: string;
  orderNo: string;
  sequenceNo?: number | null;
  date: Date;
  status: PurchaseOrderStatus;
  includePricing: boolean;
  notes: string | null;
  financialYear?: { id: string; label: string; isActive?: boolean } | null;
  supplier: { id: string; name: string; phone: string | null };
  location: { id: string; name: string };
  items: Array<{
    id: string;
    quantity: number;
    unitCost: number | null;
    lineTotal: number | null;
    destinationLocationId?: string | null;
    warehouseLotId?: string | null;
    destinationLocation?: { id: string; name: string } | null;
    warehouseLot?: { id: string; lotNumber: string } | null;
    product: { id: string; productNo: string; name: string; unit: string };
  }>;
};

type PartyOption = {
  id: string;
  name: string;
  type: string;
  balance?: number;
  phone?: string | null;
  address?: string | null;
  isPartner?: boolean;
  isBeneficiary?: boolean;
  partnerWarehouseId?: string | null;
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
  destinationLocationId?: string;
  warehouseLotId?: string;
};

export default function PurchaseOrdersPage() {
  const router = useRouter();
  const confirm = useConfirm();
  const { data: session } = useSession();
  const canView = !session?.user ? true : canPerformAction(session.user.role, "purchase-orders", "view", (session.user as any).permissions);
  const canCreate = !session?.user ? false : canPerformAction(session.user.role, "purchase-orders", "create", (session.user as any).permissions);
  const canUpdate = !session?.user ? false : canPerformAction(session.user.role, "purchase-orders", "update", (session.user as any).permissions);
  const canDelete = !session?.user ? false : canPerformAction(session.user.role, "purchase-orders", "delete", (session.user as any).permissions);
  const canCreatePurchaseInvoice = !session?.user ? false : canPerformAction(session.user.role, "purchases", "create", (session.user as any).permissions);

  useEffect(() => {
    if (session?.user && !canView) {
      router.replace("/dashboard");
    }
  }, [session, canView, router]);

  const [orders, setOrders] = useState<PORow[]>([]);
  const [suppliers, setSuppliers] = useState<PartyOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [dbLocations, setDbLocations] = useState<Array<{ id: string; name: string; type?: string }>>([]);
  const [warehouseLots, setWarehouseLots] = useState<Array<{ id: string; locationId: string; lotNumber: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [yearFilter, setYearFilter] = useState<"CURRENT" | "ALL">("CURRENT");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const oneTimeNameRef = useRef<HTMLInputElement>(null);
  const destLocRef = useRef<HTMLInputElement>(null);
  const orderDateRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLInputElement>(null);
  const productRefs = useRef<React.RefObject<HTMLInputElement>[]>([]);
  const locationRefs = useRef<React.RefObject<HTMLInputElement>[]>([]);
  const lotRefs = useRef<React.RefObject<HTMLInputElement>[]>([]);
  const qtyRefs = useRef<React.RefObject<HTMLInputElement>[]>([]);
  const costRefs = useRef<React.RefObject<HTMLInputElement>[]>([]);

  // Global keydown with Ctrl+Enter save support
  const handleSubmitRef = useRef<(e: React.FormEvent) => Promise<void>>(async () => {});
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.key === "F2" || e.key === "Insert") && canCreate) {
        e.preventDefault();
        setIsDialogOpen(true);
      } else if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
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
  const [supplierType, setSupplierType] = useState<"REGISTERED" | "ONE_TIME">("REGISTERED");
  const [oneTimeSupplierName, setOneTimeSupplierName] = useState("");
  const [oneTimeSupplierPhone, setOneTimeSupplierPhone] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [orderDate, setOrderDate] = useState(getLocalDateTimeInputValue());
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItem[]>([{ productId: "", quantity: 1, unitCost: 0 }]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [includePricing, setIncludePricing] = useState(true);
  const [isSourceSharedStock, setIsSourceSharedStock] = useState(false);
  const [inventory, setInventory] = useState<any[]>([]);

  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get("action") === "new") {
      setIsDialogOpen(true);
    }
    const paramSupplier = searchParams.get("supplierId") || searchParams.get("partnerId");
    if (paramSupplier) {
      setSupplierId(paramSupplier);
      setSupplierType("REGISTERED");
      if (searchParams.get("partnerId")) {
        setIsSourceSharedStock(true);
      }
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
      const totalCost = includePricing ? items.reduce((sum, i) => sum + (i.quantity || 0) * (i.unitCost || 0), 0) : null;

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
        totalAmount: includePricing ? totalCost : null,
        hidePricing: !includePricing,
        amountPaid: 0,
        notes: notes || null,
        items: items.map((item) => {
          const prod = products.find((p) => p.id === item.productId);
          return {
            name: prod ? `${prod.productNo} - ${prod.name}` : "Product",
            specs: prod?.unit || "Unit",
            quantity: item.quantity,
            unit: prod?.unit || "Unit",
            unitPrice: includePricing ? item.unitCost : null,
            lineTotal: includePricing ? (item.quantity || 0) * (item.unitCost || 0) : null,
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

      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const iframe = document.createElement("iframe");
      iframe.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none;";
      iframe.src = objectUrl;
      document.body.appendChild(iframe);
      iframe.onload = () => { setTimeout(() => { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); setTimeout(() => { URL.revokeObjectURL(objectUrl); document.body.removeChild(iframe); }, 2000); }, 300); };
    } catch (err: any) {
      await confirm.alert(err.message || "Failed to print PO preview", { variant: "destructive" });
    } finally {
      setPreviewLoading(false);
    }
  }

  async function loadData(isBackground = false) {
    if (!isBackground) setLoading(true);
    try {
      const [poRes, partyRes, prodRes, locRes, lotRes, invRes] = await Promise.all([
        listPurchaseOrdersAction(),
        listPartiesAction(),
        listProductsAction(),
        listLocationsAction(),
        listWarehouseLotsAction(undefined, false),
        listInventoryAction(),
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
        const locs = locRes.data as Array<{ id: string; name: string; type?: string }>;
        setDbLocations(locs);
        if (locs.length > 0) {
          const shop = locs.find((l) => l.name.toLowerCase() === "shop") ?? locs[0];
          setLocationId((prev) => prev || shop.id);
        }
      }
      if (lotRes.success && lotRes.data) {
        setWarehouseLots(lotRes.data as any);
      }
      if (invRes.success && invRes.data) {
        setInventory(invRes.data as any[]);
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
    const map = new Map<string, { id: string; name: string; type?: string }>();
    orders.forEach((o) => map.set(o.location.id, { id: o.location.id, name: o.location.name }));
    return Array.from(map.values());
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

  function handleItemDestinationChange(index: number, locId: string) {
    const updated = [...items];
    updated[index].destinationLocationId = locId;
    const lotMatches = warehouseLots.some(
      (l) => l.id === updated[index].warehouseLotId && l.locationId === locId,
    );
    if (!lotMatches) updated[index].warehouseLotId = "";
    setItems(updated);
  }

  function handleItemLotChange(index: number, lotId: string) {
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
    const nextIdx = items.length;
    while (productRefs.current.length <= nextIdx) productRefs.current.push(React.createRef<HTMLInputElement>());
    while (locationRefs.current.length <= nextIdx) locationRefs.current.push(React.createRef<HTMLInputElement>());
    while (lotRefs.current.length <= nextIdx) lotRefs.current.push(React.createRef<HTMLInputElement>());
    while (qtyRefs.current.length <= nextIdx) qtyRefs.current.push(React.createRef<HTMLInputElement>());
    while (costRefs.current.length <= nextIdx) costRefs.current.push(React.createRef<HTMLInputElement>());

    setItems((prev) => [
      ...prev,
      { productId: "", quantity: 1, unitCost: 0, destinationLocationId: locationId || "", warehouseLotId: "" },
    ]);
    setTimeout(() => {
      productRefs.current[nextIdx]?.current?.focus();
      productRefs.current[nextIdx]?.current?.select();
    }, 50);
  }

  function removeItem(index: number) {
    if (items.length <= 1) return;
    setItems(items.filter((_, idx) => idx !== index));
  }

  function resetPurchaseOrderForm() {
    setSupplierType("REGISTERED");
    setOneTimeSupplierName("");
    setOneTimeSupplierPhone("");
    setSupplierId("");
    setLocationId("");
    setOrderDate(getLocalDateTimeInputValue());
    setNotes("");
    setIncludePricing(true);
    setIsSourceSharedStock(false);
    setItems([{ productId: "", quantity: 1, unitCost: 0, destinationLocationId: "", warehouseLotId: "" }]);
    setFormError(null);
  }

  function openEditPurchaseOrder(order: PORow) {
    setEditingOrderId(order.id);
    setSupplierType("REGISTERED");
    setSupplierId(order.supplier.id);
    setOneTimeSupplierName("");
    setOneTimeSupplierPhone("");
    setLocationId(order.location.id);
    setOrderDate(getLocalDateTimeInputValue(order.date));
    setNotes(order.notes || "");
    setIncludePricing(order.includePricing);
    setIsSourceSharedStock(Boolean((order as any).isPartnership));
    setItems(
      order.items.map((item) => ({
        productId: item.product.id,
        quantity: item.quantity,
        unitCost: item.unitCost ?? 0,
        destinationLocationId: item.destinationLocationId || order.location.id,
        warehouseLotId: item.warehouseLotId || item.warehouseLot?.id || "",
      }))
    );
    setFormError(null);
    setIsDialogOpen(true);
  }

  function handleCreatePurchaseInvoiceFromPO(po: PORow) {
    // When converting a PO to a Purchase Invoice, set the invoice destination and header location to the Main Retail Shop (destinationLocationId), not the source Partnership Warehouse.
    const shopLoc = dbLocations.find((l) => l.name.toLowerCase().includes("shop") || l.type === "SHOP") ?? dbLocations[0];
    const destinationShopId = po.items.find((i: any) => i.destinationLocationId)?.destinationLocationId || shopLoc?.id || po.location?.id || "";

    const payload = {
      purchaseOrderId: po.id,
      supplierId: po.supplier?.id || null,
      supplierName: po.supplier?.name || "",
      locationId: destinationShopId,
      destinationLocationId: destinationShopId,
      includePricing: po.includePricing,
      isPartnership: Boolean((po as any).isPartnership || po.supplier?.isBeneficiary || po.supplier?.isPartner),
      items: po.items.map((item: any) => {
        const prod = products.find((p) => p.id === (item.product?.id || item.productId));
        // Invoice Price Fallback for Unpriced POs: Pre-populate with product's master cost price or batch intake cost
        const fallbackCost = prod?.costPrice || item.unitCost || 0;
        const resolvedCost = po.includePricing ? (item.unitCost ?? fallbackCost) : fallbackCost;

        return {
          productId: item.product?.id || item.productId || "",
          destinationLocationId: destinationShopId,
          warehouseLotId: item.warehouseLotId || item.warehouseLot?.id || undefined,
          sourceWarehouseLotId: item.warehouseLotId || item.warehouseLot?.id || undefined,
          quantity: item.quantity,
          unitCost: resolvedCost,
          unit: item.product?.unit || prod?.unit || "",
        };
      }),
    };
    try {
      sessionStorage.setItem("draft_from_po", JSON.stringify(payload));
    } catch (e) {
      console.error("Failed to store draft_from_po in sessionStorage", e);
    }
    window.open("/purchases?action=new&fromPO=1", "_blank");
  }

  async function handleDeletePurchaseOrder(order: PORow) {
    const ok = await confirm({
      title: "Delete purchase order",
      description: `Are you sure you want to delete ${order.orderNo}? This will remove the order document and related line items.`,
      confirmText: "Delete",
      variant: "destructive",
    });
    if (!ok) return;

    try {
      const res = await deletePurchaseOrderAction({ id: order.id });
      if (!res.success) {
        await confirm.alert(res.error || "Failed to delete purchase order.", { variant: "destructive" });
        return;
      }
      setEditingOrderId(null);
      setIsDialogOpen(false);
      await loadData();
    } catch (err: any) {
      await confirm.alert(err?.message || "Failed to delete purchase order.", { variant: "destructive" });
    }
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
    const effectiveLoc = locationId || items.find((i) => i.destinationLocationId)?.destinationLocationId || locations[0]?.id;
    if (!effectiveLoc) {
      setFormError("Please select a destination location.");
      return;
    }
    if (items.some((i) => !i.productId || i.quantity <= 0)) {
      setFormError("All line items must have a valid product and quantity > 0.");
      return;
    }

    const isEditing = Boolean(editingOrderId);
    const ok = await confirm({
      title: isEditing ? "Update Purchase Order" : "Confirm Purchase Order",
      description: isEditing
        ? "Are you sure you want to update this purchase order?"
        : "Are you sure you want to create this purchase order?",
      confirmText: isEditing ? "Update Order" : "Create Order",
      variant: "primary",
    });
    if (!ok) return;

    setSubmitting(true);
    try {
      const payload = {
        ...(isEditing ? { id: editingOrderId } : {}),
        supplierType,
        supplierId: supplierType === "REGISTERED" ? supplierId : undefined,
        oneTimeSupplierName: supplierType === "ONE_TIME" ? (oneTimeSupplierName.trim() || "Market Vendor") : undefined,
        oneTimeSupplierPhone: supplierType === "ONE_TIME" ? (oneTimeSupplierPhone.trim() || null) : undefined,
        locationId: locationId || effectiveLoc,
        date: new Date(orderDate),
        status: isEditing ? (orders.find((o) => o.id === editingOrderId)?.status ?? PurchaseOrderStatus.DRAFT) : PurchaseOrderStatus.DRAFT,
        includePricing,
        isPartnership: isSourceSharedStock,
        partnershipId: isSourceSharedStock && selectedSupplier?.id ? selectedSupplier.id : undefined,
        notes,
        items: items.map((i) => ({
          productId: i.productId,
          destinationLocationId: i.destinationLocationId || locationId || effectiveLoc || undefined,
          warehouseLotId: i.warehouseLotId || undefined,
          quantity: i.quantity,
          unitCost: i.unitCost,
        })),
      };

      const res = isEditing
        ? await updatePurchaseOrderAction(payload)
        : await createPurchaseOrderAction(payload);

      if (!res.success) {
        setFormError(res.error || (isEditing ? "Failed to update purchase order." : "Failed to create purchase order."));
      } else {
        setIsDialogOpen(false);
        setEditingOrderId(null);
        resetPurchaseOrderForm();
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

          {canCreate && (
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
          )}
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
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md shadow-xs overflow-hidden">
          <div className="overflow-x-auto max-h-[calc(100vh-230px)]">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700 text-[11px] font-bold uppercase tracking-wider">
                <tr>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap">PO #</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap">Date & Time</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 min-w-[160px]">Supplier</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap">Location</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 text-center whitespace-nowrap">Items</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap">Total (PKR)</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 text-center whitespace-nowrap">Status</th>
                  <th className="py-2 px-2 text-center whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredOrders.map((order) => {
                  return (
                    <tr key={order.id} className="hover:bg-sky-50/60 dark:hover:bg-slate-800/60 transition-colors even:bg-slate-50/40 dark:even:bg-slate-900/40">
                      <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-slate-900 dark:text-slate-100">#{formatSequenceDisplay((order as any).sequenceNo, order.orderNo)}</span>
                          {order.financialYear && (
                            <span className="text-[9px] px-1 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-mono" title={order.orderNo}>
                              {order.financialYear.label}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono whitespace-nowrap text-slate-600 dark:text-slate-400 text-[11px]">
                        {formatDateTime(order.date)}
                      </td>
                      <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-medium text-slate-800 dark:text-slate-200">
                        {order.supplier.name}
                      </td>
                      <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 whitespace-nowrap text-slate-600 dark:text-slate-400">
                        {(() => {
                          const itemLocs = Array.from(new Set(order.items.map((i) => i.destinationLocation?.name).filter(Boolean)));
                          if (itemLocs.length > 1) {
                            return (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-200">
                                Multi ({itemLocs.length} locs)
                              </span>
                            );
                          }
                          return itemLocs[0] || order.location?.name || "—";
                        })()}
                      </td>
                      <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 text-center font-mono whitespace-nowrap text-slate-600">
                        {order.items.length}
                      </td>
                      <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono text-right whitespace-nowrap font-bold text-slate-900 dark:text-slate-100">
                        {order.includePricing
                          ? `PKR ${order.items.reduce((s, i) => s + (i.lineTotal ?? 0), 0).toLocaleString()}`
                          : <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200">Qty Only</span>
                        }
                      </td>
                      <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 text-center whitespace-nowrap">
                        {getStatusBadge(order.status)}
                      </td>
                      <td className="py-1 px-2 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-1.5 text-xs text-slate-600 hover:text-slate-800 hover:bg-slate-100"
                            title="Print Purchase Order"
                            onClick={() => {
                              printDocumentPdf(`/api/pdf/purchase-order/${order.id}`).catch((e) =>
                                confirm.alert(e.message, { variant: "destructive" })
                              );
                            }}
                          >
                            <Printer className="h-3 w-3 mr-1" />
                            Print
                          </Button>
                          {canCreatePurchaseInvoice && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleCreatePurchaseInvoiceFromPO(order)}
                              className="h-6 px-1.5 text-xs text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                              title="Create Purchase Invoice from this PO"
                            >
                              <ShoppingCart className="h-3 w-3 mr-1" />
                              + Invoice
                            </Button>
                          )}
                          {canUpdate && order.status === PurchaseOrderStatus.DRAFT && (
                            <Button size="sm" variant="ghost" onClick={() => handleStatusChange(order.id, PurchaseOrderStatus.SENT)} className="h-6 px-1.5 text-xs text-sky-700 hover:bg-sky-50 dark:hover:bg-sky-950/40">
                              <Send className="h-3 w-3 mr-1" />
                              Sent
                            </Button>
                          )}
                          {canUpdate && (order.status === PurchaseOrderStatus.SENT || order.status === PurchaseOrderStatus.DRAFT) && (
                            <Button size="sm" variant="ghost" onClick={() => handleStatusChange(order.id, PurchaseOrderStatus.FULFILLED)} className="h-6 px-1.5 text-xs text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Receive
                            </Button>
                          )}
                          {canUpdate && (order.status === PurchaseOrderStatus.DRAFT || order.status === PurchaseOrderStatus.SENT) && (
                            <Button size="sm" variant="ghost" onClick={() => openEditPurchaseOrder(order)} className="h-6 px-1.5 text-xs text-sky-700 hover:bg-sky-50 dark:hover:bg-sky-950/40">
                              Edit
                            </Button>
                          )}
                          {canDelete && (order.status === PurchaseOrderStatus.DRAFT || order.status === PurchaseOrderStatus.SENT) && (
                            <Button size="sm" variant="ghost" onClick={() => handleDeletePurchaseOrder(order)} className="h-6 px-1.5 text-xs text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40">
                              Delete
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
                <h2 className="text-lg font-bold text-slate-900">{editingOrderId ? "Edit Purchase Order" : "New Purchase Order"}</h2>
                <p className="text-xs text-slate-500">Draft order to send to paper mills or suppliers</p>
              </div>
              <div className="flex items-center gap-3">
                {/* Include Pricing Toggle */}
                <button
                  type="button"
                  onClick={() => setIncludePricing((v) => !v)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                    includePricing
                      ? "bg-emerald-50 border-emerald-300 text-emerald-800"
                      : "bg-slate-100 border-slate-300 text-slate-600"
                  }`}
                  title="Toggle to include or exclude pricing/rates in this purchase order"
                >
                  <span className={`inline-block h-3.5 w-3.5 rounded border-2 transition-all flex-shrink-0 ${
                    includePricing ? "bg-emerald-600 border-emerald-600" : "border-slate-400 bg-white"
                  }`} />
                  {includePricing ? "Include Pricing / Rates" : "Qty Only (No Rates)"}
                </button>
                <button
                  onClick={() => setIsDialogOpen(false)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
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
                          Balance:{" "}
                          <strong
                            className={
                              Number(selectedSupplier.balance || 0) > 0
                                ? "text-emerald-700"
                                : Number(selectedSupplier.balance || 0) < 0
                                ? "text-amber-800"
                                : "text-slate-600"
                            }
                          >
                            PKR {Math.abs(Number(selectedSupplier.balance || 0)).toLocaleString()}{" "}
                            {Number(selectedSupplier.balance || 0) > 0
                              ? "(Receivable)"
                              : Number(selectedSupplier.balance || 0) < 0
                              ? "(Payable)"
                              : "(Settled)"}
                          </strong>
                        </span>
                      )}
                    </div>
                    <SearchCombobox
                      options={suppliers
                        .filter((s) => !s.name.toLowerCase().includes("market vendor") && !s.name.toLowerCase().includes("walk-in"))
                        .map((s) => ({
                          id: s.id,
                          label: s.name,
                          badge: s.type === "SUPPLIER" ? "Supplier" : "Customer",
                          badgeColor: s.type === "SUPPLIER" ? "amber" : "green",
                          sublabel: s.phone || undefined,
                        }))}
                      value={supplierId}
                      onChange={(val) => setSupplierId(val)}
                      onEnterPress={() => {
                        destLocRef.current?.focus();
                      }}
                      placeholder="Search party by name (Supplier or Customer)..."
                      className="w-full text-xs"
                      inputClassName="h-8 text-xs font-medium"
                    />

                    {/* Partner Shared Stock Toggle */}
                    {(selectedSupplier?.isBeneficiary || selectedSupplier?.isPartner) && (
                      <div className="mt-2 p-2 rounded-md bg-amber-50/80 border border-amber-200 text-xs">
                        <label className="flex items-center gap-2 cursor-pointer font-bold text-amber-950">
                          <input
                            type="checkbox"
                            checked={isSourceSharedStock}
                            onChange={(e) => {
                              setIsSourceSharedStock(e.target.checked);
                              if (e.target.checked) {
                                const shop = dbLocations.find((l) => l.name.toLowerCase() === "shop") ?? dbLocations[0];
                                if (shop) setLocationId(shop.id);
                              }
                            }}
                            className="rounded border-amber-300 text-amber-800 focus:ring-amber-600"
                          />
                          <span>Source from Shared / Partner Stock (Co-Ownership Requisition)</span>
                        </label>
                        {isSourceSharedStock && (
                          <p className="text-[10px] text-amber-800 mt-1">
                            Requisition will pull stock from partner lots into Shop. Upon conversion to PI, partner payable is isolated in their partnership equity ledger.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold">
                        Vendor Name <span className="text-slate-400 font-normal">(Optional)</span>
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
                      ref={oneTimeNameRef}
                      value={oneTimeSupplierName}
                      onChange={(e) => setOneTimeSupplierName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          destLocRef.current?.focus();
                        }
                      }}
                      placeholder="Vendor / Market Name (optional — defaults to 'Market Vendor')"
                      className="h-8 text-xs bg-white"
                    />
                    <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                      Defaults to 'Market Vendor' if blank (counter cash purchase)
                    </p>
                  </div>
                )}

                <div className="space-y-1">
                  <Label htmlFor="polocation" className="text-xs font-semibold">
                    Default Destination Location <span className="text-slate-400 font-normal">(Optional / Multi-Location)</span>
                  </Label>
                  <SearchCombobox
                    options={locations.map((loc) => ({
                      id: loc.id,
                      label: loc.name,
                    }))}
                    value={locationId}
                    onChange={(val) => setLocationId(val)}
                    inputRef={destLocRef}
                    onEnterPress={() => {
                      orderDateRef.current?.focus();
                    }}
                    placeholder="Select default location (or specify per item below)"
                    className="w-full text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="podate" className="text-xs font-semibold">
                    Order Date & Time <span className="text-rose-500">*</span>
                  </Label>
                  <Input
                    ref={orderDateRef}
                    id="podate"
                    type="datetime-local"
                    value={orderDate}
                    onChange={(e) => setOrderDate(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        productRefs.current[0]?.current?.focus();
                        productRefs.current[0]?.current?.select();
                      }
                    }}
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
                  {items.map((item, idx) => {
                    while (productRefs.current.length <= idx) productRefs.current.push(React.createRef<HTMLInputElement>());
                    while (locationRefs.current.length <= idx) locationRefs.current.push(React.createRef<HTMLInputElement>());
                    while (lotRefs.current.length <= idx) lotRefs.current.push(React.createRef<HTMLInputElement>());
                    while (qtyRefs.current.length <= idx) qtyRefs.current.push(React.createRef<HTMLInputElement>());
                    while (costRefs.current.length <= idx) costRefs.current.push(React.createRef<HTMLInputElement>());

                    const lineDestId = item.destinationLocationId || locationId;
                    const lineLots = warehouseLots.filter((lot) => lot.locationId === lineDestId);

                    return (
                      <div
                        key={idx}
                        className={`grid gap-2 items-center rounded-lg border border-slate-100 p-2.5 bg-slate-50/50 ${
                          includePricing
                            ? "sm:grid-cols-[1.2fr_130px_110px_80px_90px_85px_32px]"
                            : "sm:grid-cols-[1.2fr_130px_110px_80px_32px]"
                        }`}
                      >
                        {/* Product */}
                        <div>
                          <SearchCombobox
                            options={products.map((p) => {
                              let availText = "";
                              if (item.warehouseLotId) {
                                const lotInv = inventory.find((inv) => inv.productId === p.id && inv.lotId === item.warehouseLotId);
                                const count = lotInv ? lotInv.available : 0;
                                availText = ` (Lot Avail: ${count} ${p.unit})`;
                              } else if (isSourceSharedStock) {
                                const partnerInv = inventory.filter(
                                  (inv) => inv.productId === p.id && (inv.stockCategory === "BENEFICIARY" || inv.beneficiaryId === supplierId)
                                );
                                const count = partnerInv.reduce((sum, inv) => sum + (inv.available || 0), 0);
                                availText = ` (Shared Stock: ${count} ${p.unit})`;
                              } else if (inventory.length > 0) {
                                const count = inventory.filter((inv) => inv.productId === p.id).reduce((sum, inv) => sum + (inv.available || 0), 0);
                                availText = ` (Avail: ${count} ${p.unit})`;
                              }
                              return {
                                id: p.id,
                                label: `${p.productNo} - ${p.name}${availText}`,
                                sublabel: p.unit,
                              };
                            })}
                            value={item.productId}
                            onChange={(val) => handleProductChange(idx, val)}
                            inputRef={productRefs.current[idx]}
                            onEnterPress={() => {
                              locationRefs.current[idx]?.current?.focus();
                              locationRefs.current[idx]?.current?.select();
                            }}
                            placeholder="Select paper item..."
                            className="w-full text-xs"
                          />
                        </div>

                        {/* Destination Location */}
                        <div>
                          <SearchCombobox
                            options={locations.map((loc) => ({
                              id: loc.id,
                              label: loc.name,
                            }))}
                            value={item.destinationLocationId || locationId || ""}
                            onChange={(val) => handleItemDestinationChange(idx, val)}
                            inputRef={locationRefs.current[idx]}
                            onEnterPress={() => {
                              if (lineLots.length > 0) {
                                lotRefs.current[idx]?.current?.focus();
                                lotRefs.current[idx]?.current?.select();
                              } else {
                                qtyRefs.current[idx]?.current?.focus();
                                qtyRefs.current[idx]?.current?.select();
                              }
                            }}
                            placeholder="Destination"
                            className="w-full text-xs"
                          />
                        </div>

                        {/* Lot (Optional) */}
                        <div>
                          <SearchCombobox
                            options={[
                              { id: "", label: "No Lot" },
                              ...lineLots.map((lot) => {
                                const invRow = item.productId
                                  ? inventory.find((inv) => inv.productId === item.productId && inv.lotId === lot.id)
                                  : null;
                                const count = invRow ? invRow.available : (lot.currentStock ?? 0);
                                return {
                                  id: lot.id,
                                  label: `#${lot.lotNumber} (${count} avail)`,
                                };
                              }),
                            ]}
                            value={item.warehouseLotId || ""}
                            onChange={(val) => handleItemLotChange(idx, val)}
                            inputRef={lotRefs.current[idx]}
                            onEnterPress={() => {
                              qtyRefs.current[idx]?.current?.focus();
                              qtyRefs.current[idx]?.current?.select();
                            }}
                            placeholder="Lot (Opt)"
                            className="w-full text-xs font-mono"
                          />
                        </div>

                        {/* Quantity */}
                        <div>
                          <Input
                            ref={qtyRefs.current[idx]}
                            type="number"
                            min="0.0001"
                            step="any"
                            value={item.quantity}
                            onChange={(e) => handleQuantityChange(idx, parseFloat(e.target.value) || 0)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                if (includePricing) {
                                  costRefs.current[idx]?.current?.focus();
                                  costRefs.current[idx]?.current?.select();
                                } else {
                                  if (idx === items.length - 1) {
                                    addItem();
                                  } else {
                                    productRefs.current[idx + 1]?.current?.focus();
                                    productRefs.current[idx + 1]?.current?.select();
                                  }
                                }
                              }
                            }}
                            className="h-8 text-xs text-right font-mono"
                            placeholder="Qty"
                            required
                          />
                        </div>

                        {/* Unit Cost */}
                        {includePricing && (
                        <div>
                          <Input
                            ref={costRefs.current[idx]}
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.unitCost}
                            onChange={(e) => handleCostChange(idx, Number(e.target.value) || 0)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                if (idx === items.length - 1) {
                                  addItem();
                                } else {
                                  productRefs.current[idx + 1]?.current?.focus();
                                  productRefs.current[idx + 1]?.current?.select();
                                }
                              }
                            }}
                            className="h-8 text-xs text-right font-mono"
                            placeholder="Unit Cost"
                          />
                        </div>
                        )}

                        {includePricing && (
                        <div className="text-right text-xs font-semibold text-slate-800">
                          PKR {(((item.quantity || 0) * (item.unitCost || 0))).toFixed(2)}
                        </div>
                        )}

                        <button
                          type="button"
                          onClick={() => removeItem(idx)}
                          disabled={items.length <= 1}
                          className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:text-rose-600 disabled:opacity-30"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Subtotal & Notes */}
              <div className="border-t border-slate-100 pt-3 flex flex-col sm:flex-row justify-between items-start gap-4">
                <div className="w-full sm:max-w-xs space-y-1">
                  <Label htmlFor="ponotes" className="text-xs">
                    Instructions / Notes <span className="text-slate-400 font-normal text-xs">(Optional)</span>
                  </Label>
                  <Input
                    ref={notesRef}
                    id="ponotes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const fakeEv = { preventDefault: () => {} } as React.FormEvent;
                        void handleSubmit(fakeEv);
                      }
                    }}
                    placeholder="e.g. Delivery required by Friday (press Enter to save)"
                    className="text-xs"
                  />
                </div>

                {includePricing && (
                <div className="w-full sm:w-60 rounded-xl bg-sky-50/50 p-3 border border-sky-100 space-y-1 text-right">
                  <p className="text-xs text-sky-800">Estimated Total</p>
                  <p className="text-xl font-bold text-sky-950">PKR {orderSubtotal.toLocaleString()}</p>
                </div>
                )}
                {!includePricing && (
                <div className="w-full sm:w-60 rounded-xl bg-slate-50 p-3 border border-slate-200 space-y-1 text-right">
                  <p className="text-xs text-slate-500">Quantity-Only Order</p>
                  <p className="text-sm font-semibold text-slate-700">{items.reduce((s, i) => s + i.quantity, 0).toFixed(0)} units ordered</p>
                  <p className="text-[10px] text-slate-400">No pricing printed on PO</p>
                </div>
                )}
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
                    {submitting ? "Saving..." : editingOrderId ? "Update Purchase Order" : "Create Purchase Order"}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PDF modal removed — using browser print dialog */}
    </div>
  );
}

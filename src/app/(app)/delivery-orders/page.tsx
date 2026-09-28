"use client";

import React, { useEffect, useState, useMemo, useRef, createRef } from "react";
import { useSearchParams } from "next/navigation";
import {
  Truck,
  Plus,
  Search,
  FileText,
  Share2,
  AlertCircle,
  Trash2,
  X,
  Send,
  CheckCircle,
  Clock,
  Eye,
  Printer,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  listDeliveryOrdersAction,
  createDeliveryOrderAction,
  updateDeliveryOrderAction,
  deleteDeliveryOrderAction,
  updateDeliveryOrderStatusAction,
} from "@/actions/orders";
import { listLocationsAction } from "@/actions/locations";
import { listPartiesAction } from "@/actions/parties";
import { listProductsAction } from "@/actions/products";
import { listWarehouseLotsAction, createWarehouseLotAction } from "@/actions/warehouse-lots";
import { DeliveryOrderStatus, Unit } from "@prisma/client";
import { format } from "date-fns";
import { cn, formatDateTime } from "@/lib/utils";
import { formatSequenceDisplay } from "@/lib/financial-year";
import { SearchCombobox } from "@/components/ui/search-combobox";
import { useRealtimeListener } from "@/hooks/use-realtime";
import { useConfirm } from "@/components/providers/confirm-provider";
import { printDocumentPdf } from "@/lib/print-pdf";

type DORow = {
  id: string;
  doNo: string;
  sequenceNo?: number | null;
  date: Date;
  status: DeliveryOrderStatus;
  vehicleNo: string | null;
  driverName: string | null;
  deliveredTo: string | null;
  recipientName: string | null;
  notes: string | null;
  customer: { id: string; name: string; phone: string | null } | null;
  location: { id: string; name: string };
  destinationLocation?: { id: string; name: string } | null;
  linkedSaleInvoice?: { id: string; invoiceNo: string } | null;
  financialYear?: { id: string; label: string; isActive?: boolean } | null;
  items: Array<{
    id: string;
    quantity: number;
    warehouseLot?: { id: string; lotNumber: string } | null;
    product: { id: string; productNo: string; name: string };
  }>;
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

type PartyOption = {
  id: string;
  name: string;
  type: string;
  phone?: string | null;
  address?: string | null;
};

type ProductOption = {
  id: string;
  productNo: string;
  name: string;
  unit: string;
};

type LineItem = {
  productId: string;
  warehouseLotId?: string;
  quantity: number;
  unit: Unit;
};

export default function DeliveryOrdersPage() {
  const confirm = useConfirm();
  const [orders, setOrders] = useState<DORow[]>([]);
  const [customers, setCustomers] = useState<PartyOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [dbLocations, setDbLocations] = useState<LocationOption[]>([]);
  const [warehouseLots, setWarehouseLots] = useState<WarehouseLotOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [yearFilter, setYearFilter] = useState<"CURRENT" | "ALL">("CURRENT");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Form input refs for sequential Enter-key navigation
  const customerRef = useRef<HTMLInputElement>(null);
  const recipientRef = useRef<HTMLInputElement>(null);
  const sourceLocationRef = useRef<HTMLInputElement>(null);
  const destLocationRef = useRef<HTMLInputElement>(null);
  const orderDateRef = useRef<HTMLInputElement>(null);
  const vehicleNoRef = useRef<HTMLInputElement>(null);
  const driverNameRef = useRef<HTMLInputElement>(null);
  const deliveredToRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLInputElement>(null);

  const productRefs = useRef<React.RefObject<HTMLInputElement>[]>([]);
  const lotRefs = useRef<React.RefObject<HTMLInputElement>[]>([]);
  const qtyRefs = useRef<React.RefObject<HTMLInputElement>[]>([]);
  const unitRefs = useRef<React.RefObject<HTMLSelectElement>[]>([]);

  // Ref to hold handleSubmit for key listener
  const handleSubmitRef = useRef<(e: React.FormEvent) => Promise<void>>(() => Promise.resolve());

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "F2" || e.key === "Insert") {
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

  // Quick lot creation modal state
  const [quickLotModalOpen, setQuickLotModalOpen] = useState(false);
  const [quickLotLineIndex, setQuickLotLineIndex] = useState<number | null>(null);
  const [quickLotNumber, setQuickLotNumber] = useState("");
  const [quickLotDesc, setQuickLotDesc] = useState("");
  const [submittingQuickLot, setSubmittingQuickLot] = useState(false);

  // Form state
  const [orderType, setOrderType] = useState<"CUSTOMER" | "INTERNAL_TRANSFER">("CUSTOMER");
  const [customerId, setCustomerId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [destinationLocationId, setDestinationLocationId] = useState("");
  const [orderDate, setOrderDate] = useState(() => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  });
  const [vehicleNo, setVehicleNo] = useState("");
  const [driverName, setDriverName] = useState("");
  const [deliveredTo, setDeliveredTo] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItem[]>([
    { productId: "", warehouseLotId: "", quantity: 1, unit: Unit.PACKET },
  ]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [saleInvoiceId, setSaleInvoiceId] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  function resetDeliveryOrderForm() {
    setOrderType("CUSTOMER");
    setCustomerId("");
    setLocationId("");
    setDestinationLocationId("");
    setSaleInvoiceId(null);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    setOrderDate(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`);
    setVehicleNo("");
    setDriverName("");
    setDeliveredTo("");
    setRecipientName("");
    setNotes("");
    setItems([{ productId: "", warehouseLotId: "", quantity: 1, unit: Unit.PACKET }]);
    setFormError(null);
  }

  function openEditDeliveryOrder(order: DORow) {
    setEditingOrderId(order.id);
    setOrderType(order.customer ? "CUSTOMER" : "INTERNAL_TRANSFER");
    setCustomerId(order.customer?.id || "");
    setLocationId(order.location.id);
    setDestinationLocationId(order.destinationLocation?.id || "");
    setSaleInvoiceId(order.linkedSaleInvoice?.id || null);
    setOrderDate(new Date(order.date).toISOString().slice(0, 16));
    setVehicleNo(order.vehicleNo || "");
    setDriverName(order.driverName || "");
    setDeliveredTo(order.deliveredTo || "");
    setRecipientName(order.recipientName || "");
    setNotes(order.notes || "");
    setItems(
      order.items.map((item) => ({
        productId: item.product.id,
        warehouseLotId: item.warehouseLot?.id || "",
        quantity: item.quantity,
        unit: Unit.PACKET,
      }))
    );
    setFormError(null);
    setIsDialogOpen(true);
  }

  async function handleDeleteDeliveryOrder(order: DORow) {
    const ok = await confirm({
      title: "Delete delivery order",
      description: `Are you sure you want to delete ${order.doNo}? This will remove the dispatch and linked items.`,
      confirmText: "Delete",
      variant: "destructive",
    });
    if (!ok) return;

    try {
      const res = await deleteDeliveryOrderAction({ id: order.id });
      if (!res.success) {
        await confirm.alert(res.error || "Failed to delete delivery order.", { variant: "destructive" });
        return;
      }
      setEditingOrderId(null);
      setIsDialogOpen(false);
      await loadData();
    } catch (err: any) {
      await confirm.alert(err?.message || "Failed to delete delivery order.", { variant: "destructive" });
    }
  }

  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get("action") === "new") {
      setIsDialogOpen(true);
    }
    const invId = searchParams.get("saleInvoiceId");
    if (invId) {
      setSaleInvoiceId(invId);
    }
    const custId = searchParams.get("customerId");
    if (custId) {
      setCustomerId(custId);
    }

    if (searchParams.get("fromInvoice") === "1") {
      try {
        const stored = sessionStorage.getItem("draft_from_invoice");
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed.saleInvoiceId) setSaleInvoiceId(parsed.saleInvoiceId);
          if (parsed.customerId) setCustomerId(parsed.customerId);
          if (parsed.locationId) setLocationId(parsed.locationId);
          if (parsed.recipientName || parsed.customerName) {
            setRecipientName(parsed.recipientName || parsed.customerName || "");
          }
          if (Array.isArray(parsed.items) && parsed.items.length > 0) {
            setItems(
              parsed.items.map((item: any) => ({
                productId: item.productId || "",
                quantity: Number(item.quantity) || 1,
                unit: item.unit && Object.values(Unit).includes(item.unit) ? item.unit : Unit.PACKET,
                warehouseLotId: item.warehouseLotId || "",
              }))
            );
          }
        }
      } catch (e) {
        console.error("Failed to load draft_from_invoice in delivery orders", e);
      }
    }
  }, [searchParams]);

  // Pre-posting PDF preview
  async function handlePreviewPdf() {
    if (items.length === 0 || items.some((i) => !i.productId || i.quantity <= 0)) {
      setFormError("Please select valid items with quantities > 0 before previewing.");
      return;
    }
    if (!locationId) {
      setFormError("Please select a warehouse dispatch location.");
      return;
    }
    const missingLot = items.find((i) => !i.warehouseLotId || !i.warehouseLotId.trim());
    if (missingLot) {
      const prod = products.find((p) => p.id === missingLot.productId);
      setFormError(
        `A warehouse lot must be specified for "${prod?.productNo ?? ""} ${prod?.name ?? "each item"}". All warehouse consignments require lot tracking.`
      );
      return;
    }
    setPreviewLoading(true);
    try {
      const selectedCustomer = customers.find((c) => c.id === customerId);
      const selectedLoc = dbLocations.find((l) => l.id === locationId);
      const activeDocNo = orders[0]?.doNo
        ? orders[0].doNo.replace(/\d+$/, (n: string) => String(Number(n) + 1).padStart(n.length, "0"))
        : `${new Date().getFullYear()}-001`;

      const payload = {
        type: "delivery-order",
        docNumber: activeDocNo,
        date: orderDate,
        partyName: orderType === "CUSTOMER" ? selectedCustomer?.name || "Customer" : "Internal Stock Transfer",
        partyPhone: selectedCustomer ? (selectedCustomer as any).phone || null : null,
        recipientName: recipientName || null,
        locationName: selectedLoc?.name || "Warehouse",
        referenceNo: vehicleNo ? `Vehicle: ${vehicleNo}` : null,
        notes: notes || null,
        items: items.map((item) => {
          const prod = products.find((p) => p.id === item.productId);
          const foundLot = warehouseLots.find((l) => l.id === item.warehouseLotId);
          return {
            name: prod ? `${prod.productNo} - ${prod.name}` : "Product",
            specs: item.unit || "Standard",
            lot: foundLot ? foundLot.lotNumber : null,
            quantity: item.quantity,
            unit: item.unit,
            unitPrice: 0,
            lineTotal: 0,
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
      await confirm.alert(err.message || "Failed to print DO preview", { variant: "destructive" });
    } finally {
      setPreviewLoading(false);
    }
  }

  async function loadData(isBackground = false) {
    if (!isBackground) setLoading(true);
    try {
      const [doRes, partyRes, prodRes, locRes, lotRes] = await Promise.all([
        listDeliveryOrdersAction(),
        listPartiesAction(),
        listProductsAction(),
        listLocationsAction(),
        listWarehouseLotsAction(undefined, false),
      ]);

      if (doRes.success && doRes.data) {
        setOrders(doRes.data as DORow[]);
      }
      if (partyRes.success && partyRes.data) {
        const custList = partyRes.data as PartyOption[];
        setCustomers(custList);
      }
      if (prodRes.success && prodRes.data) {
        setProducts(prodRes.data as ProductOption[]);
      }
      if (locRes.success && locRes.data) {
        setDbLocations(locRes.data as LocationOption[]);
      }
      if (lotRes.success && lotRes.data) {
        setWarehouseLots(lotRes.data as WarehouseLotOption[]);
      }
    } finally {
      if (!isBackground) setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  useRealtimeListener(["delivery-orders", "sales", "inventory", "warehouse-lots"], () => {
    void loadData(true);
  });

  const locations = useMemo(() => {
    if (dbLocations.length > 0) return dbLocations;
    const map = new Map<string, LocationOption>();
    orders.forEach((o) =>
      map.set(o.location.id, { id: o.location.id, name: o.location.name, type: "WAREHOUSE" }),
    );
    return Array.from(map.values());
  }, [dbLocations, orders]);

  const warehouseLocations = useMemo(() => {
    const list = locations.filter((l) => l.type === "WAREHOUSE");
    if (list.length > 0) return list;
    return locations.filter((l) => !l.name.toLowerCase().includes("shop"));
  }, [locations]);

  const selectedSourceLocation = useMemo(
    () => locations.find((l) => l.id === locationId),
    [locations, locationId],
  );

  const sourceLocationLots = useMemo(
    () => warehouseLots.filter((lot) => lot.locationId === locationId),
    [warehouseLots, locationId],
  );

  const showLotSelector = true; // Consignments on delivery orders require lot tracking

  const filteredOrders = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((order) => {
      // Financial year filter
      if (yearFilter === "CURRENT" && order.financialYear && order.financialYear.isActive === false) {
        return false;
      }
      const matchesQuery =
        !q ||
        order.doNo.toLowerCase().includes(q) ||
        (order.customer?.name && order.customer.name.toLowerCase().includes(q)) ||
        (order.destinationLocation?.name && order.destinationLocation.name.toLowerCase().includes(q)) ||
        (order.driverName && order.driverName.toLowerCase().includes(q)) ||
        (order.vehicleNo && order.vehicleNo.toLowerCase().includes(q));
      const matchesStatus = statusFilter === "ALL" || order.status === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [orders, query, statusFilter, yearFilter]);

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
    const prod = products.find((p) => p.id === pId);
    const updated = [...items];
    updated[index].productId = pId;
    if (prod && Object.values(Unit).includes(prod.unit as Unit)) {
      updated[index].unit = prod.unit as Unit;
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

  function handleUnitChange(index: number, unit: Unit) {
    const updated = [...items];
    updated[index].unit = unit;
    setItems(updated);
  }

  function addItem() {
    setItems([...items, { productId: "", warehouseLotId: "", quantity: 1, unit: Unit.PACKET }]);
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

  async function handleStatusChange(id: string, status: DeliveryOrderStatus) {
    const actionLabel = status === DeliveryOrderStatus.DISPATCHED ? "dispatch goods and update stock" : "update status";
    const ok = await confirm({
      title: "Delivery Order Status",
      description: `Are you sure you want to ${actionLabel} for this Delivery Order?`,
      confirmText: status === DeliveryOrderStatus.DISPATCHED ? "Dispatch Goods" : "Update Status",
      variant: status === DeliveryOrderStatus.DISPATCHED ? "primary" : "default",
    });
    if (!ok) {
      return;
    }

    try {
      const res = await updateDeliveryOrderStatusAction({ id, status });
      if (!res.success) {
        await confirm.alert(res.error || "Failed to update status", { variant: "destructive" });
      } else {
        await loadData();
      }
    } catch (err: any) {
      await confirm.alert(err.message || "An error occurred", { variant: "destructive" });
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (orderType === "CUSTOMER" && !customerId && !recipientName.trim()) {
      setFormError("Please select a customer or provide a recipient name.");
      return;
    }
    if (!locationId) {
      setFormError("Please select a source/dispatch location.");
      return;
    }
    if (orderType === "INTERNAL_TRANSFER") {
      if (!destinationLocationId) {
        setFormError("Please select a destination location.");
        return;
      }
      if (destinationLocationId === locationId) {
        setFormError("Destination location must be different from source location.");
        return;
      }
    }
    if (!locationId) {
      setFormError("Please select a warehouse dispatch location.");
      return;
    }
    const missingLot = items.find((i) => !i.warehouseLotId || !i.warehouseLotId.trim());
    if (missingLot) {
      const prod = products.find((p) => p.id === missingLot.productId);
      setFormError(
        `A warehouse lot must be specified for "${prod?.productNo ?? ""} ${prod?.name ?? "each item"}". All warehouse consignments require lot tracking.`
      );
      return;
    }

    const isEditing = Boolean(editingOrderId);
    const confirmMsg = isEditing
      ? "Are you sure you want to update this delivery order?"
      : orderType === "INTERNAL_TRANSFER"
        ? "Are you sure you want to create this internal stock transfer between locations?"
        : "Are you sure you want to create this delivery order?";
    const ok = await confirm({
      title: isEditing
        ? "Update Delivery Order"
        : orderType === "INTERNAL_TRANSFER"
          ? "Confirm Stock Transfer"
          : "Confirm Delivery Order",
      description: confirmMsg,
      confirmText: isEditing ? "Update Order" : "Create Order",
      variant: "primary",
    });
    if (!ok) return;

    setSubmitting(true);
    try {
      const payload = {
        ...(isEditing ? { id: editingOrderId } : {}),
        orderType,
        customerId: orderType === "CUSTOMER" ? customerId : null,
        locationId,
        destinationLocationId: orderType === "INTERNAL_TRANSFER" ? destinationLocationId : null,
        saleInvoiceId: saleInvoiceId || undefined,
        date: new Date(orderDate),
        status: isEditing ? (orders.find((o) => o.id === editingOrderId)?.status ?? DeliveryOrderStatus.DRAFT) : DeliveryOrderStatus.DISPATCHED,
        vehicleNo: vehicleNo || undefined,
        driverName: driverName || undefined,
        deliveredTo: orderType === "INTERNAL_TRANSFER"
          ? (locations.find(l => l.id === destinationLocationId)?.name || deliveredTo)
          : deliveredTo,
        recipientName: recipientName.trim() || undefined,
        notes: notes || undefined,
        items: items.map((i) => ({
          productId: i.productId,
          warehouseLotId: i.warehouseLotId || undefined,
          quantity: i.quantity,
          unit: i.unit,
        })),
      };

      const res = isEditing
        ? await updateDeliveryOrderAction(payload)
        : await createDeliveryOrderAction(payload);

      if (!res.success) {
        setFormError(res.error || (isEditing ? "Failed to update delivery order." : "Failed to create delivery order."));
      } else {
        setIsDialogOpen(false);
        setEditingOrderId(null);
        resetDeliveryOrderForm();
        await loadData();
      }
    } finally {
      setSubmitting(false);
    }
  }

  handleSubmitRef.current = handleSubmit;

  // Initialize and synchronize ref arrays with items
  items.forEach((_, idx) => {
    if (!productRefs.current[idx]) productRefs.current[idx] = { current: null };
    if (!lotRefs.current[idx]) lotRefs.current[idx] = { current: null };
    if (!qtyRefs.current[idx]) qtyRefs.current[idx] = { current: null };
    if (!unitRefs.current[idx]) unitRefs.current[idx] = { current: null };
  });

  // Autofocus first input when dialog opens
  useEffect(() => {
    if (isDialogOpen) {
      setTimeout(() => {
        if (orderType === "CUSTOMER") {
          customerRef.current?.focus();
        } else {
          sourceLocationRef.current?.focus();
        }
      }, 80);
    }
  }, [isDialogOpen, orderType]);

  async function handleWhatsAppShare(doId: string) {
    try {
      const res = await fetch(`/api/share/whatsapp?type=delivery-order&id=${doId}`);
      const json = await res.json();
      if (json.success && json.url) {
        window.open(json.url, "_blank");
      } else {
        await confirm.alert("Failed to create WhatsApp share link.", { variant: "destructive" });
      }
    } catch {
      await confirm.alert("Error generating WhatsApp share link.", { variant: "destructive" });
    }
  }

  function getStatusBadge(status: DeliveryOrderStatus) {
    switch (status) {
      case DeliveryOrderStatus.DRAFT:
        return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">DRAFT</span>;
      case DeliveryOrderStatus.DISPATCHED:
        return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">DISPATCHED</span>;
      case DeliveryOrderStatus.DELIVERED:
        return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">DELIVERED</span>;
      case DeliveryOrderStatus.CANCELLED:
        return <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800">CANCELLED</span>;
    }
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Top Banner: Title, Counters, and Action Button */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-2.5 rounded-md shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-400 rounded-md">
            <Truck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Delivery Orders
            </h1>
            <p className="text-[11px] text-slate-500">
              Issue gate passes and delivery slips for paper transport, with vehicle and driver assignment
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Counters */}
          <div className="hidden sm:flex items-center gap-2 text-xs font-mono">
            <span className="bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 px-2 py-1 rounded">
              Orders: <strong>{filteredOrders.length}</strong>
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
            Create Delivery Order <span className="ml-1.5 text-[10px] opacity-75 font-mono">[F2]</span>
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
            placeholder="Search by DO number, customer, vehicle, or driver... (Press / to focus)"
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
            <option value="DISPATCHED">Dispatched</option>
            <option value="DELIVERED">Delivered</option>
            <option value="CANCELLED">Cancelled</option>
          </select>

          <div className="inline-flex rounded-md border border-slate-300 p-0.5 bg-slate-100">
            <button
              type="button"
              onClick={() => setYearFilter("CURRENT")}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-all ${
                yearFilter === "CURRENT"
                  ? "bg-white text-amber-950 shadow-xs"
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

      {/* DO Cards */}
      {loading ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500 text-sm">
            Loading delivery orders...
          </CardContent>
        </Card>
      ) : filteredOrders.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500 text-sm">
            No delivery orders found.
          </CardContent>
        </Card>
      ) : (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md shadow-xs overflow-hidden">
          <div className="overflow-x-auto max-h-[calc(100vh-230px)]">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700 text-[11px] font-bold uppercase tracking-wider">
                <tr>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap">DO #</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap">Date & Time</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 min-w-[170px]">Customer / Recipient</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap">From</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap">To</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap">Vehicle</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 text-center whitespace-nowrap">Items</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 text-center whitespace-nowrap">Status</th>
                  <th className="py-2 px-2 text-center whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredOrders.map((order) => (
                  <tr key={order.id} className="hover:bg-amber-50/60 dark:hover:bg-slate-800/60 transition-colors even:bg-slate-50/40 dark:even:bg-slate-900/40">
                    <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-slate-900 dark:text-slate-100">#{formatSequenceDisplay(order.sequenceNo, order.doNo)}</span>
                        {order.financialYear && (
                          <span className="text-[9px] px-1 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-mono" title={order.doNo}>
                            {order.financialYear.label}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono whitespace-nowrap text-slate-600 dark:text-slate-400 text-[11px]">
                      {formatDateTime(order.date)}
                    </td>
                    <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-medium text-slate-800 dark:text-slate-200">
                      {order.customer ? (
                        <div className="flex flex-col">
                          <span>{order.customer.name}</span>
                          {order.customer.phone && <span className="text-[10px] text-slate-400 font-mono">{order.customer.phone}</span>}
                        </div>
                      ) : (
                        <span className="inline-flex items-center rounded-md bg-sky-50 dark:bg-sky-950/40 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800 dark:text-sky-300 border border-sky-200 dark:border-sky-800">Internal transfer</span>
                      )}
                    </td>
                    <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 whitespace-nowrap text-slate-600 dark:text-slate-400">
                      {order.location.name}
                    </td>
                    <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 whitespace-nowrap text-sky-800 dark:text-sky-300">
                      {order.destinationLocation?.name ?? order.recipientName ?? "—"}
                    </td>
                    <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono whitespace-nowrap text-slate-600 dark:text-slate-400">
                      {order.vehicleNo || "—"}
                    </td>
                    <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 text-center font-mono whitespace-nowrap text-slate-600">
                      {order.items.length}
                    </td>
                    <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 text-center whitespace-nowrap">
                      {getStatusBadge(order.status)}
                    </td>
                    <td className="py-1 px-2 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1">
                        {order.status === DeliveryOrderStatus.DRAFT && (
                          <Button size="sm" variant="ghost" onClick={() => handleStatusChange(order.id, DeliveryOrderStatus.DISPATCHED)} className="h-6 px-1.5 text-xs text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/40">
                            <Send className="h-3 w-3 mr-1" />
                            Dispatch
                          </Button>
                        )}
                        {order.status === DeliveryOrderStatus.DISPATCHED && (
                          <Button size="sm" variant="ghost" onClick={() => handleStatusChange(order.id, DeliveryOrderStatus.DELIVERED)} className="h-6 px-1.5 text-xs text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Deliver
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-xs text-slate-600 hover:text-slate-800 hover:bg-slate-100"
                          title="Print Delivery Order"
                          onClick={() => {
                            printDocumentPdf(`/api/pdf/delivery-order/${order.id}`).catch((e) =>
                              confirm.alert(e.message, { variant: "destructive" })
                            );
                          }}
                        >
                          <Printer className="h-3 w-3 mr-1" />
                          Print
                        </Button>
                        {(order.status === DeliveryOrderStatus.DRAFT || order.status === DeliveryOrderStatus.DISPATCHED) && (
                          <Button size="sm" variant="ghost" onClick={() => openEditDeliveryOrder(order)} className="h-6 px-1.5 text-xs text-sky-700 hover:bg-sky-50 dark:hover:bg-sky-950/40">
                            Edit
                          </Button>
                        )}
                        {(order.status === DeliveryOrderStatus.DRAFT || order.status === DeliveryOrderStatus.DISPATCHED) && (
                          <Button size="sm" variant="ghost" onClick={() => handleDeleteDeliveryOrder(order)} className="h-6 px-1.5 text-xs text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40">
                            Delete
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* New DO Modal */}
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
                  href="/purchases"
                  className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-200"
                >
                  + Purchase Invoice
                </a>
                <a
                  href="/purchase-orders"
                  className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-200"
                >
                  + Purchase Order
                </a>
              </div>
              <span className="text-[11px] text-slate-400 font-mono">Press [Esc] to close</span>
            </div>

            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-bold text-slate-900">{editingOrderId ? "Edit Delivery Order" : "New Delivery Order"}</h2>
                <p className="text-xs text-slate-500">Dispatch paper consignment with vehicle and driver details</p>
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
              {/* Transfer Type Selection */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <Label className="text-xs font-semibold text-slate-700 block mb-2">Delivery / Transfer Type</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setOrderType("CUSTOMER");
                      setDestinationLocationId("");
                    }}
                    className={cn(
                      "flex items-center justify-center gap-2 rounded-md py-2 px-3 text-xs font-semibold transition-all",
                      orderType === "CUSTOMER"
                        ? "bg-amber-800 text-white shadow-sm"
                        : "bg-white text-slate-700 hover:bg-slate-100 border border-slate-200",
                    )}
                  >
                    <span>Customer Delivery</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOrderType("INTERNAL_TRANSFER");
                      setCustomerId("");
                      if (!destinationLocationId && locations.length > 1) {
                        const other = locations.find((l) => l.id !== locationId);
                        if (other) setDestinationLocationId(other.id);
                      }
                    }}
                    className={cn(
                      "flex items-center justify-center gap-2 rounded-md py-2 px-3 text-xs font-semibold transition-all",
                      orderType === "INTERNAL_TRANSFER"
                        ? "bg-sky-700 text-white shadow-sm"
                        : "bg-white text-slate-700 hover:bg-slate-100 border border-slate-200",
                    )}
                  >
                    <span>Internal Transfer (Shop &harr; Warehouse)</span>
                  </button>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-4">
                {orderType === "CUSTOMER" ? (
                  <>
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold">
                        Customer <span className="text-slate-400 font-normal">(Optional if Recipient Name provided)</span>
                      </Label>
                      <SearchCombobox
                        options={customers.map((c) => ({
                          id: c.id,
                          label: c.name,
                          badge: c.type === "CUSTOMER" ? "Customer" : "Supplier",
                          badgeColor: c.type === "CUSTOMER" ? "green" : "amber",
                          sublabel: c.phone || undefined,
                        }))}
                        value={customerId}
                        onChange={(val) => setCustomerId(val)}
                        inputRef={customerRef}
                        onEnterPress={() => {
                          recipientRef.current?.focus();
                          recipientRef.current?.select();
                        }}
                        placeholder="Search party by name (Customer or Supplier)..."
                        className="text-xs h-8"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="recipientName" className="text-xs font-semibold">
                        Recipient Name <span className="text-slate-400 font-normal">(Optional)</span>
                      </Label>
                      <Input
                        ref={recipientRef}
                        id="recipientName"
                        value={recipientName}
                        onChange={(e) => setRecipientName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            sourceLocationRef.current?.focus();
                            sourceLocationRef.current?.select();
                          }
                        }}
                        placeholder="e.g. Ali Ahmed"
                        className="text-xs h-8"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs font-semibold">
                        Dispatch Warehouse <span className="text-rose-500">*</span>
                      </Label>
                      <SearchCombobox
                        options={warehouseLocations.map((loc) => ({
                          id: loc.id,
                          label: `${loc.name} [Warehouse]`,
                        }))}
                        value={locationId}
                        onChange={(val) => handleLocationChange(val)}
                        inputRef={sourceLocationRef}
                        onEnterPress={() => {
                          orderDateRef.current?.focus();
                        }}
                        placeholder="Select warehouse..."
                        className="text-xs h-8"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold text-rose-800">
                        Source Location (From) <span className="text-rose-500">*</span>
                      </Label>
                      <SearchCombobox
                        options={locations.map((loc) => ({
                          id: loc.id,
                          label: `${loc.name} ${loc.type === "WAREHOUSE" ? "(Warehouse)" : ""}`,
                        }))}
                        value={locationId}
                        onChange={(val) => handleLocationChange(val)}
                        inputRef={sourceLocationRef}
                        onEnterPress={() => {
                          destLocationRef.current?.focus();
                          destLocationRef.current?.select();
                        }}
                        placeholder="Select source..."
                        className="text-xs h-8"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs font-semibold text-emerald-800">
                        Destination Location (To) <span className="text-rose-500">*</span>
                      </Label>
                      <SearchCombobox
                        options={locations
                          .filter((loc) => loc.id !== locationId)
                          .map((loc) => ({
                            id: loc.id,
                            label: loc.name,
                          }))}
                        value={destinationLocationId}
                        onChange={(val) => setDestinationLocationId(val)}
                        inputRef={destLocationRef}
                        onEnterPress={() => {
                          recipientRef.current?.focus();
                          recipientRef.current?.select();
                        }}
                        placeholder="Select destination..."
                        className="text-xs h-8"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="recipientName" className="text-xs font-semibold">
                        Recipient Name <span className="text-slate-400 font-normal">(Optional)</span>
                      </Label>
                      <Input
                        ref={recipientRef}
                        id="recipientName"
                        value={recipientName}
                        onChange={(e) => setRecipientName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            orderDateRef.current?.focus();
                          }
                        }}
                        placeholder="e.g. Warehouse Receiver"
                        className="text-xs h-8"
                      />
                    </div>
                  </>
                )}

                <div className="space-y-1">
                  <Label htmlFor="dodate" className="text-xs font-semibold">
                    Date & Time <span className="text-rose-500">*</span>
                  </Label>
                  <Input
                    ref={orderDateRef}
                    id="dodate"
                    type="datetime-local"
                    value={orderDate}
                    onChange={(e) => setOrderDate(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        vehicleNoRef.current?.focus();
                        vehicleNoRef.current?.select();
                      }
                    }}
                    className="text-xs h-8"
                    required
                  />
                </div>
              </div>

              {/* Logistics Details */}
              <div className="grid gap-4 sm:grid-cols-3 border-t border-slate-100 pt-3">
                <div className="space-y-1">
                  <Label htmlFor="vehicleNo" className="text-xs">
                    Vehicle Number <span className="text-slate-400 font-normal text-xs">(Optional)</span>
                  </Label>
                  <Input
                    ref={vehicleNoRef}
                    id="vehicleNo"
                    value={vehicleNo}
                    onChange={(e) => setVehicleNo(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        driverNameRef.current?.focus();
                        driverNameRef.current?.select();
                      }
                    }}
                    placeholder="e.g. LES-19-4820"
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="driverName" className="text-xs">
                    Driver Name <span className="text-slate-400 font-normal text-xs">(Optional)</span>
                  </Label>
                  <Input
                    ref={driverNameRef}
                    id="driverName"
                    value={driverName}
                    onChange={(e) => setDriverName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        deliveredToRef.current?.focus();
                        deliveredToRef.current?.select();
                      }
                    }}
                    placeholder="e.g. Muhammad Rafiq"
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="deliveredTo" className="text-xs">
                    Destination Address / Note <span className="text-slate-400 font-normal text-xs">(Optional)</span>
                  </Label>
                  <Input
                    ref={deliveredToRef}
                    id="deliveredTo"
                    value={deliveredTo}
                    onChange={(e) => setDeliveredTo(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        productRefs.current[0]?.current?.focus();
                        productRefs.current[0]?.current?.select();
                      }
                    }}
                    placeholder="e.g. Printing Press, Urdu Bazar"
                    className="text-xs"
                  />
                </div>
              </div>

              {/* Line items */}
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs font-bold uppercase tracking-wider text-slate-700">Consignment Items</Label>
                    {showLotSelector && (
                      <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-900">
                        Lot Tracking Active
                      </span>
                    )}
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={addItem} className="h-7 text-xs">
                    <Plus className="mr-1 h-3 w-3" /> Add Item
                  </Button>
                </div>

                <div className="space-y-3">
                  {items.map((item, idx) => (
                    <div
                      key={idx}
                      className={cn(
                        "grid gap-2 items-center rounded-lg border border-slate-100 p-2.5 bg-slate-50/50",
                        showLotSelector
                          ? "sm:grid-cols-[1fr_150px_100px_110px_36px]"
                          : "sm:grid-cols-[1fr_120px_120px_36px]"
                      )}
                    >
                      <div>
                        <SearchCombobox
                          options={products.map((p) => ({
                            id: p.id,
                            label: `${p.productNo} - ${p.name}`,
                            sublabel: p.unit,
                          }))}
                          value={item.productId}
                          onChange={(val) => handleProductChange(idx, val)}
                          inputRef={productRefs.current[idx]}
                          onEnterPress={() => {
                            if (!item.productId) {
                              notesRef.current?.focus();
                              notesRef.current?.select();
                              return;
                            }
                            if (showLotSelector && sourceLocationLots.length > 0) {
                              lotRefs.current[idx]?.current?.focus();
                              lotRefs.current[idx]?.current?.select();
                            } else {
                              qtyRefs.current[idx]?.current?.focus();
                              qtyRefs.current[idx]?.current?.select();
                            }
                          }}
                          placeholder="Select paper item..."
                          className="text-xs h-8"
                        />
                      </div>

                      {showLotSelector && (
                        <div className="flex items-center gap-1">
                          <div className="flex-1">
                            <SearchCombobox
                              options={sourceLocationLots.map((lot) => ({
                                id: lot.id,
                                label: `#${lot.lotNumber}`,
                                sublabel: lot.description || undefined,
                              }))}
                              value={item.warehouseLotId || ""}
                              onChange={(val) => handleLotChange(idx, val)}
                              inputRef={lotRefs.current[idx]}
                              onEnterPress={() => {
                                qtyRefs.current[idx]?.current?.focus();
                                qtyRefs.current[idx]?.current?.select();
                              }}
                              placeholder="Select Lot *"
                              className={cn(
                                "text-xs h-8 font-mono",
                                !item.warehouseLotId && "border-rose-300"
                              )}
                            />
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            title="Quick create new lot for this warehouse"
                            onClick={() => {
                              setQuickLotLineIndex(idx);
                              setQuickLotModalOpen(true);
                            }}
                            className="h-7 w-7 shrink-0 p-0 text-sky-800 hover:bg-sky-100"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}

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
                              if (idx === items.length - 1) {
                                addItem();
                                setTimeout(() => {
                                  productRefs.current[idx + 1]?.current?.focus();
                                  productRefs.current[idx + 1]?.current?.select();
                                }, 50);
                              } else {
                                productRefs.current[idx + 1]?.current?.focus();
                                productRefs.current[idx + 1]?.current?.select();
                              }
                            }
                          }}
                          className="h-8 text-xs text-right font-mono"
                          placeholder="Qty"
                          required
                        />
                      </div>

                      <div>
                        <select
                          ref={unitRefs.current[idx]}
                          value={item.unit}
                          onChange={(e) => handleUnitChange(idx, e.target.value as Unit)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && e.shiftKey) {
                              e.preventDefault();
                              notesRef.current?.focus();
                              notesRef.current?.select();
                              return;
                            }
                            if (e.key === "Enter") {
                              e.preventDefault();
                              if (idx === items.length - 1) {
                                if (!item.productId || item.quantity <= 0) {
                                  notesRef.current?.focus();
                                  notesRef.current?.select();
                                } else {
                                  addItem();
                                  setTimeout(() => {
                                    productRefs.current[idx + 1]?.current?.focus();
                                    productRefs.current[idx + 1]?.current?.select();
                                  }, 50);
                                }
                              } else {
                                productRefs.current[idx + 1]?.current?.focus();
                                productRefs.current[idx + 1]?.current?.select();
                              }
                            } else if (e.key === "ArrowDown" && idx === items.length - 1) {
                              e.preventDefault();
                              notesRef.current?.focus();
                              notesRef.current?.select();
                            }
                          }}
                          className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                        >
                          <option value={Unit.PACKET}>PACKET (100 sheets)</option>
                          <option value={Unit.REAM}>REAM (500 sheets)</option>
                          {Object.values(Unit).filter((u) => u !== Unit.PACKET && u !== Unit.REAM).map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                        </select>
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

              {/* Notes */}
              <div className="border-t border-slate-100 pt-3">
                <Label htmlFor="donotes" className="text-xs">
                  Delivery Instructions <span className="text-slate-400 font-normal text-xs">(Optional)</span>
                </Label>
                <Input
                  ref={notesRef}
                  id="donotes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleSubmit(e);
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      const lastIdx = items.length - 1;
                      unitRefs.current[lastIdx]?.current?.focus();
                    }
                  }}
                  placeholder="e.g. Unload at warehouse gate #2"
                  className="text-xs mt-1"
                />
              </div>

              <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-4">
                <span className="text-[11px] text-slate-400 font-mono hidden sm:inline">
                  Preview official document layout before dispatch
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handlePreviewPdf}
                    disabled={previewLoading || items.length === 0}
                    className="text-xs border-amber-400 text-amber-800 hover:bg-amber-50 dark:hover:bg-amber-950/40 gap-1.5"
                    title="Preview DO in PDF format"
                  >
                    <Eye className="h-3.5 w-3.5 text-amber-700" />
                    {previewLoading ? "Rendering..." : "Preview PDF"}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)} className="text-xs">
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting} className="bg-amber-800 text-white hover:bg-amber-700 text-xs font-semibold">
                    {submitting ? "Saving..." : editingOrderId ? "Update Delivery Order" : "Create Delivery Order"}
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
                  Quick-create lot for <strong className="text-slate-700">{selectedSourceLocation?.name || "Selected Location"}</strong>
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
                <Label htmlFor="doQuickLotNo" className="text-xs font-medium text-slate-700">
                  Lot Number / Tag <span className="text-rose-500">*</span>
                </Label>
                <Input
                  id="doQuickLotNo"
                  placeholder="e.g. Lot-12, Bin-4, Reel-01"
                  value={quickLotNumber}
                  onChange={(e) => setQuickLotNumber(e.target.value)}
                  className="text-xs h-8"
                  required
                  autoFocus
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="doQuickLotDesc" className="text-xs font-medium text-slate-700">
                  Description / Sub-batch <span className="text-slate-400 font-normal">(Optional)</span>
                </Label>
                <Input
                  id="doQuickLotDesc"
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
                  className="bg-sky-800 text-white hover:bg-sky-700 text-xs h-8"
                >
                  {submittingQuickLot ? "Adding..." : "Save Lot"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PDF modal removed — using browser print dialog */}
    </div>
  );
}

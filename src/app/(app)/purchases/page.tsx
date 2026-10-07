"use client";

import React, { useCallback, useEffect, useState, useMemo, useRef, createRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
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
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  listPurchaseInvoicesAction,
  createPurchaseInvoiceAction,
  updatePurchaseInvoiceAction,
  deletePurchaseInvoiceAction,
} from "@/actions/invoices";
import { listPurchaseOrdersAction } from "@/actions/orders";
import { listLocationsAction } from "@/actions/locations";
import { listPartiesAction } from "@/actions/parties";
import { listProductsAction } from "@/actions/products";
import { listWarehouseLotsAction, createWarehouseLotAction } from "@/actions/warehouse-lots";
import { format } from "date-fns";
import { formatDateTime, cn, getLocalDateTimeInputValue } from "@/lib/utils";
import { formatSequenceDisplay } from "@/lib/financial-year";
import { SearchCombobox } from "@/components/ui/search-combobox";
import { useRealtimeListener } from "@/hooks/use-realtime";
import { useConfirm } from "@/components/providers/confirm-provider";
import { useSession } from "next-auth/react";
import { canPerformAction } from "@/lib/auth/permissions";
import { printDocumentPdf, printDraftPdf } from "@/lib/print-pdf";
import { PrintPaperSizeControl, type PrintPaperSize } from "@/components/print/PrintPaperSizeControl";
import { withPaperSizeQuery } from "@/components/ui/print-with-paper-size";
import { DocumentWorkspace } from "@/components/documents/DocumentWorkspace";
import { useDockedDraft } from "@/components/documents/DocumentWorkspaceDock";
import { useDocumentWorkspaceStore } from "@/lib/document-workspace-store";

type PurchaseInvoiceRow = {
  id: string;
  invoiceNo: string;
  sequenceNo?: number;
  date: Date;
  status: string;
  totalAmount: number;
  amountPaid: number;
  balanceDue: number;
  freightCharges?: number;
  isPartnership?: boolean;
  partnershipId?: string | null;
  supplier: { id: string; name: string; phone: string | null };
  location: { id: string; name: string };
  purchaseOrder?: { id: string; orderNo: string } | null;
  financialYear?: { id: string; label: string; isActive?: boolean } | null;
  items: Array<{
    id: string;
    quantity: number;
    unitCost: number;
    lineTotal: number;
    locationId?: string;
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
  locationId?: string;
  warehouseLotId?: string;
  sourceWarehouseLotId?: string;
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
  const router = useRouter();
  const confirm = useConfirm();
  const { data: session } = useSession();
  const canView = !session?.user ? true : canPerformAction(session.user.role, "purchases", "view", (session.user as any).permissions);
  const canCreate = !session?.user ? false : canPerformAction(session.user.role, "purchases", "create", (session.user as any).permissions);
  const canUpdate = !session?.user ? false : canPerformAction(session.user.role, "purchases", "update", (session.user as any).permissions);
  const canDelete = !session?.user ? false : canPerformAction(session.user.role, "purchases", "delete", (session.user as any).permissions);

  useEffect(() => {
    if (session?.user && !canView) {
      router.replace("/dashboard");
    }
  }, [session, canView, router]);
  const [invoices, setInvoices] = useState<PurchaseInvoiceRow[]>([]);
  const [suppliers, setSuppliers] = useState<PartyOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [pos, setPos] = useState<POOption[]>([]);
  const [dbLocations, setDbLocations] = useState<LocationOption[]>([]);
  const [warehouseLots, setWarehouseLots] = useState<WarehouseLotOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [docPaperSize, setDocPaperSize] = useState<PrintPaperSize>("A4");
  const [statusFilter, setStatusFilter] = useState<"OPEN" | "ALL">("ALL");
  const [yearFilter, setYearFilter] = useState<"CURRENT" | "ALL">("CURRENT");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const invoiceDateRef = useRef<HTMLInputElement>(null);
  const oneTimeNameRef = useRef<HTMLInputElement>(null);
  const oneTimePhoneRef = useRef<HTMLInputElement>(null);
  const amountPaidRef = useRef<HTMLInputElement>(null);
  const freightRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLInputElement>(null);
  const productRefs = useRef<React.RefObject<HTMLInputElement>[]>([]);
  const locationRefs = useRef<React.RefObject<HTMLInputElement>[]>([]);
  const lotRefs = useRef<React.RefObject<HTMLInputElement>[]>([]);
  const qtyRefs = useRef<React.RefObject<HTMLInputElement>[]>([]);
  const costRefs = useRef<React.RefObject<HTMLInputElement>[]>([]);

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
  const [isPartnership, setIsPartnership] = useState(false);
  const [partnershipId, setPartnershipId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(getLocalDateTimeInputValue());
  const [notes, setNotes] = useState("");
  const [amountPaid, setAmountPaid] = useState<string>("0");
  const [freightCharges, setFreightCharges] = useState<string>("0");
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "BANK" | "CHEQUE" | "OTHER">("CASH");
  const [isSplitPayment, setIsSplitPayment] = useState(false);
  const [paymentSplits, setPaymentSplits] = useState<
    Array<{ method: "CASH" | "BANK" | "CHEQUE" | "OTHER"; amount: string; reference: string }>
  >([
    { method: "CASH", amount: "", reference: "" },
    { method: "BANK", amount: "", reference: "" },
  ]);
  const [items, setItems] = useState<LineItem[]>([{ productId: "", locationId: "", warehouseLotId: "", quantity: 1, unitCost: 0 }]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  function closePurchaseDialog() {
    setIsDialogOpen(false);
    setEditingInvoiceId(null);
    setFormError(null);
    useDocumentWorkspaceStore.getState().clearDock();
  }

  function detachPurchaseDialog() {
    const inv = editingInvoiceId ? invoices.find((i) => i.id === editingInvoiceId) : null;
    const title = inv
      ? `Edit PI ${formatSequenceDisplay(inv.sequenceNo, inv.invoiceNo)}`
      : "New purchase invoice draft";
    useDocumentWorkspaceStore.getState().setDock({
      kind: "PURCHASE",
      title,
      restorePath: "/purchases",
      snapshot: {
        editingInvoiceId,
        supplierType,
        oneTimeSupplierName,
        oneTimeSupplierPhone,
        supplierId,
        locationId,
        purchaseOrderId,
        isPartnership,
        partnershipId,
        invoiceDate,
        notes,
        amountPaid,
        freightCharges,
        paymentMethod,
        isSplitPayment,
        paymentSplits,
        items,
      },
    });
    setIsDialogOpen(false);
    setFormError(null);
  }

  useDockedDraft("PURCHASE", (snap: {
    editingInvoiceId: string | null;
    supplierType: "REGISTERED" | "ONE_TIME";
    oneTimeSupplierName: string;
    oneTimeSupplierPhone: string;
    supplierId: string;
    locationId: string;
    purchaseOrderId: string;
    isPartnership: boolean;
    partnershipId: string;
    invoiceDate: string;
    notes: string;
    amountPaid: string;
    freightCharges: string;
    paymentMethod: "CASH" | "BANK" | "CHEQUE" | "OTHER";
    isSplitPayment: boolean;
    paymentSplits: Array<{ method: "CASH" | "BANK" | "CHEQUE" | "OTHER"; amount: string; reference: string }>;
    items: LineItem[];
  }) => {
    setEditingInvoiceId(snap.editingInvoiceId);
    setSupplierType(snap.supplierType);
    setOneTimeSupplierName(snap.oneTimeSupplierName);
    setOneTimeSupplierPhone(snap.oneTimeSupplierPhone);
    setSupplierId(snap.supplierId);
    setLocationId(snap.locationId);
    setPurchaseOrderId(snap.purchaseOrderId);
    setIsPartnership(snap.isPartnership);
    setPartnershipId(snap.partnershipId);
    setInvoiceDate(snap.invoiceDate);
    setNotes(snap.notes);
    setAmountPaid(snap.amountPaid);
    setFreightCharges(snap.freightCharges);
    setPaymentMethod(snap.paymentMethod);
    setIsSplitPayment(snap.isSplitPayment);
    setPaymentSplits(snap.paymentSplits);
    setItems(snap.items);
    setIsDialogOpen(true);
  });

  // Global keydown with Ctrl+Enter save support
  const handleSubmitRef = useRef<(e: React.FormEvent) => Promise<void>>(async () => {});
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
        closePurchaseDialog();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && isDialogOpen) {
        e.preventDefault();
        const fakeEv = { preventDefault: () => {} } as React.FormEvent;
        void handleSubmitRef.current(fakeEv);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDialogOpen]);

  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get("action") === "new" || searchParams.get("new") === "true") {
      setIsDialogOpen(true);
    }
    const paramSupplier = searchParams.get("supplierId") || searchParams.get("partnerId");
    if (paramSupplier) {
      setSupplierId(paramSupplier);
      setSupplierType("REGISTERED");
      if (searchParams.get("partnerId")) {
        setIsPartnership(true);
        setPartnershipId(searchParams.get("partnerId") || "");
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
                locationId: item.locationId || parsed.locationId || "",
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

    if (searchParams.get("fromPO") === "1") {
      try {
        const stored = sessionStorage.getItem("draft_from_po");
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed.supplierId) {
            setSupplierType("REGISTERED");
            setSupplierId(parsed.supplierId);
          }
          setIsPartnership(Boolean(parsed.isPartnership));
          setPartnershipId(parsed.partnershipId || "");
          // Set invoice destination and header location to Main Retail Shop
          const shop = dbLocations.find((l) => l.name.toLowerCase().includes("shop") || l.type === "SHOP");
          const targetLoc = parsed.destinationLocationId || (shop ? shop.id : parsed.locationId) || parsed.locationId;
          if (targetLoc) setLocationId(targetLoc);

          if (parsed.purchaseOrderId) setPurchaseOrderId(parsed.purchaseOrderId);
          if (Array.isArray(parsed.items) && parsed.items.length > 0) {
            setItems(
              parsed.items.map((item: any) => {
                const prod = products.find((p) => p.id === item.productId);
                const cost = Number(item.unitCost) > 0 ? Number(item.unitCost) : (prod?.costPrice || 0);
                return {
                  productId: item.productId || "",
                  locationId: item.destinationLocationId || targetLoc || "",
                  warehouseLotId: item.warehouseLotId || "",
                  sourceWarehouseLotId: item.sourceWarehouseLotId || item.warehouseLotId || "",
                  quantity: Number(item.quantity) || 1,
                  unitCost: cost,
                };
              })
            );
          }
        }
      } catch (e) {
        console.error("Failed to load draft_from_po in purchases", e);
      }
    }
  }, [searchParams, dbLocations, products]);

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
        paperSize: docPaperSize,
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

      await printDraftPdf(payload);
    } catch (err: any) {
      await confirm.alert(err.message || "Failed to print Purchase Invoice preview", { variant: "destructive" });
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

  const numFreight = useMemo(
    () => Math.max(0, parseFloat(freightCharges) || 0),
    [freightCharges]
  );

  const invoiceGrandTotal = useMemo(
    () => invoiceSubtotal + numFreight,
    [invoiceSubtotal, numFreight]
  );

  const numPaid = useMemo(
    () => Math.max(0, parseFloat(amountPaid) || 0),
    [amountPaid]
  );

  const balanceDue = useMemo(
    () => Math.max(0, invoiceGrandTotal - numPaid),
    [invoiceGrandTotal, numPaid]
  );

  const selectedSupplier = useMemo(
    () => suppliers.find((s) => s.id === supplierId),
    [suppliers, supplierId],
  );

  function handleLocationChange(newLocId: string) {
    setLocationId(newLocId);
    setItems((prev) =>
      prev.map((it) => {
        const itemLoc = it.locationId || newLocId;
        const lotMatches = warehouseLots.some(
          (l) => l.id === it.warehouseLotId && l.locationId === itemLoc,
        );
        return lotMatches ? it : { ...it, warehouseLotId: "" };
      }),
    );
  }

  function handleItemLocationChange(index: number, newLocId: string) {
    const updated = [...items];
    updated[index].locationId = newLocId;
    const lotMatches = warehouseLots.some(
      (l) => l.id === updated[index].warehouseLotId && l.locationId === newLocId,
    );
    if (!lotMatches) {
      updated[index].warehouseLotId = "";
    }
    setItems(updated);
  }

  function handleProductChange(index: number, pId: string, jumpToQty = false) {
    const product = products.find((p) => p.id === pId);
    const updated = [...items];
    updated[index].productId = pId;
    if (product) {
      updated[index].unitCost = product.costPrice || 0;
    }
    setItems(updated);
    if (jumpToQty || pId) {
      setTimeout(() => {
        qtyRefs.current[index]?.current?.focus();
        qtyRefs.current[index]?.current?.select();
      }, 50);
    }
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
    const lastLocId = items[items.length - 1]?.locationId || locationId || (locations[0]?.id ?? "");
    const nextIdx = items.length;
    setItems((prev) => [...prev, { productId: "", locationId: lastLocId, warehouseLotId: "", quantity: 1, unitCost: 0 }]);
    setTimeout(() => {
      productRefs.current[nextIdx]?.current?.focus();
      productRefs.current[nextIdx]?.current?.select();
    }, 60);
  }

  function removeItem(index: number) {
    if (items.length <= 1) return;
    setItems(items.filter((_, idx) => idx !== index));
  }

  async function handleStatusChange(id: string, status: string) {
    const ok = await confirm({
      title: "Purchase Invoice Status",
      description: `Are you sure you want to mark this invoice as ${status}?`,
      confirmText: status === "SETTLED" ? "Mark Settled" : "Update Status",
      variant: "primary",
    });
    if (!ok) return;

    // Note: This would need a backend action to update purchase invoice status
    // For now, we'll just show an alert
    await confirm.alert("Status update functionality requires backend implementation.", { variant: "default" });
  }

  async function handleCreateQuickLot(e: React.FormEvent) {
    e.preventDefault();
    const targetLocId =
      (quickLotLineIndex !== null ? items[quickLotLineIndex]?.locationId : null) ||
      locationId ||
      (locations[0]?.id ?? "");
    if (!targetLocId || !quickLotNumber.trim()) return;
    setSubmittingQuickLot(true);
    try {
      const res = await createWarehouseLotAction({
        locationId: targetLocId,
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

  function resetPurchaseInvoiceForm() {
    setSupplierType("REGISTERED");
    setOneTimeSupplierName("");
    setOneTimeSupplierPhone("");
    setSupplierId("");
    setLocationId("");
    setPurchaseOrderId("");
    setIsPartnership(false);
    setPartnershipId("");
    setInvoiceDate(getLocalDateTimeInputValue());
    setNotes("");
    setAmountPaid("0");
    setFreightCharges("0");
    setPaymentMethod("CASH");
    setIsSplitPayment(false);
    setPaymentSplits([
      { method: "CASH", amount: "", reference: "" },
      { method: "BANK", amount: "", reference: "" },
    ]);
    setItems([{ productId: "", locationId: "", warehouseLotId: "", quantity: 1, unitCost: 0 }]);
    setFormError(null);
  }

  function openEditPurchaseInvoice(invoice: PurchaseInvoiceRow) {
    if (!canUpdate) {
      confirm.alert("You do not have permission to edit purchase invoices.", { variant: "destructive" });
      return;
    }
    setEditingInvoiceId(invoice.id);
    setSupplierType("REGISTERED");
    setSupplierId(invoice.supplier.id);
    setOneTimeSupplierName("");
    setOneTimeSupplierPhone("");
    setLocationId(invoice.location.id);
    setPurchaseOrderId(invoice.purchaseOrder?.id || "");
    setIsPartnership(Boolean(invoice.isPartnership));
    setPartnershipId(invoice.partnershipId || "");
    setInvoiceDate(new Date(invoice.date).toISOString().slice(0, 16));
    setNotes("");
    setAmountPaid(String(invoice.amountPaid || 0));
    setFreightCharges(String(invoice.freightCharges || 0));
    setIsSplitPayment(false);
    setPaymentSplits([
      { method: "CASH", amount: "", reference: "" },
      { method: "BANK", amount: "", reference: "" },
    ]);
    setItems(
      invoice.items.map((item) => ({
        productId: item.product.id,
        locationId: item.locationId || invoice.location.id,
        warehouseLotId: item.warehouseLot?.id || "",
        quantity: item.quantity,
        unitCost: item.unitCost,
      }))
    );
    setFormError(null);
    setIsDialogOpen(true);
  }

  async function handleDeletePurchaseInvoice(invoice: PurchaseInvoiceRow) {
    if (!canDelete) {
      await confirm.alert("You do not have permission to delete purchase invoices.", { variant: "destructive" });
      return;
    }
    const ok = await confirm({
      title: "Delete purchase invoice",
      description: `Are you sure you want to delete ${invoice.invoiceNo}? This will remove the invoice, its stock movements, and related ledger entries.`,
      confirmText: "Delete",
      variant: "destructive",
    });
    if (!ok) return;

    try {
      // Optimistically remove from state so the row disappears immediately and scroll position is preserved
      setInvoices((prev) => prev.filter((i) => i.id !== invoice.id));
      const res = await deletePurchaseInvoiceAction({ id: invoice.id });
      if (!res.success) {
        await confirm.alert(res.error || "Failed to delete purchase invoice.", { variant: "destructive" });
        await loadData(true);
        return;
      }
      setEditingInvoiceId(null);
      setIsDialogOpen(false);
      await loadData(true);
    } catch (err: any) {
      await confirm.alert(err?.message || "Failed to delete purchase invoice.", { variant: "destructive" });
      await loadData(true);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const isEditing = Boolean(editingInvoiceId);
    if (isEditing && !canUpdate) {
      setFormError("You do not have permission to edit purchase invoices.");
      return;
    }
    if (!isEditing && !canCreate) {
      setFormError("You do not have permission to create purchase invoices.");
      return;
    }

    if (supplierType === "REGISTERED" && !supplierId) {
      setFormError("Please select a registered supplier.");
      return;
    }
    if (supplierType === "ONE_TIME" && !oneTimeSupplierName.trim()) {
      setOneTimeSupplierName("Market Vendor");
    }
    const finalLocationId = locationId || items[0]?.locationId || (locations[0]?.id ?? "");
    if (!finalLocationId) {
      setFormError("Please select a receiving location.");
      return;
    }
    if (items.some((i) => !i.productId || i.quantity <= 0)) {
      setFormError("All line items must have a valid product and quantity > 0.");
      return;
    }

    const ok = await confirm({
      title: isEditing ? "Update Purchase Invoice" : "Confirm Purchase Invoice",
      description: isEditing
        ? "Are you sure you want to update this purchase invoice and adjust stock and ledger balances?"
        : "Are you sure you want to record this purchase invoice and receive inventory?",
      confirmText: isEditing ? "Update Invoice" : "Record Invoice",
      variant: "primary",
    });
    if (!ok) return;

    if (isSplitPayment && numPaid > 0) {
      const activeSplits = paymentSplits.filter((s) => (parseFloat(s.amount) || 0) > 0);
      const splitSum = activeSplits.reduce((acc, s) => acc + (parseFloat(s.amount) || 0), 0);
      if (Math.abs(splitSum - numPaid) > 0.05) {
        setFormError(
          `Sum of split payments (PKR ${splitSum.toFixed(2)}) must equal Total Amount Paid (PKR ${numPaid.toFixed(2)}).`
        );
        return;
      }
    }

    setSubmitting(true);
    try {
      const splitsPayload =
        isSplitPayment && numPaid > 0
          ? paymentSplits
              .filter((s) => (parseFloat(s.amount) || 0) > 0)
              .map((s) => ({
                method: s.method,
                amount: parseFloat(s.amount) || 0,
                reference: s.reference.trim() || undefined,
              }))
          : undefined;

      const payload = {
        ...(isEditing ? { id: editingInvoiceId } : {}),
        supplierType,
        supplierId: supplierType === "REGISTERED" ? supplierId : undefined,
        oneTimeSupplierName: supplierType === "ONE_TIME" ? (oneTimeSupplierName.trim() || "Market Vendor") : undefined,
        oneTimeSupplierPhone: supplierType === "ONE_TIME" ? (oneTimeSupplierPhone.trim() || null) : undefined,
        locationId: finalLocationId,
        purchaseOrderId: purchaseOrderId || null,
        isPartnership,
        partnershipId: partnershipId || null,
        date: new Date(invoiceDate),
        notes,
        amountPaid: numPaid,
        paymentMethod: numPaid > 0 ? paymentMethod : undefined,
        paymentSplits: splitsPayload,
        freightCharges: numFreight,
        items: items.map((i) => ({
          productId: i.productId,
          locationId: i.locationId || finalLocationId,
          warehouseLotId: i.warehouseLotId || undefined,
          sourceWarehouseLotId: i.sourceWarehouseLotId || undefined,
          quantity: i.quantity,
          unitCost: i.unitCost,
        })),
      };

      const res = isEditing
        ? await updatePurchaseInvoiceAction(payload)
        : await createPurchaseInvoiceAction(payload);

      if (!res.success) {
        setFormError(res.error || (isEditing ? "Failed to update purchase invoice." : "Failed to record purchase invoice."));
      } else {
        setIsDialogOpen(false);
        setEditingInvoiceId(null);
        resetPurchaseInvoiceForm();
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

          {canCreate && (
            <Button
              onClick={() => {
                if (!canCreate) {
                  confirm.alert("You do not have permission to create purchase invoices.", { variant: "destructive" });
                  return;
                }
                if (!locationId && locations.length > 0) setLocationId(locations[0].id);
                setIsDialogOpen(true);
              }}
              className="h-8 bg-amber-800 hover:bg-amber-900 text-white text-xs font-bold shadow-xs px-3"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Receive Purchase <span className="ml-1.5 text-[10px] opacity-75 font-mono">[F2]</span>
            </Button>
          )}
        </div>
      </div>

      {/* Search Filter & Archive Toggles */}
      <div className="flex flex-col md:flex-row gap-2 items-center justify-between bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2.5 rounded-md shadow-xs">
        <PrintPaperSizeControl value={docPaperSize} onChange={setDocPaperSize} />
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
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md shadow-xs overflow-hidden">
          <div className="overflow-x-auto max-h-[calc(100vh-230px)]">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700 text-[11px] font-bold uppercase tracking-wider">
                <tr>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap">Invoice #</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap">Date & Time</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 min-w-[160px]">Supplier</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap">Location</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap">Linked PO</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 text-center whitespace-nowrap">Items</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap">Total (PKR)</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap">Paid (PKR)</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap font-bold">Balance Due</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 text-center whitespace-nowrap">Status</th>
                  <th className="sticky right-0 z-20 py-2 px-2 text-center whitespace-nowrap bg-slate-100 dark:bg-slate-800 border-l border-slate-200 dark:border-slate-700 shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.06)]">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredInvoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-amber-50/60 dark:hover:bg-slate-800/60 transition-colors even:bg-slate-50/40 dark:even:bg-slate-900/40">
                    <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-slate-900 dark:text-slate-100">#{formatSequenceDisplay(inv.sequenceNo, inv.invoiceNo)}</span>
                        {inv.financialYear && (
                          <span className="text-[9px] px-1 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-mono" title={inv.invoiceNo}>
                            {inv.financialYear.label}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono whitespace-nowrap text-slate-600 dark:text-slate-400 text-[11px]">
                      {formatDateTime(inv.date)}
                    </td>
                    <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-medium text-slate-800 dark:text-slate-200">
                      <div className="flex flex-col">
                        <span>{inv.supplier.name}</span>
                        {inv.supplier.phone && <span className="text-[10px] text-slate-400 font-mono">{inv.supplier.phone}</span>}
                      </div>
                    </td>
                    <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 whitespace-nowrap text-slate-600 dark:text-slate-400">
                      {inv.location.name}
                    </td>
                    <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono whitespace-nowrap text-emerald-800 dark:text-emerald-400">
                      {inv.purchaseOrder ? inv.purchaseOrder.orderNo : "—"}
                    </td>
                    <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 text-center font-mono whitespace-nowrap text-slate-600">
                      {inv.items.length}
                    </td>
                    <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono text-right whitespace-nowrap font-bold text-slate-900 dark:text-slate-100">
                      PKR {inv.totalAmount.toLocaleString()}
                    </td>
                    <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono text-right whitespace-nowrap text-emerald-700 dark:text-emerald-400">
                      PKR {(inv.amountPaid || 0).toLocaleString()}
                    </td>
                    <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono text-right whitespace-nowrap font-bold">
                      {(inv.balanceDue ?? (inv.totalAmount - (inv.amountPaid || 0))) > 0 ? (
                        <span className="text-rose-700 dark:text-rose-400">PKR {(inv.balanceDue ?? (inv.totalAmount - (inv.amountPaid || 0))).toLocaleString()}</span>
                      ) : (
                        <span className="text-emerald-700 dark:text-emerald-400">PAID</span>
                      )}
                    </td>
                    <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 text-center whitespace-nowrap">
                      <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                        inv.status === "SETTLED"
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                          : inv.status === "CANCELLED"
                          ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                          : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                      }`}>{inv.status}</span>
                    </td>
                    <td className="sticky right-0 z-10 py-1 px-2 text-center whitespace-nowrap bg-white dark:bg-slate-900 border-l border-slate-200/60 dark:border-slate-800 shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.06)]">
                      <div className="grid grid-cols-4 items-center justify-items-center gap-1 min-w-[280px]">
                        <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs text-slate-600 hover:text-slate-800 hover:bg-slate-100" title="Print Invoice"
                          onClick={() => {
                            printDocumentPdf(withPaperSizeQuery(`/api/pdf/purchase-invoice/${inv.id}`, docPaperSize)).catch((e) =>
                              confirm.alert(e.message, { variant: "destructive" })
                            );
                          }}
                        >
                          <Printer className="h-3 w-3 mr-1" />
                          Print
                        </Button>
                        {canUpdate && inv.status === "OPEN" ? (
                          <Button size="sm" variant="ghost" onClick={() => handleStatusChange(inv.id, "SETTLED")} className="h-6 px-1.5 text-xs text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Settle
                          </Button>
                        ) : (
                          <span className="inline-block w-[4.5rem]" aria-hidden="true" />
                        )}
                        {canUpdate ? (
                          <Button size="sm" variant="ghost" onClick={() => openEditPurchaseInvoice(inv)} className="h-6 px-1.5 text-xs text-sky-700 hover:bg-sky-50 dark:hover:bg-sky-950/40">
                            Edit
                          </Button>
                        ) : (
                          <span className="inline-block w-10" aria-hidden="true" />
                        )}
                        {canDelete ? (
                          <Button size="sm" variant="ghost" onClick={() => handleDeletePurchaseInvoice(inv)} className="h-6 px-1.5 text-xs text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40">
                            Delete
                          </Button>
                        ) : (
                          <span className="inline-block w-12" aria-hidden="true" />
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

      <DocumentWorkspace
        open={isDialogOpen}
        icon={<ShoppingCart className="h-4 w-4 text-amber-400" />}
        title={editingInvoiceId ? "Edit purchase invoice" : "Record purchase invoice"}
        onClose={closePurchaseDialog}
        onDetach={detachPurchaseDialog}
        error={formError}
        toolbar={
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-[11px] font-semibold text-slate-500">Quick jump:</span>
            <a href="/sales" className="rounded bg-white dark:bg-slate-900 border border-slate-300 px-2 py-0.5 text-[11px] font-medium hover:border-amber-500">
              + Sales
            </a>
            <a href="/purchase-orders" className="rounded bg-white dark:bg-slate-900 border border-slate-300 px-2 py-0.5 text-[11px] font-medium hover:border-amber-500">
              + PO
            </a>
            <a href="/delivery-orders" className="rounded bg-white dark:bg-slate-900 border border-slate-300 px-2 py-0.5 text-[11px] font-medium hover:border-amber-500">
              + DO
            </a>
          </div>
        }
        header={
          <p className="text-[11px] text-slate-500">Receive stock from supplier and post to payables</p>
        }
        footer={
          <div className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-slate-500 font-mono">[Ctrl+Enter] Save • [Esc] Close</span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handlePreviewPdf}
                disabled={previewLoading || items.length === 0}
                className="text-xs border-amber-400 text-amber-800 hover:bg-amber-50 gap-1.5 h-8"
              >
                <Eye className="h-3.5 w-3.5" />
                {previewLoading ? "Printing..." : "Print"}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={closePurchaseDialog} className="text-xs h-8">
                Cancel
              </Button>
              <Button
                type="submit"
                form="purchase-invoice-form"
                disabled={submitting}
                className="bg-amber-800 text-white hover:bg-amber-700 text-xs font-semibold h-8"
              >
                {submitting ? "Processing..." : editingInvoiceId ? "Update purchase invoice" : "Save & receive stock"}
              </Button>
            </div>
          </div>
        }
      >
            <form id="purchase-invoice-form" onSubmit={handleSubmit} className="space-y-4 px-1">
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
                  <div className="space-y-1 sm:col-span-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="supplier" className="text-xs font-semibold">
                        Supplier Party <span className="text-rose-500">*</span>
                      </Label>
                      {selectedSupplier && (
                        <span className="text-[11px] font-semibold">
                          Balance:{" "}
                          <strong
                            className={
                              Number(selectedSupplier.balance || 0) > 0
                                ? "text-emerald-700"
                                : Number(selectedSupplier.balance || 0) < 0
                                ? "text-rose-700"
                                : "text-slate-600"
                            }
                          >
                            PKR {Math.abs(Number(selectedSupplier.balance || 0)).toLocaleString()}{" "}
                            {Number(selectedSupplier.balance || 0) > 0
                              ? "(Receivable / Advance)"
                              : Number(selectedSupplier.balance || 0) < 0
                              ? "(Payable / You owe)"
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
                        invoiceDateRef.current?.focus();
                      }}
                      placeholder="Search party by name (Supplier or Customer)..."
                      className="w-full text-xs"
                      inputClassName="h-8 text-xs font-medium"
                    />
                  </div>
                ) : (
                  <div className="space-y-1 sm:col-span-2">
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
                          invoiceDateRef.current?.focus();
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
                    Invoice Date & Time <span className="text-rose-500">*</span>
                  </Label>
                  <Input
                    ref={invoiceDateRef}
                    id="pdate"
                    type="datetime-local"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
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
                  <div className="flex items-center gap-2">
                    <Label className="text-xs font-bold uppercase tracking-wider text-slate-700">Stock Arrival Items</Label>
                    <span className="text-[10px] text-slate-400 font-mono">
                      (Specify receiving location & lot for each product)
                    </span>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={addItem} className="h-7 text-xs">
                    <Plus className="mr-1 h-3 w-3" /> Add Product
                  </Button>
                </div>

                <div className="space-y-3">
                  {items.map((item, idx) => {
                    while (productRefs.current.length <= idx) productRefs.current.push(React.createRef<HTMLInputElement>());
                    while (locationRefs.current.length <= idx) locationRefs.current.push(React.createRef<HTMLInputElement>());
                    while (lotRefs.current.length <= idx) lotRefs.current.push(React.createRef<HTMLInputElement>());
                    while (qtyRefs.current.length <= idx) qtyRefs.current.push(React.createRef<HTMLInputElement>());
                    while (costRefs.current.length <= idx) costRefs.current.push(React.createRef<HTMLInputElement>());

                    const itemLocId = item.locationId || locationId || (locations[0]?.id ?? "");
                    const itemLocObj = locations.find((l) => l.id === itemLocId);
                    const rowLots = warehouseLots.filter((lot) => lot.locationId === itemLocId);
                    const isRowWarehouse = itemLocObj?.type === "WAREHOUSE" || rowLots.length > 0;

                    return (
                      <div
                        key={idx}
                        className="grid gap-2 items-center rounded-lg border border-slate-100 p-2.5 bg-slate-50/50 sm:grid-cols-[1.5fr_1.1fr_1.1fr_80px_100px_90px_36px]"
                      >
                        {/* Product SearchCombobox */}
                        <div>
                          <Label className="text-[10px] text-slate-500 mb-0.5 block sm:hidden">Product</Label>
                          <SearchCombobox
                            options={products.map((p) => ({
                              id: p.id,
                              label: `${p.productNo} - ${p.name}`,
                              sublabel: `Unit: ${p.unit} | Cost: PKR ${p.costPrice}`,
                            }))}
                            value={item.productId}
                            onChange={(val) => handleProductChange(idx, val, true)}
                            inputRef={productRefs.current[idx]}
                            onEnterPress={() => {
                              qtyRefs.current[idx]?.current?.focus();
                              qtyRefs.current[idx]?.current?.select();
                            }}
                            placeholder="Select product..."
                            className="w-full text-xs"
                          />
                        </div>

                        {/* Location SearchCombobox */}
                        <div>
                          <Label className="text-[10px] text-slate-500 mb-0.5 block sm:hidden">Location</Label>
                          <SearchCombobox
                            options={locations.map((loc) => ({
                              id: loc.id,
                              label: loc.name,
                              badge: loc.type === "WAREHOUSE" ? "Warehouse" : "Shop",
                              badgeColor: loc.type === "WAREHOUSE" ? "amber" : "sky",
                            }))}
                            value={itemLocId}
                            onChange={(val) => handleItemLocationChange(idx, val)}
                            inputRef={locationRefs.current[idx]}
                            onEnterPress={() => {
                              if (isRowWarehouse && rowLots.length > 0) {
                                lotRefs.current[idx]?.current?.focus();
                                lotRefs.current[idx]?.current?.select();
                              } else {
                                qtyRefs.current[idx]?.current?.focus();
                                qtyRefs.current[idx]?.current?.select();
                              }
                            }}
                            placeholder="Location"
                            className="w-full text-xs"
                          />
                        </div>

                        {/* Lot SearchCombobox */}
                        <div>
                          <Label className="text-[10px] text-slate-500 mb-0.5 block sm:hidden">Lot #</Label>
                          {isRowWarehouse ? (
                            <div className="flex items-center gap-1">
                              <SearchCombobox
                                options={[
                                  { id: "", label: "No Lot" },
                                  ...rowLots.map((lot) => ({
                                    id: lot.id,
                                    label: `#${lot.lotNumber}${lot.description ? ` (${lot.description})` : ""}`,
                                  })),
                                ]}
                                value={item.warehouseLotId || ""}
                                onChange={(val) => handleLotChange(idx, val)}
                                inputRef={lotRefs.current[idx]}
                                onEnterPress={() => {
                                  qtyRefs.current[idx]?.current?.focus();
                                  qtyRefs.current[idx]?.current?.select();
                                }}
                                placeholder="Lot #"
                                className="w-full text-xs font-mono"
                              />
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
                          ) : (
                            <span className="text-[10px] text-slate-400 italic text-center block">N/A (Shop)</span>
                          )}
                        </div>

                        {/* Quantity */}
                        <div>
                          <Label className="text-[10px] text-slate-500 mb-0.5 block sm:hidden">Quantity</Label>
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
                                costRefs.current[idx]?.current?.focus();
                                costRefs.current[idx]?.current?.select();
                              }
                            }}
                            className="h-8 text-xs text-right font-mono"
                            placeholder="Qty"
                            required
                          />
                          {(() => {
                            const p = products.find((pr) => pr.id === item.productId);
                            const w = (p as any)?.packetWeight || (p as any)?.reamWeight || 0;
                            if (w > 0 && item.quantity > 0) {
                              return (
                                <span className="text-[10px] text-amber-700 font-mono block text-right mt-0.5">
                                  {((item.quantity || 0) * w).toFixed(2)} kg
                                </span>
                              );
                            }
                            return null;
                          })()}
                        </div>

                        {/* Unit Cost */}
                        <div>
                          <Label className="text-[10px] text-slate-500 mb-0.5 block sm:hidden">Unit Cost</Label>
                          <Input
                            ref={costRefs.current[idx]}
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.unitCost}
                            onChange={(e) => handleCostChange(idx, Number(e.target.value) || 0)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && e.shiftKey) {
                                e.preventDefault();
                                amountPaidRef.current?.focus();
                                amountPaidRef.current?.select();
                                return;
                              }
                              if (e.key === "Enter") {
                                e.preventDefault();
                                if (idx === items.length - 1) {
                                  if (!item.productId || item.quantity <= 0) {
                                    amountPaidRef.current?.focus();
                                    amountPaidRef.current?.select();
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
                                amountPaidRef.current?.focus();
                                amountPaidRef.current?.select();
                              }
                            }}
                            className="h-8 text-xs text-right font-mono"
                            placeholder="Cost"
                            required
                          />
                        </div>

                        {/* Line Total */}
                        <div className="text-right text-xs font-semibold text-slate-800 font-mono">
                          PKR {((item.quantity || 0) * (item.unitCost || 0)).toFixed(2)}
                        </div>

                        {/* Remove Button */}
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

              {/* Subtotal, Settlement & Summary */}
              <div className="border-t border-slate-100 pt-3 grid grid-cols-1 md:grid-cols-12 gap-4">
                <div className="md:col-span-7 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <div className="flex items-center justify-between">
                        <Label className="text-[10px] uppercase font-bold text-slate-700">Amount Paid (PKR)</Label>
                        <button
                          type="button"
                          onClick={() => setAmountPaid(String(invoiceGrandTotal))}
                          className="text-[10px] font-bold text-amber-800 hover:text-amber-900 underline"
                        >
                          Full Pay
                        </button>
                      </div>
                      <Input
                        ref={amountPaidRef}
                        type="number"
                        min="0"
                        step="0.01"
                        value={amountPaid}
                        onChange={(e) => setAmountPaid(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            freightRef.current?.focus();
                            freightRef.current?.select();
                          } else if (e.key === "ArrowUp") {
                            e.preventDefault();
                            const lastIdx = items.length - 1;
                            costRefs.current[lastIdx]?.current?.focus();
                            costRefs.current[lastIdx]?.current?.select();
                          }
                        }}
                        placeholder="0.00"
                        className="mt-1 h-8 text-xs text-right font-mono font-bold"
                      />
                    </div>

                    {/* Payment Method / Multi-mode Toggle */}
                    <div>
                      <div className="flex items-center justify-between">
                        <Label className="text-[10px] uppercase font-bold text-slate-700">Payment Mode</Label>
                        {numPaid > 0 && (
                          <button
                            type="button"
                            onClick={() => setIsSplitPayment(!isSplitPayment)}
                            className="text-[10px] font-bold text-amber-800 dark:text-amber-400 hover:underline"
                          >
                            {isSplitPayment ? "Single Mode" : "+ Multiple Modes"}
                          </button>
                        )}
                      </div>
                      {!isSplitPayment ? (
                        <select
                          value={paymentMethod}
                          onChange={(e) => setPaymentMethod(e.target.value as any)}
                          disabled={numPaid <= 0}
                          className="w-full mt-1 h-8 rounded border border-slate-300 bg-white px-2 text-xs font-semibold disabled:opacity-50"
                        >
                          <option value="CASH">CASH (Drawer)</option>
                          <option value="BANK">BANK (Transfer)</option>
                          <option value="CHEQUE">CHEQUE</option>
                          <option value="OTHER">OTHER</option>
                        </select>
                      ) : (
                        <div className="mt-1 text-[11px] font-bold text-amber-800 dark:text-amber-400">
                          {paymentSplits.filter((s) => (parseFloat(s.amount) || 0) > 0).length} split mode(s) selected
                        </div>
                      )}
                    </div>

                    <div>
                      <Label className="text-[10px] uppercase font-bold text-slate-700">Freight / Packing (PKR)</Label>
                      <Input
                        ref={freightRef}
                        type="number"
                        min="0"
                        step="0.01"
                        value={freightCharges}
                        onChange={(e) => setFreightCharges(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            notesRef.current?.focus();
                            notesRef.current?.select();
                          } else if (e.key === "ArrowUp") {
                            e.preventDefault();
                            amountPaidRef.current?.focus();
                            amountPaidRef.current?.select();
                          }
                        }}
                        placeholder="0.00"
                        className="mt-1 h-8 text-xs text-right font-mono"
                      />
                    </div>
                  </div>

                  {/* Multiple Payment Modes Breakdown Panel */}
                  {isSplitPayment && numPaid > 0 && (
                    <div className="mt-2 p-2 bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded space-y-2">
                      <div className="flex items-center justify-between text-[11px] font-bold text-amber-900 dark:text-amber-300">
                        <span>Multiple Payment Allocation</span>
                        {(() => {
                          const splitSum = paymentSplits.reduce((acc, s) => acc + (parseFloat(s.amount) || 0), 0);
                          const isMatched = Math.abs(splitSum - numPaid) < 0.05;
                          return (
                            <span className={isMatched ? "text-emerald-700 dark:text-emerald-400 font-bold" : "text-rose-600 dark:text-rose-400 font-bold"}>
                              Split Total: PKR {splitSum.toFixed(2)} / Paid: PKR {numPaid.toFixed(2)} {isMatched ? "✓" : "(Diff: " + (numPaid - splitSum).toFixed(2) + ")"}
                            </span>
                          );
                        })()}
                      </div>
                      {paymentSplits.map((split, sIdx) => (
                        <div key={sIdx} className="flex items-center gap-1.5">
                          <select
                            value={split.method}
                            onChange={(e) => {
                              const next = [...paymentSplits];
                              next[sIdx].method = e.target.value as any;
                              setPaymentSplits(next);
                            }}
                            className="h-7 w-28 text-xs rounded border border-slate-300 bg-white dark:bg-slate-900 px-1 font-semibold"
                          >
                            <option value="CASH">CASH</option>
                            <option value="BANK">BANK</option>
                            <option value="CHEQUE">CHEQUE</option>
                            <option value="OTHER">OTHER</option>
                          </select>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={split.amount}
                            onChange={(e) => {
                              const next = [...paymentSplits];
                              next[sIdx].amount = e.target.value;
                              setPaymentSplits(next);
                            }}
                            placeholder="Amount"
                            className="h-7 flex-1 text-xs text-right font-mono bg-white dark:bg-slate-900"
                          />
                          <Input
                            type="text"
                            value={split.reference}
                            onChange={(e) => {
                              const next = [...paymentSplits];
                              next[sIdx].reference = e.target.value;
                              setPaymentSplits(next);
                            }}
                            placeholder="Ref / Chq #"
                            className="h-7 w-28 text-xs bg-white dark:bg-slate-900"
                          />
                          {paymentSplits.length > 1 && (
                            <button
                              type="button"
                              onClick={() => setPaymentSplits(paymentSplits.filter((_, i) => i !== sIdx))}
                              className="p-1 text-rose-500 hover:text-rose-700 text-xs"
                              title="Remove split"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      ))}
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setPaymentSplits([...paymentSplits, { method: "BANK", amount: "", reference: "" }])}
                          className="h-6 text-[10px] px-2 border-amber-300 text-amber-900 hover:bg-amber-100 dark:hover:bg-amber-900/40"
                        >
                          + Add Payment Method
                        </Button>
                      </div>
                    </div>
                  )}

                  <div>
                    <Label htmlFor="pnotes" className="text-xs">
                      Supplier Notes / Bill Reference <span className="text-slate-400 font-normal text-xs">(Optional)</span>
                    </Label>
                    <Input
                      ref={notesRef}
                      id="pnotes"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const fakeEv = { preventDefault: () => {} } as React.FormEvent;
                          void handleSubmit(fakeEv);
                        } else if (e.key === "ArrowUp") {
                          e.preventDefault();
                          freightRef.current?.focus();
                          freightRef.current?.select();
                        }
                      }}
                      placeholder="e.g. Mill consignment #442 (press Enter to save)"
                      className="text-xs mt-1"
                    />
                  </div>
                </div>

                {/* 3-Figure Summary Box */}
                <div className="md:col-span-5 rounded-xl bg-amber-50/60 p-3 border border-amber-200/80 space-y-1.5 text-xs font-mono">
                  {/* Physical Totals Readout */}
                  <div className="flex justify-between items-center text-slate-600 border-b border-amber-200/80 pb-1">
                    <span>Physical Totals:</span>
                    <span className="font-bold text-slate-800 text-[11px]">
                      {items.reduce((s, it) => s + (it.quantity || 0), 0).toLocaleString()} pkts •{" "}
                      {items.reduce((s, it) => {
                        const p = products.find((pr) => pr.id === it.productId);
                        const w = (p as any)?.packetWeight || (p as any)?.reamWeight || 0;
                        return s + (it.quantity || 0) * w;
                      }, 0).toFixed(2)} kg{" "}
                      ({(items.reduce((s, it) => {
                        const p = products.find((pr) => pr.id === it.productId);
                        const w = (p as any)?.packetWeight || (p as any)?.reamWeight || 0;
                        return s + (it.quantity || 0) * w;
                      }, 0) / 1000).toFixed(3)} T)
                    </span>
                  </div>

                  <div className="flex justify-between text-slate-600">
                    <span>Subtotal:</span>
                    <span className="font-bold text-slate-900">
                      PKR {invoiceSubtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>

                  {numFreight > 0 && (
                    <div className="flex justify-between text-slate-600">
                      <span>Freight / Packing:</span>
                      <span className="font-bold text-slate-900">
                        PKR {numFreight.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  )}

                  <div className="flex justify-between text-slate-900 border-t border-amber-200 pt-1 font-bold">
                    <span>Total Amount:</span>
                    <span className="text-sm">
                      PKR {invoiceGrandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>

                  <div className="flex justify-between text-slate-600">
                    <span>Amount Paid:</span>
                    <span className="font-bold text-emerald-700">
                      PKR {numPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>

                  <div className="flex justify-between items-center border-t border-amber-200 pt-1 text-sm font-bold">
                    <span>Balance Due:</span>
                    <div className="flex items-center gap-1.5">
                      <span className={balanceDue > 0 ? "text-rose-700" : "text-emerald-700"}>
                        PKR {balanceDue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                      <span
                        className={`text-[9px] px-1.5 py-0.2 rounded font-sans uppercase font-bold ${
                          balanceDue === 0
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {balanceDue === 0 ? "SETTLED" : "OPEN"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

            </form>
      </DocumentWorkspace>

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

      {/* PDF modal removed — using browser print dialog (inline iframe) */}
    </div>
  );
}

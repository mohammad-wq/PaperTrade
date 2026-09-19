"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import {
  Receipt,
  Plus,
  Search,
  FileText,
  Share2,
  AlertCircle,
  CheckCircle2,
  Trash2,
  Clock,
  X,
  Building2,
  UserPlus,
  Banknote,
  Check,
  Boxes,
  ArrowRight,
  Sparkles,
  ShoppingBag,
  Edit,
  Eye,
  Printer,
  ExternalLink,
  Download,
  Truck,
  ShoppingCart,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  listSaleInvoicesAction,
  createSaleInvoiceAction,
  updateSaleInvoiceAction,
} from "@/actions/invoices";
import { listPartiesAction, listInventoryAction } from "@/actions/parties";
import { listProductsAction } from "@/actions/products";
import { listLocationsAction } from "@/actions/orders";
import { listWarehouseLotsAction } from "@/actions/warehouse-lots";
import { format } from "date-fns";
import { useRealtimeListener } from "@/hooks/use-realtime";
import { useConfirm } from "@/components/providers/confirm-provider";

type WarehouseLotOption = {
  id: string;
  locationId: string;
  lotNumber: string;
  description?: string | null;
};

type SaleInvoiceRow = {
  id: string;
  invoiceNo: string;
  date: Date;
  status: string;
  totalAmount: number;
  amountPaid: number;
  balanceDue: number;
  customer: { id: string; name: string; phone: string | null };
  location: { id: string; name: string };
  deliveryOrder?: { id: string; doNo: string } | null;
  financialYear?: { id: string; label: string; isActive?: boolean } | null;
  notes?: string | null;
  items: Array<{
    id: string;
    product: { id: string; productNo: string; name: string; unit: string };
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
};

type PartyOption = {
  id: string;
  name: string;
  type: string;
  balance: number;
  creditLimit: number | null;
  phone?: string | null;
  address?: string | null;
};

type ProductOption = {
  id: string;
  productNo: string;
  name: string;
  unit: string;
  category?: { id: string; name: string } | null;
  retailPrice: number;
  wholesalePrice: number;
};

type StockInfo = {
  productId: string;
  locationId: string;
  available: number;
};

type CommittedLineItem = {
  productId: string;
  productNo: string;
  productName: string;
  categoryName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  availableStock: number;
  warehouseLotId?: string | null;
  lotNumber?: string | null;
};

export default function SalesPage() {
  const confirm = useConfirm();
  const [invoices, setInvoices] = useState<SaleInvoiceRow[]>([]);
  const [parties, setParties] = useState<PartyOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [inventory, setInventory] = useState<StockInfo[]>([]);
  const [dbLocations, setDbLocations] = useState<Array<{ id: string; name: string }>>([]);
  const [warehouseLots, setWarehouseLots] = useState<WarehouseLotOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"OPEN" | "ALL">("OPEN");
  const [yearFilter, setYearFilter] = useState<"CURRENT" | "ALL">("CURRENT");
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Form state - Header
  const [customerType, setCustomerType] = useState<"REGISTERED" | "WALK_IN">("REGISTERED");
  const [customerId, setCustomerId] = useState("");
  const [walkInName, setWalkInName] = useState("Walk-in Customer");
  const [walkInPhone, setWalkInPhone] = useState("");
  const [walkInAddress, setWalkInAddress] = useState("");
  const [saveCustomer, setSaveCustomer] = useState(false);
  const [locationId, setLocationId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  // Pattern 3: Line Items Table State
  const [committedItems, setCommittedItems] = useState<CommittedLineItem[]>([]);

  // Pattern 3: Active Data Entry Row State
  const [activeCodeInput, setActiveCodeInput] = useState("");
  const [matchedProduct, setMatchedProduct] = useState<ProductOption | null>(null);
  const [activeLotId, setActiveLotId] = useState<string>("");
  const [activeQty, setActiveQty] = useState<string>("1");
  const [activeRate, setActiveRate] = useState<string>("0");
  const [activeRowError, setActiveRowError] = useState<string | null>(null);
  const [showTypeahead, setShowTypeahead] = useState(false);
  const [typeaheadIndex, setTypeaheadIndex] = useState<number>(0);

  // Form Settlement State
  const [paidImmediately, setPaidImmediately] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "BANK" | "CHEQUE" | "OTHER">("CASH");
  const [customAmountPaid, setCustomAmountPaid] = useState<string>("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Edit Invoice & Live PDF Preview States
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [showPdfPreviewModal, setShowPdfPreviewModal] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  // References for Keyboard Navigation
  const searchInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const productInputRef = useRef<HTMLInputElement>(null);
  const qtyInputRef = useRef<HTMLInputElement>(null);
  const rateInputRef = useRef<HTMLInputElement>(null);
  const customerSelectRef = useRef<HTMLSelectElement>(null);
  const locationSelectRef = useRef<HTMLSelectElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const amountPaidInputRef = useRef<HTMLInputElement>(null);

  // Load all initial data
  async function loadData(isBackground = false) {
    if (!isBackground) setLoading(true);
    try {
      const [invRes, partyRes, prodRes, stockRes, locRes, lotRes] = await Promise.all([
        listSaleInvoicesAction(),
        listPartiesAction(),
        listProductsAction(),
        listInventoryAction(),
        listLocationsAction(),
        listWarehouseLotsAction(undefined, false),
      ]);

      if (invRes.success && invRes.data) {
        setInvoices(invRes.data as SaleInvoiceRow[]);
      }
      if (partyRes.success && partyRes.data) {
        const partyList = (partyRes.data as PartyOption[]).filter((p) => p.type === "CUSTOMER");
        setParties(partyList);
      }
      if (prodRes.success && prodRes.data) {
        setProducts(prodRes.data as ProductOption[]);
      }
      if (stockRes.success && stockRes.data) {
        const invRows = stockRes.data as Array<{ productId: string; locationId: string; available: number }>;
        setInventory(invRows);
      }
      if (locRes.success && locRes.data) {
        const locs = locRes.data as Array<{ id: string; name: string }>;
        setDbLocations(locs);
        if (locs.length > 0) {
          const shop = locs.find((l) => l.name.toLowerCase() === "shop") ?? locs[0];
          setLocationId((prev) => prev || shop.id);
        }
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

  useRealtimeListener(["sales", "inventory", "parties", "delivery-orders", "payments", "warehouse-lots"], () => {
    void loadData(true);
  });

  // Global keyboard shortcuts
  const handleSaveInvoiceRef = useRef(handleSaveInvoice);
  handleSaveInvoiceRef.current = handleSaveInvoice;
  const handlePreviewPdfRef = useRef(handlePreviewPdf);
  handlePreviewPdfRef.current = handlePreviewPdf;
  const openNewInvoiceDialogRef = useRef(openNewInvoiceDialog);
  openNewInvoiceDialogRef.current = openNewInvoiceDialog;
  const closeInvoiceDialogRef = useRef(closeInvoiceDialog);
  closeInvoiceDialogRef.current = closeInvoiceDialog;

  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      if (e.key === "F2" || e.key === "Insert") {
        e.preventDefault();
        openNewInvoiceDialogRef.current();
        return;
      }
      if (
        e.key === "/" &&
        !isDialogOpen &&
        !(document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if (e.key === "Escape" && isDialogOpen) {
        e.preventDefault();
        closeInvoiceDialogRef.current();
        return;
      }
      // Ctrl+Enter anywhere inside dialog saves the invoice
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && isDialogOpen) {
        e.preventDefault();
        void handleSaveInvoiceRef.current();
        return;
      }
      // Ctrl+P inside dialog triggers live PDF preview
      if ((e.ctrlKey || e.metaKey) && (e.key === "p" || e.key === "P") && isDialogOpen) {
        e.preventDefault();
        void handlePreviewPdfRef.current();
      }
    }
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [isDialogOpen]);

  function getAvailableStock(prodId: string, locId: string) {
    const found = inventory.find((i) => i.productId === prodId && i.locationId === locId);
    return found ? found.available : 0;
  }

  const locationLots = useMemo(
    () => warehouseLots.filter((l) => l.locationId === locationId),
    [warehouseLots, locationId]
  );

  const selectedCustomer = useMemo(
    () => parties.find((p) => p.id === customerId),
    [parties, customerId]
  );

  const invoiceSubtotal = useMemo(
    () => committedItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0),
    [committedItems]
  );

  const totalQuantity = useMemo(
    () => committedItems.reduce((sum, item) => sum + item.quantity, 0),
    [committedItems]
  );

  // Pattern 1: Filtered Invoices across status, financial year, and search query
  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      // 1. Status Filter (default: OPEN)
      if (statusFilter === "OPEN" && (inv.status === "SETTLED" || inv.status === "PAID")) {
        return false;
      }

      // 2. Financial Year Filter (default: CURRENT)
      if (yearFilter === "CURRENT") {
        if (inv.financialYear && inv.financialYear.isActive === false) {
          return false;
        }
      }

      // 3. Search Query
      const q = query.trim().toLowerCase();
      if (!q) return true;

      const invNo = inv.invoiceNo.toLowerCase();
      const custName = inv.customer.name.toLowerCase();
      const phone = inv.customer.phone ? inv.customer.phone.toLowerCase() : "";
      const loc = inv.location.name.toLowerCase();
      const status = inv.status.toLowerCase();
      const itemsMatch = inv.items.some(
        (i) => i.product.productNo.toLowerCase().includes(q) || i.product.name.toLowerCase().includes(q)
      );

      return (
        invNo.includes(q) ||
        custName.includes(q) ||
        phone.includes(q) ||
        loc.includes(q) ||
        status.includes(q) ||
        itemsMatch
      );
    });
  }, [invoices, statusFilter, yearFilter, query]);

  const totalFilteredSales = useMemo(
    () => filteredInvoices.reduce((sum, i) => sum + i.totalAmount, 0),
    [filteredInvoices]
  );

  const totalFilteredBalanceDue = useMemo(
    () => filteredInvoices.reduce((sum, i) => sum + i.balanceDue, 0),
    [filteredInvoices]
  );

  // Pattern 3: Typeahead suggestions for Product Code / Name
  const typeaheadMatches = useMemo(() => {
    const q = activeCodeInput.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter((p) => p.productNo.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [products, activeCodeInput]);

  // Open Invoice Dialog
  function openNewInvoiceDialog() {
    setEditingInvoiceId(null);
    setCommittedItems([]);
    setActiveCodeInput("");
    setMatchedProduct(null);
    setActiveLotId("");
    setActiveQty("1");
    setActiveRate("0");
    setActiveRowError(null);
    setFormError(null);
    setPaidImmediately(true);
    setCustomAmountPaid("");
    setCustomerType("REGISTERED");
    setNotes("");
    setInvoiceDate(new Date().toISOString().slice(0, 10));
    if (parties.length > 0 && !customerId) {
      setCustomerId(parties[0].id);
    }
    setIsDialogOpen(true);

    setTimeout(() => {
      productInputRef.current?.focus();
    }, 100);
  }

  // Open Edit Invoice Dialog
  function openEditInvoiceDialog(inv: SaleInvoiceRow) {
    setEditingInvoiceId(inv.id);
    const isWalkIn = inv.customer.name.toLowerCase().includes("walk-in");
    if (isWalkIn) {
      setCustomerType("WALK_IN");
      setWalkInName(inv.customer.name);
      setWalkInPhone(inv.customer.phone || "");
      setWalkInAddress("");
    } else {
      setCustomerType("REGISTERED");
      setCustomerId(inv.customer.id);
    }
    setLocationId(inv.location.id);
    setInvoiceDate(new Date(inv.date).toISOString().slice(0, 10));
    setNotes(inv.notes || "");

    const items: CommittedLineItem[] = inv.items.map((it) => {
      const prod = products.find((p) => p.id === it.product.id);
      const currStock = getAvailableStock(it.product.id, inv.location.id);
      return {
        productId: it.product.id,
        productNo: it.product.productNo,
        productName: it.product.name,
        categoryName: prod?.category?.name || "",
        unit: it.product.unit,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        availableStock: currStock + it.quantity,
      };
    });

    setCommittedItems(items);
    setActiveCodeInput("");
    setMatchedProduct(null);
    setActiveLotId("");
    setActiveQty("1");
    setActiveRate("0");
    setActiveRowError(null);
    setFormError(null);
    setPaidImmediately(inv.amountPaid > 0);
    setCustomAmountPaid(inv.amountPaid > 0 ? String(inv.amountPaid) : "");
    setIsDialogOpen(true);
  }

  function closeInvoiceDialog() {
    setIsDialogOpen(false);
    setEditingInvoiceId(null);
    setFormError(null);
  }

  // Live pre-posting PDF preview
  async function handlePreviewPdf() {
    if (committedItems.length === 0) {
      setFormError("Add at least one product before previewing.");
      return;
    }
    setPreviewLoading(true);
    try {
      const selectedLocName = dbLocations.find((l) => l.id === locationId)?.name || "Shop";
      let partyName = walkInName || "Customer";
      let partyPhone = walkInPhone || null;
      let partyAddress = walkInAddress || null;

      if (customerType === "REGISTERED" && customerId) {
        const foundCust = parties.find((p) => p.id === customerId);
        if (foundCust) {
          partyName = foundCust.name;
          partyPhone = (foundCust as any).phone || null;
          partyAddress = (foundCust as any).address || null;
        }
      }

      const activeDocNo = editingInvoiceId
        ? invoices.find((i) => i.id === editingInvoiceId)?.invoiceNo || "INV-EDIT"
        : "DRAFT-PREVIEW";

      const payload = {
        type: "sale-invoice",
        docNumber: activeDocNo,
        date: invoiceDate,
        partyName,
        partyPhone,
        partyAddress,
        locationName: selectedLocName,
        totalAmount: invoiceSubtotal,
        amountPaid: paidImmediately
          ? customAmountPaid !== ""
            ? Number(customAmountPaid)
            : invoiceSubtotal
          : 0,
        notes: notes.trim() || null,
        items: committedItems.map((item) => ({
          name: `${item.productNo} - ${item.productName}`,
          specs: item.unit,
          quantity: item.quantity,
          unit: item.unit,
          unitPrice: item.unitPrice,
          lineTotal: item.quantity * item.unitPrice,
        })),
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
      const url = URL.createObjectURL(blob);
      setPdfPreviewUrl(url);
      setShowPdfPreviewModal(true);
    } catch (err: any) {
      await confirm.alert(err.message || "Failed to preview invoice PDF", { variant: "destructive" });
    } finally {
      setPreviewLoading(false);
    }
  }

  // Quick create related DO, PO, or Purchase Invoice with pre-filled items
  function handleCreateRelated(type: "DO" | "PO" | "PURCHASE") {
    const payload = {
      saleInvoiceId: editingInvoiceId || null,
      customerId: customerType === "REGISTERED" ? customerId : null,
      customerName: customerType === "REGISTERED"
        ? parties.find((p) => p.id === customerId)?.name || ""
        : walkInName || "Walk-in Customer",
      locationId: locationId || "",
      items: committedItems.map((item) => ({
        productId: item.productId,
        warehouseLotId: item.warehouseLotId || undefined,
        quantity: item.quantity,
        unit: item.unit,
        unitCost: item.unitPrice,
      })),
    };
    try {
      sessionStorage.setItem("draft_from_invoice", JSON.stringify(payload));
    } catch (e) {
      console.error("Failed to store draft_from_invoice in sessionStorage", e);
    }

    if (type === "DO") {
      window.open("/delivery-orders?action=new&fromInvoice=1", "_blank");
    } else if (type === "PO") {
      window.open("/purchase-orders?action=new&fromInvoice=1", "_blank");
    } else if (type === "PURCHASE") {
      window.open("/purchases?action=new&fromInvoice=1", "_blank");
    }
  }

  // Create Delivery Order directly from an already posted Sale Invoice in table
  function handleCreateDOFromInvoice(inv: SaleInvoiceRow) {
    const payload = {
      saleInvoiceId: inv.id,
      customerId: inv.customer?.id || null,
      customerName: inv.customer?.name || "",
      locationId: inv.location?.id || "",
      items: inv.items.map((item) => ({
        productId: item.product?.id || "",
        quantity: item.quantity,
        unit: item.product?.unit || "",
      })),
    };
    try {
      sessionStorage.setItem("draft_from_invoice", JSON.stringify(payload));
    } catch (e) {
      console.error("Failed to store draft_from_invoice in sessionStorage", e);
    }
    window.open("/delivery-orders?action=new&fromInvoice=1", "_blank");
  }

  // Select product into the active entry row
  function handleSelectProduct(prod: ProductOption) {
    setMatchedProduct(prod);
    setActiveCodeInput(`${prod.productNo} - ${prod.name}`);
    setShowTypeahead(false);
    setActiveRowError(null);

    // Default rate based on retail price
    setActiveRate(String(prod.retailPrice));

    // Focus Quantity input and select text
    setTimeout(() => {
      qtyInputRef.current?.focus();
      qtyInputRef.current?.select();
    }, 50);
  }

  // Match product on Enter in Product No / Name field
  function handleProductInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();

      // If user navigated typeahead dropdown
      if (showTypeahead && typeaheadMatches.length > 0 && typeaheadMatches[typeaheadIndex]) {
        handleSelectProduct(typeaheadMatches[typeaheadIndex]);
        return;
      }

      // Check for exact code match or name match
      const q = activeCodeInput.trim().toLowerCase();
      if (!q) {
        // If row is empty and user presses Enter, jump to settlement / save
        if (committedItems.length > 0) {
          amountPaidInputRef.current?.focus();
          amountPaidInputRef.current?.select();
        }
        return;
      }

      const exact = products.find(
        (p) => p.productNo.toLowerCase() === q || p.name.toLowerCase() === q
      );

      if (exact) {
        handleSelectProduct(exact);
      } else if (typeaheadMatches.length > 0) {
        handleSelectProduct(typeaheadMatches[0]);
      } else {
        // Pattern 3: Show immediate non-disruptive inline error without popup
        setActiveRowError("Product not found. Enter a valid Code or Name.");
        productInputRef.current?.select();
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!showTypeahead && typeaheadMatches.length > 0) setShowTypeahead(true);
      setTypeaheadIndex((prev) => Math.min(prev + 1, typeaheadMatches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setTypeaheadIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Escape") {
      setShowTypeahead(false);
    }
  }

  // Handle Enter on Quantity field
  function handleQtyKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      const qtyNum = parseFloat(activeQty);
      if (isNaN(qtyNum) || qtyNum <= 0) {
        setActiveRowError("Please enter a valid quantity greater than 0.");
        qtyInputRef.current?.select();
        return;
      }
      setActiveRowError(null);
      rateInputRef.current?.focus();
      rateInputRef.current?.select();
    }
  }

  // Pattern 3: Handle Enter on Rate field -> Commits line item and immediately starts fresh empty row!
  function handleRateKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitActiveRow();
    }
  }

  // Commit the active row to the invoice table
  function commitActiveRow() {
    if (!matchedProduct) {
      setActiveRowError("Please select a valid product first.");
      productInputRef.current?.focus();
      return;
    }

    const qtyNum = parseFloat(activeQty);
    if (isNaN(qtyNum) || qtyNum <= 0) {
      setActiveRowError("Quantity must be greater than 0.");
      qtyInputRef.current?.focus();
      return;
    }

    const rateNum = parseFloat(activeRate);
    if (isNaN(rateNum) || rateNum < 0) {
      setActiveRowError("Rate cannot be negative.");
      rateInputRef.current?.focus();
      return;
    }

    const available = locationId ? getAvailableStock(matchedProduct.id, locationId) : 0;
    const matchedLot = activeLotId ? locationLots.find((l) => l.id === activeLotId) : null;

    // Add to committed items list
    setCommittedItems((prev) => [
      ...prev,
      {
        productId: matchedProduct.id,
        productNo: matchedProduct.productNo,
        productName: matchedProduct.name,
        categoryName: matchedProduct.category?.name || "—",
        unit: matchedProduct.unit,
        quantity: qtyNum,
        unitPrice: rateNum,
        availableStock: available,
        warehouseLotId: activeLotId || null,
        lotNumber: matchedLot ? matchedLot.lotNumber : null,
      },
    ]);

    // Reset active row state
    setActiveCodeInput("");
    setMatchedProduct(null);
    setActiveLotId("");
    setActiveQty("1");
    setActiveRate("0");
    setActiveRowError(null);
    setShowTypeahead(false);

    // Immediately focus back to Product Code input for lightning-fast subsequent entries!
    setTimeout(() => {
      productInputRef.current?.focus();
    }, 50);
  }

  // Remove committed row
  function removeCommittedItem(index: number) {
    setCommittedItems((prev) => prev.filter((_, i) => i !== index));
  }

  // Save Full Sale Invoice
  async function handleSaveInvoice() {
    setFormError(null);

    if (committedItems.length === 0) {
      setFormError("Please add at least one line item to the invoice.");
      productInputRef.current?.focus();
      return;
    }

    if (customerType === "REGISTERED" && !customerId) {
      setFormError("Please select a registered customer.");
      customerSelectRef.current?.focus();
      return;
    }

    if (customerType === "WALK_IN" && !walkInName.trim()) {
      setFormError("Walk-in customer name is required.");
      return;
    }

    if (!locationId) {
      setFormError("Please select a dispatch location.");
      locationSelectRef.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const payload: any = {
        customerType,
        locationId,
        date: invoiceDate,
        notes: notes.trim() || undefined,
        items: committedItems.map((item) => ({
          productId: item.productId,
          warehouseLotId: item.warehouseLotId || undefined,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
        paidImmediately,
        paymentMethod: paidImmediately ? paymentMethod : undefined,
        amountPaid: paidImmediately
          ? customAmountPaid !== ""
            ? Number(customAmountPaid)
            : invoiceSubtotal
          : 0,
      };

      if (customerType === "REGISTERED") {
        payload.customerId = customerId;
      } else {
        payload.walkInName = walkInName.trim();
        payload.walkInPhone = walkInPhone.trim() || undefined;
        payload.walkInAddress = walkInAddress.trim() || undefined;
        payload.saveCustomer = saveCustomer;
      }

      let res: any;
      if (editingInvoiceId) {
        payload.id = editingInvoiceId;
        res = await updateSaleInvoiceAction(payload);
      } else {
        res = await createSaleInvoiceAction(payload);
      }

      if (res.success) {
        await loadData(true);
        closeInvoiceDialog();
      } else {
        setFormError(res.error || `Failed to ${editingInvoiceId ? "update" : "create"} sales invoice.`);
      }
    } catch (err: any) {
      setFormError(err?.message || "An unexpected error occurred.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleWhatsAppShare(invoiceId: string) {
    try {
      const response = await fetch("/api/share/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId }),
      });
      const data = await response.json();
      if (data.success && data.whatsappUrl) {
        window.open(data.whatsappUrl, "_blank");
      } else {
        await confirm.alert(data.error || "Could not generate WhatsApp share link", { variant: "destructive" });
      }
    } catch {
      await confirm.alert("Failed to communicate with WhatsApp service", { variant: "destructive" });
    }
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Top Banner: KPI Overview & Primary Action */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-2.5 rounded-md shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 rounded-md">
            <Receipt className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Sales Invoices
            </h1>
            <p className="text-[11px] text-slate-500">
              Counter billing, customer receivables, real-time stock deduction, and ledger posting
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Quick Metrics Bar */}
          <div className="hidden sm:flex items-center gap-2 text-xs mr-2 font-mono">
            <span className="bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 px-2 py-1 rounded">
              Total Sales: <strong>PKR {totalFilteredSales.toLocaleString()}</strong>
            </span>
            <span className="bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800 px-2 py-1 rounded">
              Balance Due: <strong>PKR {totalFilteredBalanceDue.toLocaleString()}</strong>
            </span>
            <span className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-300 px-2 py-1 rounded">
              Invoices: <strong>{filteredInvoices.length}</strong>
            </span>
          </div>

          {/* Primary Action Button: Open Invoice Entry Window */}
          <Button
            onClick={openNewInvoiceDialog}
            className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs px-3"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New Sale Invoice <span className="ml-1.5 text-[10px] opacity-75 font-mono">[F2]</span>
          </Button>
        </div>
      </div>

      {/* Pattern 1: Universal Search Bar with Status & Financial Year Archive Toggles */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2 rounded-md shadow-xs flex flex-col md:flex-row gap-2 items-center justify-between">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <Input
            ref={searchInputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search invoices by number, customer name, phone, dispatch location, or item... (Press / to focus)"
            className="h-8 pl-8 pr-8 text-xs bg-slate-50 dark:bg-slate-950/50 border-slate-300 dark:border-slate-700 font-medium w-full"
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

        {/* Status & Financial Year Archive Toggles */}
        <div className="flex items-center gap-1.5 shrink-0 self-end md:self-auto text-xs">
          <div className="inline-flex rounded-md border border-slate-300 dark:border-slate-700 p-0.5 bg-slate-100 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setStatusFilter("OPEN")}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-all ${
                statusFilter === "OPEN"
                  ? "bg-white dark:bg-slate-900 text-emerald-800 dark:text-emerald-400 shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
            >
              Open Invoices
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("ALL")}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-all ${
                statusFilter === "ALL"
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
            >
              All (inc. Settled)
            </button>
          </div>

          <div className="inline-flex rounded-md border border-slate-300 dark:border-slate-700 p-0.5 bg-slate-100 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setYearFilter("CURRENT")}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-all ${
                yearFilter === "CURRENT"
                  ? "bg-white dark:bg-slate-900 text-emerald-800 dark:text-emerald-400 shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
            >
              Current Year
            </button>
            <button
              type="button"
              onClick={() => setYearFilter("ALL")}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-all ${
                yearFilter === "ALL"
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
            >
              All Years (Archive)
            </button>
          </div>
        </div>
      </div>

      {/* Pattern 1: High-Density Tabular List View for Sales Invoices */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md shadow-xs overflow-hidden">
        <div className="overflow-x-auto max-h-[calc(100vh-230px)]">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700 text-[11px] font-bold uppercase tracking-wider">
              <tr>
                <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap">Invoice #</th>
                <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap">Date</th>
                <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 min-w-[160px]">Customer</th>
                <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap">Type</th>
                <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap">Location</th>
                <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 text-center whitespace-nowrap">Items</th>
                <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap">Total (PKR)</th>
                <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap">Paid (PKR)</th>
                <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap font-bold">Balance Due</th>
                <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 text-center whitespace-nowrap">Status</th>
                <th className="py-2 px-2 text-center whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-slate-500 font-medium">
                    Loading sales invoices...
                  </td>
                </tr>
              ) : filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-slate-500 font-medium">
                    No sales invoices match your search. Press <kbd className="px-1.5 py-0.5 bg-slate-100 border rounded text-[10px]">F2</kbd> to record a sale.
                  </td>
                </tr>
              ) : (
                filteredInvoices.map((inv) => {
                  const isWalkIn =
                    inv.customer.name.toLowerCase().includes("walk-in") ||
                    inv.customer.name.toLowerCase().includes("walk in");

                  return (
                    <tr
                      key={inv.id}
                      className="hover:bg-amber-50/60 dark:hover:bg-slate-800/60 transition-colors even:bg-slate-50/40 dark:even:bg-slate-900/40"
                    >
                      {/* Invoice No */}
                      <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-slate-900 dark:text-slate-100">{inv.invoiceNo}</span>
                          {inv.financialYear && (
                            <span className="text-[9px] px-1 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-mono">
                              {inv.financialYear.label}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Date */}
                      <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono whitespace-nowrap text-slate-600 dark:text-slate-400">
                        {format(new Date(inv.date), "dd/MM/yyyy")}
                      </td>

                      {/* Customer */}
                      <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-medium text-slate-800 dark:text-slate-200">
                        <div className="flex flex-col">
                          <span>{inv.customer.name}</span>
                          {inv.customer.phone && (
                            <span className="text-[10px] text-slate-400 font-mono">{inv.customer.phone}</span>
                          )}
                        </div>
                      </td>

                      {/* Customer Type */}
                      <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 whitespace-nowrap text-[10px]">
                        {isWalkIn ? (
                          <span className="rounded bg-sky-50 text-sky-800 border border-sky-200 px-1.5 py-0.5 font-bold">
                            Walk-in
                          </span>
                        ) : (
                          <span className="rounded bg-slate-100 text-slate-600 px-1.5 py-0.5 font-medium">
                            Registered
                          </span>
                        )}
                      </td>

                      {/* Location */}
                      <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 whitespace-nowrap text-slate-600 dark:text-slate-400">
                        {inv.location.name}
                      </td>

                      {/* Items Count */}
                      <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 text-center font-mono whitespace-nowrap text-slate-600">
                        {inv.items.length}
                      </td>

                      {/* Total Amount */}
                      <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono text-right whitespace-nowrap font-bold text-slate-900 dark:text-slate-100">
                        PKR {inv.totalAmount.toLocaleString()}
                      </td>

                      {/* Paid Amount */}
                      <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono text-right whitespace-nowrap text-emerald-700 dark:text-emerald-400">
                        PKR {inv.amountPaid.toLocaleString()}
                      </td>

                      {/* Balance Due */}
                      <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono text-right whitespace-nowrap font-bold">
                        {inv.balanceDue > 0 ? (
                          <span className="text-rose-700 dark:text-rose-400">
                            PKR {inv.balanceDue.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-emerald-700 dark:text-emerald-400 text-[10px] font-bold">
                            PAID
                          </span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 text-center whitespace-nowrap">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                            inv.status === "SETTLED" || inv.status === "PAID"
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                              : inv.status === "CANCELLED"
                              ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                              : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                          }`}
                        >
                          {inv.status}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-1 px-2 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditInvoiceDialog(inv)}
                            className="h-6 px-1.5 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                            title="Edit Invoice"
                          >
                            <Edit className="h-3 w-3 mr-1" />
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCreateDOFromInvoice(inv)}
                            className="h-6 px-1.5 text-xs text-amber-700 hover:text-amber-800 hover:bg-amber-50 dark:hover:bg-amber-950/40"
                            title="Generate Delivery Order for this Invoice"
                          >
                            <Truck className="h-3 w-3 mr-1" />
                            DO
                          </Button>
                          <Button
                            asChild
                            variant="ghost"
                            size="sm"
                            className="h-6 px-1.5 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                            title="Download PDF"
                          >
                            <a href={`/api/pdf/sale-invoice/${inv.id}`} target="_blank" rel="noreferrer">
                              <FileText className="h-3 w-3 mr-1" />
                              PDF
                            </a>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleWhatsAppShare(inv.id)}
                            className="h-6 px-1.5 text-xs text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                            title="Share via WhatsApp"
                          >
                            <Share2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pattern 3: Rapid Keyboard-Driven Sale Invoice Entry Window */}
      {isDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 overflow-y-auto">
          <div
            ref={dialogRef}
            className="w-[96vw] max-w-6xl bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-700 rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[96vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Title Bar (Desktop Style) */}
            <div className="bg-slate-900 text-slate-100 px-4 py-2 flex items-center justify-between border-b border-slate-800 select-none">
              <div className="flex items-center gap-2">
                <Receipt className="h-4 w-4 text-emerald-400" />
                <span className="font-bold text-xs">
                  {editingInvoiceId
                    ? `Edit Sale Invoice Form - [${invoices.find((i) => i.id === editingInvoiceId)?.invoiceNo || "Invoice"}]`
                    : "Sale Invoice Entry Form - [New Invoice]"}
                </span>
              </div>
              <button
                onClick={closeInvoiceDialog}
                className="rounded text-slate-400 hover:text-white hover:bg-slate-800 p-1 transition-colors"
                title="Close Window (Esc)"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Keyboard Shortcuts & Quick Cross-Document Links Banner */}
            <div className="bg-slate-100 dark:bg-slate-800 px-4 py-1.5 border-b border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-300">
              <div className="flex items-center gap-3 font-mono text-[11px]">
                <span>↵ Enter: Autofill & Advance</span>
                <span>•</span>
                <span>Ctrl+Enter: Save Invoice</span>
                <span>•</span>
                <span>Esc: Close</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase font-bold text-slate-400 mr-1 hidden sm:inline">Create Related:</span>
                <button
                  type="button"
                  onClick={() => handleCreateRelated("DO")}
                  className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-[10px] font-semibold text-slate-700 dark:text-slate-300 hover:text-emerald-700 hover:border-emerald-500 transition-colors inline-flex items-center gap-1"
                  title="Open Delivery Order form with this invoice's items pre-loaded"
                >
                  <Truck className="h-2.5 w-2.5 text-amber-600" />
                  + Delivery Order
                  <ExternalLink className="h-2.5 w-2.5 opacity-60" />
                </button>
                <button
                  type="button"
                  onClick={() => handleCreateRelated("PO")}
                  className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-[10px] font-semibold text-slate-700 dark:text-slate-300 hover:text-emerald-700 hover:border-emerald-500 transition-colors inline-flex items-center gap-1"
                  title="Open Purchase Order form with this invoice's items pre-loaded"
                >
                  <ShoppingCart className="h-2.5 w-2.5 text-sky-600" />
                  + Purchase Order
                  <ExternalLink className="h-2.5 w-2.5 opacity-60" />
                </button>
                <button
                  type="button"
                  onClick={() => handleCreateRelated("PURCHASE")}
                  className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-[10px] font-semibold text-slate-700 dark:text-slate-300 hover:text-emerald-700 hover:border-emerald-500 transition-colors inline-flex items-center gap-1"
                  title="Open Purchase Invoice form with this invoice's items pre-loaded"
                >
                  <Receipt className="h-2.5 w-2.5 text-emerald-600" />
                  + Purchase Invoice
                  <ExternalLink className="h-2.5 w-2.5 opacity-60" />
                </button>
              </div>
            </div>

            {/* Validation Error Banner */}
            {formError && (
              <div className="bg-rose-50 dark:bg-rose-950/50 border-b border-rose-200 dark:border-rose-800 px-4 py-2 flex items-center gap-2 text-xs text-rose-700 dark:text-rose-300">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            {/* Dialog Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs bg-slate-50/50 dark:bg-slate-950/40">
              {/* Header Section: Customer, Location, Date */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 bg-white dark:bg-slate-900 p-3 rounded-md border border-slate-200 dark:border-slate-800">
                {/* Customer Column */}
                <div className="sm:col-span-6 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      Customer <span className="text-rose-500">*</span>
                    </Label>
                    <div className="flex items-center gap-2 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setCustomerType("REGISTERED")}
                        className={`px-2 py-0.5 rounded font-medium transition-colors ${
                          customerType === "REGISTERED"
                            ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                            : "text-slate-500 hover:text-slate-800"
                        }`}
                      >
                        Registered
                      </button>
                      <button
                        type="button"
                        onClick={() => setCustomerType("WALK_IN")}
                        className={`px-2 py-0.5 rounded font-medium transition-colors ${
                          customerType === "WALK_IN"
                            ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                            : "text-slate-500 hover:text-slate-800"
                        }`}
                      >
                        Walk-in
                      </button>
                    </div>
                  </div>

                  {customerType === "REGISTERED" ? (
                    <div>
                      <select
                        ref={customerSelectRef}
                        value={customerId}
                        onChange={(e) => setCustomerId(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            locationSelectRef.current?.focus();
                          }
                        }}
                        className="w-full h-8 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 text-xs font-medium"
                      >
                        <option value="">Select customer from directory...</option>
                        {parties.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} {p.creditLimit ? `(Limit: PKR ${p.creditLimit.toLocaleString()})` : ""}
                          </option>
                        ))}
                      </select>
                      {selectedCustomer && (
                        <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-500">
                          <span>
                            Ledger Balance:{" "}
                            <strong className={selectedCustomer.balance > 0 ? "text-amber-700" : "text-slate-700"}>
                              PKR {selectedCustomer.balance.toLocaleString()}
                            </strong>
                          </span>
                          {selectedCustomer.creditLimit !== null && (
                            <span>
                              | Credit Limit: <strong>PKR {selectedCustomer.creditLimit.toLocaleString()}</strong>
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        value={walkInName}
                        onChange={(e) => setWalkInName(e.target.value)}
                        placeholder="Customer Name *"
                        className="h-8 text-xs bg-white dark:bg-slate-900"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            locationSelectRef.current?.focus();
                          }
                        }}
                      />
                      <Input
                        value={walkInPhone}
                        onChange={(e) => setWalkInPhone(e.target.value)}
                        placeholder="Phone (Optional)"
                        className="h-8 text-xs bg-white dark:bg-slate-900"
                      />
                    </div>
                  )}
                </div>

                {/* Dispatch Location */}
                <div className="sm:col-span-3 space-y-1">
                  <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Dispatch Location <span className="text-rose-500">*</span>
                  </Label>
                  <select
                    ref={locationSelectRef}
                    value={locationId}
                    onChange={(e) => setLocationId(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        dateInputRef.current?.focus();
                      }
                    }}
                    className="w-full h-8 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 text-xs font-medium"
                  >
                    {dbLocations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Invoice Date */}
                <div className="sm:col-span-3 space-y-1">
                  <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Invoice Date <span className="text-rose-500">*</span>
                  </Label>
                  <Input
                    ref={dateInputRef}
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        productInputRef.current?.focus();
                        productInputRef.current?.select();
                      }
                    }}
                    className="h-8 text-xs bg-white dark:bg-slate-900"
                  />
                </div>
              </div>

              {/* Pattern 3: Line Item Entry Area (Table-Like Interface) */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md shadow-xs overflow-hidden">
                <div className="bg-slate-100 dark:bg-slate-800 px-3 py-1.5 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-xs text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                      Invoice Line Items
                    </span>
                    <span className="text-[10px] text-emerald-800 dark:text-emerald-300 font-bold bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800 font-mono">
                      {committedItems.length} items ({totalQuantity} units)
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">
                    Type Code/Name → Enter → Qty → Enter → Rate → Enter to commit
                  </span>
                </div>

                {/* Table of Items */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 text-[10px] font-bold uppercase border-b border-slate-200 dark:border-slate-700">
                      <tr>
                        <th className="py-1.5 px-2 w-8 text-center border-r border-slate-200 dark:border-slate-700">#</th>
                        <th className="py-1.5 px-2 border-r border-slate-200 dark:border-slate-700 min-w-[200px]">Product Code / Name</th>
                        {locationLots.length > 0 && (
                          <th className="py-1.5 px-2 border-r border-slate-200 dark:border-slate-700 w-28 whitespace-nowrap">Lot</th>
                        )}
                        <th className="py-1.5 px-2 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap">Category</th>
                        <th className="py-1.5 px-2 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap text-right">Available Stock</th>
                        <th className="py-1.5 px-2 border-r border-slate-200 dark:border-slate-700 text-center whitespace-nowrap">Unit</th>
                        <th className="py-1.5 px-2 border-r border-slate-200 dark:border-slate-700 w-24 text-right whitespace-nowrap">Quantity</th>
                        <th className="py-1.5 px-2 border-r border-slate-200 dark:border-slate-700 w-28 text-right whitespace-nowrap">Rate (PKR)</th>
                        <th className="py-1.5 px-2 border-r border-slate-200 dark:border-slate-700 w-28 text-right whitespace-nowrap">Total (PKR)</th>
                        <th className="py-1.5 px-2 w-10 text-center">Action</th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
                      {/* Committed Items Rows */}
                      {committedItems.map((item, idx) => {
                        const lineTotal = item.quantity * item.unitPrice;
                        return (
                          <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                            <td className="py-1 px-2 text-center text-slate-400 border-r border-slate-100 dark:border-slate-800">{idx + 1}</td>
                            <td className="py-1 px-2 border-r border-slate-100 dark:border-slate-800 text-slate-800 dark:text-slate-200 font-sans">
                              <span className="font-mono font-bold text-slate-900 dark:text-slate-100 mr-1.5">
                                {item.productNo}
                              </span>
                              <span>{item.productName}</span>
                            </td>
                            {locationLots.length > 0 && (
                              <td className="py-1 px-2 border-r border-slate-100 dark:border-slate-800 text-slate-700 dark:text-slate-300 font-mono text-[11px]">
                                {item.lotNumber ? (
                                  <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border border-blue-200 dark:border-blue-800 font-semibold text-[10px]">
                                    #{item.lotNumber}
                                  </span>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </td>
                            )}
                            <td className="py-1 px-2 border-r border-slate-100 dark:border-slate-800 text-slate-600 dark:text-slate-400 font-sans">
                              {item.categoryName}
                            </td>
                            <td className="py-1 px-2 border-r border-slate-100 dark:border-slate-800 text-right text-slate-600">
                              {item.availableStock}
                            </td>
                            <td className="py-1 px-2 border-r border-slate-100 dark:border-slate-800 text-center text-slate-600 text-[10px]">
                              {item.unit}
                            </td>
                            <td className="py-1 px-2 border-r border-slate-100 dark:border-slate-800 text-right font-bold text-slate-900 dark:text-slate-100">
                              {Number(item.quantity).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                            </td>
                            <td className="py-1 px-2 border-r border-slate-100 dark:border-slate-800 text-right text-slate-700 dark:text-slate-300">
                              {item.unitPrice.toFixed(2)}
                            </td>
                            <td className="py-1 px-2 border-r border-slate-100 dark:border-slate-800 text-right font-bold text-emerald-700 dark:text-emerald-400">
                              {lineTotal.toFixed(2)}
                            </td>
                            <td className="py-1 px-2 text-center">
                              <button
                                type="button"
                                onClick={() => removeCommittedItem(idx)}
                                className="text-slate-400 hover:text-rose-600 p-0.5"
                                title="Remove Line"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}

                      {/* Pattern 3: Active Data Entry Row */}
                      <tr className="bg-amber-50/40 dark:bg-slate-800/80 border-t-2 border-emerald-500/50">
                        {/* Row Index */}
                        <td className="py-1 px-2 text-center text-emerald-700 font-bold border-r border-slate-200 dark:border-slate-700">
                          {committedItems.length + 1}
                        </td>

                        {/* Product Code / Name Lookup Input */}
                        <td className="py-1 px-2 border-r border-slate-200 dark:border-slate-700 relative">
                          <Input
                            ref={productInputRef}
                            value={activeCodeInput}
                            onChange={(e) => {
                              setActiveCodeInput(e.target.value);
                              setShowTypeahead(true);
                              setTypeaheadIndex(0);
                              setActiveRowError(null);
                            }}
                            onKeyDown={handleProductInputKeyDown}
                            placeholder="Type Product Code or Name..."
                            className="h-7 text-xs bg-white dark:bg-slate-900 font-mono font-medium"
                          />

                          {/* Inline Validation Warning on Invalid Code */}
                          {activeRowError && (
                            <p className="text-[10px] text-rose-600 font-sans font-bold mt-0.5 flex items-center gap-1">
                              <AlertCircle className="h-3 w-3 shrink-0" />
                              {activeRowError}
                            </p>
                          )}

                          {/* Autocomplete Dropdown */}
                          {showTypeahead && typeaheadMatches.length > 0 && (
                            <div className="absolute left-2 right-2 top-8 z-30 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded shadow-lg max-h-48 overflow-y-auto font-sans">
                              {typeaheadMatches.map((p, idx) => {
                                const avail = locationId ? getAvailableStock(p.id, locationId) : 0;
                                return (
                                  <div
                                    key={p.id}
                                    onMouseDown={() => handleSelectProduct(p)}
                                    className={`px-2.5 py-1.5 text-xs cursor-pointer flex items-center justify-between ${
                                      idx === typeaheadIndex
                                        ? "bg-emerald-600 text-white"
                                        : "hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200"
                                    }`}
                                  >
                                    <div>
                                      <strong className="font-mono">{p.productNo}</strong> - {p.name}
                                    </div>
                                    <div className="text-[10px] font-mono opacity-90">
                                      Stock: {avail} {p.unit} | Rate: PKR {p.retailPrice}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </td>

                        {/* Lot Selector (if location has lots) */}
                        {locationLots.length > 0 && (
                          <td className="py-1 px-2 border-r border-slate-200 dark:border-slate-700">
                            <select
                              value={activeLotId}
                              onChange={(e) => setActiveLotId(e.target.value)}
                              className="h-7 w-full text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-1 font-mono"
                            >
                              <option value="">No Lot</option>
                              {locationLots.map((lot) => (
                                <option key={lot.id} value={lot.id}>
                                  #{lot.lotNumber}{lot.description ? ` (${lot.description})` : ""}
                                </option>
                              ))}
                            </select>
                          </td>
                        )}

                        {/* Category (Auto-filled) */}
                        <td className="py-1 px-2 border-r border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 font-sans">
                          {matchedProduct?.category?.name || "—"}
                        </td>

                        {/* Available Stock (Live from Inventory) */}
                        <td className="py-1 px-2 border-r border-slate-200 dark:border-slate-700 text-right">
                          {matchedProduct ? (
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                getAvailableStock(matchedProduct.id, locationId) > 0
                                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                                  : "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                              }`}
                            >
                              {getAvailableStock(matchedProduct.id, locationId)} {matchedProduct.unit}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>

                        {/* Unit (Auto-filled) */}
                        <td className="py-1 px-2 border-r border-slate-200 dark:border-slate-700 text-center text-[10px] text-slate-600">
                          {matchedProduct?.unit || "—"}
                        </td>

                        {/* Quantity Input */}
                        <td className="py-1 px-2 border-r border-slate-200 dark:border-slate-700">
                          <Input
                            ref={qtyInputRef}
                            type="number"
                            min="0.0001"
                            step="any"
                            value={activeQty}
                            onChange={(e) => setActiveQty(e.target.value)}
                            onKeyDown={handleQtyKeyDown}
                            className="h-7 text-xs text-right bg-white dark:bg-slate-900 font-mono font-bold"
                          />
                        </td>

                        {/* Rate Input */}
                        <td className="py-1 px-2 border-r border-slate-200 dark:border-slate-700">
                          <Input
                            ref={rateInputRef}
                            type="number"
                            step="0.01"
                            value={activeRate}
                            onChange={(e) => setActiveRate(e.target.value)}
                            onKeyDown={handleRateKeyDown}
                            className="h-7 text-xs text-right bg-white dark:bg-slate-900 font-mono font-bold"
                          />
                        </td>

                        {/* Line Total Calculation */}
                        <td className="py-1 px-2 border-r border-slate-200 dark:border-slate-700 text-right font-bold text-emerald-700 dark:text-emerald-400">
                          {((parseFloat(activeQty) || 0) * (parseFloat(activeRate) || 0)).toFixed(2)}
                        </td>

                        {/* Commit Button */}
                        <td className="py-1 px-2 text-center">
                          <Button
                            type="button"
                            size="sm"
                            onClick={commitActiveRow}
                            className="h-6 px-1.5 text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                            title="Commit line item (Enter)"
                          >
                            + Add
                          </Button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Settlement Section & Summary Totals */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 bg-white dark:bg-slate-900 p-3 rounded-md border border-slate-200 dark:border-slate-800">
                {/* Payment Options */}
                <div className="sm:col-span-7 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="paidImmediately"
                      checked={paidImmediately}
                      onChange={(e) => setPaidImmediately(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <label htmlFor="paidImmediately" className="font-bold text-xs text-slate-800 dark:text-slate-200 cursor-pointer">
                      Settle payment immediately at billing counter
                    </label>
                  </div>

                  {paidImmediately && (
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div>
                        <Label className="text-[10px] uppercase font-bold text-slate-500">Payment Method</Label>
                        <select
                          value={paymentMethod}
                          onChange={(e) => setPaymentMethod(e.target.value as any)}
                          className="w-full mt-1 h-8 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 text-xs font-semibold"
                        >
                          <option value="CASH">CASH (Counter Cash Drawer)</option>
                          <option value="BANK">BANK (Direct Online Transfer)</option>
                          <option value="CHEQUE">CHEQUE</option>
                          <option value="OTHER">OTHER</option>
                        </select>
                      </div>

                      <div>
                        <Label className="text-[10px] uppercase font-bold text-slate-500">Amount Received (PKR)</Label>
                        <Input
                          ref={amountPaidInputRef}
                          type="number"
                          step="0.01"
                          value={customAmountPaid !== "" ? customAmountPaid : invoiceSubtotal}
                          onChange={(e) => setCustomAmountPaid(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void handleSaveInvoice();
                            }
                          }}
                          placeholder={String(invoiceSubtotal)}
                          className="mt-1 h-8 text-xs text-right font-mono font-bold bg-white dark:bg-slate-900"
                        />
                      </div>
                    </div>
                  )}

                  {/* Notes */}
                  <div className="pt-1">
                    <Input
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Invoice notes / remarks (optional)"
                      className="h-7 text-xs bg-slate-50 dark:bg-slate-950/50"
                    />
                  </div>
                </div>

                {/* Subtotal & Balance Due Readout */}
                <div className="sm:col-span-5 bg-slate-50 dark:bg-slate-800/80 p-3 rounded border border-slate-200 dark:border-slate-700 flex flex-col justify-between space-y-1.5 font-mono text-xs">
                  <div className="flex justify-between text-slate-600 dark:text-slate-400">
                    <span>Subtotal:</span>
                    <span className="font-bold text-slate-900 dark:text-slate-100">
                      PKR {invoiceSubtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>

                  <div className="flex justify-between text-slate-600 dark:text-slate-400">
                    <span>Amount Paid:</span>
                    <span className="font-bold text-emerald-700 dark:text-emerald-400">
                      PKR{" "}
                      {paidImmediately
                        ? (customAmountPaid !== "" ? Number(customAmountPaid) : invoiceSubtotal).toLocaleString(
                            undefined,
                            { minimumFractionDigits: 2 }
                          )
                        : "0.00"}
                    </span>
                  </div>

                  <div className="flex justify-between border-t border-slate-200 dark:border-slate-700 pt-1 text-sm font-bold">
                    <span>Balance Due:</span>
                    <span className="text-rose-700 dark:text-rose-400">
                      PKR{" "}
                      {paidImmediately
                        ? Math.max(
                            0,
                            invoiceSubtotal - (customAmountPaid !== "" ? Number(customAmountPaid) : invoiceSubtotal)
                          ).toLocaleString(undefined, { minimumFractionDigits: 2 })
                        : invoiceSubtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Window Footer Action Bar */}
            <div className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-slate-500 font-mono">
                [Ctrl+Enter] Save Invoice  •  [Ctrl+P] Preview PDF  •  [Esc] Cancel
              </span>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handlePreviewPdf}
                  disabled={previewLoading || committedItems.length === 0}
                  className="h-8 text-xs border-emerald-400 text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 gap-1.5"
                  title="Generate & View Live Document PDF"
                >
                  <Eye className="h-3.5 w-3.5 text-emerald-600" />
                  {previewLoading ? "Rendering..." : "Preview PDF"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={closeInvoiceDialog}
                  disabled={submitting}
                  className="h-8 text-xs border-slate-300 dark:border-slate-700"
                >
                  Cancel (Esc)
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSaveInvoice}
                  disabled={submitting || committedItems.length === 0}
                  className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs px-4"
                >
                  <Check className="h-3.5 w-3.5 mr-1.5" />
                  {submitting ? "Posting Invoice..." : editingInvoiceId ? "Update Sale Invoice (Ctrl+Enter)" : "Save Sale Invoice (Ctrl+Enter)"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pre-Posting Live PDF Document Preview Modal */}
      {showPdfPreviewModal && pdfPreviewUrl && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 backdrop-blur-xs p-4">
          <div className="w-full max-w-5xl h-[90vh] bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-700 rounded-lg shadow-2xl flex flex-col overflow-hidden">
            <div className="bg-slate-900 text-slate-100 px-4 py-2 flex items-center justify-between border-b border-slate-800 select-none">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-emerald-400" />
                <span className="font-bold text-xs">Official Document Preview (Pre-Posting)</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const iframe = document.getElementById("pdfPreviewIframe") as HTMLIFrameElement;
                    iframe?.contentWindow?.print();
                  }}
                  className="h-7 text-xs border-slate-700 text-slate-200 hover:bg-slate-800 gap-1"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print
                </Button>
                <a
                  href={pdfPreviewUrl}
                  download={`Invoice-Preview-${new Date().toISOString().slice(0, 10)}.pdf`}
                  className="inline-flex items-center gap-1 h-7 px-2.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded font-medium"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download
                </a>
                <button
                  onClick={() => setShowPdfPreviewModal(false)}
                  className="rounded text-slate-400 hover:text-white hover:bg-slate-800 p-1"
                  title="Close Preview"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 bg-slate-100 dark:bg-slate-950 p-2">
              <iframe
                id="pdfPreviewIframe"
                src={pdfPreviewUrl}
                className="w-full h-full rounded border border-slate-300 dark:border-slate-800 bg-white"
                title="Invoice Preview"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

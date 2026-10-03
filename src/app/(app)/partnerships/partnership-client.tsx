"use client";

import React, { useEffect, useState, useMemo, useRef, useCallback, Fragment } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Warehouse,
  Store,
  DollarSign,
  TrendingUp,
  Receipt,
  ShoppingCart,
  ArrowRightLeft,
  ChevronDown,
  ChevronRight,
  Download,
  Printer,
  Calendar,
  AlertCircle,
  Plus,
  Search,
  Filter,
  Layers,
  FileSpreadsheet,
  X,
  CreditCard,
  Building,
  Trash2,
  ArrowUpRight,
  Scale,
  CheckCircle2,
  Sliders,
  ExternalLink,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getPartnershipHubDataAction,
  adjustSharedWarehouseStockAction,
  deleteSharedWarehouseAdjustmentAction,
  partnershipPurchaseIntakeAction,
} from "@/actions/partnerships";
import { createPaymentAction } from "@/actions/payments";
import { listLocationsAction } from "@/actions/orders";
import { useRealtimeListener } from "@/hooks/use-realtime";
import { useConfirm } from "@/components/providers/confirm-provider";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { handleFormEnterKeyDown } from "@/lib/keyboard-nav";
import { useSession } from "next-auth/react";
import { canPerformAction } from "@/lib/auth/permissions";

export type HubData = {
  partner: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    isPartner?: boolean;
    isBeneficiary: boolean;
    sharedWarehouse: { id: string; name: string } | null;
  };
  metrics: {
    totalInitialCapital: number;
    partnerCapitalInvested: number;
    clientCapitalInvested: number;
    currentStockValuationSharedWarehouse: number;
    currentStockValuationShopPartnerLots: number;
    capitalLiabilityAccrued: number;
    capitalReimbursedToPartner: number;
    unpaidCapitalReimbursement: number;
    totalSalesRevenue: number;
    totalCOGS: number;
    totalRealizedProfit: number;
    netGrossMargin: number;
    partnerProfitShare: number;
    netPayableToPartner: number;
    currentPayableToB?: number;
    totalPurchasedFromB?: number;
    partnershipLedgerBalance: number;
    regularLedgerBalance: number;
    consolidatedLedgerBalance: number;
  };
  productBreakdown: Array<{
    product: { id: string; productNo: string; name: string; unit: string; costPrice: number };
    totalQtyPurchased: number;
    batchPurchaseCost: number;
    totalPurchaseCost: number;
    totalQtySold: number;
    totalSalesRevenue: number;
    totalCostOfSold: number;
    grossMargin: number;
    partnerProfitShare: number;
    remainingInShop: number;
    remainingInSharedWarehouse: number;
    lots: Array<{
      id: string;
      lotNumber: string;
      partnerSharePct: number;
      clientSharePct: number;
      equityBadge: string;
      inwardDate: Date;
      inwardPrice: number;
      qtyReceived: number;
      qtyTransferredToShop: number;
      qtySoldDirect: number;
      qtyRemainingSharedWarehouse: number;
      qtyRemainingInShop: number;
    }>;
  }>;
  settlementLog: Array<{
    id: string;
    date: Date;
    invoiceId: string;
    invoiceNo: string;
    customerName: string;
    productId: string;
    productName: string;
    productNo: string;
    lotNumber: string;
    partnerSharePct: number;
    quantity: number;
    unit: string;
    unitSellingPrice: number;
    unitLotCost: number;
    totalSale: number;
    totalCost: number;
    netMargin: number;
    partnerProfitShare: number;
  }>;
  stockMovedToShop?: Array<{
    id: string;
    date: Date;
    invoiceNo: string;
    productNo: string;
    productName: string;
    lotNumber: string;
    quantity: number;
    unit: string;
    unitCost: number;
    totalCost: number;
    partnerSharePct: number;
    owedToB: number;
  }>;
  partnerPayments?: Array<{
    id: string;
    receiptNo: string;
    date: Date;
    amount: number;
    method: string;
    notes: string | null;
    isPartnership: boolean;
  }>;
  locations?: {
    sharedWarehouse: { id: string; name: string } | null;
    shop: { id: string; name: string } | null;
  };
  allProducts?: Array<{ id: string; productNo: string; name: string; unit: string; costPrice: number }>;
  allSuppliers?: Array<{ id: string; name: string; phone: string | null }>;
  allLots?: Array<{
    id: string;
    lotNumber: string;
    locationId: string;
    locationName: string;
    partnerSharePct: number;
    clientSharePct: number;
    unitCost: number;
  }>;
  recentAdjustments?: Array<{
    id: string;
    date: Date;
    productId: string;
    productNo: string;
    productName: string;
    quantity: number;
    notes: string | null;
    createdByName: string;
  }>;
  purchaseOrders?: Array<{
    id: string;
    orderNo: string;
    date: Date;
    status: string;
    includePricing: boolean;
    locationName: string;
    items: Array<{
      id: string;
      productNo: string;
      productName: string;
      quantity: number;
      unit: string;
      unitCost: number | null;
      destinationLocationName: string | null;
      lotNumber: string | null;
    }>;
    invoices: Array<{
      id: string;
      invoiceNo: string;
      status: string;
      date: Date;
      totalAmount: number;
    }>;
  }>;
  purchaseInvoices?: Array<{
    id: string;
    invoiceNo: string;
    date: Date;
    status: string;
    totalAmount: number;
    paidAmount: number;
    balanceAmount: number;
    purchaseOrderId: string | null;
    items: Array<{
      id: string;
      productNo: string;
      productName: string;
      quantity: number;
      unitCost: number;
      lineTotal: number;
      lotNumber: string | null;
    }>;
  }>;
};

export default function PartnershipClient({
  initialPartners,
  initialPartnerId,
  initialHubData,
}: {
  initialPartners: Array<{
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    isBeneficiary: boolean;
    partnerWarehouse?: { id: string; name: string } | null;
  }>;
  initialPartnerId?: string;
  initialHubData?: HubData | null;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const role = session?.user?.role;
  const permissions = (session?.user as any)?.permissions;

  const canRecordSettlement = !session?.user
    ? false
    : canPerformAction(role!, "partnerships", "update", permissions) ||
      canPerformAction(role!, "payments", "create", permissions);

  const canIntake = !session?.user
    ? false
    : canPerformAction(role!, "partnerships", "create", permissions) ||
      canPerformAction(role!, "purchases", "create", permissions);

  const canPullStock = !session?.user
    ? false
    : canPerformAction(role!, "partnerships", "update", permissions) ||
      canPerformAction(role!, "inventory", "update", permissions);

  const canAdjustStock = !session?.user
    ? false
    : canPerformAction(role!, "partnerships", "update", permissions) ||
      canPerformAction(role!, "inventory", "update", permissions);

  const canDeleteAdjustment = !session?.user
    ? false
    : canPerformAction(role!, "partnerships", "delete", permissions) ||
      canPerformAction(role!, "inventory", "delete", permissions);

  const canCreatePO = !session?.user
    ? false
    : canPerformAction(role!, "purchase-orders", "create", permissions);

  const canCreatePI = !session?.user
    ? false
    : canPerformAction(role!, "purchases", "create", permissions);

  const [partners, setPartners] = useState(initialPartners);
  const [selectedPartnerId, setSelectedPartnerId] = useState(
    initialPartnerId || initialPartners[0]?.id || ""
  );

  const [hubData, setHubData] = useState<HubData | null>(initialHubData || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Date range filters for Sales & Settlement Log
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedLogLotId, setSelectedLogLotId] = useState("all");
  const [selectedLogProductId, setSelectedLogProductId] = useState("all");

  // Product breakdown table filters
  const [productSearch, setProductSearch] = useState("");
  const [filterWarehouseId, setFilterWarehouseId] = useState("all");
  const [filterLotId, setFilterLotId] = useState("all");
  const [showZeroStock, setShowZeroStock] = useState(false);

  // Expanded lots set
  const [expandedProductIds, setExpandedProductIds] = useState<Set<string>>(new Set());
  // Active Tab: Inventory, Settlements, or Orders
  const [activeTab, setActiveTab] = useState<"inventory" | "settlements" | "orders">("inventory");

  // Settlement Payout Modal
  const [showSettlementPayoutModal, setShowSettlementPayoutModal] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState<number>(0);
  const [payoutMethod, setPayoutMethod] = useState<"CASH" | "BANK" | "CHEQUE" | "OTHER">("CASH");
  const [payoutDate, setPayoutDate] = useState(new Date().toISOString().split("T")[0]);
  const [payoutNotes, setPayoutNotes] = useState("");
  const [submittingPayout, setSubmittingPayout] = useState(false);
  const [payoutError, setPayoutError] = useState<string | null>(null);

  // ==========================================
  // MODAL 1: Dedicated Partnership Purchase Intake
  // ==========================================
  const [showIntakeModal, setShowIntakeModal] = useState(false);
  const [intakeSupplierId, setIntakeSupplierId] = useState("");
  const [intakeLocationId, setIntakeLocationId] = useState("");
  const [intakeDate, setIntakeDate] = useState(new Date().toISOString().split("T")[0]);
  const [intakeLotMode, setIntakeLotMode] = useState<"EXISTING" | "NEW">("EXISTING");
  const [intakeSelectedLotId, setIntakeSelectedLotId] = useState("");
  const [intakeLotNumber, setIntakeLotNumber] = useState("");
  const [intakeSplitPreset, setIntakeSplitPreset] = useState<"100_PARTNER" | "50_50" | "75_25" | "CUSTOM">("50_50");
  const [intakePartnerPct, setIntakePartnerPct] = useState(50);
  const [intakeClientPct, setIntakeClientPct] = useState(50);
  const [intakeNotes, setIntakeNotes] = useState("");
  const [intakeItems, setIntakeItems] = useState<Array<{ productId: string; quantity: number; unitCost: number }>>([
    { productId: "", quantity: 100, unitCost: 10 },
  ]);
  const [submittingIntake, setSubmittingIntake] = useState(false);
  const [intakeError, setIntakeError] = useState<string | null>(null);

  // ==========================================
  // MODAL 3: Settlement Statement Modal
  // ==========================================
  const [showSettlementModal, setShowSettlementModal] = useState(false);
  const [statementLotFilter, setStatementLotFilter] = useState("ALL");
  const [statementStartDate, setStatementStartDate] = useState("");
  const [statementEndDate, setStatementEndDate] = useState("");

  // ==========================================
  // MODAL 4: Bulk Shared Warehouse Stock Adjustment
  // ==========================================
  type BulkAdjustItem = {
    id: string;
    productId: string;
    warehouseLotId: string;
    quantity: number;
    direction: "OUT" | "IN";
    mode?: "DELTA" | "TARGET_COUNT";
    targetCount?: number;
  };
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [adjustLocationId, setAdjustLocationId] = useState("");
  const [adjustItems, setAdjustItems] = useState<BulkAdjustItem[]>([]);
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustNotes, setAdjustNotes] = useState("");
  const [adjustDate, setAdjustDate] = useState(new Date().toISOString().split("T")[0]);
  const [submittingAdjust, setSubmittingAdjust] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [locations, setLocations] = useState<Array<{ id: string; name: string; type: string }>>([]);

  const loadHubData = useCallback(async (pId: string, sDate?: string, eDate?: string) => {
    if (!pId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getPartnershipHubDataAction(pId, {
        startDate: sDate || undefined,
        endDate: eDate || undefined,
      });
      if (res.success && res.data) {
        setHubData(res.data as unknown as HubData);
      } else if (!res.success) {
        setError(res.error || "Failed to load partnership data.");
      }
    } catch (err: any) {
      setError(err.message || "An error occurred.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedPartnerId) {
      void loadHubData(selectedPartnerId, startDate, endDate);
    }
  }, [selectedPartnerId, startDate, endDate, loadHubData]);

  // Load locations for adjustment modal
  useEffect(() => {
    listLocationsAction().then((res) => {
      if (res.success && res.data) {
        setLocations(res.data as any);
      }
    });
  }, []);

  useRealtimeListener(["sales", "purchases", "inventory", "stock-movements"], () => {
    if (selectedPartnerId) {
      void loadHubData(selectedPartnerId, startDate, endDate);
    }
  });

  function toggleProductExpand(productId: string) {
    setExpandedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  // ------------------------------------------
  // INTAKE MODAL HANDLERS
  // ------------------------------------------
  function generateNewLotNumber() {
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const dateStr = format(new Date(), "yyyyMMdd");
    return `LOT-B-${dateStr}-${randomSuffix}`;
  }

  function openIntakeModal() {
    setIntakeSupplierId(hubData?.allSuppliers?.[0]?.id || "");
    const whId = hubData?.locations?.sharedWarehouse?.id || locations.find((l) => l.type === "WAREHOUSE")?.id || "";
    setIntakeLocationId(whId);
    setIntakeDate(new Date().toISOString().split("T")[0]);

    const lotsAvailable = (hubData as any)?.existingWarehouseLots || hubData?.allLots || [];
    if (lotsAvailable.length > 0) {
      setIntakeLotMode("EXISTING");
      const firstLot = lotsAvailable[0];
      setIntakeSelectedLotId(firstLot.id);
      setIntakeLotNumber(firstLot.lotNumber);
      const p = firstLot.partnerSharePct != null ? firstLot.partnerSharePct : 50;
      const c = firstLot.clientSharePct != null ? firstLot.clientSharePct : (100 - p);
      setIntakePartnerPct(p);
      setIntakeClientPct(c);
      if (p === 100) setIntakeSplitPreset("100_PARTNER");
      else if (p === 50) setIntakeSplitPreset("50_50");
      else if (p === 75) setIntakeSplitPreset("75_25");
      else setIntakeSplitPreset("CUSTOM");
    } else {
      setIntakeLotMode("NEW");
      setIntakeSelectedLotId("");
      setIntakeLotNumber(generateNewLotNumber());
      setIntakeSplitPreset("50_50");
      setIntakePartnerPct(50);
      setIntakeClientPct(50);
    }

    setIntakeNotes("");
    const firstProd = hubData?.allProducts?.[0];
    setIntakeItems([
      { productId: firstProd?.id || "", quantity: 100, unitCost: firstProd?.costPrice || 10 },
    ]);
    setIntakeError(null);
    setShowIntakeModal(true);
  }

  function handleSelectExistingLot(lotId: string) {
    setIntakeSelectedLotId(lotId);
    const lotsAvailable = (hubData as any)?.existingWarehouseLots || hubData?.allLots || [];
    const found = lotsAvailable.find((l: any) => l.id === lotId);
    if (found) {
      setIntakeLotNumber(found.lotNumber);
      if (found.locationId) setIntakeLocationId(found.locationId);
      const p = found.partnerSharePct != null ? found.partnerSharePct : 50;
      const c = found.clientSharePct != null ? found.clientSharePct : (100 - p);
      setIntakePartnerPct(p);
      setIntakeClientPct(c);
      if (p === 100) setIntakeSplitPreset("100_PARTNER");
      else if (p === 50) setIntakeSplitPreset("50_50");
      else if (p === 75) setIntakeSplitPreset("75_25");
      else setIntakeSplitPreset("CUSTOM");
    }
  }

  function handleSplitPresetChange(preset: "100_PARTNER" | "50_50" | "75_25" | "CUSTOM") {
    setIntakeSplitPreset(preset);
    if (preset === "100_PARTNER") {
      setIntakePartnerPct(100);
      setIntakeClientPct(0);
    } else if (preset === "50_50") {
      setIntakePartnerPct(50);
      setIntakeClientPct(50);
    } else if (preset === "75_25") {
      setIntakePartnerPct(75);
      setIntakeClientPct(25);
    }
  }

  function addIntakeItem() {
    const firstProd = hubData?.allProducts?.[0];
    setIntakeItems((prev) => [
      ...prev,
      { productId: firstProd?.id || "", quantity: 50, unitCost: firstProd?.costPrice || 10 },
    ]);
  }

  function removeIntakeItem(index: number) {
    setIntakeItems((prev) => prev.filter((_, i) => i !== index));
  }

  function updateIntakeItem(index: number, field: "productId" | "quantity" | "unitCost", value: any) {
    setIntakeItems((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      if (field === "productId") {
        const prod = hubData?.allProducts?.find((p) => p.id === value);
        if (prod && copy[index].unitCost <= 0) {
          copy[index].unitCost = prod.costPrice;
        }
      }
      return copy;
    });
  }

  const intakeTotalAmount = useMemo(() => {
    return intakeItems.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unitCost) || 0), 0);
  }, [intakeItems]);

  const intakePartnerCapital = useMemo(() => {
    return intakeTotalAmount * (intakePartnerPct / 100);
  }, [intakeTotalAmount, intakePartnerPct]);

  const intakeClientCapital = useMemo(() => {
    return intakeTotalAmount * (intakeClientPct / 100);
  }, [intakeTotalAmount, intakeClientPct]);

  async function handleIntakeSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIntakeError(null);
    if (!selectedPartnerId || !intakeSupplierId || !intakeLotNumber.trim() || intakeItems.length === 0) {
      setIntakeError("Please fill in all mandatory fields and at least one item.");
      return;
    }
    if (intakePartnerPct + intakeClientPct !== 100) {
      setIntakeError("Partner share and Client share must total exactly 100%.");
      return;
    }
    for (const item of intakeItems) {
      if (!item.productId || item.quantity <= 0 || item.unitCost < 0) {
        setIntakeError("All line items must have a valid product, quantity > 0, and non-negative unit cost.");
        return;
      }
    }

    setSubmittingIntake(true);
    try {
      const res = await partnershipPurchaseIntakeAction({
        partnerId: selectedPartnerId,
        supplierId: intakeSupplierId,
        destinationLocationId: intakeLocationId || undefined,
        lotNumber: intakeLotNumber.trim(),
        date: new Date(intakeDate),
        partnerSharePct: intakePartnerPct,
        clientSharePct: intakeClientPct,
        notes: intakeNotes.trim() || undefined,
        items: intakeItems.map((it) => ({
          productId: it.productId,
          quantity: Number(it.quantity),
          unitCost: Number(it.unitCost),
        })),
      });

      if (res.success) {
        setShowIntakeModal(false);
        await loadHubData(selectedPartnerId, startDate, endDate);
        await confirm.alert(
          `Partnership Intake posted successfully! Lot ${res.data?.lotNumber} created in Shared Warehouse with ${intakePartnerPct}% Partner / ${intakeClientPct}% Client split.`,
          { variant: "default" }
        );
      } else {
        setIntakeError(res.error || "Failed to post partnership intake.");
      }
    } catch (err: any) {
      setIntakeError(err.message || "An unexpected error occurred.");
    } finally {
      setSubmittingIntake(false);
    }
  }


  // ------------------------------------------
  // SETTLEMENT STATEMENT MODAL HANDLERS
  // ------------------------------------------
  function openSettlementModal() {
    setStatementLotFilter("ALL");
    setStatementStartDate(startDate);
    setStatementEndDate(endDate);
    setShowSettlementModal(true);
  }

  const statementData = useMemo(() => {
    const rawMoved = hubData?.stockMovedToShop || [];
    const rawSales = hubData?.settlementLog || [];
    const rawPayments = hubData?.partnerPayments || [];

    const filteredMoved = rawMoved.filter((m) => {
      if (statementLotFilter !== "ALL" && m.lotNumber !== statementLotFilter) return false;
      if (statementStartDate && new Date(m.date) < new Date(statementStartDate)) return false;
      if (statementEndDate && new Date(m.date) > new Date(`${statementEndDate}T23:59:59`)) return false;
      return true;
    });

    const filteredSales = rawSales.filter((s) => {
      if (statementLotFilter !== "ALL" && s.lotNumber !== statementLotFilter) return false;
      if (statementStartDate && new Date(s.date) < new Date(statementStartDate)) return false;
      if (statementEndDate && new Date(s.date) > new Date(`${statementEndDate}T23:59:59`)) return false;
      return true;
    });

    const filteredPayments = rawPayments.filter((p) => {
      if (statementStartDate && new Date(p.date) < new Date(statementStartDate)) return false;
      if (statementEndDate && new Date(p.date) > new Date(`${statementEndDate}T23:59:59`)) return false;
      return true;
    });

    const totalStockPulledValuation = filteredMoved.reduce((sum, m) => sum + m.totalCost, 0);
    const totalCapitalOwedToB = filteredMoved.reduce((sum, m) => sum + m.owedToB, 0);
    const totalSalesRevenue = filteredSales.reduce((sum, s) => sum + s.totalSale, 0);
    const totalCOGS = filteredSales.reduce((sum, s) => sum + s.totalCost, 0);
    const totalGrossProfit = totalSalesRevenue - totalCOGS;
    const totalPartnerProfitShare = filteredSales.reduce((sum, s) => sum + s.partnerProfitShare, 0);
    const totalPaymentsToB = filteredPayments.reduce((sum, p) => sum + p.amount, 0);

    const netPayableBalance = totalCapitalOwedToB + totalPartnerProfitShare - totalPaymentsToB;

    return {
      filteredMoved,
      filteredSales,
      filteredPayments,
      totalStockPulledValuation,
      totalCapitalOwedToB,
      totalSalesRevenue,
      totalCOGS,
      totalGrossProfit,
      totalPartnerProfitShare,
      totalPaymentsToB,
      netPayableBalance,
    };
  }, [
    hubData?.stockMovedToShop,
    hubData?.settlementLog,
    hubData?.partnerPayments,
    statementLotFilter,
    statementStartDate,
    statementEndDate,
  ]);

  function exportSettlementStatementCsv() {
    const rows: string[][] = [];
    rows.push(["PARTNERSHIP SETTLEMENT STATEMENT"]);
    rows.push([`Partner: ${hubData?.partner.name}`]);
    rows.push([`Lot Filter: ${statementLotFilter}`]);
    rows.push([`Date Generated: ${new Date().toLocaleString()}`]);
    rows.push([]);

    rows.push(["--- 1. STOCK MOVED TO SHOP & CAPITAL OWED TO B ---"]);
    rows.push(["Date", "Invoice No", "Lot", "Product", "Qty", "Unit Cost", "Shop Valuation", "Partner Share %", "Capital Owed to B"]);
    statementData.filteredMoved.forEach((m) => {
      rows.push([
        format(new Date(m.date), "yyyy-MM-dd"),
        m.invoiceNo,
        m.lotNumber,
        `"${m.productName}"`,
        String(m.quantity),
        m.unitCost.toFixed(2),
        m.totalCost.toFixed(2),
        `${m.partnerSharePct}%`,
        m.owedToB.toFixed(2),
      ]);
    });
    rows.push(["", "", "", "", "", "", "Total Capital Owed to B:", "", statementData.totalCapitalOwedToB.toFixed(2)]);
    rows.push([]);

    rows.push(["--- 2. DIRECT SALES MARGINS & B's SHARE OF PROFITS ---"]);
    rows.push(["Date", "Sale Invoice #", "Customer", "Product", "Lot", "Qty", "Sale Price", "Lot Cost", "Total Sale", "Total Cost", "Margin", "Partner Share %", "B Profit Share"]);
    statementData.filteredSales.forEach((s) => {
      rows.push([
        format(new Date(s.date), "yyyy-MM-dd"),
        s.invoiceNo,
        `"${s.customerName}"`,
        `"${s.productName}"`,
        s.lotNumber,
        String(s.quantity),
        s.unitSellingPrice.toFixed(2),
        s.unitLotCost.toFixed(2),
        s.totalSale.toFixed(2),
        s.totalCost.toFixed(2),
        s.netMargin.toFixed(2),
        `${s.partnerSharePct}%`,
        s.partnerProfitShare.toFixed(2),
      ]);
    });
    rows.push(["", "", "", "", "", "", "", "", "Total Revenue:", statementData.totalSalesRevenue.toFixed(2), "Total Profit Share:", "", statementData.totalPartnerProfitShare.toFixed(2)]);
    rows.push([]);

    rows.push(["--- 3. PAYMENTS RECORDED FROM A TO B ---"]);
    rows.push(["Date", "Receipt #", "Method", "Amount Paid"]);
    statementData.filteredPayments.forEach((p) => {
      rows.push([
        format(new Date(p.date), "yyyy-MM-dd"),
        p.receiptNo,
        p.method,
        p.amount.toFixed(2),
      ]);
    });
    rows.push(["", "", "Total Payments Paid:", statementData.totalPaymentsToB.toFixed(2)]);
    rows.push([]);

    rows.push(["--- 4. NET SETTLEMENT SUMMARY ---"]);
    rows.push(["Capital Liability Owed to B", statementData.totalCapitalOwedToB.toFixed(2)]);
    rows.push(["Partner Profit Share", statementData.totalPartnerProfitShare.toFixed(2)]);
    rows.push(["Less Payments Already Made", statementData.totalPaymentsToB.toFixed(2)]);
    rows.push(["Net Balance Outstanding", statementData.netPayableBalance.toFixed(2)]);

    const csvContent = "data:text/csv;charset=utf-8," + rows.map((r) => r.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute(
      "download",
      `settlement-statement-${hubData?.partner.name.replace(/\s+/g, "_")}-${format(new Date(), "yyyyMMdd")}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // ------------------------------------------
  // ------------------------------------------
  // ADJUSTMENT MODAL HANDLERS
  // ------------------------------------------
  function openAdjustModalForProduct(prodId?: string, lotId?: string) {
    const lotObj = lotId ? hubData?.allLots?.find((l) => l.id === lotId) : null;
    const filteredWarehouse = locations.find(
      (location) => location.id === filterWarehouseId && location.type === "WAREHOUSE",
    );
    const namedPartnerWarehouse = locations.find(
      (location) =>
        location.type === "WAREHOUSE" &&
        (location.name.toLowerCase().includes("partner") || location.name.toLowerCase().includes("shared")),
    );
    const chosenWh =
      lotObj?.locationId ||
      (filterWarehouseId !== "all" ? filteredWarehouse?.id : undefined) ||
      hubData?.locations?.sharedWarehouse?.id ||
      selectedPartner?.partnerWarehouse?.id ||
      namedPartnerWarehouse?.id ||
      "";

    setAdjustLocationId(chosenWh);
    setAdjustDate(new Date().toISOString().split("T")[0]);
    setAdjustReason("Direct physical stock adjustment / balance count");
    setAdjustNotes("");
    setAdjustError(null);

    const initialProdId = prodId || hubData?.productBreakdown?.[0]?.product.id || hubData?.allProducts?.[0]?.id || "";
    const prodEntry = hubData?.productBreakdown?.find((p) => p.product.id === initialProdId);
    const firstLocationLot = hubData?.allLots?.find((lot) => lot.locationId === chosenWh);
    const initialLotId = lotId || firstLocationLot?.id || "";
    const initialLot = prodEntry?.lots?.find((l) => l.id === initialLotId);
    const initialAvail = initialLot ? initialLot.qtyRemainingSharedWarehouse : (prodEntry?.remainingInSharedWarehouse ?? 0);

    setAdjustItems([
      {
        id: Math.random().toString(),
        productId: initialProdId,
        warehouseLotId: initialLotId,
        mode: "DELTA",
        direction: "IN",
        quantity: 1,
        targetCount: initialAvail,
      },
    ]);
    setShowAdjustModal(true);
  }

  function addAdjustItem() {
    const defaultProd = hubData?.productBreakdown?.[0]?.product.id || hubData?.allProducts?.[0]?.id || "";
    const prodEntry = hubData?.productBreakdown?.find((p) => p.product.id === defaultProd);
    const defaultLot = hubData?.allLots?.find((lot) => lot.locationId === adjustLocationId)?.id || "";
    const defaultLotObj = prodEntry?.lots?.find((l) => l.id === defaultLot);
    const defaultAvail = defaultLotObj ? defaultLotObj.qtyRemainingSharedWarehouse : (prodEntry?.remainingInSharedWarehouse ?? 0);

    setAdjustItems((prev) => [
      ...prev,
      {
        id: Math.random().toString(),
        productId: defaultProd,
        warehouseLotId: defaultLot,
        mode: "DELTA",
        direction: "IN",
        quantity: 1,
        targetCount: defaultAvail,
      },
    ]);
  }

  function removeAdjustItem(index: number) {
    setAdjustItems((prev) => prev.filter((_, i) => i !== index));
  }

  function updateAdjustItem(index: number, field: keyof BulkAdjustItem, value: any) {
    setAdjustItems((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      if (field === "productId") {
        const prodEntry = hubData?.productBreakdown?.find((p) => p.product.id === value);
        const firstLot = hubData?.allLots?.find((lot) => lot.locationId === adjustLocationId);
        copy[index].warehouseLotId = firstLot?.id || "";
        const avail = prodEntry?.lots?.find((lot) => lot.id === firstLot?.id)?.qtyRemainingSharedWarehouse ?? 0;
        copy[index].targetCount = avail;
      }
      if (field === "warehouseLotId") {
        const prodEntry = hubData?.productBreakdown?.find((p) => p.product.id === copy[index].productId);
        const selLot = prodEntry?.lots?.find((l) => l.id === value);
        const avail = selLot?.qtyRemainingSharedWarehouse ?? 0;
        copy[index].targetCount = avail;
      }
      return copy;
    });
  }

  function handleAdjustLocationChange(locationId: string) {
    setAdjustLocationId(locationId);
    const locationLotIds = new Set(
      hubData?.allLots?.filter((lot) => lot.locationId === locationId).map((lot) => lot.id) || [],
    );
    setAdjustItems((items) =>
      items.map((item) => ({
        ...item,
        warehouseLotId: locationLotIds.has(item.warehouseLotId)
          ? item.warehouseLotId
          : hubData?.allLots?.find((lot) => lot.locationId === locationId)?.id || "",
      })),
    );
  }

  async function handleAdjustSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAdjustError(null);
    if (!selectedPartnerId || !adjustLocationId || !adjustReason.trim()) {
      setAdjustError("Please specify warehouse location and a mandatory adjustment reason.");
      return;
    }
    if (adjustItems.length === 0) {
      setAdjustError("Please add at least one product item to adjust.");
      return;
    }

    const normalizedItems: Array<{
      productId: string;
      warehouseLotId?: string;
      quantity: number;
      direction: "OUT" | "IN";
    }> = [];

    for (const it of adjustItems) {
      if (!it.productId) {
        setAdjustError("All adjustment items must have a valid product selected.");
        return;
      }
      const prodEntry = hubData?.productBreakdown.find((p) => p.product.id === it.productId);
      const selectedLot = prodEntry?.lots?.find((l) => l.id === it.warehouseLotId);
      const currentAvail = selectedLot ? selectedLot.qtyRemainingSharedWarehouse : (prodEntry?.remainingInSharedWarehouse ?? 0);

      let finalDirection: "OUT" | "IN" = it.direction || "IN";
      let finalQuantity: number = Number(it.quantity) || 0;

      if (it.mode === "TARGET_COUNT") {
        const target = Number(it.targetCount);
        if (isNaN(target) || target < 0) {
          setAdjustError(`Target final count must be a non-negative number for ${prodEntry?.product.name || "item"}.`);
          return;
        }
        const delta = target - currentAvail;
        if (delta === 0) {
          setAdjustError(`Target final count (${target}) matches the current on-hand count for ${prodEntry?.product.name || "item"}. No adjustment needed.`);
          return;
        }
        finalDirection = delta > 0 ? "IN" : "OUT";
        finalQuantity = Math.abs(delta);
      } else {
        if (finalQuantity <= 0) {
          setAdjustError("All adjustment delta quantities must be greater than 0.");
          return;
        }
      }

      normalizedItems.push({
        productId: it.productId,
        warehouseLotId: it.warehouseLotId || undefined,
        quantity: finalQuantity,
        direction: finalDirection,
      });
    }

    setSubmittingAdjust(true);
    try {
      const res = await adjustSharedWarehouseStockAction({
        partnerId: selectedPartnerId,
        locationId: adjustLocationId,
        reason: adjustReason.trim(),
        notes: adjustNotes.trim() || undefined,
        date: new Date(adjustDate),
        items: normalizedItems,
      });

      if (res.success) {
        setShowAdjustModal(false);
        await loadHubData(selectedPartnerId, startDate, endDate);
        await confirm.alert(
          `Adjustment completed successfully! Updated ${res.data?.movementCount || normalizedItems.length} stock movement(s) in ${locations.find((l) => l.id === adjustLocationId)?.name || "Warehouse"}.`,
          { variant: "default" }
        );
      } else {
        setAdjustError(res.error || "Failed to adjust shared warehouse stock.");
      }
    } catch (err: any) {
      setAdjustError(err.message || "An unexpected error occurred.");
    } finally {
      setSubmittingAdjust(false);
    }
  }

  async function handleDeleteAdjustment(adjustmentId: string, label: string) {
    const ok = await confirm({
      title: "Revert Warehouse Adjustment",
      description: `Are you sure you want to revert and delete this adjustment: "${label}"? This will reverse the stock balance change in the warehouse.`,
      confirmText: "Revert Adjustment",
      variant: "destructive",
    });
    if (!ok) return;

    try {
      const res = await deleteSharedWarehouseAdjustmentAction({ id: adjustmentId });
      if (res.success) {
        await loadHubData(selectedPartnerId, startDate, endDate);
      } else {
        await confirm.alert(res.error || "Failed to revert adjustment.", { variant: "destructive" });
      }
    } catch (err: any) {
      await confirm.alert(err.message || "An error occurred.", { variant: "destructive" });
    }
  }

  // Available warehouses holding this partner's stock
  const partnerWarehouses = useMemo(() => {
    if (!hubData?.allLots) return [];
    const map = new Map<string, string>();
    if (hubData.locations?.sharedWarehouse) {
      map.set(hubData.locations.sharedWarehouse.id, hubData.locations.sharedWarehouse.name);
    }
    for (const lot of hubData.allLots) {
      if (lot.locationId && lot.locationName) {
        map.set(lot.locationId, lot.locationName);
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [hubData]);

  // Available lots for dropdown
  const partnerLots = useMemo(() => {
    return hubData?.allLots || [];
  }, [hubData]);

  // Filtered Product Breakdown list
  const filteredProducts = useMemo(() => {
    if (!hubData?.productBreakdown) return [];
    let list = hubData.productBreakdown;

    // Table-level Warehouse filter
    if (filterWarehouseId !== "all") {
      list = list
        .map((item) => {
          const matchingLots = item.lots.filter((lot) => {
            const lotObj = hubData.allLots?.find((l) => l.id === lot.id);
            return lotObj?.locationId === filterWarehouseId;
          });
          if (matchingLots.length === 0) return null;
          return {
            ...item,
            lots: matchingLots,
          };
        })
        .filter(Boolean) as typeof list;
    }

    // Table-level Lot filter
    if (filterLotId !== "all") {
      list = list
        .map((item) => {
          const matchingLots = item.lots.filter((lot) => lot.id === filterLotId);
          if (matchingLots.length === 0) return null;
          return {
            ...item,
            lots: matchingLots,
          };
        })
        .filter(Boolean) as typeof list;
    }

    // Filter Zero Stock: by default only list products where active balance > 0
    if (!showZeroStock) {
      list = list.filter((item) => {
        const totalRemaining = (item.remainingInShop || 0) + (item.remainingInSharedWarehouse || 0);
        return totalRemaining > 0;
      });
    }

    if (productSearch.trim()) {
      const q = productSearch.toLowerCase();
      list = list.filter(
        (item) =>
          item.product.name.toLowerCase().includes(q) ||
          item.product.productNo.toLowerCase().includes(q) ||
          item.lots.some((l) => l.lotNumber.toLowerCase().includes(q))
      );
    }

    return list;
  }, [hubData?.productBreakdown, hubData?.allLots, productSearch, filterWarehouseId, filterLotId, showZeroStock]);

  const filteredSettlementLog = useMemo(() => {
    let list = hubData?.settlementLog || [];
    if (selectedLogLotId !== "all") {
      const lotObj = partnerLots.find((l) => l.id === selectedLogLotId);
      const targetLotNumber = lotObj?.lotNumber;
      list = list.filter((log) => log.lotNumber === targetLotNumber || log.lotNumber === selectedLogLotId);
    }
    if (selectedLogProductId !== "all") {
      list = list.filter((log) => log.productId === selectedLogProductId);
    }
    return list;
  }, [hubData?.settlementLog, selectedLogLotId, selectedLogProductId, partnerLots]);

  const logTotals = useMemo(() => {
    const totalSales = filteredSettlementLog.reduce((s, it) => s + (it.totalSale || 0), 0);
    const totalCOGS = filteredSettlementLog.reduce((s, it) => s + (it.totalCost || 0), 0);
    const totalMargin = filteredSettlementLog.reduce((s, it) => s + (it.netMargin || 0), 0);
    const totalBProfit = filteredSettlementLog.reduce((s, it) => s + (it.partnerProfitShare || 0), 0);
    return { totalSales, totalCOGS, totalMargin, totalBProfit };
  }, [filteredSettlementLog]);

  function openSettlementPayoutModal() {
    const suggested = Math.max(0, hubData?.metrics?.netPayableToPartner || 0);
    setPayoutAmount(suggested);
    setPayoutDate(new Date().toISOString().split("T")[0]);
    setPayoutNotes(`Partnership Settlement Payout for ${hubData?.partner.name || "Partner"}`);
    setPayoutError(null);
    setShowSettlementPayoutModal(true);
  }

  async function handleRecordSettlementPayout() {
    if (!selectedPartnerId || payoutAmount <= 0) {
      setPayoutError("Please enter a valid payout amount.");
      return;
    }
    setSubmittingPayout(true);
    setPayoutError(null);
    try {
      const res = await createPaymentAction({
        partyId: selectedPartnerId,
        direction: "OUT",
        amount: payoutAmount,
        method: payoutMethod,
        date: new Date(payoutDate),
        isPartnership: true,
        partnershipId: selectedPartnerId,
        notes: payoutNotes.trim() || `Partnership Settlement Payout for ${hubData?.partner.name}`,
        autoAllocate: true,
      });

      if (res.success) {
        setShowSettlementPayoutModal(false);
        setPayoutNotes("");
        await confirm.alert("Settlement payment recorded successfully.", { variant: "default" });
        await loadHubData(selectedPartnerId, startDate, endDate);
      } else {
        setPayoutError(res.error || "Failed to record payment.");
      }
    } catch (e: any) {
      setPayoutError(e.message || "An error occurred.");
    } finally {
      setSubmittingPayout(false);
    }
  }

  const selectedPartner = partners.find((p) => p.id === selectedPartnerId);

  return (
    <div className="space-y-6 p-4 sm:p-6 print:p-0 print:space-y-4">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4 print:border-none">
        <div>
          <div className="flex items-center gap-2">
            <Warehouse className="h-6 w-6 text-amber-700 dark:text-amber-500" />
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-slate-100 tracking-tight">
              Partnership Hub & Equity Accounts
            </h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Bulk stock co-ownership, dynamic equity splits, isolated ledger tracking, and multi-lot profit settlements.
          </p>
        </div>

        {/* Partner Selector & Primary Actions */}
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <div className="flex items-center gap-1.5 bg-amber-50 dark:bg-amber-950/40 p-1.5 rounded-lg border border-amber-200 dark:border-amber-800">
            <span className="text-xs font-bold text-amber-900 dark:text-amber-200">Partner:</span>
            <select
              value={selectedPartnerId}
              onChange={(e) => {
                setSelectedPartnerId(e.target.value);
                router.replace(`/partnerships?partnerId=${e.target.value}`);
              }}
              className="h-8 rounded-md border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 px-3 text-xs font-bold text-slate-900 dark:text-slate-100"
            >
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.isBeneficiary ? "★ (Partner B)" : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Action 0: Record Partner Settlement Payout */}
          {canRecordSettlement && (
            <Button
              size="sm"
              onClick={openSettlementPayoutModal}
              className="bg-emerald-700 hover:bg-emerald-800 text-white text-xs gap-1.5 h-8 font-bold shadow-xs"
              title="Record a settlement payment to Person B directly isolated in their partnership ledger"
            >
              <DollarSign className="h-3.5 w-3.5" />
              Record Settlement Payment
            </Button>
          )}

          {/* Action 1: Dedicated Purchase Intake */}
          {canIntake && (
            <Button
              size="sm"
              onClick={openIntakeModal}
              className="bg-amber-700 hover:bg-amber-800 text-white text-xs gap-1.5 h-8 font-bold shadow-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              Partnership Intake
            </Button>
          )}



          {/* Action 3: Generate Settlement Statement */}
          <Button
            variant="outline"
            size="sm"
            onClick={openSettlementModal}
            className="border-slate-300 dark:border-slate-700 text-xs gap-1.5 h-8 font-bold shadow-xs hover:bg-slate-50"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />
            Settlement Statement
          </Button>

          {/* Action 4: Warehouse Stock Adjustment */}
          {canAdjustStock && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => openAdjustModalForProduct()}
              className="text-xs gap-1.5 h-8 font-medium text-amber-900 border-amber-300 dark:border-amber-800 hover:bg-amber-50"
            >
              <Sliders className="h-3.5 w-3.5" />
              Direct WH Adjustment
            </Button>
          )}

          {/* Quick Create PO & PI for Partnership */}
          {canCreatePO && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`/purchase-orders?partnerId=${selectedPartnerId}&action=new`)}
              className="border-slate-300 dark:border-slate-700 text-xs gap-1.5 h-8 font-bold text-slate-800 dark:text-slate-200 shadow-xs hover:bg-slate-50 dark:hover:bg-slate-800"
              title="Create Purchase Order for this Partner"
            >
              <ShoppingCart className="h-3.5 w-3.5 text-blue-600" />
              + New Shared PO
            </Button>
          )}

          {canCreatePI && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`/purchases?partnerId=${selectedPartnerId}&action=new`)}
              className="border-slate-300 dark:border-slate-700 text-xs gap-1.5 h-8 font-bold text-slate-800 dark:text-slate-200 shadow-xs hover:bg-slate-50 dark:hover:bg-slate-800"
              title="Create Purchase Invoice for this Partner"
            >
              <Receipt className="h-3.5 w-3.5 text-purple-600" />
              + PI
            </Button>
          )}
        </div>
      </div>

      {/* Printable Statement Title */}
      <div className="hidden print:block border-b border-black pb-3">
        <h2 className="text-lg font-bold text-black uppercase">
          Partnership Equity & Settlement Statement
        </h2>
        <div className="flex justify-between text-xs mt-1">
          <div>
            <strong>Co-Owner / Equity Partner (Person B):</strong> {hubData?.partner.name}
          </div>
          <div>
            <strong>Date Generated:</strong> {format(new Date(), "dd/MM/yyyy HH:mm")}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ========================================================= */}
      {/* REQUIREMENT 4: 7 FINANCIAL SUMMARY CARDS                 */}
      {/* ========================================================= */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        {/* Card 1: Total Initial Capital Invested */}
        <Card className="border-indigo-200 dark:border-indigo-900 bg-indigo-50/50 dark:bg-indigo-950/20 shadow-xs">
          <CardContent className="p-3.5 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-800 dark:text-indigo-400 block">
              Initial Capital Invested
            </span>
            <div className="text-lg font-black font-mono text-indigo-950 dark:text-indigo-100">
              PKR {(hubData?.metrics?.totalInitialCapital || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
            <div className="text-[10px] text-slate-500 font-mono leading-tight">
              <div>B: PKR {(hubData?.metrics?.partnerCapitalInvested || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
              <div>A: PKR {(hubData?.metrics?.clientCapitalInvested || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Current Warehouse Stock Value */}
        <Card className="border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20 shadow-xs">
          <CardContent className="p-3.5 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-400 block">
              Warehouse Stock Value
            </span>
            <div className="text-lg font-black font-mono text-slate-900 dark:text-slate-100">
              PKR {(hubData?.metrics?.currentStockValuationSharedWarehouse || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
            <p className="text-[10px] text-slate-500 truncate" title={hubData?.locations?.sharedWarehouse?.name || "Shared Warehouse"}>
              At {hubData?.locations?.sharedWarehouse?.name || "Shared Warehouse"}
            </p>
          </CardContent>
        </Card>

        {/* Card 3: Capital Reimbursed to Partner */}
        <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <CardContent className="p-3.5 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 block">
              Capital Reimbursed
            </span>
            <div className="text-lg font-black font-mono text-emerald-800 dark:text-emerald-400">
              PKR {(hubData?.metrics?.capitalReimbursedToPartner || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
            <p className="text-[10px] text-slate-500 font-mono leading-tight">
              Accrued: PKR {(hubData?.metrics?.capitalLiabilityAccrued || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              <br />
              Unpaid: PKR {(hubData?.metrics?.unpaidCapitalReimbursement || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </p>
          </CardContent>
        </Card>

        {/* Card 4: Sales Revenue to Date */}
        <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <CardContent className="p-3.5 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 block">
              Sales Revenue
            </span>
            <div className="text-lg font-black font-mono text-slate-900 dark:text-slate-100">
              PKR {(hubData?.metrics?.totalSalesRevenue || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
            <p className="text-[10px] text-slate-500">
              From partner lot batches
            </p>
          </CardContent>
        </Card>

        {/* Card 5: Total Realized Profit */}
        <Card className="border-teal-200 dark:border-teal-900 bg-teal-50/50 dark:bg-teal-950/20 shadow-xs">
          <CardContent className="p-3.5 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-teal-800 dark:text-teal-400 block">
              Total Realized Profit
            </span>
            <div className="text-lg font-black font-mono text-teal-950 dark:text-teal-200">
              PKR {(hubData?.metrics?.totalRealizedProfit || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
            <p className="text-[10px] text-slate-500">
              COGS: PKR {(hubData?.metrics?.totalCOGS || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </p>
          </CardContent>
        </Card>

        {/* Card 6: Partner Profit Share */}
        <Card className="border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20 shadow-xs">
          <CardContent className="p-3.5 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-800 dark:text-blue-400 block">
              Partner Profit Share
            </span>
            <div className="text-lg font-black font-mono text-blue-950 dark:text-blue-200">
              PKR {(hubData?.metrics?.partnerProfitShare || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
            <p className="text-[10px] text-slate-500">
              Weighted by lot equity %
            </p>
          </CardContent>
        </Card>

        {/* Card 7: Net Payable to Partner */}
        <Card className="border-rose-300 dark:border-rose-900 bg-rose-50/60 dark:bg-rose-950/30 shadow-xs">
          <CardContent className="p-3.5 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-rose-800 dark:text-rose-400">
                Net Payable to Partner
              </span>
              <a
                href={`/payments?partyId=${selectedPartnerId}&action=new`}
                className="text-[10px] text-rose-700 hover:text-rose-900 font-bold underline"
              >
                Settle →
              </a>
            </div>
            <div className="text-lg font-black font-mono text-rose-900 dark:text-rose-300">
              PKR {(hubData?.metrics?.netPayableToPartner || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
            <p className="text-[10px] text-slate-500 leading-tight">
              Unpaid Cap + Profit Share
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Clean Tab Navigation */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-1 print:hidden">
        <button
          type="button"
          onClick={() => setActiveTab("inventory")}
          className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors flex items-center gap-2 ${
            activeTab === "inventory"
              ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 shadow-xs"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          }`}
        >
          <Layers className="h-3.5 w-3.5" />
          Products & Lot Breakdown ({hubData?.productBreakdown.length || 0})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("settlements")}
          className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors flex items-center gap-2 ${
            activeTab === "settlements"
              ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 shadow-xs"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          }`}
        >
          <Receipt className="h-3.5 w-3.5" />
          Sales & Realized Margins ({hubData?.settlementLog.length || 0})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("orders")}
          className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors flex items-center gap-2 ${
            activeTab === "orders"
              ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 shadow-xs"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          }`}
        >
          <ShoppingCart className="h-3.5 w-3.5" />
          Orders & Requisitions ({hubData?.purchaseOrders?.length || 0})
        </button>
      </div>

      {/* ========================================================= */}
      {/* SECTION 1: PRODUCT BREAKDOWN & LOT HISTORY TABLE         */}
      {/* ========================================================= */}
      {activeTab === "inventory" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Layers className="h-4 w-4 text-amber-700" />
                Product Breakdown & Lot Allocation Table
              </h2>
              <p className="text-xs text-slate-500">
                Breakdown of stock co-owned with {selectedPartner?.name || "Person B"}, equity splits, units pulled to shop, sold direct, and balances.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 print:hidden">
              {/* Warehouse Filter */}
              <select
                value={filterWarehouseId}
                onChange={(e) => setFilterWarehouseId(e.target.value)}
                className="h-8 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200"
              >
                <option value="all">All Warehouses</option>
                {partnerWarehouses.map((wh) => (
                  <option key={wh.id} value={wh.id}>
                    {wh.name}
                  </option>
                ))}
              </select>

              {/* Lot Filter */}
              <select
                value={filterLotId}
                onChange={(e) => setFilterLotId(e.target.value)}
                className="h-8 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200"
              >
                <option value="all">All Lots ({partnerLots.length})</option>
                {partnerLots.map((lot) => (
                  <option key={lot.id} value={lot.id}>
                    Lot #{lot.lotNumber} ({lot.locationName})
                  </option>
                ))}
              </select>

              {/* Zero Stock Toggle */}
              <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 font-medium cursor-pointer bg-slate-50 dark:bg-slate-800/60 px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700">
                <input
                  type="checkbox"
                  checked={showZeroStock}
                  onChange={(e) => setShowZeroStock(e.target.checked)}
                  className="rounded border-slate-300 text-amber-700 focus:ring-amber-600"
                />
                <span>Show Zero Stock</span>
              </label>

              {/* Search */}
              <div className="relative w-56">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <Input
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder="Filter products or lots..."
                  className="h-8 pl-8 text-xs bg-white dark:bg-slate-950 font-medium"
                />
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xs overflow-hidden print:border-black">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700 text-[11px] font-bold uppercase tracking-wider print:bg-slate-200 print:text-black">
                  <tr>
                    <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700 w-8"></th>
                    <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700 min-w-[180px]">Product / Lots</th>
                    <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700 text-right">Total Intake</th>
                    <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700 text-right">Avg Unit Cost</th>
                    <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700 text-right">Sold to Date</th>
                    <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700 text-right font-bold text-emerald-900 dark:text-emerald-400">Shop Stock</th>
                    <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700 text-right">Sales Revenue</th>
                    <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700 text-right font-bold">Total Margin</th>
                    <th className="py-2.5 px-3 text-center print:hidden">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {loading ? (
                    <tr>
                      <td colSpan={9} className="py-10 text-center text-slate-500">
                        Loading product breakdown...
                      </td>
                    </tr>
                  ) : filteredProducts.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-10 text-center text-slate-500">
                        No products found. Click &quot;Partnership Intake&quot; to intake inventory into the shared warehouse.
                      </td>
                    </tr>
                  ) : (
                    filteredProducts.map((p) => {
                      const isExpanded = expandedProductIds.has(p.product.id);
                      return (
                        <Fragment key={p.product.id}>
                          <tr className="hover:bg-slate-50/70 dark:hover:bg-slate-800/60 transition-colors">
                            <td className="py-2 px-3 border-r border-slate-200/60 text-center">
                              <button
                                type="button"
                                onClick={() => toggleProductExpand(p.product.id)}
                                className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500"
                                title="Toggle lot batches"
                              >
                                {isExpanded ? (
                                  <ChevronDown className="h-3.5 w-3.5 text-amber-800" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5" />
                                )}
                              </button>
                            </td>
                            <td className="py-2 px-3 border-r border-slate-200/60 font-medium text-slate-900 dark:text-slate-100">
                              <div>
                                <span className="font-mono text-slate-500 mr-1.5">{p.product.productNo}</span>
                                <span className="font-bold">{p.product.name}</span>
                              </div>
                              {p.lots.length > 0 && (
                                <span className="text-[10px] text-amber-800 dark:text-amber-400 font-mono">
                                  {p.lots.length} active lot{p.lots.length > 1 ? "s" : ""}
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-3 border-r border-slate-200/60 text-right font-mono">
                              {p.totalQtyPurchased.toLocaleString()} {p.product.unit}
                            </td>
                            <td className="py-2 px-3 border-r border-slate-200/60 text-right font-mono">
                              PKR {p.batchPurchaseCost.toFixed(2)}
                            </td>
                            <td className="py-2 px-3 border-r border-slate-200/60 text-right font-mono">
                              {p.totalQtySold.toLocaleString()} {p.product.unit}
                            </td>
                            <td className="py-2 px-3 border-r border-slate-200/60 text-right font-mono font-bold text-emerald-800 dark:text-emerald-400">
                              {p.remainingInShop.toLocaleString()} {p.product.unit}
                            </td>
                            <td className="py-2 px-3 border-r border-slate-200/60 text-right font-mono">
                              PKR {p.totalSalesRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </td>
                            <td className="py-2 px-3 border-r border-slate-200/60 text-right font-mono font-bold text-emerald-800 dark:text-emerald-400">
                              PKR {p.grossMargin.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </td>
                            <td className="py-2 px-3 text-center whitespace-nowrap print:hidden">
                              <div className="flex items-center justify-center gap-1">
                                {canAdjustStock && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => openAdjustModalForProduct(p.product.id, p.lots[0]?.id)}
                                    className="h-7 text-[11px] px-2 bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-200"
                                  >
                                    Adjust
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>

                          {/* Expandable Lot History Details */}
                          {isExpanded && (
                            <tr className="bg-amber-50/20 dark:bg-amber-950/20 border-b border-amber-200 dark:border-amber-900">
                              <td colSpan={9} className="py-2 px-6">
                                <div className="space-y-1.5 py-1">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-bold text-amber-900 dark:text-amber-300 uppercase tracking-wider block">
                                      Lot Batches & Equity Split Ratios: {p.product.name}
                                    </span>
                                    <span className="text-[10px] text-slate-500 font-mono">
                                      Shows partner equity share and stock distribution across locations
                                    </span>
                                  </div>

                                  {p.lots.length === 0 ? (
                                    <p className="text-xs text-slate-500 italic">No specific lot records assigned yet.</p>
                                  ) : (
                                    <table className="w-full text-left text-xs bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800 rounded-md">
                                      <thead className="bg-amber-100/60 dark:bg-amber-950 text-amber-950 dark:text-amber-200 text-[10px] font-bold uppercase">
                                        <tr>
                                          <th className="py-1.5 px-3">Lot Reference</th>
                                          <th className="py-1.5 px-3">Equity Split Badge</th>
                                          <th className="py-1.5 px-3">Inward Date</th>
                                          <th className="py-1.5 px-3 text-right">Unit Lot Cost</th>
                                          <th className="py-1.5 px-3 text-right">Received</th>
                                          <th className="py-1.5 px-3 text-right">Pulled to Shop</th>
                                          <th className="py-1.5 px-3 text-right">Sold Direct</th>
                                          <th className="py-1.5 px-3 text-right font-bold text-amber-900">In Shared WH</th>
                                          <th className="py-1.5 px-3 text-right font-bold text-emerald-900">In Shop</th>
                                          <th className="py-1.5 px-3 text-center print:hidden">Action</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-amber-100 dark:divide-amber-900">
                                        {p.lots.map((lot) => (
                                          <tr key={lot.id} className="hover:bg-amber-50/50">
                                            <td className="py-1.5 px-3 font-mono font-bold text-amber-900 dark:text-amber-300">
                                              {lot.lotNumber}
                                            </td>
                                            <td className="py-1.5 px-3">
                                              <span
                                                className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                                                  lot.partnerSharePct === 100
                                                    ? "bg-purple-100 text-purple-800 border border-purple-200"
                                                    : lot.partnerSharePct === 50
                                                    ? "bg-blue-100 text-blue-800 border border-blue-200"
                                                    : "bg-indigo-100 text-indigo-800 border border-indigo-200"
                                                }`}
                                              >
                                                {lot.equityBadge}
                                              </span>
                                            </td>
                                            <td className="py-1.5 px-3 font-mono text-slate-600">
                                              {format(new Date(lot.inwardDate), "dd/MM/yyyy")}
                                            </td>
                                            <td className="py-1.5 px-3 text-right font-mono">
                                              PKR {lot.inwardPrice.toFixed(2)}
                                            </td>
                                            <td className="py-1.5 px-3 text-right font-mono">
                                              {lot.qtyReceived} {p.product.unit}
                                            </td>
                                            <td className="py-1.5 px-3 text-right font-mono text-indigo-800">
                                              {lot.qtyTransferredToShop} {p.product.unit}
                                            </td>
                                            <td className="py-1.5 px-3 text-right font-mono">
                                              {lot.qtySoldDirect} {p.product.unit}
                                            </td>
                                            <td className="py-1.5 px-3 text-right font-mono font-bold text-amber-900 dark:text-amber-400">
                                              {lot.qtyRemainingSharedWarehouse} {p.product.unit}
                                            </td>
                                            <td className="py-1.5 px-3 text-right font-mono font-bold text-emerald-800 dark:text-emerald-400">
                                              {lot.qtyRemainingInShop} {p.product.unit}
                                            </td>
                                            <td className="py-1.5 px-3 text-center print:hidden">
                                              {canAdjustStock && (
                                                <Button
                                                  size="sm"
                                                  variant="outline"
                                                  onClick={() => openAdjustModalForProduct(p.product.id, lot.id)}
                                                  className="h-6 text-[10px] px-2 bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-300"
                                                >
                                                  Adjust
                                                </Button>
                                              )}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* SECTION 2: SALES & REALIZED SETTLEMENT LOG               */}
      {/* ========================================================= */}
      {activeTab === "settlements" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Receipt className="h-4 w-4 text-emerald-700" />
                Sales & Realized Margin Ledger (Partner Lots)
              </h2>
              <p className="text-xs text-slate-500">
                Detailed transaction audit of goods sold from partnership lots, showing specific unit lot costs, gross margins, and B&apos;s profit share.
              </p>
            </div>

            {/* Date range & lot filters + Print Statement */}
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                <Calendar className="h-3.5 w-3.5 text-slate-400" />
                <span>From:</span>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="h-8 text-xs w-36 bg-white dark:bg-slate-950"
                />
                <span>To:</span>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="h-8 text-xs w-36 bg-white dark:bg-slate-950"
                />
                {(startDate || endDate) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setStartDate("");
                      setEndDate("");
                    }}
                    className="h-8 text-xs text-slate-500"
                  >
                    Clear
                  </Button>
                )}
              </div>

              {/* Lot Filter for Sales */}
              <select
                value={selectedLogLotId}
                onChange={(e) => setSelectedLogLotId(e.target.value)}
                className="h-8 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200"
              >
                <option value="all">All Lot Batches</option>
                {partnerLots.map((lot) => (
                  <option key={lot.id} value={lot.id}>
                    #{lot.lotNumber}
                  </option>
                ))}
              </select>

              {/* Print Statement Button */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const params = new URLSearchParams();
                  if (startDate) params.set("from", startDate);
                  if (endDate) params.set("to", endDate);
                  if (selectedLogLotId && selectedLogLotId !== "all") {
                    const foundLot = partnerLots.find((l) => l.id === selectedLogLotId);
                    params.set("lotId", foundLot?.id || selectedLogLotId);
                  }
                  params.set("autoprint", "1");
                  window.open(`/partnerships/${selectedPartnerId}/print-sales?${params.toString()}`, "_blank");
                }}
                className="border-slate-300 dark:border-slate-700 text-xs gap-1.5 h-8 font-bold shadow-xs hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200"
                title="Open formatted A4 Landscape printable statement in new tab"
              >
                <Printer className="h-3.5 w-3.5 text-emerald-700" />
                Print Statement
              </Button>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xs overflow-hidden print:border-black">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700 text-[11px] font-bold uppercase tracking-wider print:bg-slate-200 print:text-black">
                  <tr>
                    <th className="py-2 px-3 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap">Date</th>
                    <th className="py-2 px-3 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap">Sale Invoice #</th>
                    <th className="py-2 px-3 border-r border-slate-200 dark:border-slate-700 min-w-[130px]">Customer</th>
                    <th className="py-2 px-3 border-r border-slate-200 dark:border-slate-700 min-w-[160px]">Product</th>
                    <th className="py-2 px-3 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap">Lot Batch</th>
                    <th className="py-2 px-3 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap">Qty Sold</th>
                    <th className="py-2 px-3 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap">Sale Price</th>
                    <th className="py-2 px-3 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap">Lot Cost</th>
                    <th className="py-2 px-3 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap font-bold">Total Sale</th>
                    <th className="py-2 px-3 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap">Total Cost</th>
                    <th className="py-2 px-3 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap font-bold">Margin</th>
                    <th className="py-2 px-3 text-right whitespace-nowrap font-bold text-emerald-800 dark:text-emerald-400">B Profit Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {loading ? (
                    <tr>
                      <td colSpan={12} className="py-10 text-center text-slate-500">
                        Loading settlement log...
                      </td>
                    </tr>
                  ) : filteredSettlementLog.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="py-10 text-center text-slate-500">
                        No partner lot sales recorded for the selected filters.
                      </td>
                    </tr>
                  ) : (
                    filteredSettlementLog.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/60 transition-colors">
                        <td className="py-2 px-3 border-r border-slate-200/60 font-mono text-slate-600 whitespace-nowrap">
                          {format(new Date(log.date), "dd/MM/yyyy")}
                        </td>
                        <td className="py-2 px-3 border-r border-slate-200/60 font-mono font-bold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                          <a href={`/sales?invoiceId=${log.invoiceId}`} className="hover:underline text-blue-700">
                            {log.invoiceNo}
                          </a>
                        </td>
                        <td className="py-2 px-3 border-r border-slate-200/60 font-medium text-slate-800 dark:text-slate-200">
                          {log.customerName}
                        </td>
                        <td className="py-2 px-3 border-r border-slate-200/60 font-medium text-slate-900 dark:text-slate-100">
                          {log.productName}
                        </td>
                        <td className="py-2 px-3 border-r border-slate-200/60 font-mono text-amber-900 dark:text-amber-400 font-bold whitespace-nowrap">
                          {log.lotNumber}
                        </td>
                        <td className="py-2 px-3 border-r border-slate-200/60 text-right font-mono whitespace-nowrap">
                          {log.quantity} {log.unit}
                        </td>
                        <td className="py-2 px-3 border-r border-slate-200/60 text-right font-mono whitespace-nowrap">
                          PKR {log.unitSellingPrice.toFixed(2)}
                        </td>
                        <td className="py-2 px-3 border-r border-slate-200/60 text-right font-mono whitespace-nowrap text-slate-600">
                          PKR {log.unitLotCost.toFixed(2)}
                        </td>
                        <td className="py-2 px-3 border-r border-slate-200/60 text-right font-mono font-bold whitespace-nowrap">
                          PKR {log.totalSale.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </td>
                        <td className="py-2 px-3 border-r border-slate-200/60 text-right font-mono text-slate-600 whitespace-nowrap">
                          PKR {log.totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </td>
                        <td className="py-2 px-3 border-r border-slate-200/60 text-right font-mono font-bold whitespace-nowrap text-slate-800">
                          PKR {log.netMargin.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-emerald-800 dark:text-emerald-400 whitespace-nowrap">
                          PKR {log.partnerProfitShare.toLocaleString(undefined, { maximumFractionDigits: 0 })} ({log.partnerSharePct}%)
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {filteredSettlementLog.length > 0 && (
                  <tfoot className="bg-slate-100 dark:bg-slate-800 border-t-2 border-slate-300 dark:border-slate-700 font-bold text-xs">
                    <tr>
                      <td colSpan={8} className="py-2.5 px-3 text-right uppercase tracking-wider text-slate-700 dark:text-slate-300">
                        Total Summary:
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono border-r border-slate-300 dark:border-slate-700">
                        PKR {logTotals.totalSales.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono border-r border-slate-300 dark:border-slate-700 text-slate-600">
                        PKR {logTotals.totalCOGS.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono border-r border-slate-300 dark:border-slate-700 text-slate-800">
                        PKR {logTotals.totalMargin.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-emerald-800 dark:text-emerald-400">
                        PKR {logTotals.totalBProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* SECTION 3: ORDERS & REQUISITIONS TAB                      */}
      {/* ========================================================= */}
      {activeTab === "orders" && (
        <div className="space-y-6">
          {/* Purchase Orders Block */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4 text-blue-600" />
                  Purchase Orders & Requisitions
                </h2>
                <p className="text-xs text-slate-500">
                  Shared orders placed with co-owner {selectedPartner?.name}, quantity requisitions, and conversion history.
                </p>
              </div>

              <Button
                size="sm"
                onClick={() => router.push(`/purchase-orders?supplierId=${selectedPartnerId}&action=new`)}
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs gap-1.5 h-8 font-bold"
              >
                <Plus className="h-3.5 w-3.5" />
                New Shared Stock PO
              </Button>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700 text-[11px] font-bold uppercase tracking-wider">
                    <tr>
                      <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700">Order #</th>
                      <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700">Date</th>
                      <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700">Type / Pricing</th>
                      <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700">Destination</th>
                      <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700">Items Summary</th>
                      <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700 text-center">Status</th>
                      <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700">Converted Invoices</th>
                      <th className="py-2.5 px-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {!hubData?.purchaseOrders || hubData.purchaseOrders.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-slate-500">
                          No purchase orders recorded for this partnership yet.
                        </td>
                      </tr>
                    ) : (
                      hubData.purchaseOrders.map((po) => (
                        <tr key={po.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/60 transition-colors">
                          <td className="py-2 px-3 border-r border-slate-200/60 font-mono font-bold text-slate-900 dark:text-slate-100">
                            {po.orderNo}
                          </td>
                          <td className="py-2 px-3 border-r border-slate-200/60 text-slate-600">
                            {format(new Date(po.date), "dd/MM/yyyy")}
                          </td>
                          <td className="py-2 px-3 border-r border-slate-200/60">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                                po.includePricing
                                  ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                                  : "bg-amber-50 text-amber-800 border border-amber-200"
                              }`}
                            >
                              {po.includePricing ? "Pricing Included" : "Quantities Only"}
                            </span>
                          </td>
                          <td className="py-2 px-3 border-r border-slate-200/60 text-slate-700">
                            {po.locationName}
                          </td>
                          <td className="py-2 px-3 border-r border-slate-200/60">
                            <span className="font-semibold text-slate-800 dark:text-slate-200">
                              {po.items.length} item(s)
                            </span>{" "}
                            <span className="text-[11px] text-slate-500">
                              ({po.items.reduce((s, it) => s + it.quantity, 0).toLocaleString()} units)
                            </span>
                          </td>
                          <td className="py-2 px-3 border-r border-slate-200/60 text-center">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                                po.status === "FULFILLED"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : po.status === "CANCELLED"
                                  ? "bg-rose-100 text-rose-800"
                                  : "bg-blue-100 text-blue-800"
                              }`}
                            >
                              {po.status}
                            </span>
                          </td>
                          <td className="py-2 px-3 border-r border-slate-200/60">
                            {po.invoices.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {po.invoices.map((inv) => (
                                  <a
                                    key={inv.id}
                                    href={`/purchases?search=${inv.invoiceNo}`}
                                    className="font-mono text-[11px] text-blue-700 hover:underline font-bold bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200"
                                  >
                                    {inv.invoiceNo}
                                  </a>
                                ))}
                              </div>
                            ) : (
                              <span className="text-slate-400 italic">None converted</span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-center">
                            <a
                              href={`/purchase-orders?search=${po.orderNo}`}
                              className="text-xs text-blue-700 hover:underline font-semibold"
                            >
                              View PO →
                            </a>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Linked Purchase Invoices Block */}
          <div className="space-y-3">
            <div>
              <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Receipt className="h-4 w-4 text-purple-600" />
                Co-Ownership Purchase Invoices
              </h2>
              <p className="text-xs text-slate-500">
                Official purchase invoices billed to or from partner {selectedPartner?.name}, detailing financial payables and receipts.
              </p>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700 text-[11px] font-bold uppercase tracking-wider">
                    <tr>
                      <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700">Invoice #</th>
                      <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700">Date</th>
                      <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700 text-right">Total Amount</th>
                      <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700 text-right">Paid Amount</th>
                      <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700 text-right">Balance Due</th>
                      <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700 text-center">Status</th>
                      <th className="py-2.5 px-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {!hubData?.purchaseInvoices || hubData.purchaseInvoices.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-slate-500">
                          No purchase invoices logged for this partner yet.
                        </td>
                      </tr>
                    ) : (
                      hubData.purchaseInvoices.map((pi) => (
                        <tr key={pi.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/60 transition-colors">
                          <td className="py-2 px-3 border-r border-slate-200/60 font-mono font-bold text-slate-900 dark:text-slate-100">
                            {pi.invoiceNo}
                          </td>
                          <td className="py-2 px-3 border-r border-slate-200/60 text-slate-600">
                            {format(new Date(pi.date), "dd/MM/yyyy")}
                          </td>
                          <td className="py-2 px-3 border-r border-slate-200/60 text-right font-mono font-bold text-slate-900 dark:text-slate-100">
                            PKR {pi.totalAmount.toLocaleString()}
                          </td>
                          <td className="py-2 px-3 border-r border-slate-200/60 text-right font-mono text-emerald-700">
                            PKR {pi.paidAmount.toLocaleString()}
                          </td>
                          <td className="py-2 px-3 border-r border-slate-200/60 text-right font-mono font-bold text-rose-700">
                            PKR {pi.balanceAmount.toLocaleString()}
                          </td>
                          <td className="py-2 px-3 border-r border-slate-200/60 text-center">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                                pi.status === "SETTLED" || pi.status === "PAID"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-amber-100 text-amber-800"
                              }`}
                            >
                              {pi.status}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-center">
                            <a
                              href={`/purchases?search=${pi.invoiceNo}`}
                              className="text-xs text-blue-700 hover:underline font-semibold"
                            >
                              View PI →
                            </a>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 1: DEDICATED PARTNERSHIP PURCHASE INTAKE          */}
      {/* ========================================================= */}
      {showIntakeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="w-full max-w-2xl bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-700 rounded-xl shadow-2xl p-5 overflow-hidden max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-md bg-emerald-600 text-white">
                  <Plus className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Partnership Purchase Intake into Shared Warehouse
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Partner: <strong>{selectedPartner?.name}</strong> • Destination: <strong>{hubData?.locations?.sharedWarehouse?.name || "Shared Warehouse"}</strong>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowIntakeModal(false)}
                className="rounded p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {intakeError && (
              <div className="mt-3 rounded bg-rose-50 border border-rose-200 p-2 text-xs text-rose-700 flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span>{intakeError}</span>
              </div>
            )}

            <form onSubmit={handleIntakeSubmit} className="mt-3 space-y-4 text-xs flex-1 overflow-y-auto pr-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* External Supplier Selection */}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold">External Supplier / Vendor *</Label>
                  <select
                    value={intakeSupplierId}
                    onChange={(e) => setIntakeSupplierId(e.target.value)}
                    className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-medium"
                    required
                  >
                    <option value="">Select Vendor / Mill</option>
                    {hubData?.allSuppliers?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} {s.phone ? `(${s.phone})` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Intake Date */}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold">Intake Date *</Label>
                  <Input
                    type="date"
                    value={intakeDate}
                    onChange={(e) => setIntakeDate(e.target.value)}
                    className="h-8 text-xs"
                    required
                  />
                </div>

                {/* Destination Location */}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold">Destination Location *</Label>
                  <select
                    value={intakeLocationId}
                    onChange={(e) => setIntakeLocationId(e.target.value)}
                    className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-medium"
                    required
                  >
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name} ({loc.type})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Lot Selection Mode: Existing Lot vs Create New Lot */}
                <div className="space-y-1.5 sm:col-span-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold">Warehouse Lot Selection *</Label>
                    <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-md border border-slate-200 dark:border-slate-700">
                      <button
                        type="button"
                        onClick={() => {
                          setIntakeLotMode("EXISTING");
                          const lots = (hubData as any)?.existingWarehouseLots || hubData?.allLots || [];
                          if (lots.length > 0) handleSelectExistingLot(lots[0].id);
                        }}
                        className={`px-2 py-0.5 rounded text-[11px] font-bold transition-all ${
                          intakeLotMode === "EXISTING"
                            ? "bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-xs"
                            : "text-slate-500 hover:text-slate-800"
                        }`}
                      >
                        Select Existing Lot
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIntakeLotMode("NEW");
                          setIntakeSelectedLotId("");
                          if (!intakeLotNumber || intakeLotNumber.startsWith("LOT-")) {
                            setIntakeLotNumber(generateNewLotNumber());
                          }
                        }}
                        className={`px-2 py-0.5 rounded text-[11px] font-bold transition-all ${
                          intakeLotMode === "NEW"
                            ? "bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 shadow-xs"
                            : "text-slate-500 hover:text-slate-800"
                        }`}
                      >
                        + Create New Lot
                      </button>
                    </div>
                  </div>

                  {intakeLotMode === "EXISTING" ? (
                    <div className="space-y-1">
                      <select
                        value={intakeSelectedLotId}
                        onChange={(e) => handleSelectExistingLot(e.target.value)}
                        className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-mono font-bold"
                        required
                      >
                        <option value="">-- Choose Existing Lot --</option>
                        {((hubData as any)?.existingWarehouseLots || hubData?.allLots || []).map((l: any) => (
                          <option key={l.id} value={l.id}>
                            {l.lotNumber} ({l.locationName || "Shared WH"}) — {l.partnerSharePct}% Partner / {l.clientSharePct}% Client — Unit Cost: PKR {l.unitCost}
                          </option>
                        ))}
                      </select>
                      <p className="text-[10px] text-slate-500">
                        Adds incoming inventory into this existing lot and preserves its equity split.
                      </p>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Input
                        value={intakeLotNumber}
                        onChange={(e) => setIntakeLotNumber(e.target.value)}
                        placeholder="e.g. LOT-101 or LOT-B-20261002"
                        className="h-8 text-xs font-mono font-bold flex-1"
                        required
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setIntakeLotNumber(generateNewLotNumber())}
                        className="h-8 text-[11px] px-2.5 whitespace-nowrap text-slate-600"
                        title="Auto generate a unique lot number"
                      >
                        Auto-Gen
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              {/* Partnership Equity Split Selector */}
              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-tight">
                    Partnership Equity Split:
                  </Label>
                  <span className="text-[11px] font-mono text-slate-500">
                    Total: {intakePartnerPct + intakeClientPct}%
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={() => handleSplitPresetChange("100_PARTNER")}
                    className={`py-1.5 px-2 rounded-md text-xs font-bold transition-all border ${
                      intakeSplitPreset === "100_PARTNER"
                        ? "bg-purple-600 text-white border-purple-600 shadow-xs"
                        : "bg-white dark:bg-slate-900 border-slate-200 text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    100% Partner
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSplitPresetChange("50_50")}
                    className={`py-1.5 px-2 rounded-md text-xs font-bold transition-all border ${
                      intakeSplitPreset === "50_50"
                        ? "bg-blue-600 text-white border-blue-600 shadow-xs"
                        : "bg-white dark:bg-slate-900 border-slate-200 text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    50% / 50%
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSplitPresetChange("75_25")}
                    className={`py-1.5 px-2 rounded-md text-xs font-bold transition-all border ${
                      intakeSplitPreset === "75_25"
                        ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                        : "bg-white dark:bg-slate-900 border-slate-200 text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    75% B / 25% A
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSplitPresetChange("CUSTOM")}
                    className={`py-1.5 px-2 rounded-md text-xs font-bold transition-all border ${
                      intakeSplitPreset === "CUSTOM"
                        ? "bg-slate-800 text-white border-slate-800 shadow-xs"
                        : "bg-white dark:bg-slate-900 border-slate-200 text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    Custom %
                  </button>
                </div>

                {intakeSplitPreset === "CUSTOM" && (
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div className="space-y-1">
                      <Label className="text-[11px]">Partner Share %</Label>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        value={intakePartnerPct}
                        onChange={(e) => {
                          const p = Math.max(0, Math.min(100, parseFloat(e.target.value) || 0));
                          setIntakePartnerPct(p);
                          setIntakeClientPct(100 - p);
                        }}
                        className="h-8 text-xs font-mono font-bold"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Client (A) Share %</Label>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        value={intakeClientPct}
                        onChange={(e) => {
                          const c = Math.max(0, Math.min(100, parseFloat(e.target.value) || 0));
                          setIntakeClientPct(c);
                          setIntakePartnerPct(100 - c);
                        }}
                        className="h-8 text-xs font-mono font-bold"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Line Items Table with Enter Navigation */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      Line Items Table
                    </Label>
                    <span className="text-[10px] text-slate-400 ml-2 font-mono">
                      (Press Enter to move: Product → Qty → Unit Cost → Next Row)
                    </span>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={addIntakeItem}
                    className="h-6 text-[11px] px-2 text-emerald-700 border-emerald-300"
                  >
                    <Plus className="h-3 w-3 mr-1" /> Add Product
                  </Button>
                </div>

                <div className="border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-100 dark:bg-slate-800 text-[10px] font-bold uppercase text-slate-700 dark:text-slate-300">
                      <tr>
                        <th className="py-1.5 px-2">Product *</th>
                        <th className="py-1.5 px-2 w-28 text-right">Packets / Qty *</th>
                        <th className="py-1.5 px-2 w-28 text-right">Unit Cost (PKR) *</th>
                        <th className="py-1.5 px-2 w-32 text-right">Line Total</th>
                        <th className="py-1.5 px-2 w-8"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {intakeItems.map((item, idx) => {
                        const lineTotal = (Number(item.quantity) || 0) * (Number(item.unitCost) || 0);
                        return (
                          <tr key={idx}>
                            <td className="p-1.5">
                              <select
                                id={`intake-prod-${idx}`}
                                value={item.productId}
                                onChange={(e) => updateIntakeItem(idx, "productId", e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    document.getElementById(`intake-qty-${idx}`)?.focus();
                                  }
                                }}
                                className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
                                required
                              >
                                <option value="">Select product</option>
                                {hubData?.allProducts?.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.productNo} - {p.name} ({p.unit})
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="p-1.5 text-right">
                              <Input
                                id={`intake-qty-${idx}`}
                                type="number"
                                min="0.0001"
                                step="any"
                                value={item.quantity}
                                onChange={(e) => updateIntakeItem(idx, "quantity", parseFloat(e.target.value) || 0)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    document.getElementById(`intake-cost-${idx}`)?.focus();
                                  }
                                }}
                                className="h-7 text-xs font-mono text-right"
                                required
                              />
                            </td>
                            <td className="p-1.5 text-right">
                              <Input
                                id={`intake-cost-${idx}`}
                                type="number"
                                min="0"
                                step="any"
                                value={item.unitCost}
                                onChange={(e) => updateIntakeItem(idx, "unitCost", parseFloat(e.target.value) || 0)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    if (idx === intakeItems.length - 1) {
                                      addIntakeItem();
                                      setTimeout(() => {
                                        document.getElementById(`intake-prod-${idx + 1}`)?.focus();
                                      }, 50);
                                    } else {
                                      document.getElementById(`intake-prod-${idx + 1}`)?.focus();
                                    }
                                  }
                                }}
                                className="h-7 text-xs font-mono text-right"
                                required
                              />
                            </td>
                            <td className="p-1.5 text-right font-mono font-bold text-slate-800 dark:text-slate-200">
                              PKR {lineTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </td>
                            <td className="p-1.5 text-center">
                              {intakeItems.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => removeIntakeItem(idx)}
                                  className="text-rose-500 hover:text-rose-700 p-1"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Capital Contribution Preview */}
              <div className="p-3 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/20 space-y-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-900 dark:text-emerald-300 block">
                  Capital Contribution Effect on Post:
                </span>
                <div className="grid grid-cols-3 gap-2 text-xs font-mono">
                  <div>
                    <span className="text-[10px] text-slate-500 block font-sans">Total Purchase:</span>
                    <strong>PKR {intakeTotalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block font-sans">Partner Capital ({intakePartnerPct}%):</span>
                    <strong className="text-purple-700 dark:text-purple-300">
                      PKR {intakePartnerCapital.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block font-sans">Client Capital ({intakeClientPct}%):</span>
                    <strong className="text-blue-700 dark:text-blue-300">
                      PKR {intakeClientCapital.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </strong>
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">Notes / Purchase Order Reference (Optional)</Label>
                <Input
                  value={intakeNotes}
                  onChange={(e) => setIntakeNotes(e.target.value)}
                  placeholder="e.g. Mill delivery slip #8271 / bulk import batch"
                  className="h-8 text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowIntakeModal(false)}
                  className="h-8 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={submittingIntake}
                  className="bg-emerald-700 hover:bg-emerald-800 text-white h-8 text-xs font-bold shadow-xs px-4"
                >
                  {submittingIntake ? "Posting Intake..." : "Post Intake to Shared Warehouse"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}



      {/* ========================================================= */}
      {/* MODAL 3: SETTLEMENT STATEMENT REPORT & EXPORT             */}
      {/* ========================================================= */}
      {showSettlementModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="w-full max-w-4xl bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-700 rounded-xl shadow-2xl p-5 overflow-hidden max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-md bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900">
                  <FileSpreadsheet className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Comprehensive Settlement Statement: {hubData?.partner.name}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Audit report of stock pulled to shop, direct sales margins, payments recorded, and net outstanding balance.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={exportSettlementStatementCsv}
                  className="h-7 text-xs gap-1 border-slate-300"
                >
                  <Download className="h-3 w-3" /> Export CSV
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => window.print()}
                  className="h-7 text-xs gap-1 border-slate-300"
                >
                  <Printer className="h-3 w-3" /> Print
                </Button>
                <button
                  type="button"
                  onClick={() => setShowSettlementModal(false)}
                  className="rounded p-1 text-slate-400 hover:text-slate-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Filter Bar */}
            <div className="bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 mt-3 flex flex-wrap items-center gap-3 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-slate-700 dark:text-slate-300">Filter by Lot:</span>
                <select
                  value={statementLotFilter}
                  onChange={(e) => setStatementLotFilter(e.target.value)}
                  className="h-7 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 text-xs font-mono font-medium"
                >
                  <option value="ALL">All Lots (Consolidated)</option>
                  {hubData?.allLots?.map((l) => (
                    <option key={l.id} value={l.lotNumber}>
                      {l.lotNumber} ({l.partnerSharePct}% B)
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="font-bold text-slate-700 dark:text-slate-300">From:</span>
                <Input
                  type="date"
                  value={statementStartDate}
                  onChange={(e) => setStatementStartDate(e.target.value)}
                  className="h-7 text-xs w-32 bg-white dark:bg-slate-900"
                />
                <span className="font-bold text-slate-700 dark:text-slate-300">To:</span>
                <Input
                  type="date"
                  value={statementEndDate}
                  onChange={(e) => setStatementEndDate(e.target.value)}
                  className="h-7 text-xs w-32 bg-white dark:bg-slate-900"
                />
              </div>
            </div>

            {/* Statement Content */}
            <div className="mt-3 flex-1 overflow-y-auto space-y-4 pr-1 text-xs">
              {/* Section 1: Stock Moved to Shop */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
                  <h4 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <Store className="h-3.5 w-3.5 text-indigo-700" />
                    1. Stock Moved to Shop &amp; Capital Owed to B
                  </h4>
                  <span className="font-mono font-bold text-indigo-800">
                    Total Capital Owed: PKR {statementData.totalCapitalOwedToB.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>

                {statementData.filteredMoved.length === 0 ? (
                  <p className="text-slate-400 italic py-2">No stock transfers to shop recorded for this criteria.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-slate-100 text-[10px] uppercase font-bold text-slate-700">
                        <tr>
                          <th className="py-1 px-2">Date</th>
                          <th className="py-1 px-2">Pull Invoice #</th>
                          <th className="py-1 px-2">Lot</th>
                          <th className="py-1 px-2">Product</th>
                          <th className="py-1 px-2 text-right">Qty Pulled</th>
                          <th className="py-1 px-2 text-right">Unit Cost</th>
                          <th className="py-1 px-2 text-right">Shop Valuation</th>
                          <th className="py-1 px-2 text-right">Partner Share %</th>
                          <th className="py-1 px-2 text-right font-bold text-indigo-900">Liability to B</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {statementData.filteredMoved.map((m) => (
                          <tr key={m.id}>
                            <td className="py-1 px-2 font-mono text-slate-600">{format(new Date(m.date), "dd/MM/yyyy")}</td>
                            <td className="py-1 px-2 font-mono font-bold text-blue-700">{m.invoiceNo}</td>
                            <td className="py-1 px-2 font-mono">{m.lotNumber}</td>
                            <td className="py-1 px-2 font-medium">{m.productName}</td>
                            <td className="py-1 px-2 text-right font-mono">{m.quantity} {m.unit}</td>
                            <td className="py-1 px-2 text-right font-mono">PKR {m.unitCost.toFixed(2)}</td>
                            <td className="py-1 px-2 text-right font-mono">PKR {m.totalCost.toFixed(2)}</td>
                            <td className="py-1 px-2 text-right font-mono">{m.partnerSharePct}%</td>
                            <td className="py-1 px-2 text-right font-mono font-bold text-indigo-900">
                              PKR {m.owedToB.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Section 2: Direct Sales Margins & B Profit Share */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
                  <h4 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <Receipt className="h-3.5 w-3.5 text-emerald-700" />
                    2. Direct Sales Margins &amp; B&apos;s Share of Profits
                  </h4>
                  <span className="font-mono font-bold text-emerald-800">
                    B Profit Share: PKR {statementData.totalPartnerProfitShare.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>

                {statementData.filteredSales.length === 0 ? (
                  <p className="text-slate-400 italic py-2">No sales recorded from partnership lots for this criteria.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-slate-100 text-[10px] uppercase font-bold text-slate-700">
                        <tr>
                          <th className="py-1 px-2">Date</th>
                          <th className="py-1 px-2">Invoice #</th>
                          <th className="py-1 px-2">Customer</th>
                          <th className="py-1 px-2">Product</th>
                          <th className="py-1 px-2 text-right">Qty Sold</th>
                          <th className="py-1 px-2 text-right">Sale Total</th>
                          <th className="py-1 px-2 text-right">Cost Total</th>
                          <th className="py-1 px-2 text-right">Margin</th>
                          <th className="py-1 px-2 text-right font-bold text-emerald-900">B Profit Share</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {statementData.filteredSales.map((s) => (
                          <tr key={s.id}>
                            <td className="py-1 px-2 font-mono text-slate-600">{format(new Date(s.date), "dd/MM/yyyy")}</td>
                            <td className="py-1 px-2 font-mono text-blue-700">{s.invoiceNo}</td>
                            <td className="py-1 px-2">{s.customerName}</td>
                            <td className="py-1 px-2 font-medium">{s.productName}</td>
                            <td className="py-1 px-2 text-right font-mono">{s.quantity} {s.unit}</td>
                            <td className="py-1 px-2 text-right font-mono">PKR {s.totalSale.toFixed(2)}</td>
                            <td className="py-1 px-2 text-right font-mono">PKR {s.totalCost.toFixed(2)}</td>
                            <td className="py-1 px-2 text-right font-mono font-bold">PKR {s.netMargin.toFixed(2)}</td>
                            <td className="py-1 px-2 text-right font-mono font-bold text-emerald-900">
                              PKR {s.partnerProfitShare.toFixed(2)} ({s.partnerSharePct}%)
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Section 3: Payments Already Recorded */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
                  <h4 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <CreditCard className="h-3.5 w-3.5 text-teal-700" />
                    3. Payments Already Recorded from A to B
                  </h4>
                  <span className="font-mono font-bold text-teal-800">
                    Total Paid: PKR {statementData.totalPaymentsToB.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>

                {statementData.filteredPayments.length === 0 ? (
                  <p className="text-slate-400 italic py-2">No payments recorded to Person B in this period.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-slate-100 text-[10px] uppercase font-bold text-slate-700">
                        <tr>
                          <th className="py-1 px-2">Date</th>
                          <th className="py-1 px-2">Receipt #</th>
                          <th className="py-1 px-2">Payment Method</th>
                          <th className="py-1 px-2">Notes</th>
                          <th className="py-1 px-2 text-right font-bold text-teal-900">Amount Paid</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {statementData.filteredPayments.map((p) => (
                          <tr key={p.id}>
                            <td className="py-1 px-2 font-mono text-slate-600">{format(new Date(p.date), "dd/MM/yyyy")}</td>
                            <td className="py-1 px-2 font-mono font-bold">{p.receiptNo}</td>
                            <td className="py-1 px-2">{p.method}</td>
                            <td className="py-1 px-2 text-slate-500">{p.notes || "—"}</td>
                            <td className="py-1 px-2 text-right font-mono font-bold text-teal-900">
                              PKR {p.amount.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Section 4: Net Balance Outstanding Summary Card */}
              <div className="p-4 rounded-xl border-2 border-slate-900 dark:border-slate-100 bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 dark:text-slate-600">
                      Net Balance Currently Outstanding
                    </h3>
                    <p className="text-2xl font-black font-mono mt-1">
                      PKR {statementData.netPayableBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-4 text-xs font-mono border-t sm:border-t-0 sm:border-l border-slate-700 dark:border-slate-300 pt-2 sm:pt-0 sm:pl-4">
                    <div>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 block font-sans">Capital Owed:</span>
                      PKR {statementData.totalCapitalOwedToB.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 block font-sans">Profit Share:</span>
                      + PKR {statementData.totalPartnerProfitShare.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 block font-sans">Paid to B:</span>
                      - PKR {statementData.totalPaymentsToB.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 4: BULK SHARED WAREHOUSE STOCK ADJUSTMENT          */}
      {/* ========================================================= */}
      {showAdjustModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="w-full max-w-3xl bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-700 rounded-xl shadow-2xl flex flex-col max-h-[85vh] overflow-y-auto">
            {/* Sticky Header */}
            <div className="sticky top-0 flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800 shrink-0 bg-white dark:bg-slate-900 z-10">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-md bg-amber-600 text-white">
                  <Sliders className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Bulk Shared Warehouse Stock Adjustment
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Enter an adjustment delta for each product and lot: IN adds the entered quantity; OUT removes it.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAdjustModal(false)}
                className="rounded p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Scrollable Form Body */}
            <form onSubmit={handleAdjustSubmit} className="flex flex-col flex-1 min-h-0">
              <div className="p-4 flex-1 space-y-4">
                {adjustError && (
                  <div className="rounded bg-rose-50 border border-rose-200 p-2.5 text-xs text-rose-700 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{adjustError}</span>
                  </div>
                )}

                {/* Warehouse Location & Date Header */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">Warehouse Location *</Label>
                    <select
                      value={adjustLocationId}
                      onChange={(e) => handleAdjustLocationChange(e.target.value)}
                      className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-medium"
                      required
                    >
                      <option value="">Select warehouse location</option>
                      {locations.filter((loc) => loc.type === "WAREHOUSE").map((loc) => (
                        <option key={loc.id} value={loc.id}>
                          {loc.name} ({loc.type})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">Adjustment Date *</Label>
                    <Input
                      type="date"
                      value={adjustDate}
                      onChange={(e) => setAdjustDate(e.target.value)}
                      className="h-8 text-xs bg-white dark:bg-slate-950"
                      required
                    />
                  </div>
                </div>

                {/* Adjustment Items List */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                      Adjustment Line Items ({adjustItems.length})
                    </Label>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={addAdjustItem}
                      className="h-7 text-xs gap-1 border-amber-300 text-amber-900 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40"
                    >
                      <Plus className="h-3 w-3" />
                      Add Item
                    </Button>
                  </div>

                  <div className="space-y-2">
                    {adjustItems.map((item, idx) => {
                      const prodEntry = hubData?.productBreakdown.find((p) => p.product.id === item.productId);
                      const lotOptions = hubData?.allLots?.filter((lot) => lot.locationId === adjustLocationId) || [];
                      const selectedLot = prodEntry?.lots.find((lot) => lot.id === item.warehouseLotId);
                      const availInWH = selectedLot?.qtyRemainingSharedWarehouse ?? 0;

                      return (
                        <div
                          key={item.id}
                          className="p-3 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg space-y-2 shadow-xs"
                        >
                          <div className="flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-slate-400">
                            <span>Item #{idx + 1}</span>
                            {adjustItems.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeAdjustItem(idx)}
                                className="text-rose-600 hover:text-rose-800 text-[11px] flex items-center gap-0.5"
                              >
                                <Trash2 className="h-3 w-3" /> Remove
                              </button>
                            )}
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 text-xs">
                            {/* Product */}
                            <div className="sm:col-span-4 space-y-1">
                              <label className="text-[11px] font-medium text-slate-500">Product *</label>
                              <select
                                value={item.productId}
                                onChange={(e) => updateAdjustItem(idx, "productId", e.target.value)}
                                className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs"
                                required
                              >
                                <option value="">Select product</option>
                                {hubData?.productBreakdown.map((pb) => (
                                  <option key={pb.product.id} value={pb.product.id}>
                                    {pb.product.productNo} - {pb.product.name} (Shared WH: {pb.remainingInSharedWarehouse} {pb.product.unit})
                                  </option>
                                ))}
                              </select>
                            </div>

                            {/* Lot */}
                            <div className="sm:col-span-4 space-y-1">
                              <label className="text-[11px] font-medium text-slate-500">Lot Batch {lotOptions.length > 0 ? "*" : "(Optional)"}</label>
                              <select
                                value={item.warehouseLotId}
                                onChange={(e) => updateAdjustItem(idx, "warehouseLotId", e.target.value)}
                                className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs font-mono"
                                required={lotOptions.length > 0}
                              >
                                {lotOptions.length === 0 ? (
                                  <option value="">No lot (unassigned stock)</option>
                                ) : (
                                  <option value="">Select a lot</option>
                                )}
                                {lotOptions.map((lot) => (
                                  <option key={lot.id} value={lot.id}>
                                    {lot.lotNumber} — Available: {prodEntry?.lots.find((productLot) => productLot.id === lot.id)?.qtyRemainingSharedWarehouse ?? 0}
                                  </option>
                                ))}
                              </select>
                            </div>

                            {/* Direction */}
                            <div className="sm:col-span-2 space-y-1">
                              <label className="text-[11px] font-medium text-slate-500">Direction</label>
                              <select
                                value={item.direction}
                                onChange={(e) => updateAdjustItem(idx, "direction", e.target.value as "OUT" | "IN")}
                                className={cn(
                                  "w-full rounded border px-2 py-1.5 text-xs font-bold",
                                  item.direction === "OUT"
                                    ? "bg-rose-50 dark:bg-rose-950/40 text-rose-800 border-rose-300"
                                    : "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 border-emerald-300"
                                )}
                              >
                                <option value="OUT">- OUT</option>
                                <option value="IN">+ IN</option>
                              </select>
                            </div>

                            {/* Qty */}
                            <div className="sm:col-span-2 space-y-1">
                              <div className="flex items-center justify-between">
                                <label className="text-[11px] font-medium text-slate-500">Adjustment delta *</label>
                                {item.direction === "OUT" && (
                                  <span className="text-[10px] text-amber-700 dark:text-amber-400 font-mono font-bold">
                                    Avail: {availInWH}
                                  </span>
                                )}
                              </div>
                              <Input
                                type="number"
                                min="0.0001"
                                step="any"
                                value={item.quantity}
                                onChange={(e) => updateAdjustItem(idx, "quantity", parseFloat(e.target.value) || 0)}
                                className="h-7 text-xs font-mono"
                                required
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Reason & Reference Notes */}
                <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">Reason (Mandatory) *</Label>
                    <Input
                      value={adjustReason}
                      onChange={(e) => setAdjustReason(e.target.value)}
                      placeholder="e.g. Sold 50 units directly to third-party buyer / physical count adjustment"
                      className="h-8 text-xs"
                      required
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">Reference Notes / Buyer Details</Label>
                    <Input
                      value={adjustNotes}
                      onChange={(e) => setAdjustNotes(e.target.value)}
                      placeholder="e.g. Third-party invoice #9182 / dispatch slip / damaged goods report"
                      className="h-8 text-xs"
                    />
                  </div>
                </div>

                {/* Recent Adjustments List with deletion option */}
                {hubData?.recentAdjustments && hubData.recentAdjustments.length > 0 && (
                  <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                    <h4 className="text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wider">
                      Recent Adjustments (Click Trash to Revert)
                    </h4>
                    <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                      {hubData.recentAdjustments.map((adj) => (
                        <div
                          key={adj.id}
                          className="flex items-center justify-between text-[11px] bg-slate-50 dark:bg-slate-800/60 p-2 rounded border border-slate-200 dark:border-slate-700"
                        >
                          <div className="flex-1 min-w-0 pr-2">
                            <div className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                              {adj.productNo} - {adj.productName}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              {format(new Date(adj.date), "dd MMM yyyy")} | {adj.notes || "No notes"}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "font-mono font-bold text-[11px]",
                                adj.quantity > 0 ? "text-emerald-700" : "text-rose-700"
                              )}
                            >
                              {adj.quantity > 0 ? `+${adj.quantity}` : adj.quantity}
                            </span>
                            {canDeleteAdjustment && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void handleDeleteAdjustment(adj.id, `${adj.productNo} (${adj.quantity})`)}
                                className="h-6 w-6 p-0 text-rose-600 hover:text-rose-800 hover:bg-rose-50"
                                title="Revert and delete adjustment"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Sticky Footer */}
              <div className="sticky bottom-0 p-3 border-t border-slate-200 dark:border-slate-800 shrink-0 bg-slate-50 dark:bg-slate-900/95 flex items-center justify-between z-10">
                <span className="text-xs text-slate-500 font-mono">
                  {adjustItems.length} line item(s) to process
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAdjustModal(false)}
                    className="h-8 text-xs"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={submittingAdjust}
                    className="bg-amber-800 hover:bg-amber-700 text-white h-8 text-xs font-semibold shadow-xs px-4"
                  >
                    {submittingAdjust ? "Saving Adjustments..." : "Save Adjustments"}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 5: SETTLEMENT PAYOUT MODAL                          */}
      {/* ========================================================= */}
      {showSettlementPayoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-700 rounded-xl shadow-2xl p-5 overflow-hidden">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-md bg-emerald-600 text-white">
                  <DollarSign className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Record Partner Settlement Payment
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Partner: <strong>{hubData?.partner.name}</strong>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSettlementPayoutModal(false)}
                className="rounded p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {payoutError && (
              <div className="mt-3 rounded bg-rose-50 border border-rose-200 p-2 text-xs text-rose-700 flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span>{payoutError}</span>
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleRecordSettlementPayout();
              }}
              className="mt-3 space-y-3 text-xs"
            >
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold">Payment Amount (PKR) *</Label>
                  <button
                    type="button"
                    onClick={() => setPayoutAmount(Math.max(0, hubData?.metrics?.netPayableToPartner || 0))}
                    className="text-[10px] font-bold text-emerald-700 hover:underline"
                  >
                    Full Balance (PKR {(hubData?.metrics?.netPayableToPartner || 0).toLocaleString()})
                  </button>
                </div>
                <Input
                  type="number"
                  min="0.01"
                  step="any"
                  value={payoutAmount}
                  onChange={(e) => setPayoutAmount(parseFloat(e.target.value) || 0)}
                  className="h-8 text-xs font-mono font-bold"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs font-semibold">Payment Method *</Label>
                  <select
                    value={payoutMethod}
                    onChange={(e) => setPayoutMethod(e.target.value as any)}
                    className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-semibold"
                  >
                    <option value="CASH">CASH</option>
                    <option value="BANK">BANK Transfer</option>
                    <option value="CHEQUE">CHEQUE</option>
                    <option value="OTHER">OTHER</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-semibold">Date *</Label>
                  <Input
                    type="date"
                    value={payoutDate}
                    onChange={(e) => setPayoutDate(e.target.value)}
                    className="h-8 text-xs"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">Notes / Bank Ref / Cheque #</Label>
                <Input
                  value={payoutNotes}
                  onChange={(e) => setPayoutNotes(e.target.value)}
                  placeholder="e.g. Online transfer ref #558291"
                  className="h-8 text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowSettlementPayoutModal(false)}
                  className="h-8 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={submittingPayout}
                  className="bg-emerald-700 hover:bg-emerald-800 text-white h-8 text-xs font-bold"
                >
                  {submittingPayout ? "Recording..." : "Record Payment"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

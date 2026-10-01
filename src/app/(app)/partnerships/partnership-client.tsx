"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
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
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getPartnershipHubDataAction, adjustSharedWarehouseStockAction } from "@/actions/partnerships";
import { listLocationsAction } from "@/actions/orders";
import { useRealtimeListener } from "@/hooks/use-realtime";
import { useConfirm } from "@/components/providers/confirm-provider";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { handleFormEnterKeyDown } from "@/lib/keyboard-nav";
export type HubData = {
  partner: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    isBeneficiary: boolean;
    sharedWarehouse: { id: string; name: string } | null;
  };
  metrics: {
    currentStockValuationSharedWarehouse: number;
    currentStockValuationShopPartnerLots: number;
    totalPurchasedFromB: number;
    totalSalesRevenue: number;
    totalCOGS: number;
    netGrossMargin: number;
    currentPayableToB: number;
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
    remainingInShop: number;
    remainingInSharedWarehouse: number;
    lots: Array<{
      id: string;
      lotNumber: string;
      inwardDate: Date;
      inwardPrice: number;
      qtyReceived: number;
      qtySold: number;
      qtyRemaining: number;
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
    quantity: number;
    unit: string;
    unitSellingPrice: number;
    unitLotCost: number;
    totalSale: number;
    totalCost: number;
    netMargin: number;
  }>;
  locations?: {
    sharedWarehouse: { id: string; name: string } | null;
    shop: { id: string; name: string } | null;
  };
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

  // Product breakdown search
  const [productSearch, setProductSearch] = useState("");
  // Expanded lots set
  const [expandedProductIds, setExpandedProductIds] = useState<Set<string>>(new Set());

  // Manual Shared Warehouse Adjustment Modal State
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [adjustProductId, setAdjustProductId] = useState("");
  const [adjustLocationId, setAdjustLocationId] = useState("");
  const [adjustQuantity, setAdjustQuantity] = useState(1);
  const [adjustDirection, setAdjustDirection] = useState<"OUT" | "IN">("OUT");
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

  function openAdjustModalForProduct(prodId?: string) {
    setAdjustProductId(prodId || "");
    const defaultWh = hubData?.locations?.sharedWarehouse?.id || locations.find((l) => l.type === "WAREHOUSE")?.id || "";
    setAdjustLocationId(defaultWh);
    setAdjustQuantity(1);
    setAdjustDirection("OUT");
    setAdjustReason("Direct sale / delivery from shared warehouse");
    setAdjustNotes("");
    setAdjustDate(new Date().toISOString().split("T")[0]);
    setAdjustError(null);
    setShowAdjustModal(true);
  }

  async function handleAdjustSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAdjustError(null);
    if (!selectedPartnerId || !adjustLocationId || !adjustProductId || adjustQuantity <= 0 || !adjustReason.trim()) {
      setAdjustError("Please fill in all mandatory fields.");
      return;
    }

    setSubmittingAdjust(true);
    try {
      const res = await adjustSharedWarehouseStockAction({
        partnerId: selectedPartnerId,
        locationId: adjustLocationId,
        productId: adjustProductId,
        quantity: adjustQuantity,
        direction: adjustDirection,
        reason: adjustReason.trim(),
        notes: adjustNotes.trim() || undefined,
        date: new Date(adjustDate),
      });

      if (res.success) {
        setShowAdjustModal(false);
        void loadHubData(selectedPartnerId, startDate, endDate);
      } else {
        setAdjustError(res.error || "Failed to record adjustment.");
      }
    } catch (err: any) {
      setAdjustError(err.message || "Adjustment failed.");
    } finally {
      setSubmittingAdjust(false);
    }
  }

  // Filtered product breakdown
  const filteredProducts = useMemo(() => {
    if (!hubData?.productBreakdown) return [];
    if (!productSearch.trim()) return hubData.productBreakdown;
    const q = productSearch.toLowerCase();
    return hubData.productBreakdown.filter(
      (p) =>
        p.product.name.toLowerCase().includes(q) ||
        p.product.productNo.toLowerCase().includes(q)
    );
  }, [hubData?.productBreakdown, productSearch]);

  // Export Settlement Log to CSV
  function handleExportCsv() {
    if (!hubData?.settlementLog || hubData.settlementLog.length === 0) {
      confirm.alert("No sales settlement records to export.");
      return;
    }
    const headers = [
      "Date",
      "Sale Invoice No",
      "Customer",
      "Product No",
      "Product Name",
      "Lot Number",
      "Qty Sold",
      "Unit Selling Price",
      "Unit Lot Cost",
      "Total Sale (PKR)",
      "Total Cost (PKR)",
      "Net Margin (PKR)",
    ];
    const rows = hubData.settlementLog.map((log) => [
      format(new Date(log.date), "yyyy-MM-dd"),
      log.invoiceNo,
      `"${log.customerName.replace(/"/g, '""')}"`,
      log.productNo,
      `"${log.productName.replace(/"/g, '""')}"`,
      log.lotNumber,
      log.quantity,
      log.unitSellingPrice.toFixed(2),
      log.unitLotCost.toFixed(2),
      log.totalSale.toFixed(2),
      log.totalCost.toFixed(2),
      log.netMargin.toFixed(2),
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute(
      "download",
      `settlement-log-${hubData.partner.name.replace(/\s+/g, "_")}-${format(new Date(), "yyyyMMdd")}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function handlePrint() {
    window.print();
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
              Partnership Stock & Financials
            </h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Isolated tracking for shared bulk stock co-owned or financed by Person B with lot-specific margins and shared warehouse adjustments.
          </p>
        </div>

        {/* Partner Selector & Actions */}
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
                  {p.name} {p.isBeneficiary ? "★ (Beneficiary)" : ""}
                </option>
              ))}
            </select>
          </div>

          <Button
            size="sm"
            onClick={() => openAdjustModalForProduct()}
            className="bg-amber-800 hover:bg-amber-700 text-white text-xs gap-1.5 h-8 font-semibold shadow-xs"
          >
            <ArrowRightLeft className="h-3.5 w-3.5" />
            Adjust Warehouse Stock
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/purchase-orders?action=new&supplierId=${selectedPartnerId}`)}
            className="text-xs gap-1.5 h-8 font-semibold"
          >
            <Plus className="h-3.5 w-3.5" />
            Intake PO from {selectedPartner?.name?.split(" ")[0] || "Partner"}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            className="text-xs gap-1 h-8"
            title="Export Settlement CSV"
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handlePrint}
            className="text-xs gap-1 h-8"
            title="Print Settlement Sheet"
          >
            <Printer className="h-3.5 w-3.5" />
            Print
          </Button>
        </div>
      </div>

      {/* Printable Header */}
      <div className="hidden print:block border-b border-black pb-3">
        <h2 className="text-lg font-bold text-black uppercase">
          Partnership Stock & Settlement Statement
        </h2>
        <div className="flex justify-between text-xs mt-1">
          <div>
            <strong>Co-Owner / Beneficiary:</strong> {hubData?.partner.name}
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

      {/* Metric Cards Grid (7 Key Metrics) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        {/* Card 1: Shared WH Valuation */}
        <Card className="border-amber-200 dark:border-amber-900 bg-amber-50/40 dark:bg-amber-950/20 shadow-xs">
          <CardContent className="p-3.5 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-400 block">
              Shared WH Valuation
            </span>
            <div className="text-base sm:text-lg font-black font-mono text-slate-900 dark:text-slate-100">
              PKR {(hubData?.metrics?.currentStockValuationSharedWarehouse || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
            <p className="text-[10px] text-slate-500">
              {hubData?.locations?.sharedWarehouse?.name || "Shared Warehouse"}
            </p>
          </CardContent>
        </Card>

        {/* Card 2: Shop Partner Lots Valuation */}
        <Card className="border-emerald-200 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/20 shadow-xs">
          <CardContent className="p-3.5 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-400 block">
              Shop Partner Stock
            </span>
            <div className="text-base sm:text-lg font-black font-mono text-slate-900 dark:text-slate-100">
              PKR {(hubData?.metrics?.currentStockValuationShopPartnerLots || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
            <p className="text-[10px] text-slate-500">
              Held in {hubData?.locations?.shop?.name || "Shop"}
            </p>
          </CardContent>
        </Card>

        {/* Card 3: Total Purchased from B */}
        <Card className="border-slate-200 dark:border-slate-800 shadow-xs">
          <CardContent className="p-3.5 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 block">
              Purchased to Date
            </span>
            <div className="text-base sm:text-lg font-black font-mono text-slate-900 dark:text-slate-100">
              PKR {(hubData?.metrics?.totalPurchasedFromB || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
            <p className="text-[10px] text-slate-500">Total inward purchases</p>
          </CardContent>
        </Card>

        {/* Card 4: Total Revenue from Partner Lots */}
        <Card className="border-blue-200 dark:border-blue-900 bg-blue-50/40 dark:bg-blue-950/20 shadow-xs">
          <CardContent className="p-3.5 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-800 dark:text-blue-400 block">
              Partner Sales Revenue
            </span>
            <div className="text-base sm:text-lg font-black font-mono text-slate-900 dark:text-slate-100">
              PKR {(hubData?.metrics?.totalSalesRevenue || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
            <p className="text-[10px] text-slate-500">Sales from partner lots</p>
          </CardContent>
        </Card>

        {/* Card 5: Total COGS */}
        <Card className="border-slate-200 dark:border-slate-800 shadow-xs">
          <CardContent className="p-3.5 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 block">
              Total COGS
            </span>
            <div className="text-base sm:text-lg font-black font-mono text-slate-900 dark:text-slate-100">
              PKR {(hubData?.metrics?.totalCOGS || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
            <p className="text-[10px] text-slate-500">Actual lot batch costs</p>
          </CardContent>
        </Card>

        {/* Card 6: Net Gross Margin */}
        <Card className="border-teal-200 dark:border-teal-900 bg-teal-50/40 dark:bg-teal-950/20 shadow-xs">
          <CardContent className="p-3.5 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-teal-800 dark:text-teal-400 block">
              Net Gross Margin
            </span>
            <div className="text-base sm:text-lg font-black font-mono text-emerald-800 dark:text-emerald-400">
              PKR {(hubData?.metrics?.netGrossMargin || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
            <p className="text-[10px] text-teal-800 font-semibold">
              {hubData?.metrics?.totalSalesRevenue
                ? `${(((hubData.metrics.netGrossMargin || 0) / hubData.metrics.totalSalesRevenue) * 100).toFixed(1)}% margin`
                : "0% margin"}
            </p>
          </CardContent>
        </Card>

        {/* Card 7: Payable to Person B */}
        <Card className="border-rose-200 dark:border-rose-900 bg-rose-50/40 dark:bg-rose-950/20 shadow-xs">
          <CardContent className="p-3.5 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-rose-800 dark:text-rose-400 block">
              Payable to Person B
            </span>
            <div className="text-base sm:text-lg font-black font-mono text-rose-900 dark:text-rose-300">
              PKR {(hubData?.metrics?.currentPayableToB || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
            <a
              href={`/payments?partyId=${selectedPartnerId}&action=new`}
              className="text-[10px] text-rose-700 hover:text-rose-900 font-bold underline block"
            >
              Pay / Settle Ledger →
            </a>
          </CardContent>
        </Card>
      </div>

      {/* Section 1: Product Breakdown Table */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Layers className="h-4 w-4 text-amber-700" />
              Product Breakdown & Lot Allocation
            </h2>
            <p className="text-xs text-slate-500">
              Realtime breakdown of stock purchased from {selectedPartner?.name || "Person B"}, quantities sold, stock in Shop vs Shared Warehouse, and lot batches.
            </p>
          </div>

          <div className="relative w-64 print:hidden">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <Input
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              placeholder="Filter products..."
              className="h-8 pl-8 text-xs bg-white dark:bg-slate-950 font-medium"
            />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xs overflow-hidden print:border-black">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700 text-[11px] font-bold uppercase tracking-wider print:bg-slate-200 print:text-black">
                <tr>
                  <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700 w-8"></th>
                  <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700 min-w-[180px]">Product Name / SKU</th>
                  <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700 text-right">Purchased from B</th>
                  <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700 text-right">Avg Batch Cost</th>
                  <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700 text-right">Qty Sold</th>
                  <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700 text-right font-bold text-emerald-900 dark:text-emerald-400">Shop Stock</th>
                  <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700 text-right font-bold text-amber-900 dark:text-amber-400">Shared WH Stock</th>
                  <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700 text-right">Sales Revenue</th>
                  <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700 text-right font-bold">Gross Margin</th>
                  <th className="py-2.5 px-3 text-center print:hidden">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {loading ? (
                  <tr>
                    <td colSpan={10} className="py-10 text-center text-slate-500">
                      Loading product breakdown...
                    </td>
                  </tr>
                ) : filteredProducts.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-10 text-center text-slate-500">
                      No products found. Start by creating a Purchase Order or Invoice from {selectedPartner?.name || "Person B"}.
                    </td>
                  </tr>
                ) : (
                  filteredProducts.map((p) => {
                    const isExpanded = expandedProductIds.has(p.product.id);
                    return (
                      <>
                        <tr
                          key={p.product.id}
                          className="hover:bg-slate-50/70 dark:hover:bg-slate-800/60 transition-colors"
                        >
                          <td className="py-2 px-3 border-r border-slate-200/60 text-center">
                            <button
                              type="button"
                              onClick={() => toggleProductExpand(p.product.id)}
                              className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500"
                              title="Toggle lot history"
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
                                {p.lots.length} active lot batch{p.lots.length > 1 ? "es" : ""}
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
                          <td className="py-2 px-3 border-r border-slate-200/60 text-right font-mono font-bold text-amber-900 dark:text-amber-400">
                            {p.remainingInSharedWarehouse.toLocaleString()} {p.product.unit}
                          </td>
                          <td className="py-2 px-3 border-r border-slate-200/60 text-right font-mono">
                            PKR {p.totalSalesRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </td>
                          <td className="py-2 px-3 border-r border-slate-200/60 text-right font-mono font-bold text-emerald-800 dark:text-emerald-400">
                            PKR {p.grossMargin.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </td>
                          <td className="py-2 px-3 text-center whitespace-nowrap print:hidden">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openAdjustModalForProduct(p.product.id)}
                              className="h-7 text-[11px] px-2 text-amber-800 hover:text-amber-900 hover:bg-amber-50"
                            >
                              Adjust WH Stock
                            </Button>
                          </td>
                        </tr>

                        {/* Expandable Lot History Details */}
                        {isExpanded && (
                          <tr className="bg-amber-50/30 dark:bg-amber-950/20 border-b border-amber-200 dark:border-amber-900">
                            <td colSpan={10} className="py-2 px-6">
                              <div className="space-y-1.5 py-1">
                                <span className="text-[11px] font-bold text-amber-900 dark:text-amber-300 uppercase tracking-wider block">
                                  Lot Batch History for {p.product.name}
                                </span>
                                {p.lots.length === 0 ? (
                                  <p className="text-xs text-slate-500 italic">No specific lot records assigned yet.</p>
                                ) : (
                                  <table className="w-full text-left text-xs bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800 rounded-md">
                                    <thead className="bg-amber-100/60 dark:bg-amber-950 text-amber-950 dark:text-amber-200 text-[10px] font-bold uppercase">
                                      <tr>
                                        <th className="py-1.5 px-3">Lot Number</th>
                                        <th className="py-1.5 px-3">Inward Date</th>
                                        <th className="py-1.5 px-3 text-right">Inward Price</th>
                                        <th className="py-1.5 px-3 text-right">Qty Received</th>
                                        <th className="py-1.5 px-3 text-right">Qty Sold</th>
                                        <th className="py-1.5 px-3 text-right font-bold">Qty Remaining in Shop</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-amber-100 dark:divide-amber-900">
                                      {p.lots.map((lot) => (
                                        <tr key={lot.id} className="hover:bg-amber-50/50">
                                          <td className="py-1.5 px-3 font-mono font-bold text-amber-900 dark:text-amber-300">
                                            {lot.lotNumber}
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
                                          <td className="py-1.5 px-3 text-right font-mono">
                                            {lot.qtySold} {p.product.unit}
                                          </td>
                                          <td className="py-1.5 px-3 text-right font-mono font-bold text-emerald-800 dark:text-emerald-400">
                                            {lot.qtyRemaining} {p.product.unit}
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
                      </>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Section 2: Sales & Settlement Log */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Receipt className="h-4 w-4 text-emerald-700" />
              Sales & Settlement Log (Partner Lots)
            </h2>
            <p className="text-xs text-slate-500">
              Filterable transaction ledger of every item sold out of {selectedPartner?.name || "Person B"}&apos;s lots, with specific purchase lot costs and net margin.
            </p>
          </div>

          {/* Date range filters */}
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
                  <th className="py-2 px-3 border-r border-slate-200 dark:border-slate-700 min-w-[160px]">Product Name</th>
                  <th className="py-2 px-3 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap">Lot Batch</th>
                  <th className="py-2 px-3 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap">Qty Sold</th>
                  <th className="py-2 px-3 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap">Unit Sale Price</th>
                  <th className="py-2 px-3 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap">Unit Lot Cost</th>
                  <th className="py-2 px-3 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap font-bold">Total Sale</th>
                  <th className="py-2 px-3 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap">Total Cost</th>
                  <th className="py-2 px-3 text-right whitespace-nowrap font-bold text-emerald-800 dark:text-emerald-400">Net Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {loading ? (
                  <tr>
                    <td colSpan={11} className="py-10 text-center text-slate-500">
                      Loading settlement log...
                    </td>
                  </tr>
                ) : !hubData?.settlementLog || hubData.settlementLog.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-10 text-center text-slate-500">
                      No partner lot sales recorded in this period.
                    </td>
                  </tr>
                ) : (
                  hubData.settlementLog.map((log) => (
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
                      <td className="py-2 px-3 text-right font-mono font-bold text-emerald-800 dark:text-emerald-400 whitespace-nowrap">
                        PKR {log.netMargin.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {hubData?.settlementLog && hubData.settlementLog.length > 0 && (
                <tfoot className="bg-slate-100 dark:bg-slate-800 border-t-2 border-slate-300 dark:border-slate-700 font-bold text-xs">
                  <tr>
                    <td colSpan={8} className="py-2.5 px-3 text-right uppercase tracking-wider text-slate-700 dark:text-slate-300">
                      Total Summary:
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono border-r border-slate-300 dark:border-slate-700">
                      PKR {hubData.metrics.totalSalesRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono border-r border-slate-300 dark:border-slate-700 text-slate-600">
                      PKR {hubData.metrics.totalCOGS.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-emerald-800 dark:text-emerald-400">
                      PKR {hubData.metrics.netGrossMargin.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>

      {/* Manual Shared Warehouse Adjustment Modal */}
      {showAdjustModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-700 rounded-xl shadow-2xl p-5 overflow-hidden">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="h-4 w-4 text-amber-700" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Shared Warehouse Stock Adjustment
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAdjustModal(false)}
                className="rounded p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-[11px] text-slate-500 mt-2">
              Log direct removals (e.g. bulk sales or write-offs) or additions occurring directly out of the shared warehouse without passing through Person A&apos;s shop.
            </p>

            {adjustError && (
              <div className="mt-3 rounded bg-rose-50 border border-rose-200 p-2 text-xs text-rose-700 flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span>{adjustError}</span>
              </div>
            )}

            <form onSubmit={handleAdjustSubmit} onKeyDown={handleFormEnterKeyDown} className="mt-3 space-y-3 text-xs">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Warehouse Location *</Label>
                <select
                  value={adjustLocationId}
                  onChange={(e) => setAdjustLocationId(e.target.value)}
                  className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-medium"
                  required
                >
                  <option value="">Select location</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name} ({loc.type})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">Product *</Label>
                <select
                  value={adjustProductId}
                  onChange={(e) => setAdjustProductId(e.target.value)}
                  className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-medium"
                  required
                >
                  <option value="">Select product</option>
                  {hubData?.productBreakdown.map((item) => (
                    <option key={item.product.id} value={item.product.id}>
                      {item.product.productNo} - {item.product.name} (Shared WH: {item.remainingInSharedWarehouse} {item.product.unit})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs font-semibold">Direction *</Label>
                  <select
                    value={adjustDirection}
                    onChange={(e) => setAdjustDirection(e.target.value as "OUT" | "IN")}
                    className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-medium font-bold text-amber-900"
                  >
                    <option value="OUT">- Decrement (Direct Sale / Removal)</option>
                    <option value="IN">+ Increment (Addition / Correction)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-semibold">Quantity *</Label>
                  <Input
                    type="number"
                    min="0.0001"
                    step="any"
                    value={adjustQuantity}
                    onChange={(e) => setAdjustQuantity(parseFloat(e.target.value) || 0)}
                    className="h-8 text-xs font-mono"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">Date *</Label>
                <Input
                  type="date"
                  value={adjustDate}
                  onChange={(e) => setAdjustDate(e.target.value)}
                  className="h-8 text-xs"
                  required
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">Reason (Mandatory) *</Label>
                <Input
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder="e.g. Sold 50 units directly to third-party buyer"
                  className="h-8 text-xs"
                  required
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">Reference Notes / Buyer Details</Label>
                <Input
                  value={adjustNotes}
                  onChange={(e) => setAdjustNotes(e.target.value)}
                  placeholder="e.g. Third-party invoice #9182 / dispatch slip"
                  className="h-8 text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
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
                  className="bg-amber-800 hover:bg-amber-700 text-white h-8 text-xs font-semibold"
                >
                  {submittingAdjust ? "Posting..." : "Post WH Adjustment"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/toast";
import { deletePartnershipLotAction } from "@/actions/partnerships";
import { Button } from "@/components/ui/button";
import {
  Layers,
  Truck,
  ShoppingCart,
  Receipt,
  Banknote,
  ArrowLeft,
  DollarSign,
  TrendingUp,
  Package,
  FileText,
  History,
  ShieldCheck,
  Building,
  Trash2,
} from "lucide-react";
import { PullPartnershipStockModal } from "./PullPartnershipStockModal";
import { PartnershipLotIntakeModal } from "./PartnershipLotIntakeModal";
import { VmiObtainFromLotModal } from "./VmiObtainFromLotModal";
import { ExternalLiquidationModal } from "./ExternalLiquidationModal";
import { RecordPartnershipExpenseModal } from "./RecordPartnershipExpenseModal";
import { SettlementPayoutModal } from "./SettlementPayoutModal";
import { AccountOfSalesStatement } from "./AccountOfSalesStatement";
import { InventoryMovementAuditSheet } from "./InventoryMovementAuditSheet";
import { PartnerSettlementStatement } from "./PartnerSettlementStatement";
import {
  PrintPaperSizeControl,
  PrintPaperSizeStyle,
  type PrintPaperSize,
} from "@/components/print/PrintPaperSizeControl";

interface PartnershipLotClientProps {
  initialData: any;
  destinationLocations: Array<{
    id: string;
    name: string;
    lots?: Array<{ id: string; lotNumber: string; quantity: number }>;
  }>;
}

export function PartnershipLotClient({
  initialData,
  destinationLocations,
}: PartnershipLotClientProps) {
  const router = useRouter();
  const { lot, metrics, items, allocations, expenses, movements, payouts } = initialData;
  const [deletingLot, setDeletingLot] = useState(false);

  const [activeTab, setActiveTab] = useState<"stock" | "sales" | "expenses" | "statements">("stock");
  const [statementSubTab, setStatementSubTab] = useState<"sales" | "movement" | "settlement">("sales");
  const [statementPaperSize, setStatementPaperSize] = useState<PrintPaperSize>("A4");

  // Modals state
  const [showPullModal, setShowPullModal] = useState(false);
  const [showIntakeModal, setShowIntakeModal] = useState(false);
  const [showVmiObtainModal, setShowVmiObtainModal] = useState(false);
  const [showLiquidationModal, setShowLiquidationModal] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showPayoutModal, setShowPayoutModal] = useState(false);

  const isConsignment = lot.type === "CONSIGNMENT_VMI";

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-4 sm:p-6 pb-20">
      {/* Top Breadcrumb & Actions Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href="/partnerships"
              className="text-xs text-muted-foreground hover:text-gray-900 flex items-center gap-1 font-medium transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back to Partnerships Hub
            </Link>
          </div>
          <div className="flex items-center gap-3 mt-1.5">
            <h1 className="text-2xl font-black text-gray-900 font-mono tracking-tight">{lot.lotNumber}</h1>
            <span
              className={`text-xs px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                isConsignment
                  ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                  : "bg-indigo-100 text-indigo-800 border border-indigo-300"
              }`}
            >
              {isConsignment ? "Consignment / VMI" : "Co-Invested Shared Pool"}
            </span>
            <span className="text-xs px-2 py-0.5 rounded-md bg-gray-100 text-gray-700 font-semibold border">
              {lot.status}
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
            <span>
              Partner: <strong className="text-gray-800">{lot.partnerName}</strong>
            </span>
            <span>•</span>
            <span>
              Warehouse: <strong className="text-gray-800">{lot.warehouseName}</strong>
            </span>
            <span>•</span>
            <span>
              Created: <strong className="text-gray-800">{new Date(lot.createdAt).toLocaleDateString()}</strong>
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowIntakeModal(true)}
            className="gap-1 text-xs border-indigo-300 text-indigo-800"
          >
            <Package className="h-3.5 w-3.5" /> Lot intake
          </Button>

          {isConsignment ? (
            <Button
              size="sm"
              onClick={() => setShowVmiObtainModal(true)}
              className="bg-emerald-700 hover:bg-emerald-800 text-white gap-1 text-xs shadow-sm"
            >
              <ShoppingCart className="h-3.5 w-3.5" /> Purchase from partner
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => setShowPullModal(true)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1 text-xs shadow-sm"
            >
              <Truck className="h-3.5 w-3.5" /> Transfer stock
            </Button>
          )}

          {!isConsignment && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowLiquidationModal(true)}
              className="gap-1 text-xs text-purple-700 border-purple-200 hover:bg-purple-50"
            >
              <ShoppingCart className="h-3.5 w-3.5" /> Partner Liquidation
            </Button>
          )}

          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowExpenseModal(true)}
            className="gap-1 text-xs text-gray-700 hover:bg-gray-50"
          >
            <Receipt className="h-3.5 w-3.5" /> Record Expense
          </Button>

          <Button
            size="sm"
            variant="outline"
            disabled={deletingLot}
            onClick={async () => {
              if (
                !window.confirm(
                  `Delete lot ${lot.lotNumber}? Only allowed when stock is cleared and settlement is zero.`,
                )
              ) {
                return;
              }
              setDeletingLot(true);
              try {
                const res = await deletePartnershipLotAction(lot.id);
                if (res.success) {
                  toast.success("Partnership lot deleted.");
                  router.push("/partnerships");
                  router.refresh();
                } else {
                  toast.error((res as { error?: string }).error || "Could not delete lot.");
                }
              } finally {
                setDeletingLot(false);
              }
            }}
            className="gap-1 text-xs text-rose-700 border-rose-200 hover:bg-rose-50"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete lot
          </Button>

          <Button
            size="sm"
            onClick={() => setShowPayoutModal(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1 text-xs shadow-sm"
          >
            <Banknote className="h-3.5 w-3.5" />{" "}
            {metrics.netSettlementDirection === "PARTNER_OWES_ENTITY" ? "Record receipt" : "Disburse Payout"}
          </Button>
        </div>
      </div>

      {/* CPA-Grade Executive KPI Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3.5">
        {/* 1. Contributed Capital */}
        <div className="bg-white p-4 rounded-xl border shadow-sm relative overflow-hidden">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Contributed Capital
          </div>
          <div className="text-lg font-black text-gray-900 mt-1">
            PKR {metrics.totalCapitalCost.toLocaleString()}
          </div>
          <div className="mt-2 text-[10px] text-muted-foreground space-y-0.5">
            <div className="flex justify-between">
              <span>Partner Share:</span>
              <span className="font-semibold text-indigo-600">
                PKR {metrics.partnerCapitalShare.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Entity Share:</span>
              <span className="font-semibold text-emerald-600">
                PKR {metrics.entityCapitalShare.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* 2. Lot Inventory */}
        <div className="bg-white p-4 rounded-xl border shadow-sm relative overflow-hidden">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Lot Inventory Balance
          </div>
          <div className="text-lg font-black text-gray-900 mt-1">
            {metrics.totalRemainingUnits}{" "}
            <span className="text-xs font-normal text-muted-foreground">/ {metrics.totalInitialUnits} Units</span>
          </div>
          <div className="mt-2 text-[10px] text-muted-foreground space-y-0.5">
            <div className="flex justify-between">
              <span>Remaining Value:</span>
              <span className="font-semibold text-gray-900">
                PKR {metrics.totalRemainingValuation.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Pulled to Shop:</span>
              <span className="font-semibold text-gray-700">{metrics.pulledUnitsTotal} Units</span>
            </div>
          </div>
        </div>

        {/* 3. Gross Revenue */}
        <div className="bg-white p-4 rounded-xl border shadow-sm relative overflow-hidden">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Gross Revenue
          </div>
          <div className="text-lg font-black text-gray-900 mt-1">
            PKR {metrics.totalGrossRevenue.toLocaleString()}
          </div>
          <div className="mt-2 text-[10px] text-muted-foreground space-y-0.5">
            <div className="flex justify-between">
              <span>COGS Realized:</span>
              <span className="font-semibold text-gray-700">
                PKR {metrics.totalCOGS.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Units Sold:</span>
              <span className="font-semibold text-gray-700">
                {(metrics.totalUnitsSold ?? metrics.internalSoldUnits + metrics.liquidatedUnitsTotal) ?? 0}{" "}
                Units
              </span>
            </div>
          </div>
        </div>

        {/* 4. Gross Margin & Partner Accrued Profit */}
        <div className="bg-white p-4 rounded-xl border shadow-sm relative overflow-hidden">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Gross Profit Margin
          </div>
          <div className="text-lg font-black text-indigo-700 mt-1">
            PKR {metrics.totalGrossMargin.toLocaleString()}
          </div>
          <div className="mt-2 text-[10px] text-muted-foreground space-y-0.5">
            <div className="flex justify-between">
              <span>Partner Profit Share:</span>
              <span className="font-bold text-indigo-600">
                PKR {metrics.partnerAccruedMarginShare.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Shop Retained:</span>
              <span className="font-bold text-emerald-600">
                PKR {metrics.shopRetainedMargin.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* 5. Recorded Expenses */}
        <div className="bg-white p-4 rounded-xl border shadow-sm relative overflow-hidden">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Lot Carrying Costs
          </div>
          <div className="text-lg font-black text-gray-900 mt-1">
            PKR {metrics.totalExpenses.toLocaleString()}
          </div>
          <div className="mt-2 text-[10px] text-muted-foreground space-y-0.5">
            <div className="flex justify-between">
              <span>Paid by Entity:</span>
              <span className="font-semibold text-gray-700">
                PKR {metrics.entityPaidExpenses.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Paid by Partner:</span>
              <span className="font-semibold text-purple-600">
                PKR {metrics.partnerPaidExpenses.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* 6. Net Settlement Position */}
        <div
          className={`p-4 rounded-xl border shadow-sm relative overflow-hidden ${
            metrics.netSettlementDirection === "ENTITY_OWES_PARTNER"
              ? "bg-amber-50/80 border-amber-200"
              : "bg-emerald-50/80 border-emerald-200"
          }`}
        >
          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-900">
            Net Settlement Balance
          </div>
          <div className="text-lg font-black text-amber-950 mt-1">
            PKR {metrics.netSettlementAmount.toLocaleString()}
          </div>
          <div className="mt-2 text-[10px] text-amber-800 font-medium">
            {metrics.netSettlementDirection === "ENTITY_OWES_PARTNER"
              ? `Accrued payable to ${lot.partnerName}`
              : `Receivable from ${lot.partnerName}`}
          </div>
          <div className="text-[9px] text-amber-700">
            Total Payouts: PKR {metrics.totalPayouts.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Main Tabs Navigation */}
      <div className="flex border-b text-sm font-medium gap-6">
        <button
          onClick={() => setActiveTab("stock")}
          className={`pb-3 flex items-center gap-2 border-b-2 transition-all ${
            activeTab === "stock"
              ? "border-indigo-600 text-indigo-600 font-bold"
              : "border-transparent text-gray-500 hover:text-gray-900"
          }`}
        >
          <Package className="h-4 w-4" /> Stock & Transfers Register
        </button>

        <button
          onClick={() => setActiveTab("sales")}
          className={`pb-3 flex items-center gap-2 border-b-2 transition-all ${
            activeTab === "sales"
              ? "border-indigo-600 text-indigo-600 font-bold"
              : "border-transparent text-gray-500 hover:text-gray-900"
          }`}
        >
          <TrendingUp className="h-4 w-4" /> Sales & Allocations Register ({allocations.length})
        </button>

        <button
          onClick={() => setActiveTab("expenses")}
          className={`pb-3 flex items-center gap-2 border-b-2 transition-all ${
            activeTab === "expenses"
              ? "border-indigo-600 text-indigo-600 font-bold"
              : "border-transparent text-gray-500 hover:text-gray-900"
          }`}
        >
          <Receipt className="h-4 w-4" /> Expenses & Carrying Costs ({expenses.length})
        </button>

        <button
          onClick={() => setActiveTab("statements")}
          className={`pb-3 flex items-center gap-2 border-b-2 transition-all ${
            activeTab === "statements"
              ? "border-indigo-600 text-indigo-600 font-bold"
              : "border-transparent text-gray-500 hover:text-gray-900"
          }`}
        >
          <FileText className="h-4 w-4" /> Statements & Printable Reports
        </button>
      </div>

      {/* Tab 1: Stock & Transfers */}
      {activeTab === "stock" && (
        <div className="space-y-4">
          <div className="flex flex-wrap justify-between items-center gap-2">
            <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider">
              Stock on hand, intakes &amp; movements
            </h3>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setShowIntakeModal(true)} className="gap-1 text-xs">
                <Package className="h-3.5 w-3.5" /> Intake
              </Button>
              {isConsignment ? (
                <Button
                  size="sm"
                  onClick={() => setShowVmiObtainModal(true)}
                  className="bg-emerald-700 hover:bg-emerald-800 text-white gap-1 text-xs"
                >
                  <ShoppingCart className="h-3.5 w-3.5" /> VMI purchase
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => setShowPullModal(true)}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1 text-xs"
                >
                  <Truck className="h-3.5 w-3.5" /> Transfer
                </Button>
              )}
            </div>
          </div>

          <div className="bg-white border rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left font-bold text-gray-700">Product Line</th>
                  <th className="px-4 py-3 text-right font-bold text-gray-700">Initial Inward Qty</th>
                  <th className="px-4 py-3 text-right font-bold text-gray-700">Unit Cost Rate</th>
                  <th className="px-4 py-3 text-right font-bold text-gray-700">Pulled to Shop (DO)</th>
                  <th className="px-4 py-3 text-right font-bold text-gray-700">Partner Liquidated</th>
                  <th className="px-4 py-3 text-right font-bold text-gray-700">Remaining in Lot</th>
                  <th className="px-4 py-3 text-right font-bold text-gray-700">Current Valuation</th>
                  <th className="px-4 py-3 text-center font-bold text-gray-700">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((it: any) => (
                  <tr key={it.id} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <div className="font-bold text-gray-900">{it.productName}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">{it.productNo}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      {it.initialQuantity} {it.unit}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-700">
                      PKR {it.unitCostRate.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-blue-600">
                      {it.pulledToShopQty} {it.unit}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-purple-600">
                      {it.liquidatedByPartnerQty} {it.unit}
                    </td>
                    <td className="px-4 py-3 text-right font-bold font-mono text-gray-900 text-sm">
                      {it.remainingQuantity} {it.unit}
                    </td>
                    <td className="px-4 py-3 text-right font-bold font-mono text-emerald-600">
                      PKR {it.remainingValuation.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3 text-center text-[10px] text-muted-foreground">—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-700">Movement register</h4>
            <div className="bg-white border rounded-xl overflow-hidden shadow-sm max-h-80 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-bold">Date &amp; time</th>
                    <th className="px-3 py-2 text-left font-bold">Type</th>
                    <th className="px-3 py-2 text-left font-bold">Product</th>
                    <th className="px-3 py-2 text-left font-bold">Location</th>
                    <th className="px-3 py-2 text-right font-bold">Qty</th>
                    <th className="px-3 py-2 text-left font-bold">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {movements.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                        No stock movements recorded yet.
                      </td>
                    </tr>
                  ) : (
                    movements.map((m: any) => (
                      <tr key={m.id} className="hover:bg-gray-50/50">
                        <td className="px-3 py-2 font-mono text-[11px] whitespace-nowrap">
                          {new Date(m.date).toLocaleString()}
                        </td>
                        <td className="px-3 py-2">
                          <span className="font-semibold text-gray-800">{m.type.replace(/_/g, " ")}</span>
                          {m.referenceType === "PARTNERSHIP_LOT_INTAKE" && (
                            <span className="ml-1 text-[10px] text-indigo-600 font-bold">INTAKE</span>
                          )}
                          {m.referenceType === "VMI_OBTAIN" && (
                            <span className="ml-1 text-[10px] text-emerald-700 font-bold">VMI PI</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {m.productName}{" "}
                          <span className="text-muted-foreground font-mono text-[10px]">({m.productNo})</span>
                        </td>
                        <td className="px-3 py-2 text-gray-700">{m.locationName}</td>
                        <td className="px-3 py-2 text-right font-bold font-mono">
                          {m.quantity} {m.unit}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground max-w-xs truncate">{m.notes || "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Sales & Allocations Register */}
      {activeTab === "sales" && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider">
                Sales & Profit Margin Allocations Register
              </h3>
              <p className="text-xs text-muted-foreground">
                Itemized log of POS sales and external partner liquidations with margin split calculation.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowLiquidationModal(true)}
              className="gap-1 text-xs text-purple-700 border-purple-200 hover:bg-purple-50"
            >
              <ShoppingCart className="h-3.5 w-3.5" /> Record Partner Liquidation
            </Button>
          </div>

          <div className="bg-white border rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-3 py-2.5 text-left font-bold text-gray-700">Date</th>
                  <th className="px-3 py-2.5 text-left font-bold text-gray-700">Invoice / Ref #</th>
                  <th className="px-3 py-2.5 text-left font-bold text-gray-700">Buyer / Customer</th>
                  <th className="px-3 py-2.5 text-left font-bold text-gray-700">Channel</th>
                  <th className="px-3 py-2.5 text-left font-bold text-gray-700">Product</th>
                  <th className="px-3 py-2.5 text-right font-bold text-gray-700">Qty Sold</th>
                  <th className="px-3 py-2.5 text-right font-bold text-gray-700">Cost Rate</th>
                  <th className="px-3 py-2.5 text-right font-bold text-gray-700">Sale Rate</th>
                  <th className="px-3 py-2.5 text-right font-bold text-gray-700">Gross Margin</th>
                  <th className="px-3 py-2.5 text-right font-bold text-gray-700">Partner Margin Share</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {allocations.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">
                      No sales allocations recorded yet.
                    </td>
                  </tr>
                ) : (
                  allocations.map((a: any) => (
                    <tr key={a.id} className="hover:bg-gray-50/50">
                      <td className="px-3 py-2.5 text-gray-600 font-mono text-[11px]">
                        {new Date(a.allocatedAt).toLocaleDateString()}
                      </td>
                      <td className="px-3 py-2.5 font-mono font-medium text-gray-900">{a.invoiceNo}</td>
                      <td className="px-3 py-2.5 text-gray-800 font-medium">{a.customerName}</td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider ${
                            a.salesChannel === "INTERNAL_POS"
                              ? "bg-blue-50 text-blue-700 border border-blue-200"
                              : "bg-purple-50 text-purple-700 border border-purple-200"
                          }`}
                        >
                          {a.salesChannel === "INTERNAL_POS" ? "Shop POS" : "Partner Direct"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-medium">
                        {a.productName} <span className="text-[10px] text-muted-foreground">({a.productNo})</span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium">
                        {a.quantity} {a.unit}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-gray-600">
                        PKR {a.unitCostRate.toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-medium text-gray-900">
                        PKR {a.unitSaleRate.toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold text-gray-900">
                        PKR {a.grossMargin.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold text-indigo-600 font-mono">
                        PKR {a.partnerMarginShare.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Expenses */}
      {activeTab === "expenses" && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider">
                Partnership Lot Carrying & Maintenance Expenses
              </h3>
              <p className="text-xs text-muted-foreground">
                Track warehouse rent, forklift handling, inward freight, and carrying fees.
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => setShowExpenseModal(true)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1 text-xs"
            >
              <Receipt className="h-3.5 w-3.5" /> Record Expense
            </Button>
          </div>

          <div className="bg-white border rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left font-bold text-gray-700">Date</th>
                  <th className="px-4 py-3 text-left font-bold text-gray-700">Category</th>
                  <th className="px-4 py-3 text-left font-bold text-gray-700">Description</th>
                  <th className="px-4 py-3 text-left font-bold text-gray-700">Paid By</th>
                  <th className="px-4 py-3 text-right font-bold text-gray-700">Amount (PKR)</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {expenses.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      No expenses attached to this lot yet.
                    </td>
                  </tr>
                ) : (
                  expenses.map((e: any) => (
                    <tr key={e.id} className="hover:bg-gray-50/50">
                      <td className="px-4 py-3 text-gray-600 font-mono text-[11px]">
                        {new Date(e.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 font-semibold text-gray-900">{e.category}</td>
                      <td className="px-4 py-3 text-gray-700">{e.description}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                            e.paidBy === "PARTNER"
                              ? "bg-purple-50 text-purple-700 border border-purple-200"
                              : "bg-blue-50 text-blue-700 border border-blue-200"
                          }`}
                        >
                          {e.paidBy}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-bold font-mono text-gray-900 text-sm">
                        PKR {e.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 4: Statements & Printable Reports */}
      {activeTab === "statements" && (
        <div className="space-y-4">
          <PrintPaperSizeStyle paperSize={statementPaperSize} />
          <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
            <PrintPaperSizeControl value={statementPaperSize} onChange={setStatementPaperSize} />
          </div>
          <div className="flex border-b gap-3 pb-2 text-xs">
            <button
              onClick={() => setStatementSubTab("sales")}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                statementSubTab === "sales"
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              Account of Sales (Goods Liquidation Statement)
            </button>

            <button
              onClick={() => setStatementSubTab("movement")}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                statementSubTab === "movement"
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              Inventory Movement & Audit Sheet
            </button>

            <button
              onClick={() => setStatementSubTab("settlement")}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                statementSubTab === "settlement"
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              Partner Settlement Statement (Running Ledger)
            </button>
          </div>

          {statementSubTab === "sales" && (
            <AccountOfSalesStatement
              lotNumber={lot.lotNumber}
              lotType={lot.type}
              partnerName={lot.partnerName}
              partnerPhone={lot.partnerPhone}
              partnerMarginRatioPct={metrics.partnerMarginRatioPct}
              allocations={allocations}
              expenses={expenses}
              netSettlementAmount={metrics.netSettlementAmount}
              netSettlementDirection={metrics.netSettlementDirection}
              totalPayouts={metrics.totalPayouts}
              totalReceipts={metrics.totalReceipts}
            />
          )}

          {statementSubTab === "movement" && (
            <InventoryMovementAuditSheet
              lotNumber={lot.lotNumber}
              partnerName={lot.partnerName}
              movements={movements}
            />
          )}

          {statementSubTab === "settlement" && (
            <PartnerSettlementStatement
              lotNumber={lot.lotNumber}
              lotType={lot.type}
              partnerName={lot.partnerName}
              partnerCapitalShare={metrics.partnerCapitalShare}
              partnerMarginRatioPct={metrics.partnerMarginRatioPct}
              allocations={allocations}
              expenses={expenses}
              payouts={payouts}
            />
          )}
        </div>
      )}

      {/* Modals */}
      <PartnershipLotIntakeModal
        open={showIntakeModal}
        onOpenChange={setShowIntakeModal}
        lotId={lot.id}
        lotNumber={lot.lotNumber}
      />

      {isConsignment && (
        <VmiObtainFromLotModal
          open={showVmiObtainModal}
          onOpenChange={setShowVmiObtainModal}
          lotId={lot.id}
          lotNumber={lot.lotNumber}
          partnerName={lot.partnerName}
          items={items}
          destinationLocations={destinationLocations}
        />
      )}

      {!isConsignment && (
        <PullPartnershipStockModal
          open={showPullModal}
          onOpenChange={setShowPullModal}
          lotId={lot.id}
          lotNumber={lot.lotNumber}
          lotType={lot.type}
          partnerName={lot.partnerName}
          items={items}
          destinationLocations={destinationLocations}
        />
      )}

      <ExternalLiquidationModal
        open={showLiquidationModal}
        onOpenChange={setShowLiquidationModal}
        lotId={lot.id}
        lotNumber={lot.lotNumber}
        partnerName={lot.partnerName}
        partnerMarginRatio={lot.partnerMarginRatio}
        items={items}
      />

      <RecordPartnershipExpenseModal
        open={showExpenseModal}
        onOpenChange={setShowExpenseModal}
        lotId={lot.id}
        lotNumber={lot.lotNumber}
        partnerName={lot.partnerName}
      />

      <SettlementPayoutModal
        open={showPayoutModal}
        onOpenChange={setShowPayoutModal}
        lotId={lot.id}
        lotNumber={lot.lotNumber}
        partnerName={lot.partnerName}
        suggestedAmount={metrics.netSettlementAmount}
        direction={metrics.netSettlementDirection === "PARTNER_OWES_ENTITY" ? "IN" : "OUT"}
      />
    </div>
  );
}

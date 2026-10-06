"use client";

import { Printer, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AllocationItem {
  id: string;
  invoiceNo: string;
  customerName: string;
  productNo: string;
  productName: string;
  unit: string;
  quantity: number;
  unitCostRate: number;
  unitSaleRate: number;
  grossMargin: number;
  partnerMarginShare: number;
  salesChannel: string;
  allocatedAt: Date | string;
}

interface ExpenseItem {
  id: string;
  category: string;
  description: string;
  amount: number;
  paidBy: string;
  createdAt: Date | string;
}

interface AccountOfSalesProps {
  lotNumber: string;
  lotType: string;
  partnerName: string;
  partnerPhone?: string | null;
  partnerMarginRatioPct: number;
  allocations: AllocationItem[];
  expenses: ExpenseItem[];
  netSettlementAmount: number;
  netSettlementDirection: string;
  totalPayouts: number;
}

export function AccountOfSalesStatement({
  lotNumber,
  lotType,
  partnerName,
  partnerPhone,
  partnerMarginRatioPct,
  allocations,
  expenses,
  netSettlementAmount,
  netSettlementDirection,
  totalPayouts,
}: AccountOfSalesProps) {
  const handlePrint = () => {
    window.print();
  };

  const totalGrossRevenue = allocations.reduce((s, a) => s + a.quantity * a.unitSaleRate, 0);
  const totalCOGS = allocations.reduce((s, a) => s + a.quantity * a.unitCostRate, 0);
  const totalGrossMargin = allocations.reduce((s, a) => s + a.grossMargin, 0);
  const totalPartnerMarginShare = allocations.reduce((s, a) => s + a.partnerMarginShare, 0);
  const partnerPaidExpenses = expenses
    .filter((e) => e.paidBy === "PARTNER")
    .reduce((s, e) => s + e.amount, 0);

  return (
    <div className="bg-white rounded-xl border p-6 space-y-6 print:p-0 print:border-0">
      {/* Header bar */}
      <div className="flex justify-between items-start border-b pb-4">
        <div>
          <span className="text-[11px] font-bold tracking-wider uppercase text-indigo-600 bg-indigo-50 px-2.5 py-0.5 rounded-full">
            Commercial Liquidation Report
          </span>
          <h2 className="text-2xl font-black text-gray-900 mt-2">ACCOUNT OF SALES</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            PaperTrade Ledger Sub-System • Lot Batch: <span className="font-semibold text-gray-900">{lotNumber}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <Button onClick={handlePrint} variant="outline" size="sm" className="gap-1 text-xs">
            <Printer className="h-4 w-4" /> Print Statement
          </Button>
        </div>
      </div>

      {/* Parties metadata */}
      <div className="grid grid-cols-2 gap-4 text-xs bg-gray-50/70 p-4 rounded-lg">
        <div>
          <span className="text-muted-foreground uppercase text-[10px] tracking-wider font-semibold block">
            Partner / Consignor
          </span>
          <div className="font-bold text-gray-900 text-sm mt-0.5">{partnerName}</div>
          {partnerPhone && <div className="text-muted-foreground">{partnerPhone}</div>}
          <div className="text-indigo-600 font-medium mt-1">
            Margin Allocation Rate: {partnerMarginRatioPct.toFixed(0)}%
          </div>
        </div>
        <div className="text-right">
          <span className="text-muted-foreground uppercase text-[10px] tracking-wider font-semibold block">
            Archetype & Date
          </span>
          <div className="font-bold text-gray-900 text-sm mt-0.5">
            {lotType === "CONSIGNMENT_VMI" ? "Consignment / VMI" : "Co-Invested Shared Pool"}
          </div>
          <div className="text-muted-foreground mt-1">
            Generated: {new Date().toLocaleDateString(undefined, { dateStyle: "medium" })}
          </div>
        </div>
      </div>

      {/* Realizations Table */}
      <div className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-700">1. Goods Realizations & Sales</h3>
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-100/70 border-b">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Date</th>
                <th className="px-3 py-2 text-left font-semibold">Ref / Invoice</th>
                <th className="px-3 py-2 text-left font-semibold">Channel</th>
                <th className="px-3 py-2 text-left font-semibold">Product Description</th>
                <th className="px-3 py-2 text-right font-semibold">Qty Sold</th>
                <th className="px-3 py-2 text-right font-semibold">Unit Cost</th>
                <th className="px-3 py-2 text-right font-semibold">Sale Rate</th>
                <th className="px-3 py-2 text-right font-semibold">Gross Margin</th>
                <th className="px-3 py-2 text-right font-semibold">Partner Share</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {allocations.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                    No sales allocations recorded for this lot yet.
                  </td>
                </tr>
              ) : (
                allocations.map((a) => (
                  <tr key={a.id} className="hover:bg-gray-50/50">
                    <td className="px-3 py-2 text-gray-600">
                      {new Date(a.allocatedAt).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2 font-mono font-medium text-gray-900">{a.invoiceNo}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          a.salesChannel === "INTERNAL_POS"
                            ? "bg-blue-50 text-blue-700"
                            : "bg-purple-50 text-purple-700"
                        }`}
                      >
                        {a.salesChannel === "INTERNAL_POS" ? "Shop POS" : "Partner Direct"}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-medium">
                      {a.productName} <span className="text-[10px] text-muted-foreground">({a.productNo})</span>
                    </td>
                    <td className="px-3 py-2 text-right font-medium">
                      {a.quantity} {a.unit}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-600">
                      PKR {a.unitCostRate.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">
                      PKR {a.unitSaleRate.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-gray-900">
                      PKR {a.grossMargin.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-indigo-600">
                      PKR {a.partnerMarginShare.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {allocations.length > 0 && (
              <tfoot className="bg-gray-50 font-semibold border-t">
                <tr>
                  <td colSpan={7} className="px-3 py-2 text-right">
                    Total Gross Realizations:
                  </td>
                  <td className="px-3 py-2 text-right text-gray-900">
                    PKR {totalGrossMargin.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-3 py-2 text-right text-indigo-700">
                    PKR {totalPartnerMarginShare.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Financial Settlement Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Expenses List */}
        <div className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-700">
            2. Lot Expenses & Reimbursements
          </h3>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-100/70 border-b">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Category</th>
                  <th className="px-3 py-2 text-left font-semibold">Description</th>
                  <th className="px-3 py-2 text-left font-semibold">Paid By</th>
                  <th className="px-3 py-2 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {expenses.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-3 text-center text-muted-foreground">
                      No expenses attached.
                    </td>
                  </tr>
                ) : (
                  expenses.map((e) => (
                    <tr key={e.id}>
                      <td className="px-3 py-1.5 font-medium">{e.category}</td>
                      <td className="px-3 py-1.5 text-gray-600">{e.description}</td>
                      <td className="px-3 py-1.5 font-medium">
                        <span className={e.paidBy === "PARTNER" ? "text-indigo-600" : "text-gray-600"}>
                          {e.paidBy}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right font-medium">
                        PKR {e.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Net Mutual Position Card */}
        <div className="p-4 bg-gray-50 rounded-xl border flex flex-col justify-between">
          <div className="space-y-2 text-xs">
            <h3 className="font-bold uppercase tracking-wider text-gray-700">3. Net Settlement Calculation</h3>
            <div className="flex justify-between py-1 border-b">
              <span className="text-muted-foreground">Partner Accrued Margin Share:</span>
              <span className="font-bold text-gray-900">
                PKR {totalPartnerMarginShare.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b">
              <span className="text-muted-foreground">Add: Partner Paid Expenses (Reimbursement):</span>
              <span className="font-semibold text-indigo-600">
                + PKR {partnerPaidExpenses.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b">
              <span className="text-muted-foreground">Less: Payouts & Drawings Made:</span>
              <span className="font-semibold text-emerald-600">
                - PKR {totalPayouts.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          <div className="pt-4 border-t mt-3 flex items-center justify-between">
            <div>
              <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground block">
                Net Mutual Balance Position
              </span>
              <span className="text-xs font-semibold text-gray-700">
                {netSettlementDirection === "ENTITY_OWES_PARTNER"
                  ? `Shop owes ${partnerName}`
                  : `${partnerName} owes Shop`}
              </span>
            </div>
            <div className="text-right">
              <span className="text-xl font-black text-indigo-700">
                PKR {netSettlementAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Dual Signature Blocks for CPA & Audit Compliance */}
      <div className="pt-8 border-t grid grid-cols-2 gap-8 text-center text-xs">
        <div>
          <div className="border-b border-gray-400 w-48 mx-auto pb-6"></div>
          <span className="font-bold text-gray-800 mt-2 block">Authorized Shop Signatory</span>
          <span className="text-[10px] text-muted-foreground">Entity Accounting Desk</span>
        </div>
        <div>
          <div className="border-b border-gray-400 w-48 mx-auto pb-6"></div>
          <span className="font-bold text-gray-800 mt-2 block">Partner / Consignor Acceptance</span>
          <span className="text-[10px] text-muted-foreground">{partnerName}</span>
        </div>
      </div>
    </div>
  );
}

"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SettlementTransaction {
  id: string;
  date: Date | string;
  description: string;
  reference: string;
  type: "CAPITAL" | "MARGIN_SHARE" | "EXPENSE_REIMBURSEMENT" | "PAYOUT";
  credit: number; // Increases what shop owes partner
  debit: number;  // Decreases what shop owes partner
  balance: number;
}

interface PartnerSettlementStatementProps {
  lotNumber: string;
  lotType: string;
  partnerName: string;
  partnerCapitalShare: number;
  partnerMarginRatioPct: number;
  allocations: Array<{
    id: string;
    allocatedAt: Date | string;
    invoiceNo: string;
    productName: string;
    partnerMarginShare: number;
  }>;
  expenses: Array<{
    id: string;
    createdAt: Date | string;
    category: string;
    description: string;
    amount: number;
    paidBy: string;
  }>;
  payouts: Array<{
    id: string;
    date: Date | string;
    receiptNo: string;
    amount: number;
    notes?: string | null;
  }>;
}

export function PartnerSettlementStatement({
  lotNumber,
  lotType,
  partnerName,
  partnerCapitalShare,
  allocations,
  expenses,
  payouts,
}: PartnerSettlementStatementProps) {
  const handlePrint = () => {
    window.print();
  };

  // Compile running ledger rows sorted chronologically
  const rawEvents: Array<{
    date: Date;
    description: string;
    reference: string;
    type: "CAPITAL" | "MARGIN_SHARE" | "EXPENSE_REIMBURSEMENT" | "PAYOUT";
    credit: number;
    debit: number;
  }> = [];

  // 1. Margin allocations
  for (const a of allocations) {
    rawEvents.push({
      date: new Date(a.allocatedAt),
      description: `Profit Margin Allocation: ${a.productName}`,
      reference: a.invoiceNo,
      type: "MARGIN_SHARE",
      credit: a.partnerMarginShare,
      debit: 0,
    });
  }

  // 2. Partner-paid expenses (reimbursements owed by entity)
  for (const e of expenses) {
    if (e.paidBy === "PARTNER") {
      rawEvents.push({
        date: new Date(e.createdAt),
        description: `Expense Reimbursement (${e.category}): ${e.description}`,
        reference: "EXP-REIMB",
        type: "EXPENSE_REIMBURSEMENT",
        credit: e.amount,
        debit: 0,
      });
    }
  }

  // 3. Payouts (disbursements to partner)
  for (const p of payouts) {
    rawEvents.push({
      date: new Date(p.date),
      description: `Settlement Disbursement to Partner${p.notes ? ` (${p.notes})` : ""}`,
      reference: p.receiptNo,
      type: "PAYOUT",
      credit: 0,
      debit: p.amount,
    });
  }

  // Sort chronologically
  rawEvents.sort((a, b) => a.date.getTime() - b.date.getTime());

  // Compute running balance
  let runningBalance = 0;
  const ledgerRows: SettlementTransaction[] = rawEvents.map((ev, idx) => {
    runningBalance += ev.credit - ev.debit;
    return {
      id: `row-${idx}`,
      date: ev.date,
      description: ev.description,
      reference: ev.reference,
      type: ev.type,
      credit: ev.credit,
      debit: ev.debit,
      balance: runningBalance,
    };
  });

  return (
    <div className="bg-white rounded-xl border p-6 space-y-6 print:p-0 print:border-0">
      <div className="flex justify-between items-start border-b pb-4">
        <div>
          <span className="text-[11px] font-bold tracking-wider uppercase text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-full">
            Sub-Ledger Running Statement
          </span>
          <h2 className="text-2xl font-black text-gray-900 mt-2">PARTNER SETTLEMENT STATEMENT</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Running account of capital entitlement, margin allocations, expense offsets, and payouts for{" "}
            <span className="font-semibold text-gray-900">{partnerName}</span> [Lot: {lotNumber}]
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <Button onClick={handlePrint} variant="outline" size="sm" className="gap-1 text-xs">
            <Printer className="h-4 w-4" /> Print Ledger Statement
          </Button>
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-100/70 border-b">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Date</th>
              <th className="px-3 py-2 text-left font-semibold">Ref #</th>
              <th className="px-3 py-2 text-left font-semibold">Transaction Details</th>
              <th className="px-3 py-2 text-right font-semibold">Disbursed (Debit)</th>
              <th className="px-3 py-2 text-right font-semibold">Accrued (Credit)</th>
              <th className="px-3 py-2 text-right font-semibold">Running Balance Due</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {ledgerRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  No settlement ledger events recorded yet.
                </td>
              </tr>
            ) : (
              ledgerRows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50/50">
                  <td className="px-3 py-2 text-gray-600 font-mono text-[11px]">
                    {new Date(r.date).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 font-mono text-gray-900 font-medium">{r.reference}</td>
                  <td className="px-3 py-2 font-medium text-gray-800">{r.description}</td>
                  <td className="px-3 py-2 text-right font-mono text-emerald-600 font-semibold">
                    {r.debit > 0 ? `PKR ${r.debit.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-indigo-600 font-semibold">
                    {r.credit > 0 ? `PKR ${r.credit.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-black text-gray-900 text-sm">
                    PKR {r.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot className="bg-gray-50 font-bold border-t">
            <tr>
              <td colSpan={5} className="px-3 py-3 text-right text-xs uppercase tracking-wider text-gray-700">
                Current Net Outstanding Liability to {partnerName}:
              </td>
              <td className="px-3 py-3 text-right text-indigo-700 text-base font-black font-mono">
                PKR {runningBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="pt-8 border-t grid grid-cols-2 gap-8 text-center text-xs">
        <div>
          <div className="border-b border-gray-400 w-48 mx-auto pb-6"></div>
          <span className="font-bold text-gray-800 mt-2 block">Accountant / Comptroller</span>
          <span className="text-[10px] text-muted-foreground">Double-Entry Ledger Certification</span>
        </div>
        <div>
          <div className="border-b border-gray-400 w-48 mx-auto pb-6"></div>
          <span className="font-bold text-gray-800 mt-2 block">Partner Acknowledgment</span>
          <span className="text-[10px] text-muted-foreground">{partnerName}</span>
        </div>
      </div>
    </div>
  );
}

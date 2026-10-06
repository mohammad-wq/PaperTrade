"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

interface MovementItem {
  id: string;
  date: Date | string;
  type: string;
  referenceType: string | null;
  referenceId: string | null;
  productNo: string;
  productName: string;
  unit: string;
  locationName: string;
  quantity: number;
  notes: string | null;
  createdByName: string;
}

interface InventoryMovementAuditSheetProps {
  lotNumber: string;
  partnerName: string;
  movements: MovementItem[];
}

export function InventoryMovementAuditSheet({
  lotNumber,
  partnerName,
  movements,
}: InventoryMovementAuditSheetProps) {
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="bg-white rounded-xl border p-6 space-y-6 print:p-0 print:border-0">
      <div className="flex justify-between items-start border-b pb-4">
        <div>
          <span className="text-[11px] font-bold tracking-wider uppercase text-purple-600 bg-purple-50 px-2.5 py-0.5 rounded-full">
            Internal Control & Physical Stock Traceability
          </span>
          <h2 className="text-2xl font-black text-gray-900 mt-2">INVENTORY MOVEMENT & AUDIT SHEET</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Audit trail of all inward intake, outward transfer (DO), partner liquidation, and sales for Lot:{" "}
            <span className="font-semibold text-gray-900">{lotNumber}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <Button onClick={handlePrint} variant="outline" size="sm" className="gap-1 text-xs">
            <Printer className="h-4 w-4" /> Print Audit Sheet
          </Button>
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-100/70 border-b">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Date & Time</th>
              <th className="px-3 py-2 text-left font-semibold">Movement Type</th>
              <th className="px-3 py-2 text-left font-semibold">Reference</th>
              <th className="px-3 py-2 text-left font-semibold">Product</th>
              <th className="px-3 py-2 text-left font-semibold">Location</th>
              <th className="px-3 py-2 text-right font-semibold">Quantity Delta</th>
              <th className="px-3 py-2 text-left font-semibold">Notes / Auditor Trace</th>
              <th className="px-3 py-2 text-left font-semibold">Auditor</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {movements.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                  No stock movements recorded for this lot yet.
                </td>
              </tr>
            ) : (
              movements.map((m) => {
                const isPositive = m.quantity > 0;
                return (
                  <tr key={m.id} className="hover:bg-gray-50/50">
                    <td className="px-3 py-2 text-gray-600 font-mono text-[11px]">
                      {new Date(m.date).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-semibold text-gray-800">{m.type}</span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-gray-700">
                      {m.referenceType} ({m.referenceId?.slice(0, 10)})
                    </td>
                    <td className="px-3 py-2 font-medium">
                      {m.productName} <span className="text-[10px] text-muted-foreground">({m.productNo})</span>
                    </td>
                    <td className="px-3 py-2 text-gray-700">{m.locationName}</td>
                    <td
                      className={`px-3 py-2 text-right font-bold font-mono ${
                        isPositive ? "text-emerald-600" : "text-amber-600"
                      }`}
                    >
                      {isPositive ? `+${m.quantity}` : m.quantity} {m.unit}
                    </td>
                    <td className="px-3 py-2 text-gray-600 max-w-xs truncate">{m.notes || "—"}</td>
                    <td className="px-3 py-2 text-gray-500 text-[11px]">{m.createdByName}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="pt-6 border-t flex justify-between text-xs text-muted-foreground">
        <div>Total Movement Audit Rows: {movements.length}</div>
        <div>Verified for Lot: {lotNumber} ({partnerName})</div>
      </div>
    </div>
  );
}

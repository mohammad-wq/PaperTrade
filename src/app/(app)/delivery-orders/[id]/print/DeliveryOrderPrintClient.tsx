"use client";

import React, { useState, useEffect } from "react";
import { format } from "date-fns";
import { Printer, ArrowLeft, Truck, PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cleanPartyDisplayName } from "@/lib/party-display";
import { formatSequenceDisplay } from "@/lib/financial-year";

interface DeliveryOrderPrintData {
  id: string;
  doNo: string;
  sequenceNo?: number | null;
  date: string;
  status: string;
  vehicleNo?: string | null;
  driverName?: string | null;
  deliveredTo?: string | null;
  recipientName?: string | null;
  notes?: string | null;
  financialYearLabel?: string;
  customerName: string;
  customerPhone?: string | null;
  customerAddress?: string | null;
  sourceLocationName: string;
  destinationLocationName?: string | null;
  saleInvoiceNo?: string | null;
  createdByName?: string | null;
  items: Array<{
    id: string;
    productNo: string;
    name: string;
    unit: string;
    length?: number | null;
    breadth?: number | null;
    gsm?: number | null;
    packetWeight?: number | null;
    reamWeight?: number | null;
    quantity: number;
    lotNumber?: string | null;
  }>;
}

interface DeliveryOrderPrintClientProps {
  order: DeliveryOrderPrintData;
  initialFormat?: "A4" | "A5";
  direct?: boolean;
}

export default function DeliveryOrderPrintClient({
  order,
  initialFormat = "A5",
  direct = false,
}: DeliveryOrderPrintClientProps) {
  const [printFormat, setPrintFormat] = useState<"A4" | "A5">(initialFormat);

  useEffect(() => {
    if (direct) {
      const timer = setTimeout(() => {
        window.print();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [direct]);

  const cleanCustomerName = cleanPartyDisplayName(order.customerName);
  const totalUnits = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const totalWeightKg = order.items.reduce((sum, item) => {
    const unitWeight = item.packetWeight || item.reamWeight || 0;
    return sum + item.quantity * unitWeight;
  }, 0);

  const isA5 = printFormat === "A5";

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-900 font-sans print:bg-white print:text-black">
      {/* Dynamic Print CSS */}
      <style dangerouslySetInnerHTML={{
        __html: `
          @media print {
            @page {
              size: ${isA5 ? "148mm 210mm" : "A4 portrait"};
              margin: ${isA5 ? "5mm" : "8mm"};
            }
            body {
              background: white !important;
              color: black !important;
              margin: 0 !important;
              padding: 0 !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            .no-print {
              display: none !important;
            }
            .print-shadow-none {
              box-shadow: none !important;
              border: 1px solid #cbd5e1 !important;
            }
          }
        `,
      }} />

      {/* Screen-Only Control Toolbar */}
      {!direct && (
        <header className="no-print sticky top-0 z-50 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.history.back()}
              className="h-8 gap-1.5 text-xs"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Button>
            <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
              Delivery Order #{formatSequenceDisplay(order.sequenceNo, order.doNo)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border border-slate-300 dark:border-slate-700 p-0.5 bg-slate-100 dark:bg-slate-800 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setPrintFormat("A5")}
                className={`px-3 py-1 rounded transition-all ${
                  printFormat === "A5"
                    ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                }`}
              >
                A5 (Counter Delivery Slip)
              </button>
              <button
                type="button"
                onClick={() => setPrintFormat("A4")}
                className={`px-3 py-1 rounded transition-all ${
                  printFormat === "A4"
                    ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                }`}
              >
                A4 (Standard Sheet)
              </button>
            </div>

            <Button
              onClick={() => window.print()}
              size="sm"
              className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white font-bold gap-1.5 text-xs shadow-xs"
            >
              <Printer className="h-3.5 w-3.5" /> Print DO
            </Button>
          </div>
        </header>
      )}

      {/* Printable Sheet Container */}
      <main className="py-6 px-2 flex justify-center print:p-0">
        <div
          className={`bg-white text-slate-900 print-shadow-none rounded-lg border border-slate-200 shadow-md ${
            isA5
              ? "w-[148mm] min-h-[210mm] p-4 text-[11px]"
              : "w-[210mm] min-h-[297mm] p-8 text-xs"
          } flex flex-col justify-between`}
        >
          {/* Top Header Block */}
          <div>
            <div className="border-b-2 border-slate-900 pb-3 flex justify-between items-start gap-4">
              <div>
                <h1 className="text-lg font-extrabold tracking-tight text-slate-900 uppercase">
                  PaperTrade Solutions
                </h1>
                <p className="text-[10px] text-slate-500 font-medium">
                  Logistics & Warehouse Dispatch Division
                </p>
                <p className="text-[9px] text-slate-400 font-mono mt-0.5">
                  Circular Road Paper Market, Lahore • Ph: +92 42 37654321
                </p>
              </div>

              <div className="text-right">
                <span className="inline-block px-2.5 py-1 rounded bg-slate-900 text-white font-bold text-xs uppercase tracking-wider">
                  Delivery Order / Gate Pass
                </span>
                <div className="mt-1 font-mono">
                  <div className="text-sm font-bold text-slate-900">
                    #{formatSequenceDisplay(order.sequenceNo, order.doNo)}
                  </div>
                  {order.financialYearLabel && (
                    <div className="text-[10px] text-slate-500">FY: {order.financialYearLabel}</div>
                  )}
                  {order.saleInvoiceNo && (
                    <div className="text-[10px] text-slate-700 font-medium">Invoice Ref: #{order.saleInvoiceNo}</div>
                  )}
                </div>
              </div>
            </div>

            {/* Consignee & Transit Details */}
            <div className="grid grid-cols-2 gap-4 py-2.5 border-b border-slate-200">
              <div>
                <span className="text-[9px] uppercase font-bold text-slate-400 block tracking-wider">
                  Deliver To / Consignee
                </span>
                <div className="text-xs font-bold text-slate-900 mt-0.5">{cleanCustomerName}</div>
                {order.customerPhone && (
                  <div className="text-[10px] text-slate-500 font-mono">Ph: {order.customerPhone}</div>
                )}
                {order.customerAddress && (
                  <div className="text-[10px] text-slate-500">{order.customerAddress}</div>
                )}
                {order.recipientName && (
                  <div className="text-[10px] text-slate-600 font-medium mt-0.5">Attn: {order.recipientName}</div>
                )}
              </div>

              <div className="text-right space-y-0.5 font-mono text-[10px]">
                <div>
                  <span className="text-slate-400 font-sans">Dispatch Date: </span>
                  <strong className="text-slate-900">{format(new Date(order.date), "yyyy-MM-dd HH:mm")}</strong>
                </div>
                <div>
                  <span className="text-slate-400 font-sans">Source Warehouse: </span>
                  <strong className="text-slate-800">{order.sourceLocationName}</strong>
                </div>
                {order.destinationLocationName && (
                  <div>
                    <span className="text-slate-400 font-sans">Destination Shop: </span>
                    <strong className="text-slate-800">{order.destinationLocationName}</strong>
                  </div>
                )}
                {(order.vehicleNo || order.driverName) && (
                  <div className="pt-0.5">
                    <span className="text-slate-400 font-sans">Vehicle / Driver: </span>
                    <span className="text-slate-900 font-bold">
                      {order.vehicleNo || "—"} {order.driverName ? `(${order.driverName})` : ""}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Itemized Table */}
            <div className="mt-3">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b-2 border-slate-900 bg-slate-100 text-[10px] font-bold text-slate-700 uppercase tracking-wider text-left">
                    <th className="py-1.5 px-2 w-7 text-center">#</th>
                    <th className="py-1.5 px-2">Item & Specifications</th>
                    <th className="py-1.5 px-2 text-right">Dispatch Qty</th>
                    <th className="py-1.5 px-2 text-center">Unit</th>
                    <th className="py-1.5 px-2 text-right">Physical Weight</th>
                    <th className="py-1.5 px-2 text-center">Verification</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {order.items.map((item, idx) => {
                    const unitWeight = item.packetWeight || item.reamWeight || 0;
                    const lineWeightKg = item.quantity * unitWeight;
                    const hasSpecs = item.length || item.breadth || item.gsm;

                    return (
                      <tr key={item.id} className="text-[11px]">
                        <td className="py-1.5 px-2 text-center text-slate-400 font-mono text-[10px]">
                          {idx + 1}
                        </td>
                        <td className="py-1.5 px-2">
                          <div className="font-bold text-slate-900">
                            <span className="font-mono text-slate-500 font-normal mr-1">{item.productNo}</span>
                            {item.name}
                          </div>
                          <div className="text-[10px] text-slate-500 font-mono flex items-center gap-2">
                            {hasSpecs && (
                              <span>
                                {item.length}&quot; x {item.breadth}&quot; • {item.gsm} GSM
                              </span>
                            )}
                            {item.lotNumber && (
                              <span className="text-purple-700 font-semibold">Lot: #{item.lotNumber}</span>
                            )}
                          </div>
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono font-bold text-slate-900 text-xs">
                          {item.quantity.toLocaleString()}
                        </td>
                        <td className="py-1.5 px-2 text-center text-slate-500 text-[10px]">
                          {item.unit}
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono text-slate-500 text-[10px]">
                          {lineWeightKg > 0 ? `${lineWeightKg.toFixed(2)} kg` : "—"}
                        </td>
                        <td className="py-1.5 px-2 text-center text-slate-400 font-mono text-[10px]">
                          [ &nbsp; ] Checked
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bottom Summary & Gate Pass Signatures */}
          <div className="mt-4 pt-3 border-t-2 border-slate-900 space-y-4">
            <div className="grid grid-cols-2 gap-4 items-center">
              {/* Physical Cargo Metrics */}
              <div className="bg-slate-50 p-2.5 rounded border border-slate-200 text-[10px] font-mono space-y-0.5">
                <div className="font-bold text-slate-700 uppercase font-sans">Physical Cargo Manifest</div>
                <div>Total Packets/Reams: <strong>{totalUnits.toLocaleString()}</strong></div>
                <div>Total Weight: <strong>{totalWeightKg.toFixed(2)} kg ({(totalWeightKg / 1000).toFixed(3)} Metric Tons)</strong></div>
              </div>

              {order.notes && (
                <div className="text-[10px] text-slate-600 bg-slate-50 p-2.5 rounded border border-slate-200">
                  <strong className="block text-slate-700 font-sans uppercase">Gate Remarks:</strong>
                  {order.notes}
                </div>
              )}
            </div>

            {/* Triple Signature / Check Blocks */}
            <div className="grid grid-cols-3 gap-4 pt-6 border-t border-dashed border-slate-300 text-center text-[10px] text-slate-500 font-mono">
              <div>
                <div className="border-b border-slate-400 mx-4 mb-1 h-6"></div>
                <span className="font-sans font-semibold text-slate-700">Warehouse In-charge</span>
                <p className="text-[9px] text-slate-400">Stock Outward Verified</p>
              </div>

              <div>
                <div className="border-b border-slate-400 mx-4 mb-1 h-6"></div>
                <span className="font-sans font-semibold text-slate-700">Driver / Transporter</span>
                <p className="text-[9px] text-slate-400">Cargo Loaded</p>
              </div>

              <div>
                <div className="border-b border-slate-400 mx-4 mb-1 h-6"></div>
                <span className="font-sans font-semibold text-slate-700">Customer Receiver</span>
                <p className="text-[9px] text-slate-400">Received Intact</p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

"use client";

import React, { useState, useEffect } from "react";
import { format } from "date-fns";
import { Printer, ArrowLeft, FileText, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cleanPartyDisplayName } from "@/lib/party-display";
import { formatSequenceDisplay } from "@/lib/financial-year";

interface InvoicePrintData {
  type: "SALE" | "PURCHASE";
  id: string;
  invoiceNo: string;
  sequenceNo?: number | null;
  date: string;
  status: string;
  totalAmount: number;
  amountPaid: number;
  balanceDue: number;
  freightCharges: number;
  walkInName?: string | null;
  notes?: string | null;
  financialYearLabel?: string;
  party: {
    id: string;
    name: string;
    type: string;
    phone?: string | null;
    address?: string | null;
  };
  locationName: string;
  createdByName?: string | null;
  deliveryOrderNo?: string | null;
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
    unitPrice: number;
    lineTotal: number;
    lotNumber?: string | null;
  }>;
}

interface InvoicePrintClientProps {
  invoice: InvoicePrintData;
  initialFormat?: "A4" | "A5";
  direct?: boolean;
}

export default function InvoicePrintClient({
  invoice,
  initialFormat = "A4",
  direct = false,
}: InvoicePrintClientProps) {
  const [printFormat, setPrintFormat] = useState<"A4" | "A5">(initialFormat);

  useEffect(() => {
    if (direct) {
      const timer = setTimeout(() => {
        window.print();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [direct]);

  const displayName = invoice.walkInName || cleanPartyDisplayName(invoice.party.name);
  const itemsSubtotal = invoice.items.reduce((sum, item) => sum + item.lineTotal, 0);
  const totalWeightKg = invoice.items.reduce((sum, item) => {
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
              Invoice #{formatSequenceDisplay(invoice.sequenceNo, invoice.invoiceNo)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Format Selector Toggle */}
            <div className="inline-flex rounded-md border border-slate-300 dark:border-slate-700 p-0.5 bg-slate-100 dark:bg-slate-800 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setPrintFormat("A4")}
                className={`px-3 py-1 rounded transition-all ${
                  printFormat === "A4"
                    ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                }`}
              >
                A4 (Standard Tax Invoice)
              </button>
              <button
                type="button"
                onClick={() => setPrintFormat("A5")}
                className={`px-3 py-1 rounded transition-all ${
                  printFormat === "A5"
                    ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                }`}
              >
                A5 (Counter Slip)
              </button>
            </div>

            <Button
              onClick={() => window.print()}
              size="sm"
              className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white font-bold gap-1.5 text-xs shadow-xs"
            >
              <Printer className="h-3.5 w-3.5" /> Print Now
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
                <h1 className="text-xl font-extrabold tracking-tight text-slate-900 uppercase">
                  PaperTrade Solutions
                </h1>
                <p className="text-[11px] text-slate-500 font-medium">
                  Wholesale Paper Merchants & Converting Specialists
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5 font-mono">
                  Circular Road Paper Market, Lahore, Pakistan • Ph: +92 42 37654321
                </p>
                <p className="text-[10px] text-slate-400 font-mono">NTN / STRN: 1234567-8</p>
              </div>

              <div className="text-right">
                <span className="inline-block px-2.5 py-1 rounded bg-slate-900 text-white font-bold text-xs uppercase tracking-wider">
                  {invoice.type === "SALE" ? "Tax Invoice (Gross Revenue)" : "Commercial Purchase Invoice"}
                </span>
                <div className="mt-1 font-mono">
                  <div className="text-sm font-bold text-slate-900">
                    #{formatSequenceDisplay(invoice.sequenceNo, invoice.invoiceNo)}
                  </div>
                  {invoice.financialYearLabel && (
                    <div className="text-[10px] text-slate-500">FY: {invoice.financialYearLabel}</div>
                  )}
                  {invoice.deliveryOrderNo && (
                    <div className="text-[10px] text-slate-600 font-medium">DO Ref: #{invoice.deliveryOrderNo}</div>
                  )}
                </div>
              </div>
            </div>

            {/* Bill To & Dispatch Metadata */}
            <div className="grid grid-cols-2 gap-4 py-3 border-b border-slate-200">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                  {invoice.type === "SALE" ? "Billed & Delivered To (Debtor)" : "Vendor / Supplier (Creditor)"}
                </span>
                <div className="text-sm font-bold text-slate-900 mt-0.5">{displayName}</div>
                {invoice.party.phone && (
                  <div className="text-[10px] text-slate-500 font-mono">Ph: {invoice.party.phone}</div>
                )}
                {invoice.party.address && (
                  <div className="text-[10px] text-slate-500">{invoice.party.address}</div>
                )}
                <div className="text-[10px] text-slate-400 mt-0.5">Account ID: {invoice.party.id}</div>
              </div>

              <div className="text-right space-y-0.5 font-mono text-[11px]">
                <div>
                  <span className="text-slate-400 font-sans">Date & Time: </span>
                  <strong className="text-slate-900">{format(new Date(invoice.date), "yyyy-MM-dd HH:mm")}</strong>
                </div>
                <div>
                  <span className="text-slate-400 font-sans">Operating Unit: </span>
                  <span className="text-slate-800">{invoice.locationName}</span>
                </div>
                {invoice.createdByName && (
                  <div>
                    <span className="text-slate-400 font-sans">Prepared By: </span>
                    <span className="text-slate-800">{invoice.createdByName}</span>
                  </div>
                )}
                <div>
                  <span className="text-slate-400 font-sans">Settlement Status: </span>
                  <span className={`font-bold px-1.5 py-0.2 rounded text-[10px] ${
                    invoice.balanceDue <= 0.01
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-amber-100 text-amber-800"
                  }`}>
                    {invoice.balanceDue <= 0.01 ? "SETTLED / PAID" : "BALANCE OPEN"}
                  </span>
                </div>
              </div>
            </div>

            {/* Itemized Table */}
            <div className="mt-3">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b-2 border-slate-900 bg-slate-100 text-[10px] font-bold text-slate-700 uppercase tracking-wider text-left">
                    <th className="py-1.5 px-2 w-7 text-center">#</th>
                    <th className="py-1.5 px-2">Item & Specifications</th>
                    <th className="py-1.5 px-2 text-right">Qty</th>
                    <th className="py-1.5 px-2 text-center">Unit</th>
                    <th className="py-1.5 px-2 text-right">Weight</th>
                    <th className="py-1.5 px-2 text-right">Unit Rate (PKR)</th>
                    <th className="py-1.5 px-2 text-right">Line Total (PKR)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {invoice.items.map((item, idx) => {
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
                        <td className="py-1.5 px-2 text-right font-mono font-bold text-slate-900">
                          {item.quantity.toLocaleString()}
                        </td>
                        <td className="py-1.5 px-2 text-center text-slate-500 text-[10px]">
                          {item.unit}
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono text-slate-500 text-[10px]">
                          {lineWeightKg > 0 ? `${lineWeightKg.toFixed(2)} kg` : "—"}
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono text-slate-700">
                          {item.unitPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono font-bold text-slate-900">
                          {item.lineTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    );
                  })}

                  {/* Explicit Transparent Freight Outward Line Item */}
                  {invoice.freightCharges > 0 && (
                    <tr className="bg-slate-50 font-semibold text-[11px]">
                      <td className="py-1.5 px-2 text-center text-slate-400 font-mono text-[10px]">
                        {invoice.items.length + 1}
                      </td>
                      <td className="py-1.5 px-2 text-slate-800" colSpan={4}>
                        Freight Outward (Transport / Delivery Charges)
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono text-slate-500 text-[10px]">Lump Sum</td>
                      <td className="py-1.5 px-2 text-right font-mono font-bold text-slate-900">
                        {invoice.freightCharges.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bottom Financial Summary & Signatures */}
          <div className="mt-4 pt-3 border-t-2 border-slate-900 space-y-4">
            <div className="grid grid-cols-2 gap-4 items-start">
              {/* Left Column: Physical Metrics & Notes */}
              <div className="space-y-2">
                <div className="bg-slate-50 p-2 rounded border border-slate-200 text-[10px] font-mono space-y-0.5">
                  <div className="font-bold text-slate-700 uppercase font-sans">Physical Cargo Tonnage</div>
                  <div>Total Units: <strong>{invoice.items.reduce((s, it) => s + it.quantity, 0).toLocaleString()} pkts/reams</strong></div>
                  <div>Total Weight: <strong>{totalWeightKg.toFixed(2)} kg ({(totalWeightKg / 1000).toFixed(3)} Metric Tons)</strong></div>
                </div>

                {invoice.notes && (
                  <div className="text-[10px] text-slate-600 bg-slate-50 p-2 rounded border border-slate-200">
                    <strong className="block text-slate-700 font-sans uppercase">Notes / Terms:</strong>
                    {invoice.notes}
                  </div>
                )}
              </div>

              {/* Right Column: Financial Readout */}
              <div className="bg-slate-50 p-3 rounded border border-slate-200 font-mono text-[11px] space-y-1">
                <div className="flex justify-between text-slate-600">
                  <span>Gross Item Subtotal:</span>
                  <span className="font-bold text-slate-900">PKR {itemsSubtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                {invoice.freightCharges > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>Freight Outward:</span>
                    <span className="font-bold text-slate-900">PKR {invoice.freightCharges.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-slate-300 pt-1 text-xs font-bold text-slate-950">
                  <span>Gross Revenue / Total:</span>
                  <span>PKR {invoice.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between text-emerald-800 font-semibold">
                  <span>Amount Paid / Tendered:</span>
                  <span>PKR {invoice.amountPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between border-t border-slate-300 pt-1 font-bold text-xs">
                  <span>Balance Due (Receivable):</span>
                  <span className={invoice.balanceDue > 0 ? "text-rose-700" : "text-emerald-700"}>
                    PKR {invoice.balanceDue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>

            {/* Dual Signature Blocks */}
            <div className="grid grid-cols-2 gap-8 pt-6 border-t border-dashed border-slate-300 text-center text-[10px] text-slate-500 font-mono">
              <div>
                <div className="border-b border-slate-400 mx-6 mb-1 h-6"></div>
                <span className="font-sans font-semibold text-slate-700">Customer Receiver Stamp & Signature</span>
                <p className="text-[9px] text-slate-400">Goods received in good condition & count verified</p>
              </div>

              <div>
                <div className="border-b border-slate-400 mx-6 mb-1 h-6"></div>
                <span className="font-sans font-semibold text-slate-700">For PaperTrade Solutions</span>
                <p className="text-[9px] text-slate-400">Authorized Financial Officer</p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

import { assertPageAccess } from "@/lib/auth/session";
import { getPartnershipHubDataAction } from "@/actions/partnerships";
import { getBusinessInfoAction } from "@/actions/settings";
import { format } from "date-fns";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Printer, ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function PrintPartnershipSalesPage({
  params,
  searchParams,
}: {
  params: Promise<{ partnerId: string }>;
  searchParams?: Promise<{
    from?: string;
    to?: string;
    lotId?: string;
    productId?: string;
    autoprint?: string;
  }>;
}) {
  await assertPageAccess("/partnerships");
  const { partnerId } = await params;
  const sp = searchParams ? await searchParams : {};

  const fromDate = sp.from || undefined;
  const toDate = sp.to || undefined;
  const lotId = sp.lotId && sp.lotId !== "all" ? sp.lotId : undefined;
  const productId = sp.productId && sp.productId !== "all" ? sp.productId : undefined;

  const [hubRes, bizRes] = await Promise.all([
    getPartnershipHubDataAction(partnerId, {
      startDate: fromDate,
      endDate: toDate,
      lotId,
    }),
    getBusinessInfoAction(),
  ]);

  if (!hubRes.success || !hubRes.data) {
    notFound();
  }

  const hubData = hubRes.data;
  const business = bizRes.success && bizRes.data ? bizRes.data : { businessName: "Paper Trader" };

  let items = hubData.settlementLog;
  if (productId) {
    items = items.filter((item) => item.productId === productId);
  }

  // Summary Metrics
  const totalQtySold = items.reduce((sum, i) => sum + i.quantity, 0);
  const totalSalesRevenue = items.reduce((sum, i) => sum + i.totalSale, 0);
  const totalCOGS = items.reduce((sum, i) => sum + i.totalCost, 0);
  const totalGrossMargin = items.reduce((sum, i) => sum + i.netMargin, 0);
  const totalPartnerProfitShare = items.reduce((sum, i) => sum + i.partnerProfitShare, 0);

  // Capital & Settlement Metrics
  const capitalLiability = hubData.metrics.capitalLiabilityAccrued || 0;
  const priorPayments = hubData.metrics.capitalReimbursedToPartner || 0;
  const netBalanceDue = hubData.metrics.netPayableToPartner || (capitalLiability + totalPartnerProfitShare - priorPayments);

  const selectedLot = lotId ? hubData.allLots.find((l) => l.id === lotId) : null;
  const selectedProduct = productId ? hubData.allProducts.find((p) => p.id === productId) : null;

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-8 print:p-0 print:bg-white text-slate-900">
      {/* Top Floating Control Bar - Hidden in Print */}
      <div className="max-w-7xl mx-auto mb-4 flex items-center justify-between bg-white border border-slate-200 p-3 rounded-xl shadow-xs print:hidden">
        <div className="flex items-center gap-3">
          <Link
            href={`/partnerships?partnerId=${partnerId}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Partnership Hub
          </Link>
          <span className="text-xs text-slate-500 font-mono">
            Landscape Statement: {items.length} records matching filter
          </span>
        </div>

        <button
          onClick={() => {}}
          className="print-trigger-btn inline-flex items-center gap-2 px-4 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold shadow-xs transition"
        >
          <Printer className="h-4 w-4" />
          Print Statement (A4 Landscape)
        </button>
      </div>

      {/* Main Print Document (A4 Landscape container) */}
      <div className="max-w-7xl mx-auto bg-white p-8 rounded-xl shadow-sm border border-slate-200 print:border-none print:shadow-none print:p-0 print:m-0 print:max-w-none text-slate-900">
        {/* Document Header Section */}
        <div className="flex justify-between items-start border-b-2 border-slate-900 pb-3 mb-4">
          <div>
            <h1 className="text-xl font-black uppercase tracking-tight text-slate-950 font-serif">
              {business.businessName || "Sughra Trader"}
            </h1>
            <p className="text-sm font-bold text-emerald-800 tracking-wide mt-0.5">
              PARTNERSHIP STOCK SALES & SETTLEMENT STATEMENT
            </p>
            <div className="flex items-center gap-3 text-xs text-slate-600 mt-1 font-medium">
              <span>
                Period: <strong>{fromDate ? format(new Date(fromDate), "dd MMM yyyy") : "Beginning"}</strong> to{" "}
                <strong>{toDate ? format(new Date(toDate), "dd MMM yyyy") : "Present"}</strong>
              </span>
              {selectedLot && (
                <span>
                  • Lot Filter: <strong className="font-mono">{selectedLot.lotNumber}</strong>
                </span>
              )}
              {selectedProduct && (
                <span>
                  • Product Filter: <strong>{selectedProduct.name}</strong>
                </span>
              )}
            </div>
          </div>

          <div className="text-right text-xs space-y-0.5">
            <p className="text-sm font-black text-slate-900">
              Partner: {hubData.partner.name}
            </p>
            <p className="text-slate-500 font-mono text-[11px]">
              ID: {hubData.partner.id.slice(0, 10)} {hubData.partner.phone ? `• Ph: ${hubData.partner.phone}` : ""}
            </p>
            <p className="text-slate-400 font-mono text-[10px]">
              Generated: {format(new Date(), "dd/MM/yyyy HH:mm:ss")}
            </p>
          </div>
        </div>

        {/* Metric Cards Strip (Top of Document) */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          <div className="border border-slate-200 rounded-lg p-2.5 bg-slate-50/70 text-center">
            <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
              Total Packets / Units Sold
            </p>
            <p className="text-lg font-black text-slate-900 font-mono mt-0.5">
              {totalQtySold.toLocaleString()} <span className="text-xs font-normal">units</span>
            </p>
          </div>

          <div className="border border-slate-200 rounded-lg p-2.5 bg-slate-50/70 text-center">
            <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
              Total Sales Revenue (PKR)
            </p>
            <p className="text-lg font-black text-emerald-800 font-mono mt-0.5">
              PKR {totalSalesRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>

          <div className="border border-slate-200 rounded-lg p-2.5 bg-slate-50/70 text-center">
            <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
              Total Cost of Goods (COGS)
            </p>
            <p className="text-lg font-black text-slate-700 font-mono mt-0.5">
              PKR {totalCOGS.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>

          <div className="border border-emerald-200 rounded-lg p-2.5 bg-emerald-50/60 text-center">
            <p className="text-[10px] uppercase font-bold text-emerald-900 tracking-wider">
              Partner Margin / Net Profit Share
            </p>
            <p className="text-lg font-black text-emerald-900 font-mono mt-0.5">
              PKR {totalPartnerProfitShare.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
        </div>

        {/* Transaction Table (10 Columns) */}
        <div className="border border-slate-300 rounded-lg overflow-hidden mb-4">
          <table className="w-full text-left border-collapse text-[11px]">
            <thead className="bg-slate-100 text-slate-800 font-bold uppercase tracking-wider text-[10px] border-b border-slate-300">
              <tr>
                <th className="py-2 px-2 border-r border-slate-300 w-16 text-center">Date</th>
                <th className="py-2 px-2 border-r border-slate-300 w-24">Invoice / Ref #</th>
                <th className="py-2 px-2 border-r border-slate-300">Product & Lot</th>
                <th className="py-2 px-2 border-r border-slate-300 text-right w-16">Packets / Qty</th>
                <th className="py-2 px-2 border-r border-slate-300 text-right w-20">Unit Cost</th>
                <th className="py-2 px-2 border-r border-slate-300 text-right w-20">Sale Rate</th>
                <th className="py-2 px-2 border-r border-slate-300 text-right w-24">Total Sale</th>
                <th className="py-2 px-2 border-r border-slate-300 text-right w-24">Total Cost</th>
                <th className="py-2 px-2 border-r border-slate-300 text-right w-24">Gross Margin</th>
                <th className="py-2 px-2 text-right w-24 text-emerald-900 font-black">Partner Share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-slate-400 italic">
                    No partner stock sales logged for the selected period and lot criteria.
                  </td>
                </tr>
              ) : (
                items.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/60">
                    <td className="py-1.5 px-2 border-r border-slate-200 text-center font-mono text-[10px]">
                      {format(new Date(row.date), "dd/MM/yy")}
                    </td>
                    <td className="py-1.5 px-2 border-r border-slate-200 font-mono font-medium">
                      {row.invoiceNo}
                    </td>
                    <td className="py-1.5 px-2 border-r border-slate-200">
                      <div className="font-semibold text-slate-900 leading-tight">
                        {row.productName}
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        SKU: {row.productNo} | Lot: {row.lotNumber} ({row.partnerSharePct}% Share)
                      </div>
                    </td>
                    <td className="py-1.5 px-2 border-r border-slate-200 text-right font-mono font-medium">
                      {row.quantity.toLocaleString()} {row.unit}
                    </td>
                    <td className="py-1.5 px-2 border-r border-slate-200 text-right font-mono">
                      {row.unitLotCost.toFixed(2)}
                    </td>
                    <td className="py-1.5 px-2 border-r border-slate-200 text-right font-mono">
                      {row.unitSellingPrice.toFixed(2)}
                    </td>
                    <td className="py-1.5 px-2 border-r border-slate-200 text-right font-mono font-medium">
                      {row.totalSale.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="py-1.5 px-2 border-r border-slate-200 text-right font-mono">
                      {row.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="py-1.5 px-2 border-r border-slate-200 text-right font-mono font-bold text-slate-800">
                      {row.netMargin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono font-bold text-emerald-800 bg-emerald-50/30">
                      {row.partnerProfitShare.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {/* Totals Row */}
            <tfoot className="bg-slate-100 font-bold border-t-2 border-slate-400 text-slate-900 text-[11px]">
              <tr>
                <td colSpan={3} className="py-2 px-2 text-right uppercase tracking-wider">
                  Totals Summary:
                </td>
                <td className="py-2 px-2 text-right font-mono border-r border-slate-300">
                  {totalQtySold.toLocaleString()}
                </td>
                <td colSpan={2} className="py-2 px-2 border-r border-slate-300"></td>
                <td className="py-2 px-2 text-right font-mono border-r border-slate-300">
                  {totalSalesRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td className="py-2 px-2 text-right font-mono border-r border-slate-300">
                  {totalCOGS.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td className="py-2 px-2 text-right font-mono border-r border-slate-300 text-slate-900 font-black">
                  {totalGrossMargin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td className="py-2 px-2 text-right font-mono font-black text-emerald-900 bg-emerald-100/50">
                  PKR {totalPartnerProfitShare.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Footer & Reconciliation Summary */}
        <div className="grid grid-cols-2 gap-6 items-start pt-2">
          {/* Left: Notes & Signatures */}
          <div className="space-y-6">
            <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 p-2.5 rounded-lg space-y-1">
              <p className="font-semibold text-slate-700">Statement Settlement Terms:</p>
              <p>• Partner profit share calculated dynamically per individual lot equity proportion.</p>
              <p>• Stock valuations based on weighted purchase invoice rates logged upon shared batch intake.</p>
              <p>• Net balance due is settled upon verified signature of authorized accounts.</p>
            </div>

            {/* Signature Blocks */}
            <div className="grid grid-cols-2 gap-8 pt-6">
              <div className="border-t border-slate-900 pt-1 text-center">
                <p className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Authorized Signature
                </p>
                <p className="text-[10px] text-slate-500">Person A (Managing Principal)</p>
              </div>

              <div className="border-t border-slate-900 pt-1 text-center">
                <p className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Partner Acceptance
                </p>
                <p className="text-[10px] text-slate-500">Person B ({hubData.partner.name})</p>
              </div>
            </div>
          </div>

          {/* Right: Settlement Summary Box */}
          <div className="border border-slate-300 rounded-xl overflow-hidden bg-slate-50/50">
            <div className="bg-slate-200/70 px-4 py-2 border-b border-slate-300 font-bold text-xs uppercase tracking-wider text-slate-800">
              Settlement & Reconciliation Balance
            </div>
            <div className="p-4 space-y-2 text-xs">
              <div className="flex justify-between items-center text-slate-700">
                <span>Total Partner Capital Recoverable (Stock Pulls):</span>
                <span className="font-mono font-medium">
                  PKR {capitalLiability.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex justify-between items-center text-slate-700">
                <span>Total Partner Profit Share:</span>
                <span className="font-mono font-medium text-emerald-800">
                  + PKR {totalPartnerProfitShare.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex justify-between items-center text-slate-700 border-b border-slate-200 pb-2">
                <span>Less: Prior Payments / Settlements Disbursed:</span>
                <span className="font-mono font-medium text-rose-700">
                  - PKR {priorPayments.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex justify-between items-center pt-1 font-black text-sm text-slate-950">
                <span>Net Balance Due to Partner:</span>
                <span className="font-mono text-emerald-900 text-base">
                  PKR {netBalanceDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Embedded Print CSS & Auto-Print Script */}
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page {
            size: A4 landscape;
            margin: 10mm;
          }
          body {
            background: white !important;
            color: black !important;
            print-color-adjust: exact !important;
            -webkit-print-color-adjust: exact !important;
          }
          tr {
            page-break-inside: avoid !important;
          }
          thead {
            display: table-header-group !important;
          }
          .print\\:hidden {
            display: none !important;
          }
        }
      `}} />

      <script dangerouslySetInnerHTML={{ __html: `
        document.querySelectorAll('.print-trigger-btn').forEach(btn => {
          btn.addEventListener('click', () => window.print());
        });
        ${sp.autoprint === "1" ? "window.addEventListener('load', () => window.print());" : ""}
      `}} />
    </div>
  );
}

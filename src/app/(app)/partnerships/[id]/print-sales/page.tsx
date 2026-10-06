import { assertPageAccess } from "@/lib/auth/session";
import { getPartnershipHubDataAction } from "@/actions/partnerships";
import { getBusinessInfoAction } from "@/actions/settings";
import { cleanPartyDisplayName } from "@/lib/party-display";
import { format } from "date-fns";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PrintStatementButton } from "./print-statement-button";

export const dynamic = "force-dynamic";

export default async function PrintPartnershipSalesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{
    from?: string;
    to?: string;
    lotId?: string;
    productId?: string;
    autoprint?: string;
  }>;
}) {
  await assertPageAccess("/partnerships");
  const { id } = await params;
  const partnerId = id;
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
  if (!hubRes.success || !hubRes.data) notFound();

  const hubData = hubRes.data;
  const businessName = bizRes.success && bizRes.data
    ? bizRes.data.businessName || "Paper Trader"
    : "Paper Trader";
  const rows = hubData.settlementLog.filter(
    (item) => !productId || item.productId === productId,
  );
  const groupedRows = new Map<string, {
    productNo: string;
    productName: string;
    lotNumber: string;
    unit: string;
    quantity: number;
    totalSale: number;
    totalCost: number;
    partnerShare: number;
  }>();

  for (const row of rows) {
    const key = `${row.productId}:${row.lotNumber}`;
    const aggregate = groupedRows.get(key) || {
      productNo: row.productNo,
      productName: row.productName,
      lotNumber: row.lotNumber,
      unit: row.unit,
      quantity: 0,
      totalSale: 0,
      totalCost: 0,
      partnerShare: 0,
    };
    aggregate.quantity += row.quantity;
    aggregate.totalSale += row.totalSale;
    aggregate.totalCost += row.totalCost;
    aggregate.partnerShare += row.partnerProfitShare;
    groupedRows.set(key, aggregate);
  }

  const summaryRows = Array.from(groupedRows.values()).sort(
    (a, b) =>
      a.productNo.localeCompare(b.productNo, undefined, { numeric: true }) ||
      a.lotNumber.localeCompare(b.lotNumber, undefined, { numeric: true }),
  );
  const totalQtySold = rows.reduce((sum, row) => sum + row.quantity, 0);
  const totalSalesRevenue = rows.reduce((sum, row) => sum + row.totalSale, 0);
  const totalCOGS = rows.reduce((sum, row) => sum + row.totalCost, 0);
  const totalGrossMargin = totalSalesRevenue - totalCOGS;
  const netPartnerSharePayable = rows.reduce((sum, row) => sum + row.partnerProfitShare, 0);
  const selectedLot = lotId ? hubData.allLots.find((lot) => lot.id === lotId) : null;
  const selectedProduct = productId
    ? hubData.allProducts.find((product) => product.id === productId)
    : null;

  return (
    <div className="min-h-screen bg-slate-100 p-4 text-slate-900 print:bg-white print:p-0">
      <div className="mx-auto mb-4 flex max-w-7xl items-center justify-between rounded-xl border border-slate-200 bg-white p-3 shadow-xs print:hidden">
        <div className="flex items-center gap-3">
          <Link
            href={`/partnerships?partnerId=${partnerId}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Partnership Hub
          </Link>
          <span className="text-xs font-mono text-slate-500">
            {summaryRows.length} product and lot summaries
          </span>
        </div>
        <PrintStatementButton autoPrint={sp.autoprint === "1"} />
      </div>

      <main className="mx-auto max-w-7xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm print:my-0 print:max-w-none print:border-none print:p-0 print:shadow-none">
        <header className="mb-4 flex items-start justify-between border-b-2 border-slate-900 pb-3">
          <div>
            <h1 className="font-serif text-xl font-black uppercase tracking-tight text-slate-950">
              {businessName}
            </h1>
            <p className="mt-0.5 text-sm font-bold tracking-wide text-emerald-800">
              PARTNERSHIP STOCK SALES STATEMENT
            </p>
            <p className="mt-1 text-xs text-slate-600">
              Period: <strong>{fromDate ? format(new Date(fromDate), "dd MMM yyyy") : "Beginning"}</strong>
              {" — "}
              <strong>{toDate ? format(new Date(toDate), "dd MMM yyyy") : "Present"}</strong>
              {selectedLot && <> • Lot: <strong>#{selectedLot.lotNumber}</strong></>}
              {selectedProduct && <> • Product: <strong>{selectedProduct.name}</strong></>}
            </p>
          </div>
          <div className="space-y-0.5 text-right text-xs">
            <p className="text-sm font-black text-slate-900">
              Partner: {cleanPartyDisplayName(hubData.partner.name)}
            </p>
            <p className="font-mono text-[11px] text-slate-500">
              ID: {hubData.partner.id.slice(0, 10)}
              {hubData.partner.phone ? ` • Ph: ${hubData.partner.phone}` : ""}
            </p>
            <p className="font-mono text-[10px] text-slate-400">
              Generated: {format(new Date(), "dd/MM/yyyy HH:mm:ss")}
            </p>
          </div>
        </header>

        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {[
            ["Total Units Sold", `${totalQtySold.toLocaleString()} units`],
            ["Total Sales Revenue", `PKR ${totalSalesRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`],
            ["Total COGS", `PKR ${totalCOGS.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`],
            ["Total Net Margin", `PKR ${totalGrossMargin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`],
            ["Net Partner Share Payable", `PKR ${netPartnerSharePayable.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-center">
              <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
              <p className="mt-1 text-xs font-black text-slate-900">{value}</p>
            </div>
          ))}
        </div>

        <div className="mb-6 overflow-hidden rounded-lg border border-slate-300">
          <table className="w-full border-collapse text-left text-[10px]">
            <thead className="border-b border-slate-300 bg-slate-100 text-[9px] font-bold uppercase tracking-wide text-slate-800">
              <tr>
                <th className="border-r border-slate-300 px-2 py-2">SKU / Code</th>
                <th className="border-r border-slate-300 px-2 py-2">Product Description</th>
                <th className="border-r border-slate-300 px-2 py-2">Lot #</th>
                <th className="border-r border-slate-300 px-2 py-2 text-right">Total Units Sold</th>
                <th className="border-r border-slate-300 px-2 py-2 text-right">Intake Unit Cost (PKR)</th>
                <th className="border-r border-slate-300 px-2 py-2 text-right">Avg Sale Rate (PKR)</th>
                <th className="border-r border-slate-300 px-2 py-2 text-right">Total Sale Value (PKR)</th>
                <th className="border-r border-slate-300 px-2 py-2 text-right">Total Cost Value (PKR)</th>
                <th className="border-r border-slate-300 px-2 py-2 text-right">Total Gross Margin (PKR)</th>
                <th className="px-2 py-2 text-right">Partner Share (PKR)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {summaryRows.length ? summaryRows.map((row) => {
                const grossMargin = row.totalSale - row.totalCost;
                return (
                  <tr key={`${row.productNo}:${row.lotNumber}`}>
                    <td className="border-r border-slate-200 px-2 py-1.5 font-mono font-bold">{row.productNo}</td>
                    <td className="border-r border-slate-200 px-2 py-1.5 font-semibold">{row.productName}</td>
                    <td className="border-r border-slate-200 px-2 py-1.5 font-mono">#{row.lotNumber}</td>
                    <td className="border-r border-slate-200 px-2 py-1.5 text-right font-mono">{row.quantity.toLocaleString()} {row.unit}</td>
                    <td className="border-r border-slate-200 px-2 py-1.5 text-right font-mono">
                      {(row.quantity ? row.totalCost / row.quantity : 0).toFixed(2)}
                    </td>
                    <td className="border-r border-slate-200 px-2 py-1.5 text-right font-mono">
                      {(row.quantity ? row.totalSale / row.quantity : 0).toFixed(2)}
                    </td>
                    <td className="border-r border-slate-200 px-2 py-1.5 text-right font-mono">{row.totalSale.toFixed(2)}</td>
                    <td className="border-r border-slate-200 px-2 py-1.5 text-right font-mono">{row.totalCost.toFixed(2)}</td>
                    <td className="border-r border-slate-200 px-2 py-1.5 text-right font-mono font-bold">{grossMargin.toFixed(2)}</td>
                    <td className="px-2 py-1.5 text-right font-mono font-bold text-emerald-800">{row.partnerShare.toFixed(2)}</td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={10} className="py-8 text-center italic text-slate-400">
                    No partner stock sales for the selected period and filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <footer className="grid grid-cols-2 gap-12 px-4 pt-10">
          <div className="border-t border-slate-900 pt-1 text-center">
            <p className="text-xs font-bold uppercase tracking-wide">Person A (Shop Owner)</p>
          </div>
          <div className="border-t border-slate-900 pt-1 text-center">
            <p className="text-xs font-bold uppercase tracking-wide">Person B (Partner)</p>
          </div>
        </footer>
      </main>

      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 10mm; }
          body { background: white !important; color: black !important; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          tr { page-break-inside: avoid; }
          thead { display: table-header-group; }
        }
      `}</style>
    </div>
  );
}

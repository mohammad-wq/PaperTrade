import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatSequenceDisplay } from "@/lib/financial-year";
import { format } from "date-fns";
import { ArrowLeft, Printer, FileText, ShoppingCart } from "lucide-react";
import { PrintButton } from "@/components/ui/print-button";

export const dynamic = "force-dynamic";

export default async function PurchaseInvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession();
  const { id } = await params;

  const invoice = await prisma.purchaseInvoice.findUnique({
    where: { id },
    include: {
      supplier: true,
      location: true,
      purchaseOrder: true,
      financialYear: true,
      items: {
        include: {
          product: true,
          warehouseLot: true,
        },
      },
      payments: {
        orderBy: { date: "asc" },
      },
    },
  });

  if (!invoice) {
    notFound();
  }

  const total = Number(invoice.totalAmount);
  const paid = Number(invoice.amountPaid);
  const freight = Number(invoice.freightCharges || 0);
  const balanceDue = Math.max(0, total - paid);
  const subtotal = total - freight;

  return (
    <div className="space-y-4 max-w-5xl mx-auto p-4 md:p-6">
      {/* Top Bar Navigation & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 rounded-lg shadow-xs">
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
            <Link href="/purchases">
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Purchases
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-bold text-slate-900 dark:text-slate-100 font-mono">
              Purchase Invoice #{formatSequenceDisplay(invoice.sequenceNo, invoice.invoiceNo)}
            </h1>
            <span
              className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider ${
                invoice.status === "SETTLED"
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                  : invoice.status === "CANCELLED"
                  ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                  : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
              }`}
            >
              {invoice.status}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <PrintButton url={`/api/pdf/purchase-invoice/${invoice.id}`} />
        </div>
      </div>

      {/* Main Details Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Supplier Information */}
        <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <CardHeader className="py-2.5 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Supplier Information
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 text-xs space-y-1.5">
            <p className="font-bold text-sm text-slate-900 dark:text-slate-100">
              {invoice.supplier.name}
            </p>
            {invoice.supplier.phone && (
              <p className="text-slate-600 dark:text-slate-400">Phone: {invoice.supplier.phone}</p>
            )}
            {invoice.supplier.address && (
              <p className="text-slate-600 dark:text-slate-400">Address: {invoice.supplier.address}</p>
            )}
            <p className="text-[11px] text-slate-400 font-mono">Supplier ID: {invoice.supplier.id}</p>
          </CardContent>
        </Card>

        {/* Invoice Metadata */}
        <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <CardHeader className="py-2.5 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Invoice Details
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 text-xs space-y-1.5">
            <div className="flex justify-between">
              <span className="text-slate-500">Date:</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {format(new Date(invoice.date), "dd MMMM yyyy")}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Receiving Location:</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {invoice.location.name} ({invoice.location.type})
              </span>
            </div>
            {invoice.financialYear && (
              <div className="flex justify-between">
                <span className="text-slate-500">Financial Year:</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {invoice.financialYear.label}
                </span>
              </div>
            )}
            {invoice.purchaseOrder && (
              <div className="flex justify-between items-center pt-1 border-t border-slate-100 dark:border-slate-800">
                <span className="text-slate-500">Linked PO:</span>
                <Link
                  href={`/purchase-orders`}
                  className="font-mono text-emerald-700 underline text-xs inline-flex items-center gap-1"
                >
                  <ShoppingCart className="h-3 w-3" />
                  {invoice.purchaseOrder.orderNo}
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Payment Summary */}
        <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <CardHeader className="py-2.5 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Payment Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 text-xs space-y-2">
            <div className="flex justify-between text-slate-600 dark:text-slate-400">
              <span>Total Bill:</span>
              <span className="font-bold font-mono text-slate-900 dark:text-slate-100">
                PKR {total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex justify-between text-emerald-700 dark:text-emerald-400 font-semibold">
              <span>Amount Paid:</span>
              <span className="font-mono">
                PKR {paid.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex justify-between border-t border-slate-100 dark:border-slate-800 pt-1.5 font-bold text-sm">
              <span>Balance Payable:</span>
              <span className={`font-mono ${balanceDue > 0 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                PKR {balanceDue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Line Items Table */}
      <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <CardHeader className="py-2.5 px-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
          <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
            Purchased Items ({invoice.items.length})
          </CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse font-sans">
            <thead className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 font-semibold text-[11px]">
              <tr>
                <th className="py-2 px-3 border-r border-slate-200 dark:border-slate-700 text-center w-10">#</th>
                <th className="py-2 px-3 border-r border-slate-200 dark:border-slate-700">Product</th>
                <th className="py-2 px-3 border-r border-slate-200 dark:border-slate-700 text-center">Unit</th>
                <th className="py-2 px-3 border-r border-slate-200 dark:border-slate-700 text-right">Qty</th>
                <th className="py-2 px-3 border-r border-slate-200 dark:border-slate-700 text-right">Unit Cost</th>
                <th className="py-2 px-3 border-r border-slate-200 dark:border-slate-700 text-right">Line Total</th>
                <th className="py-2 px-3">Lot #</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {invoice.items.map((item, idx) => (
                <tr key={item.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                  <td className="py-2 px-3 border-r border-slate-200/60 dark:border-slate-800 text-center text-slate-400">
                    {idx + 1}
                  </td>
                  <td className="py-2 px-3 border-r border-slate-200/60 dark:border-slate-800">
                    <span className="font-mono font-bold text-slate-900 dark:text-slate-100 mr-2">
                      {item.product.productNo}
                    </span>
                    <span className="text-slate-700 dark:text-slate-300">{item.product.name}</span>
                  </td>
                  <td className="py-2 px-3 border-r border-slate-200/60 dark:border-slate-800 text-center text-slate-600">
                    {item.product.unit}
                  </td>
                  <td className="py-2 px-3 border-r border-slate-200/60 dark:border-slate-800 text-right font-mono font-bold text-slate-900 dark:text-slate-100">
                    {Number(item.quantity).toLocaleString()}
                  </td>
                  <td className="py-2 px-3 border-r border-slate-200/60 dark:border-slate-800 text-right font-mono text-slate-700 dark:text-slate-300">
                    PKR {Number(item.unitCost).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-2 px-3 border-r border-slate-200/60 dark:border-slate-800 text-right font-mono font-bold text-slate-900 dark:text-slate-100">
                    PKR {Number(item.lineTotal).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-2 px-3 text-slate-600 dark:text-slate-400">
                    {item.warehouseLot ? (
                      <span className="px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 font-mono text-[10px]">
                        Lot #{item.warehouseLot.lotNumber}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 dark:bg-slate-800/80 font-mono text-xs border-t-2 border-slate-200 dark:border-slate-700">
              <tr>
                <td colSpan={5} className="py-2 px-3 text-right font-sans font-semibold text-slate-600">
                  Subtotal:
                </td>
                <td className="py-2 px-3 text-right font-bold text-slate-900 dark:text-slate-100">
                  PKR {subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </td>
                <td></td>
              </tr>
              {freight > 0 && (
                <tr>
                  <td colSpan={5} className="py-1.5 px-3 text-right font-sans text-slate-600">
                    Packing & Freight Charges:
                  </td>
                  <td className="py-1.5 px-3 text-right font-bold text-slate-900 dark:text-slate-100">
                    PKR {freight.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td></td>
                </tr>
              )}
              <tr className="border-t border-slate-200 dark:border-slate-700 font-bold text-sm">
                <td colSpan={5} className="py-2 px-3 text-right font-sans uppercase">
                  Grand Total:
                </td>
                <td className="py-2 px-3 text-right text-emerald-800 dark:text-emerald-400">
                  PKR {total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {/* Payment Vouchers History */}
      {invoice.payments.length > 0 && (
        <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <CardHeader className="py-2.5 px-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Recorded Payment Vouchers ({invoice.payments.length})
            </CardTitle>
          </CardHeader>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {invoice.payments.map((p) => (
              <div key={p.id} className="p-3 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                      Payment Voucher #{formatSequenceDisplay(p.sequenceNo, p.receiptNo)}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-mono">
                      {p.method}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {format(new Date(p.date), "dd/MM/yyyy HH:mm")} {p.notes ? `— ${p.notes}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono font-bold text-amber-700 dark:text-amber-400 text-sm">
                    PKR {Number(p.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                  <PrintButton url={`/api/pdf/payment/${p.id}`} label="Voucher" className="h-7 text-xs" />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Notes */}
      {invoice.notes && (
        <div className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-lg text-xs text-slate-600 dark:text-slate-400">
          <strong className="text-slate-800 dark:text-slate-200">Notes / Remarks:</strong> {invoice.notes}
        </div>
      )}
    </div>
  );
}

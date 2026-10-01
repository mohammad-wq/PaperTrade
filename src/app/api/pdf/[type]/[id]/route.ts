import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { prisma } from "@/lib/db";
import { renderDocumentPdfKit, renderPaymentReceiptPdfKit } from "@/lib/pdfkit-generator";
import { format } from "date-fns";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { verifyDocShareToken } from "@/lib/tokens";
import { formatSequenceDisplay } from "@/lib/financial-year";

export const dynamic = "force-dynamic";

const toNumber = (value: unknown, fallback = 0) => {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const toItemNumber = (value: unknown, fallback = 0) => toNumber(value, fallback);

const ALLOWED_DOC_TYPES = new Set([
  "sale-invoice",
  "purchase-order",
  "delivery-order",
  "purchase-invoice",
  "sale-return",
  "purchase-return",
  "payment-receipt",
  "payment",
]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> },
) {
  const { type, id } = await params;

  if (!ALLOWED_DOC_TYPES.has(type)) {
    return new NextResponse("Invalid document type", { status: 400 });
  }

  if (!id || typeof id !== "string" || id.length > 64) {
    return new NextResponse("Invalid document identifier", { status: 400 });
  }

  // 1. Enforce authentication or valid document share token (for WhatsApp recipients)
  const token = request.nextUrl.searchParams.get("token");
  const isValidShareToken = token ? verifyDocShareToken(type, id, token) : false;

  const session = await getServerSession(authOptions);
  if (!session?.user && !isValidShareToken) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // Rate limit PDF generation to mitigate denial-of-service / scraping
  const clientIp = getClientIp(request.headers);
  const rateLimit = checkRateLimit(`doc_pdf:${clientIp}`, 30, 60 * 1000);
  if (!rateLimit.success) {
    return new NextResponse("Too many PDF requests. Please slow down.", {
      status: 429,
      headers: { "Retry-After": "60" },
    });
  }
  const isDownload = request.nextUrl.searchParams.get("download") === "true";

  try {
    let pdfBuffer: Buffer | null = null;
    let filename = `document-${id}.pdf`;

    const safeFormatDate = (val?: string | null | Date) => {
      if (!val) return format(new Date(), "dd-MM-yyyy h:mm a");
      const d = new Date(val);
      return isNaN(d.getTime()) ? format(new Date(), "dd-MM-yyyy h:mm a") : format(d, "dd-MM-yyyy h:mm a");
    };

    const formatSpecs = (product?: { length?: any; breadth?: any; gsm?: any } | null) => {
      if (!product) return "—";
      const l = Number(product.length || 0);
      const b = Number(product.breadth || 0);
      const g = Number(product.gsm || 0);
      return `${l}"x${b}" | ${g} GSM`;
    };

    const formatProductName = (product?: { productNo?: string; name?: string } | null) => {
      if (!product) return "Item";
      return `${product.productNo || "—"} - ${product.name || "Product"}`;
    };

    if (type === "sale-invoice") {
      const invoice = await prisma.saleInvoice.findUnique({
        where: { id },
        include: {
          customer: true,
          location: true,
          deliveryOrder: true,
          financialYear: true,
          items: { include: { product: true } },
          payments: { include: { splits: true } },
        },
      });

      if (!invoice) {
        return new NextResponse("Sale invoice not found", { status: 404 });
      }

      const allSplits = invoice.payments.flatMap((p) =>
        p.splits && p.splits.length > 0
          ? p.splits.map((s) => ({ method: s.method, amount: toNumber(s.amount), reference: s.reference }))
          : [{ method: p.method, amount: toNumber(p.amount), reference: null }]
      );

      filename = `Estimate-${invoice.invoiceNo}.pdf`;
      pdfBuffer = await renderDocumentPdfKit({
        docType: "Estimate",
        docNumber: invoice.invoiceNo,
        sequenceNo: invoice.sequenceNo,
        financialYearLabel: invoice.financialYear?.label || null,
        date: safeFormatDate(invoice.date),
        partyLabel: "Bill To (Customer)",
        partyName: invoice.customer?.name || "Customer",
        walkInName: invoice.walkInName || null,
        partyAddress: invoice.customer?.address || null,
        partyPhone: invoice.customer?.phone || null,
        locationName: invoice.location?.name || "Shop",
        referenceNo: invoice.deliveryOrder ? `DO: ${invoice.deliveryOrder.doNo}` : null,
        totalAmount: toNumber(invoice.totalAmount),
        amountPaid: toNumber(invoice.amountPaid),
        paymentMethod: invoice.payments[0]?.method || null,
        paymentSplits: allSplits.length > 1 ? allSplits : null,
        freightCharges: toNumber(invoice.freightCharges),
        notes: invoice.notes,
        signatures: { leftLabel: "Prepared By", rightLabel: "Authorized Signature / Stamp" },
        items: invoice.items.map((item) => ({
          name: formatProductName(item.product),
          specs: formatSpecs(item.product),
          quantity: toItemNumber(item.quantity),
          unit: item.product?.unit || "Unit",
          unitPrice: toItemNumber(item.unitPrice),
          lineTotal: toItemNumber(item.lineTotal, toItemNumber(item.quantity) * toItemNumber(item.unitPrice)),
        })),
      });
    } else if (type === "purchase-order") {
      const po = await prisma.purchaseOrder.findUnique({
        where: { id },
        include: {
          supplier: true,
          location: true,
          financialYear: true,
          items: { include: { product: true } },
        },
      });

      if (!po) {
        return new NextResponse("Purchase order not found", { status: 404 });
      }

      filename = `PO-${po.orderNo}.pdf`;
      const totalAmount = po.items.reduce((sum, item) => sum + toItemNumber(item.lineTotal), 0);

      pdfBuffer = await renderDocumentPdfKit({
        docType: "Purchase Order",
        docNumber: po.orderNo,
        sequenceNo: po.sequenceNo,
        financialYearLabel: po.financialYear?.label || null,
        date: safeFormatDate(po.date),
        partyLabel: "Supplier Details",
        partyName: po.supplier?.name || "Supplier",
        partyAddress: po.supplier?.address || null,
        partyPhone: po.supplier?.phone || null,
        locationName: po.location?.name || "Warehouse",
        totalAmount,
        notes: po.notes,
        signatures: { leftLabel: "Ordered By", rightLabel: "Approved By" },
        items: po.items.map((item) => ({
          name: formatProductName(item.product),
          specs: formatSpecs(item.product),
          quantity: toItemNumber(item.quantity),
          unit: item.product?.unit || "Unit",
          unitPrice: toItemNumber(item.unitCost),
          lineTotal: toItemNumber(item.lineTotal, toItemNumber(item.quantity) * toItemNumber(item.unitCost)),
        })),
      });
    } else if (type === "delivery-order") {
      const doRecord = await prisma.deliveryOrder.findUnique({
        where: { id },
        include: {
          customer: true,
          location: true,
          destinationLocation: true,
          linkedSaleInvoice: true,
          financialYear: true,
          items: { include: { product: true, warehouseLot: true, location: true } },
        },
      });

      if (!doRecord) {
        return new NextResponse("Delivery order not found", { status: 404 });
      }

      filename = `DO-${doRecord.doNo}.pdf`;
      pdfBuffer = await renderDocumentPdfKit({
        docType: doRecord.customer ? "Delivery Order" : "Internal Stock Transfer Order",
        docNumber: doRecord.doNo,
        sequenceNo: doRecord.sequenceNo,
        financialYearLabel: doRecord.financialYear?.label || null,
        date: safeFormatDate(doRecord.date),
        partyLabel: doRecord.customer ? "Deliver To (Customer)" : "Destination Location",
        partyName: doRecord.customer?.name || (doRecord.destinationLocation ? `Internal Transfer: ${doRecord.destinationLocation.name}` : "Internal Stock Transfer"),
        partyAddress: doRecord.customer?.address || doRecord.destinationLocation?.address || null,
        partyPhone: doRecord.customer?.phone || null,
        locationName: doRecord.location?.name || "Warehouse",
        referenceNo: doRecord.linkedSaleInvoice ? `Invoice: ${doRecord.linkedSaleInvoice.invoiceNo}` : null,
        deliveryDetails: {
          vehicleNo: doRecord.vehicleNo,
          driverName: doRecord.driverName,
          deliveredTo: doRecord.deliveredTo,
          recipientName: doRecord.recipientName,
        },
        notes: doRecord.notes,
        signatures: { leftLabel: "Dispatched / Delivered By", rightLabel: "Received By (Customer Stamp)" },
        items: doRecord.items.map((item) => {
          const lotLabel = item.warehouseLot ? item.warehouseLot.lotNumber : null;
          const baseSpecs = formatSpecs(item.product);
          return {
            name: formatProductName(item.product),
            specs: baseSpecs,
            lot: lotLabel,
            locationName: item.location?.name || doRecord.location?.name || null,
            quantity: toItemNumber(item.quantity),
            unit: item.unit,
          };
        }),
      });
    } else if (type === "purchase-invoice") {
      const invoice = await prisma.purchaseInvoice.findUnique({
        where: { id },
        include: {
          supplier: true,
          location: true,
          purchaseOrder: true,
          financialYear: true,
          items: { include: { product: true, warehouseLot: true } },
          payments: { include: { splits: true } },
        },
      });

      if (!invoice) {
        return new NextResponse("Purchase invoice not found", { status: 404 });
      }

      const allSplits = invoice.payments.flatMap((p) =>
        p.splits && p.splits.length > 0
          ? p.splits.map((s) => ({ method: s.method, amount: toNumber(s.amount), reference: s.reference }))
          : [{ method: p.method, amount: toNumber(p.amount), reference: null }]
      );

      filename = `Purchase-${invoice.invoiceNo}.pdf`;
      pdfBuffer = await renderDocumentPdfKit({
        docType: "Purchase Invoice",
        docNumber: invoice.invoiceNo,
        sequenceNo: invoice.sequenceNo,
        financialYearLabel: invoice.financialYear?.label || null,
        date: safeFormatDate(invoice.date),
        partyLabel: "Supplier",
        partyName: invoice.supplier?.name || "Supplier",
        partyAddress: invoice.supplier?.address || null,
        partyPhone: invoice.supplier?.phone || null,
        locationName: invoice.location?.name || "Warehouse",
        referenceNo: invoice.purchaseOrder ? `PO: ${invoice.purchaseOrder.orderNo}` : null,
        totalAmount: toNumber(invoice.totalAmount),
        amountPaid: toNumber(invoice.amountPaid),
        paymentMethod: invoice.payments[0]?.method || null,
        paymentSplits: allSplits.length > 1 ? allSplits : null,
        freightCharges: toNumber(invoice.freightCharges),
        notes: invoice.notes,
        signatures: { leftLabel: "Received By (Store Incharge)", rightLabel: "Authorized Signature / Stamp" },
        items: invoice.items.map((item) => {
          const lotLabel = item.warehouseLot ? item.warehouseLot.lotNumber : null;
          const baseSpecs = formatSpecs(item.product);
          return {
            name: formatProductName(item.product),
            specs: baseSpecs,
            lot: lotLabel,
            quantity: toItemNumber(item.quantity),
            unit: item.product?.unit || "Unit",
            unitPrice: toItemNumber(item.unitCost),
            lineTotal: toItemNumber(item.lineTotal, toItemNumber(item.quantity) * toItemNumber(item.unitCost)),
          };
        }),
      });
    } else if (type === "sale-return") {
      const sReturn = await prisma.saleReturn.findUnique({
        where: { id },
        include: {
          customer: true,
          location: true,
          saleInvoice: true,
          financialYear: true,
          items: { include: { product: true } },
        },
      });

      if (!sReturn) {
        return new NextResponse("Sale return not found", { status: 404 });
      }

      filename = `CreditNote-${sReturn.returnNo}.pdf`;
      pdfBuffer = await renderDocumentPdfKit({
        docType: "Credit Note / Sale Return",
        docNumber: sReturn.returnNo,
        sequenceNo: sReturn.sequenceNo,
        financialYearLabel: sReturn.financialYear?.label || null,
        date: safeFormatDate(sReturn.date),
        partyLabel: "Customer",
        partyName: sReturn.customer?.name || "Customer",
        partyAddress: sReturn.customer?.address || null,
        partyPhone: sReturn.customer?.phone || null,
        locationName: sReturn.location?.name || "Shop",
        referenceNo: sReturn.saleInvoice ? `Original Invoice: ${sReturn.saleInvoice.invoiceNo}` : null,
        totalAmount: toNumber(sReturn.totalAmount),
        notes: `Reason: ${sReturn.reason}`,
        signatures: { leftLabel: "Approved By", rightLabel: "Customer Acknowledgment" },
        items: sReturn.items.map((item) => ({
          name: formatProductName(item.product),
          specs: formatSpecs(item.product),
          quantity: toItemNumber(item.quantity),
          unit: item.product?.unit || "Unit",
          unitPrice: toItemNumber(item.unitPrice),
          lineTotal: toItemNumber(item.lineTotal, toItemNumber(item.quantity) * toItemNumber(item.unitPrice)),
        })),
      });
    } else if (type === "purchase-return") {
      const pReturn = await prisma.purchaseReturn.findUnique({
        where: { id },
        include: {
          supplier: true,
          location: true,
          purchaseInvoice: true,
          financialYear: true,
          items: { include: { product: true } },
        },
      });

      if (!pReturn) {
        return new NextResponse("Purchase return not found", { status: 404 });
      }

      filename = `DebitNote-${pReturn.returnNo}.pdf`;
      pdfBuffer = await renderDocumentPdfKit({
        docType: "Purchase Debit Note / Return",
        docNumber: pReturn.returnNo,
        sequenceNo: pReturn.sequenceNo,
        financialYearLabel: pReturn.financialYear?.label || null,
        date: safeFormatDate(pReturn.date),
        partyLabel: "Supplier",
        partyName: pReturn.supplier?.name || "Supplier",
        partyAddress: pReturn.supplier?.address || null,
        locationName: pReturn.location?.name || "Warehouse",
        referenceNo: pReturn.purchaseInvoice ? `Original Purchase: ${pReturn.purchaseInvoice.invoiceNo}` : null,
        totalAmount: toNumber(pReturn.totalAmount),
        notes: `Reason: ${pReturn.reason}`,
        signatures: { leftLabel: "Returned By", rightLabel: "Supplier Acceptance" },
        items: pReturn.items.map((item) => ({
          name: formatProductName(item.product),
          specs: formatSpecs(item.product),
          quantity: toItemNumber(item.quantity),
          unit: item.product?.unit || "Unit",
          unitPrice: toItemNumber(item.unitCost),
          lineTotal: toItemNumber(item.lineTotal, toItemNumber(item.quantity) * toItemNumber(item.unitCost)),
        })),
      });
    } else if (type === "payment-receipt" || type === "payment") {
      const payment = await prisma.payment.findUnique({
        where: { id },
        include: {
          party: true,
          financialYear: true,
          saleInvoice: true,
          purchaseInvoice: true,
          createdBy: true,
          splits: true,
        },
      });

      if (!payment) {
        return new NextResponse("Payment receipt not found", { status: 404 });
      }

      const receiptNo = payment.receiptNo || `RCT-${payment.id.slice(0, 8)}`;
      filename = `Receipt-${receiptNo}.pdf`;
      pdfBuffer = await renderPaymentReceiptPdfKit({
        receiptNo,
        sequenceNo: payment.sequenceNo,
        direction: payment.direction || (payment.party?.type === "CUSTOMER" ? "IN" : "OUT"),
        financialYearLabel: payment.financialYear?.label || null,
        date: safeFormatDate(payment.date),
        partyName: payment.party?.name || "Customer / Supplier",
        partyType: payment.party?.type || "CUSTOMER",
        partyPhone: payment.party?.phone || null,
        partyAddress: payment.party?.address || null,
        amount: toNumber(payment.amount),
        remainingBalance: payment.remainingBalance != null ? toNumber(payment.remainingBalance) : null,
        method: payment.method,
        notes: payment.notes,
        invoiceNo: payment.saleInvoice
          ? `Estimate #${formatSequenceDisplay(payment.saleInvoice.sequenceNo, payment.saleInvoice.invoiceNo)}`
          : payment.purchaseInvoice
            ? `Bill #${formatSequenceDisplay(payment.purchaseInvoice.sequenceNo, payment.purchaseInvoice.invoiceNo)}`
            : null,
        createdByName: payment.createdBy?.name || "Accounts Dept",
        splits: payment.splits?.map((s) => ({
          method: s.method,
          amount: toNumber(s.amount),
          reference: s.reference || null,
        })),
      });
    }

    if (!pdfBuffer) {
      return new NextResponse("Invalid document type or generation failure", { status: 400 });
    }

    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const disposition = isDownload ? "attachment" : "inline";

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[PDF Generation Error]", error instanceof Error ? error.stack : error);
    return new NextResponse(
      `Error generating PDF: ${error instanceof Error ? error.message : "Internal server error"}`,
      { status: 500 },
    );
  }
}

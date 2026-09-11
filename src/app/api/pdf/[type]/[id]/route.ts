import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { prisma } from "@/lib/db";
import { DocumentPdfView } from "@/pdf/documents";
import { format } from "date-fns";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { verifyDocShareToken } from "@/lib/tokens";

export const dynamic = "force-dynamic";

const ALLOWED_DOC_TYPES = new Set([
  "sale-invoice",
  "purchase-order",
  "delivery-order",
  "purchase-invoice",
  "sale-return",
  "purchase-return",
]);

export async function GET(
  request: NextRequest,
  { params }: { params: { type: string; id: string } },
) {
  // 1. Enforce authentication
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { type, id } = params;

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
    let docElement: React.ReactElement | null = null;
    let filename = `document-${id}.pdf`;

    if (type === "sale-invoice") {
      const invoice = await prisma.saleInvoice.findUnique({
        where: { id },
        include: {
          customer: true,
          location: true,
          deliveryOrder: true,
          items: { include: { product: true } },
        },
      });

      if (!invoice) {
        return new NextResponse("Sale invoice not found", { status: 404 });
      }

      filename = `Invoice-${invoice.invoiceNo}.pdf`;
      docElement = React.createElement(DocumentPdfView, {
        docType: "Sale Invoice",
        docNumber: invoice.invoiceNo,
        date: format(invoice.date, "dd MMM yyyy"),
        partyLabel: "Bill To (Customer)",
        partyName: invoice.customer.name,
        partyAddress: invoice.customer.address,
        partyPhone: invoice.customer.phone,
        locationName: invoice.location.name,
        referenceNo: invoice.deliveryOrder ? `DO: ${invoice.deliveryOrder.doNo}` : null,
        totalAmount: Number(invoice.totalAmount),
        amountPaid: Number(invoice.amountPaid),
        notes: invoice.notes,
        signatures: { leftLabel: "Prepared By", rightLabel: "Authorized Signature" },
        items: invoice.items.map((item) => ({
          name: `${item.product.productNo} - ${item.product.name}`,
          specs: `${Number(item.product.length)}"x${Number(item.product.breadth)}" | ${Number(item.product.gsm)} GSM`,
          quantity: Number(item.quantity),
          unit: item.product.unit,
          unitPrice: Number(item.unitPrice),
          lineTotal: Number(item.lineTotal),
        })),
      });
    } else if (type === "purchase-order") {
      const po = await prisma.purchaseOrder.findUnique({
        where: { id },
        include: {
          supplier: true,
          location: true,
          items: { include: { product: true } },
        },
      });

      if (!po) {
        return new NextResponse("Purchase order not found", { status: 404 });
      }

      filename = `PO-${po.orderNo}.pdf`;
      const totalAmount = po.items.reduce((sum, item) => sum + Number(item.lineTotal), 0);

      docElement = React.createElement(DocumentPdfView, {
        docType: "Purchase Order",
        docNumber: po.orderNo,
        date: format(po.date, "dd MMM yyyy"),
        partyLabel: "Supplier Details",
        partyName: po.supplier.name,
        partyAddress: po.supplier.address,
        partyPhone: po.supplier.phone,
        locationName: po.location.name,
        totalAmount,
        notes: po.notes,
        signatures: { leftLabel: "Ordered By", rightLabel: "Approved By" },
        items: po.items.map((item) => ({
          name: `${item.product.productNo} - ${item.product.name}`,
          specs: `${Number(item.product.length)}"x${Number(item.product.breadth)}" | ${Number(item.product.gsm)} GSM`,
          quantity: Number(item.quantity),
          unit: item.product.unit,
          unitPrice: Number(item.unitCost),
          lineTotal: Number(item.lineTotal),
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
          items: { include: { product: true } },
        },
      });

      if (!doRecord) {
        return new NextResponse("Delivery order not found", { status: 404 });
      }

      filename = `DO-${doRecord.doNo}.pdf`;
      docElement = React.createElement(DocumentPdfView, {
        docType: doRecord.customer ? "Delivery Order" : "Internal Stock Transfer Order",
        docNumber: doRecord.doNo,
        date: format(doRecord.date, "dd MMM yyyy"),
        partyLabel: doRecord.customer ? "Deliver To (Customer)" : "Destination Location",
        partyName: doRecord.customer?.name || (doRecord.destinationLocation ? `Internal Transfer: ${doRecord.destinationLocation.name}` : "Internal Stock Transfer"),
        partyAddress: doRecord.customer?.address || doRecord.destinationLocation?.address || null,
        partyPhone: doRecord.customer?.phone || null,
        locationName: doRecord.location.name,
        referenceNo: doRecord.linkedSaleInvoice ? `Invoice: ${doRecord.linkedSaleInvoice.invoiceNo}` : null,
        deliveryDetails: {
          vehicleNo: doRecord.vehicleNo,
          driverName: doRecord.driverName,
          deliveredTo: doRecord.deliveredTo,
        },
        notes: doRecord.notes,
        signatures: { leftLabel: "Dispatched / Delivered By", rightLabel: "Received By (Customer Stamp)" },
        items: doRecord.items.map((item) => ({
          name: `${item.product.productNo} - ${item.product.name}`,
          specs: `${Number(item.product.length)}"x${Number(item.product.breadth)}" | ${Number(item.product.gsm)} GSM`,
          quantity: Number(item.quantity),
          unit: item.unit,
        })),
      });
    } else if (type === "purchase-invoice") {
      const invoice = await prisma.purchaseInvoice.findUnique({
        where: { id },
        include: {
          supplier: true,
          location: true,
          purchaseOrder: true,
          items: { include: { product: true } },
        },
      });

      if (!invoice) {
        return new NextResponse("Purchase invoice not found", { status: 404 });
      }

      filename = `Purchase-${invoice.invoiceNo}.pdf`;
      docElement = React.createElement(DocumentPdfView, {
        docType: "Purchase Invoice",
        docNumber: invoice.invoiceNo,
        date: format(invoice.date, "dd MMM yyyy"),
        partyLabel: "Supplier",
        partyName: invoice.supplier.name,
        partyAddress: invoice.supplier.address,
        partyPhone: invoice.supplier.phone,
        locationName: invoice.location.name,
        referenceNo: invoice.purchaseOrder ? `PO: ${invoice.purchaseOrder.orderNo}` : null,
        totalAmount: Number(invoice.totalAmount),
        notes: invoice.notes,
        signatures: { leftLabel: "Received By", rightLabel: "Verified By" },
        items: invoice.items.map((item) => ({
          name: `${item.product.productNo} - ${item.product.name}`,
          specs: `${Number(item.product.length)}"x${Number(item.product.breadth)}" | ${Number(item.product.gsm)} GSM`,
          quantity: Number(item.quantity),
          unit: item.product.unit,
          unitPrice: Number(item.unitCost),
          lineTotal: Number(item.lineTotal),
        })),
      });
    } else if (type === "sale-return") {
      const sReturn = await prisma.saleReturn.findUnique({
        where: { id },
        include: {
          customer: true,
          location: true,
          saleInvoice: true,
          items: { include: { product: true } },
        },
      });

      if (!sReturn) {
        return new NextResponse("Sale return not found", { status: 404 });
      }

      filename = `Return-${sReturn.returnNo}.pdf`;
      docElement = React.createElement(DocumentPdfView, {
        docType: "Sale Credit Note / Return",
        docNumber: sReturn.returnNo,
        date: format(sReturn.date, "dd MMM yyyy"),
        partyLabel: "Customer",
        partyName: sReturn.customer.name,
        partyAddress: sReturn.customer.address,
        locationName: sReturn.location.name,
        referenceNo: `Original Invoice: ${sReturn.saleInvoice.invoiceNo}`,
        totalAmount: Number(sReturn.totalAmount),
        notes: `Reason: ${sReturn.reason}`,
        signatures: { leftLabel: "Returned By", rightLabel: "Approved By" },
        items: sReturn.items.map((item) => ({
          name: `${item.product.productNo} - ${item.product.name}`,
          specs: `${Number(item.product.length)}"x${Number(item.product.breadth)}" | ${Number(item.product.gsm)} GSM`,
          quantity: Number(item.quantity),
          unit: item.product.unit,
          unitPrice: Number(item.unitPrice),
          lineTotal: Number(item.lineTotal),
        })),
      });
    } else if (type === "purchase-return") {
      const pReturn = await prisma.purchaseReturn.findUnique({
        where: { id },
        include: {
          supplier: true,
          location: true,
          purchaseInvoice: true,
          items: { include: { product: true } },
        },
      });

      if (!pReturn) {
        return new NextResponse("Purchase return not found", { status: 404 });
      }

      filename = `DebitNote-${pReturn.returnNo}.pdf`;
      docElement = React.createElement(DocumentPdfView, {
        docType: "Purchase Debit Note / Return",
        docNumber: pReturn.returnNo,
        date: format(pReturn.date, "dd MMM yyyy"),
        partyLabel: "Supplier",
        partyName: pReturn.supplier.name,
        partyAddress: pReturn.supplier.address,
        locationName: pReturn.location.name,
        referenceNo: `Original Purchase: ${pReturn.purchaseInvoice.invoiceNo}`,
        totalAmount: Number(pReturn.totalAmount),
        notes: `Reason: ${pReturn.reason}`,
        signatures: { leftLabel: "Returned By", rightLabel: "Supplier Acceptance" },
        items: pReturn.items.map((item) => ({
          name: `${item.product.productNo} - ${item.product.name}`,
          specs: `${Number(item.product.length)}"x${Number(item.product.breadth)}" | ${Number(item.product.gsm)} GSM`,
          quantity: Number(item.quantity),
          unit: item.product.unit,
          unitPrice: Number(item.unitCost),
          lineTotal: Number(item.lineTotal),
        })),
      });
    }

    if (!docElement) {
      return new NextResponse("Invalid document type", { status: 400 });
    }

    const buffer = await renderToBuffer(docElement);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${isDownload ? "attachment" : "inline"}; filename="${filename}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    console.error("[PDF Generation Error]", error);
    return new NextResponse("Error generating PDF", { status: 500 });
  }
}

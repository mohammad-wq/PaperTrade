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

    const safeFormatDate = (val?: string | null | Date) => {
      if (!val) return format(new Date(), "dd/MM/yyyy");
      const d = new Date(val);
      return isNaN(d.getTime()) ? format(new Date(), "dd/MM/yyyy") : format(d, "dd/MM/yyyy");
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
        date: safeFormatDate(invoice.date),
        partyLabel: "Bill To (Customer)",
        partyName: invoice.customer?.name || "Customer",
        partyAddress: invoice.customer?.address || null,
        partyPhone: invoice.customer?.phone || null,
        locationName: invoice.location?.name || "Shop",
        referenceNo: invoice.deliveryOrder ? `DO: ${invoice.deliveryOrder.doNo}` : null,
        totalAmount: Number(invoice.totalAmount || 0),
        amountPaid: Number(invoice.amountPaid || 0),
        notes: invoice.notes,
        signatures: { leftLabel: "Prepared By", rightLabel: "Authorized Signature" },
        items: invoice.items.map((item) => ({
          name: formatProductName(item.product),
          specs: formatSpecs(item.product),
          quantity: Number(item.quantity || 0),
          unit: item.product?.unit || "Unit",
          unitPrice: Number(item.unitPrice || 0),
          lineTotal: Number(item.lineTotal || 0),
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
      const totalAmount = po.items.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0);

      docElement = React.createElement(DocumentPdfView, {
        docType: "Purchase Order",
        docNumber: po.orderNo,
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
          quantity: Number(item.quantity || 0),
          unit: item.product?.unit || "Unit",
          unitPrice: Number(item.unitCost || 0),
          lineTotal: Number(item.lineTotal || 0),
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
        },
        notes: doRecord.notes,
        signatures: { leftLabel: "Dispatched / Delivered By", rightLabel: "Received By (Customer Stamp)" },
        items: doRecord.items.map((item) => ({
          name: formatProductName(item.product),
          specs: formatSpecs(item.product),
          quantity: Number(item.quantity || 0),
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
        date: safeFormatDate(invoice.date),
        partyLabel: "Supplier",
        partyName: invoice.supplier?.name || "Supplier",
        partyAddress: invoice.supplier?.address || null,
        partyPhone: invoice.supplier?.phone || null,
        locationName: invoice.location?.name || "Warehouse",
        referenceNo: invoice.purchaseOrder ? `PO: ${invoice.purchaseOrder.orderNo}` : null,
        totalAmount: Number(invoice.totalAmount || 0),
        notes: invoice.notes,
        signatures: { leftLabel: "Received By", rightLabel: "Verified By" },
        items: invoice.items.map((item) => ({
          name: formatProductName(item.product),
          specs: formatSpecs(item.product),
          quantity: Number(item.quantity || 0),
          unit: item.product?.unit || "Unit",
          unitPrice: Number(item.unitCost || 0),
          lineTotal: Number(item.lineTotal || 0),
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
        date: safeFormatDate(sReturn.date),
        partyLabel: "Customer",
        partyName: sReturn.customer?.name || "Customer",
        partyAddress: sReturn.customer?.address || null,
        locationName: sReturn.location?.name || "Shop",
        referenceNo: sReturn.saleInvoice ? `Original Invoice: ${sReturn.saleInvoice.invoiceNo}` : null,
        totalAmount: Number(sReturn.totalAmount || 0),
        notes: `Reason: ${sReturn.reason}`,
        signatures: { leftLabel: "Returned By", rightLabel: "Approved By" },
        items: sReturn.items.map((item) => ({
          name: formatProductName(item.product),
          specs: formatSpecs(item.product),
          quantity: Number(item.quantity || 0),
          unit: item.product?.unit || "Unit",
          unitPrice: Number(item.unitPrice || 0),
          lineTotal: Number(item.lineTotal || 0),
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
        date: safeFormatDate(pReturn.date),
        partyLabel: "Supplier",
        partyName: pReturn.supplier?.name || "Supplier",
        partyAddress: pReturn.supplier?.address || null,
        locationName: pReturn.location?.name || "Warehouse",
        referenceNo: pReturn.purchaseInvoice ? `Original Purchase: ${pReturn.purchaseInvoice.invoiceNo}` : null,
        totalAmount: Number(pReturn.totalAmount || 0),
        notes: `Reason: ${pReturn.reason}`,
        signatures: { leftLabel: "Returned By", rightLabel: "Supplier Acceptance" },
        items: pReturn.items.map((item) => ({
          name: formatProductName(item.product),
          specs: formatSpecs(item.product),
          quantity: Number(item.quantity || 0),
          unit: item.product?.unit || "Unit",
          unitPrice: Number(item.unitCost || 0),
          lineTotal: Number(item.lineTotal || 0),
        })),
      });
    }

    if (!docElement) {
      return new NextResponse("Invalid document type", { status: 400 });
    }

    const buffer = await renderToBuffer(docElement);
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const disposition = isDownload ? "attachment" : "inline";

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "private, max-age=3600",
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

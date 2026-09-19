import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { DocumentPdfView } from "@/pdf/documents";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      type = "sale-invoice",
      docNumber = "DRAFT-PREVIEW",
      financialYearLabel = null,
      date = new Date().toISOString(),
      partyLabel = "Bill To (Customer)",
      partyName = "Customer",
      partyAddress = null,
      partyPhone = null,
      locationName = "Shop",
      referenceNo = null,
      totalAmount = 0,
      amountPaid = 0,
      notes = null,
      items = [],
    } = body;

    const safeFormatDate = (val?: string | null | Date) => {
      if (!val) return format(new Date(), "dd/MM/yyyy");
      const d = new Date(val);
      return isNaN(d.getTime()) ? format(new Date(), "dd/MM/yyyy") : format(d, "dd/MM/yyyy");
    };

    let docTitle = "Sale Invoice (Draft Preview)";
    if (type === "purchase-order") docTitle = "Purchase Order (Draft Preview)";
    if (type === "delivery-order") docTitle = "Delivery Order (Draft Preview)";
    if (type === "purchase-invoice") docTitle = "Purchase Invoice (Draft Preview)";
    if (type === "sale-return") docTitle = "Credit Note (Draft Preview)";
    if (type === "purchase-return") docTitle = "Debit Note (Draft Preview)";

    const docElement = React.createElement(DocumentPdfView, {
      docType: docTitle,
      docNumber,
      financialYearLabel,
      date: safeFormatDate(date),
      partyLabel,
      partyName,
      partyAddress,
      partyPhone,
      locationName,
      referenceNo,
      totalAmount: Number(totalAmount || 0),
      amountPaid: Number(amountPaid || 0),
      notes,
      signatures: { leftLabel: "Prepared By", rightLabel: "Authorized Signature" },
      items: items.map((item: any) => ({
        name: item.name || "Product Item",
        specs: item.specs || "Standard Paper",
        lot: item.lot || null,
        quantity: Number(item.quantity || 0),
        unit: item.unit || "Unit",
        unitPrice: Number(item.unitPrice || 0),
        lineTotal: Number(item.lineTotal || (Number(item.quantity || 0) * Number(item.unitPrice || 0))),
      })),
    });

    const buffer = await renderToBuffer(docElement as any);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="preview.pdf"',
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (err: any) {
    console.error("[PDF Preview Error]", err);
    return new NextResponse(err.message || "Failed to generate preview PDF", { status: 500 });
  }
}

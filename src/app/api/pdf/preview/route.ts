import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { renderDocumentPdfKit } from "@/lib/pdfkit-generator";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

const toNumber = (value: unknown, fallback = 0) => {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : fallback;
};

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
      walkInName = null,
      recipientName = null,
      locationName = "Shop",
      referenceNo = null,
      totalAmount = 0,
      amountPaid = 0,
      freightCharges = 0,
      notes = null,
      items = [],
    } = body;

    const safeFormatDate = (val?: string | null | Date) => {
      if (!val) return format(new Date(), "dd-MM-yyyy h:mm a");
      const d = new Date(val);
      return isNaN(d.getTime()) ? format(new Date(), "dd-MM-yyyy h:mm a") : format(d, "dd-MM-yyyy h:mm a");
    };

    let docTitle = "Estimate";
    if (type === "purchase-order") docTitle = "Purchase Order";
    if (type === "delivery-order") docTitle = "Delivery Order";
    if (type === "purchase-invoice") docTitle = "Purchase Invoice";
    if (type === "sale-return") docTitle = "Credit Note";
    if (type === "purchase-return") docTitle = "Debit Note";

    const pdfBuffer = await renderDocumentPdfKit({
      docType: docTitle,
      docNumber,
      financialYearLabel,
      date: safeFormatDate(date),
      partyLabel,
      partyName,
      walkInName,
      partyAddress,
      partyPhone,
      locationName,
      referenceNo,
      totalAmount: toNumber(totalAmount),
      amountPaid: toNumber(amountPaid),
      freightCharges: toNumber(freightCharges),
      deliveryDetails: recipientName ? { recipientName } : undefined,
      notes,
      signatures: { leftLabel: "Prepared By", rightLabel: "Authorized Signature" },
      items: items.map((item: any) => {
        const quantity = toNumber(item.quantity);
        const unitPrice = toNumber(item.unitPrice);
        return {
          name: item.name || "Product Item",
          specs: item.specs || "Standard Paper",
          lot: item.lot || null,
          quantity,
          unit: item.unit || "Unit",
          unitPrice,
          lineTotal: toNumber(item.lineTotal, quantity * unitPrice),
        };
      }),
    });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="preview.pdf"',
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err: any) {
    console.error("[PDF Preview Error]", err);
    return new NextResponse(err.message || "Failed to generate preview PDF", { status: 500 });
  }
}

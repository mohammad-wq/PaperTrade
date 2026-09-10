import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { prisma } from "@/lib/db";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  // 1. Enforce authentication
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  // 2. Rate limit: 30 requests per minute per user/IP
  const clientIp = getClientIp(request.headers);
  const rateLimit = checkRateLimit(`wa_share:${session.user.id || clientIp}`, 30, 60 * 1000);
  if (!rateLimit.success) {
    return NextResponse.json(
      { success: false, error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const id = searchParams.get("id");

  if (!type || !id) {
    return NextResponse.json({ success: false, error: "Missing type or id" }, { status: 400 });
  }

  try {
    const origin = request.nextUrl.origin;
    const directPdfUrl = `${origin}/api/pdf/${type}/${id}?download=true`;

    let phone = "";
    let docTitle = "";
    let partyName = "";
    let total = "";

    if (type === "sale-invoice") {
      const inv = await prisma.saleInvoice.findUnique({ where: { id }, include: { customer: true } });
      if (inv) {
        docTitle = `Invoice #${inv.invoiceNo}`;
        partyName = inv.customer.name;
        phone = inv.customer.phone || "";
        total = `Total: PKR ${Number(inv.totalAmount).toLocaleString()}`;
      }
    } else if (type === "purchase-order") {
      const po = await prisma.purchaseOrder.findUnique({ where: { id }, include: { supplier: true } });
      if (po) {
        docTitle = `Purchase Order #${po.orderNo}`;
        partyName = po.supplier.name;
        phone = po.supplier.phone || "";
      }
    } else if (type === "delivery-order") {
      const doRec = await prisma.deliveryOrder.findUnique({
        where: { id },
        include: { customer: true, destinationLocation: true, location: true },
      });
      if (doRec) {
        docTitle = doRec.customer ? `Delivery Order #${doRec.doNo}` : `Transfer Order #${doRec.doNo}`;
        partyName = doRec.customer?.name || (doRec.destinationLocation ? `Transfer to ${doRec.destinationLocation.name}` : "Internal Transfer");
        phone = doRec.customer?.phone || "";
      }
    } else if (type === "sale-return") {
      const ret = await prisma.saleReturn.findUnique({ where: { id }, include: { customer: true } });
      if (ret) {
        docTitle = `Credit Note / Return #${ret.returnNo}`;
        partyName = ret.customer.name;
        phone = ret.customer.phone || "";
      }
    }

    // Clean phone number (remove +, spaces, dashes)
    const cleanPhone = phone.replace(/[^0-9]/g, "");

    const message = encodeURIComponent(
      `Hello ${partyName},\n\nPlease find your ${docTitle} from Paper Trade.\n${total ? `${total}\n` : ""}View/Download Document PDF:\n${directPdfUrl}\n\nThank you for your business!`,
    );

    const waUrl = cleanPhone
      ? `https://wa.me/${cleanPhone}?text=${message}`
      : `https://wa.me/?text=${message}`;

    return NextResponse.json({ success: true, url: waUrl });
  } catch (error) {
    console.error("[WhatsApp Share Error]", error);
    return NextResponse.json({ success: false, error: "Failed to generate WhatsApp link" }, { status: 500 });
  }
}

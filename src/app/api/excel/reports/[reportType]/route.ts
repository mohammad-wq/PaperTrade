import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import {
  calculateProfitLoss,
  calculateBalanceSheet,
  calculateCashFlow,
  calculatePartyStatement,
} from "@/lib/financial-reports";
import {
  buildProfitLossExcel,
  buildBalanceSheetExcel,
  buildCashFlowExcel,
  buildPartyStatementExcel,
} from "@/lib/excel-reports";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ reportType: string }> }
) {
  // 1. Enforce authentication
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // 2. Rate limit Excel generation: 30 requests per minute
  const clientIp = getClientIp(request.headers);
  const rateLimit = checkRateLimit(`report_excel:${session.user.id || clientIp}`, 30, 60 * 1000);
  if (!rateLimit.success) {
    return new NextResponse("Too many download requests. Please wait a moment.", {
      status: 429,
      headers: { "Retry-After": "60" },
    });
  }

  const { reportType } = await params;
  const searchParams = request.nextUrl.searchParams;
  const startDate = searchParams.get("startDate") || undefined;
  const endDate = searchParams.get("endDate") || undefined;
  const asOfDate = searchParams.get("asOfDate") || undefined;
  const partyId = searchParams.get("partyId") || undefined;
  const productId = searchParams.get("productId") || undefined;

  try {
    let buffer: Buffer | null = null;
    let filename = `report-${reportType}.xlsx`;

    if (reportType === "profit-loss") {
      const data = await calculateProfitLoss({ startDate, endDate });
      filename = `Profit-Loss-${startDate || "all"}-to-${endDate || "present"}.xlsx`;
      buffer = await buildProfitLossExcel(data, { startDate, endDate });
    } else if (reportType === "balance-sheet") {
      const data = await calculateBalanceSheet({ asOfDate });
      filename = `Balance-Sheet-${asOfDate || "latest"}.xlsx`;
      buffer = await buildBalanceSheetExcel(data, { asOfDate });
    } else if (reportType === "cash-flow") {
      const data = await calculateCashFlow({ startDate, endDate });
      filename = `Cash-Flow-${startDate || "all"}-to-${endDate || "present"}.xlsx`;
      buffer = await buildCashFlowExcel(data, { startDate, endDate });
    } else if (reportType === "party-statement") {
      if (!partyId) {
        return new NextResponse("partyId parameter is required", { status: 400 });
      }

      const data = await calculatePartyStatement({ partyId, startDate, endDate, productId });
      const sanitizedName = data.party.name.replace(/[^a-zA-Z0-9_-]/g, "_");
      filename = `Statement-${sanitizedName}.xlsx`;
      buffer = await buildPartyStatementExcel(data, { startDate, endDate, productId });
    }

    if (!buffer) {
      return new NextResponse("Unknown report type", { status: 400 });
    }

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error(`[API/EXCEL/${reportType}] Generation failed:`, error);
    return new NextResponse(
      `Failed to generate Excel report: ${error instanceof Error ? error.message : "Internal error"}`,
      { status: 500 }
    );
  }
}


import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import {
  calculateProfitLoss,
  calculateBalanceSheet,
  calculateCashFlow,
  calculatePartyStatement,
} from "@/lib/financial-reports";
import { ProfitLossPdfView, CashFlowPdfView, BalanceSheetPdfView, PartyStatementPdfView } from "@/pdf/reports";
import { format } from "date-fns";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { reportType: string } },
) {
  // 1. Enforce authentication
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // 2. Rate limit PDF generation (CPU intensive): 20 requests per minute
  const clientIp = getClientIp(request.headers);
  const rateLimit = checkRateLimit(`report_pdf:${session.user.id || clientIp}`, 20, 60 * 1000);
  if (!rateLimit.success) {
    return new NextResponse("Too many PDF requests. Please wait a moment.", {
      status: 429,
      headers: { "Retry-After": "60" },
    });
  }

  const { reportType } = params;
  const searchParams = request.nextUrl.searchParams;
  const isDownload = searchParams.get("download") === "true";
  const startDate = searchParams.get("startDate") || undefined;
  const endDate = searchParams.get("endDate") || undefined;
  const asOfDate = searchParams.get("asOfDate") || undefined;
  const partyId = searchParams.get("partyId") || undefined;
  const productId = searchParams.get("productId") || undefined;

  try {
    let docElement: React.ReactElement | null = null;
    let filename = `report-${reportType}.pdf`;

    if (reportType === "profit-loss") {
      const data = await calculateProfitLoss({ startDate, endDate });

      const period = startDate && endDate
        ? `${startDate} to ${endDate}`
        : startDate
        ? `From ${startDate}`
        : endDate
        ? `Up to ${endDate}`
        : "All Time";

      filename = `Income-Statement-${startDate || "all"}-to-${endDate || "present"}.pdf`;
      docElement = React.createElement(ProfitLossPdfView, {
        period,
        sales: data.sales,
        purchases: data.purchases,
        grossProfit: data.grossProfit,
        expenses: data.expenses,
        netProfit: data.netProfit,
      });
    } else if (reportType === "cash-flow") {
      const data = await calculateCashFlow({ startDate, endDate });

      const period = startDate && endDate
        ? `${startDate} to ${endDate}`
        : startDate
        ? `From ${startDate}`
        : endDate
        ? `Up to ${endDate}`
        : "All Time";

      filename = `Cash-Flow-${startDate || "all"}-to-${endDate || "present"}.pdf`;
      docElement = React.createElement(CashFlowPdfView, {
        period,
        cashInflow: data.cashInflow,
        cashOutflow: data.cashOutflow,
        netCashFlow: data.netCashFlow,
        startingBalance: data.beginningBalance,
        endingBalance: data.endingBalance,
        flowDetails: data.flowDetails.map((f) => ({
          ...f,
          date: format(new Date(f.date), "dd MMM yyyy"),
        })),
      });
    } else if (reportType === "balance-sheet") {
      const data = await calculateBalanceSheet({ asOfDate });

      const formattedAsOf = format(new Date(data.asOf), "dd MMM yyyy");
      filename = `Balance-Sheet-${asOfDate || "latest"}.pdf`;
      docElement = React.createElement(BalanceSheetPdfView, {
        asOfDate: formattedAsOf,
        assets: data.assets,
        liabilities: data.liabilities,
        equity: data.equity,
      });
    } else if (reportType === "party-statement") {
      if (!partyId) {
        return new NextResponse("partyId parameter is required", { status: 400 });
      }

      const data = await calculatePartyStatement({ partyId, startDate, endDate, productId });

      const sanitizedName = data.party.name.replace(/[^a-zA-Z0-9_-]/g, "_");
      filename = `Statement-${sanitizedName}.pdf`;

      docElement = React.createElement(PartyStatementPdfView, {
        party: data.party,
        currentBalance: data.currentBalance,
        openingBalance: data.openingBalance,
        startDate: startDate ? format(new Date(startDate), "dd MMM yyyy") : undefined,
        endDate: endDate ? format(new Date(endDate), "dd MMM yyyy") : undefined,
        ledgerRows: data.ledgerRows.map((r) => ({
          ...r,
          date: format(new Date(r.date), "dd MMM yyyy"),
        })),
      });
    }

    if (!docElement) {
      return new NextResponse("Unknown report type", { status: 400 });
    }

    const buffer = await renderToBuffer(docElement);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${isDownload ? "attachment" : "inline"}; filename="${filename}"`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (error) {
    console.error("[Report PDF Error]", error);
    return new NextResponse("Error generating report PDF", { status: 500 });
  }
}

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
import {
  ProfitLossPdfView,
  CashFlowPdfView,
  BalanceSheetPdfView,
  PartyStatementPdfView,
  GeneralLedgerPdfView,
} from "@/pdf/reports";
import { prisma } from "@/lib/db";
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

    const safeFormatDate = (val?: string | null | Date) => {
      if (!val) return undefined;
      const d = new Date(val);
      return isNaN(d.getTime()) ? undefined : format(d, "dd/MM/yyyy");
    };

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
        grossSales: data.grossSales,
        salesReturns: data.salesReturns,
        grossPurchases: data.grossPurchases,
        purchaseReturns: data.purchaseReturns,
        grossMarginPct: data.grossMarginPct,
        netMarginPct: data.netMarginPct,
        expenseBreakdown: data.expenseBreakdown,
        expenseItems: data.expenseItems?.map((e) => ({
          ...e,
          date: safeFormatDate(e.date) || "—",
        })),
        salesBreakdown: data.salesBreakdown?.map((s) => ({
          ...s,
          date: safeFormatDate(s.date) || "—",
        })),
        purchasesBreakdown: data.purchasesBreakdown?.map((p) => ({
          ...p,
          date: safeFormatDate(p.date) || "—",
        })),
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
          date: safeFormatDate(f.date) || "—",
        })),
      });
    } else if (reportType === "balance-sheet") {
      const data = await calculateBalanceSheet({ asOfDate });

      const formattedAsOf = safeFormatDate(data.asOf) || format(new Date(), "dd/MM/yyyy");
      filename = `Balance-Sheet-${asOfDate || "latest"}.pdf`;
      docElement = React.createElement(BalanceSheetPdfView, {
        asOfDate: formattedAsOf,
        assets: data.assets,
        liabilities: data.liabilities,
        equity: data.equity,
        receivablesSchedule: data.receivablesSchedule,
        payablesSchedule: data.payablesSchedule,
      });
    } else if (reportType === "party-statement") {
      if (!partyId) {
        return new NextResponse("partyId parameter is required", { status: 400 });
      }

      const data = await calculatePartyStatement({ partyId, startDate, endDate, productId });

      const safeName = (data.party.name || "Party")
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "") || "Account";
      filename = `Statement-${safeName}.pdf`;

      docElement = React.createElement(PartyStatementPdfView, {
        party: data.party,
        currentBalance: data.currentBalance,
        openingBalance: data.openingBalance,
        openingBalanceSourceYear: (data as any).openingBalanceSourceYear,
        startDate: safeFormatDate(startDate),
        endDate: safeFormatDate(endDate),
        ledgerRows: data.ledgerRows.map((r) => ({
          ...r,
          date: safeFormatDate(r.date) || "—",
        })),
      });
    } else if (reportType === "general-ledger") {
      const accountType = searchParams.get("accountType") || undefined;
      const dateFilter: Record<string, Date> = {};
      if (startDate) dateFilter.gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.lte = end;
      }

      const entries = await prisma.ledgerEntry.findMany({
        where: {
          ...(partyId && partyId !== "ALL" ? { partyId } : {}),
          ...(accountType && accountType !== "ALL" ? { accountType: accountType as any } : {}),
          ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
        },
        include: {
          party: { select: { id: true, name: true } },
        },
        orderBy: { date: "asc" },
      });

      const totalDebit = entries.reduce((s, e) => s + Number(e.debit), 0);
      const totalCredit = entries.reduce((s, e) => s + Number(e.credit), 0);

      const period = startDate && endDate
        ? `${startDate} to ${endDate}`
        : startDate
        ? `From ${startDate}`
        : endDate
        ? `Up to ${endDate}`
        : "All Time";

      const filters = [
        accountType && accountType !== "ALL" ? `Account: ${accountType}` : null,
        partyId && partyId !== "ALL" ? `Party ID: ${partyId}` : null,
      ].filter(Boolean).join(" | ") || "None";

      filename = `General-Ledger-${startDate || "all"}-to-${endDate || "present"}.pdf`;
      docElement = React.createElement(GeneralLedgerPdfView, {
        period,
        filterInfo: filters,
        totalDebit,
        totalCredit,
        entries: entries.map((e) => ({
          date: safeFormatDate(e.date) || "",
          accountType: e.accountType,
          partyName: e.party ? `${e.party.name} (${e.party.id.slice(-6)})` : "—",
          referenceType: e.referenceType,
          referenceId: e.referenceId,
          description: e.description,
          debit: Number(e.debit),
          credit: Number(e.credit),
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
        "Content-Disposition": `${isDownload ? "attachment" : "inline"}; filename="${encodeURIComponent(filename)}"`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (error) {
    console.error("[Report PDF Error]", error instanceof Error ? error.stack : error);
    return new NextResponse(
      `Error generating report PDF: ${error instanceof Error ? error.message : "Internal server error"}`,
      { status: 500 },
    );
  }
}

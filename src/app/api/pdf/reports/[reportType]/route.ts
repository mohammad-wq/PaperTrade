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
import { renderPartyStatementPdfKit } from "@/lib/pdfkit-generator";
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
import { formatSequenceDisplay } from "@/lib/financial-year";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ reportType: string }> },
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

  const { reportType } = await params;
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

      const pdfBuffer = await renderPartyStatementPdfKit({
        companyName: process.env.BUSINESS_NAME || "PAPER TRADE CO.",
        companyAddress: process.env.BUSINESS_ADDRESS || "Wholesale Paper Market, Station Road",
        companyPhone: process.env.BUSINESS_PHONE || "+92-300-1234567",
        companyEmail: process.env.BUSINESS_EMAIL || undefined,
        party: data.party,
        currentBalance: data.currentBalance,
        openingBalance: data.openingBalance,
        openingBalanceSourceYear: (data as any).openingBalanceSourceYear,
        startDate: safeFormatDate(startDate),
        endDate: safeFormatDate(endDate),
        ledgerRows: data.ledgerRows.map((r) => ({
          date: safeFormatDate(r.date) || "—",
          referenceDocNo: r.referenceDocNo,
          referenceType: r.referenceType,
          description: r.description,
          debit: Number(r.debit) || 0,
          credit: Number(r.credit) || 0,
          runningBalance: Number(r.runningBalance) || 0,
          detailRows: r.detailRows?.map((d) => ({
            productName: d.productName,
            quantity: Number(d.quantity) || 0,
            unit: d.unit,
            rate: Number(d.rate) || 0,
            amount: Number(d.amount) || 0,
          })),
        })),
      });

      const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      return new NextResponse(new Uint8Array(pdfBuffer), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `${isDownload ? "attachment" : "inline"}; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
          "Cache-Control": "private, max-age=60",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } else if (reportType === "general-ledger") {
      const accountType = searchParams.get("accountType") || undefined;
      const referenceType = searchParams.get("referenceType") || undefined;
      const dateFilter: Record<string, Date> = {};
      if (startDate) dateFilter.gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.lte = end;
      }

      let partyNameFilter = "";
      if (partyId && partyId !== "ALL") {
        const p = await prisma.party.findUnique({ where: { id: partyId }, select: { name: true } });
        if (p) partyNameFilter = p.name;
      }

      // 1. Calculate opening balance prior to startDate
      let openingBalance = 0;
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);

        const priorAgg = await prisma.ledgerEntry.aggregate({
          where: {
            ...(partyId && partyId !== "ALL" ? { partyId } : {}),
            ...(accountType && accountType !== "ALL" ? { accountType: accountType as any } : {}),
            ...(referenceType && referenceType !== "ALL" ? { referenceType } : {}),
            date: { lt: start },
          },
          _sum: { debit: true, credit: true },
        });

        const priorDebit = Number(priorAgg._sum.debit ?? 0);
        const priorCredit = Number(priorAgg._sum.credit ?? 0);
        openingBalance = priorDebit - priorCredit;
      }

      // 2. Query entries chronologically
      const entries = await prisma.ledgerEntry.findMany({
        where: {
          ...(partyId && partyId !== "ALL" ? { partyId } : {}),
          ...(accountType && accountType !== "ALL" ? { accountType: accountType as any } : {}),
          ...(referenceType && referenceType !== "ALL" ? { referenceType } : {}),
          ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
        },
        include: {
          party: { select: { id: true, name: true } },
        },
        orderBy: { date: "asc" },
      });

      // 3. Resolve human-readable voucher details
      const saleInvoiceIds = entries.filter((e) => e.referenceType === "SALE_INVOICE").map((e) => e.referenceId);
      const purchaseInvoiceIds = entries.filter((e) => e.referenceType === "PURCHASE_INVOICE").map((e) => e.referenceId);
      const paymentIds = entries.filter((e) => e.referenceType === "PAYMENT").map((e) => e.referenceId);
      const saleReturnIds = entries.filter((e) => e.referenceType === "SALE_RETURN").map((e) => e.referenceId);
      const purchaseReturnIds = entries.filter((e) => e.referenceType === "PURCHASE_RETURN").map((e) => e.referenceId);
      const expenseIds = entries.filter((e) => e.referenceType === "EXPENSE").map((e) => e.referenceId);

      const [saleInvoices, purchaseInvoices, payments, saleReturns, purchaseReturns, expenses] = await Promise.all([
        saleInvoiceIds.length > 0
          ? prisma.saleInvoice.findMany({
              where: { id: { in: saleInvoiceIds } },
              select: {
                id: true,
                invoiceNo: true,
                sequenceNo: true,
                items: {
                  select: {
                    quantity: true,
                    product: { select: { productNo: true, name: true, unit: true } },
                  },
                },
              },
            })
          : [],
        purchaseInvoiceIds.length > 0
          ? prisma.purchaseInvoice.findMany({
              where: { id: { in: purchaseInvoiceIds } },
              select: {
                id: true,
                invoiceNo: true,
                sequenceNo: true,
                items: {
                  select: {
                    quantity: true,
                    product: { select: { productNo: true, name: true, unit: true } },
                  },
                },
              },
            })
          : [],
        paymentIds.length > 0
          ? prisma.payment.findMany({ where: { id: { in: paymentIds } }, select: { id: true, receiptNo: true, sequenceNo: true, direction: true } })
          : [],
        saleReturnIds.length > 0
          ? prisma.saleReturn.findMany({ where: { id: { in: saleReturnIds } }, select: { id: true, returnNo: true, sequenceNo: true } })
          : [],
        purchaseReturnIds.length > 0
          ? prisma.purchaseReturn.findMany({ where: { id: { in: purchaseReturnIds } }, select: { id: true, returnNo: true, sequenceNo: true } })
          : [],
        expenseIds.length > 0
          ? prisma.expense.findMany({ where: { id: { in: expenseIds } }, select: { id: true, expenseNo: true } })
          : [],
      ]);

      const docMap = new Map<string, { voucherType: string; docNo: string }>();
      const itemsMap = new Map<string, string>();

      for (const s of saleInvoices) {
        docMap.set(s.id, {
          voucherType: "Estimate",
          docNo: `#${formatSequenceDisplay(s.sequenceNo, s.invoiceNo)}`,
        });
        if (s.items && s.items.length > 0) {
          itemsMap.set(
            s.id,
            s.items
              .map(
                (i) =>
                  `[${i.product.productNo}] ${i.product.name} (${Number(i.quantity)} ${i.product.unit || "pkts"})`
              )
              .join(", ")
          );
        }
      }
      for (const p of purchaseInvoices) {
        docMap.set(p.id, {
          voucherType: "Purchase",
          docNo: `#${formatSequenceDisplay(p.sequenceNo, p.invoiceNo)}`,
        });
        if (p.items && p.items.length > 0) {
          itemsMap.set(
            p.id,
            p.items
              .map(
                (i) =>
                  `[${i.product.productNo}] ${i.product.name} (${Number(i.quantity)} ${i.product.unit || "pkts"})`
              )
              .join(", ")
          );
        }
      }
      for (const pay of payments) {
        const isOut = pay.direction === "OUT";
        docMap.set(pay.id, {
          voucherType: isOut ? "Payment Voucher" : "Receipt",
          docNo: `#${formatSequenceDisplay(pay.sequenceNo, pay.receiptNo)}`,
        });
      }
      for (const sr of saleReturns) {
        docMap.set(sr.id, {
          voucherType: "Sale Return",
          docNo: `#${formatSequenceDisplay(sr.sequenceNo, sr.returnNo)}`,
        });
      }
      for (const pr of purchaseReturns) {
        docMap.set(pr.id, {
          voucherType: "Purchase Return",
          docNo: `#${formatSequenceDisplay(pr.sequenceNo, pr.returnNo)}`,
        });
      }
      for (const exp of expenses) {
        docMap.set(exp.id, {
          voucherType: "Expense",
          docNo: exp.expenseNo || `#${exp.id.slice(-6)}`,
        });
      }

      let runningBalance = openingBalance;
      const mappedEntries = entries.map((e) => {
        const debit = Number(e.debit);
        const credit = Number(e.credit);
        runningBalance += debit - credit;

        const docInfo = docMap.get(e.referenceId) || {
          voucherType: e.referenceType.replace(/_/g, " "),
          docNo: e.referenceId.length > 10 ? `#${e.referenceId.slice(-6)}` : e.referenceId,
        };

        let description = e.description || "";
        if (
          (e.referenceType === "SALE_INVOICE" || e.referenceType === "PURCHASE_INVOICE") &&
          !description.includes("[") &&
          itemsMap.has(e.referenceId)
        ) {
          const itemSummary = itemsMap.get(e.referenceId)!;
          description = description ? `${description} • ${itemSummary}` : itemSummary;
        }

        return {
          date: formatDateTime(e.date),
          accountType: e.accountType,
          partyName: e.party ? e.party.name : "—",
          referenceType: e.referenceType,
          referenceId: e.referenceId,
          voucherType: docInfo.voucherType,
          docNo: docInfo.docNo,
          description,
          debit,
          credit,
          runningBalance,
        };
      });

      const totalDebit = mappedEntries.reduce((s, e) => s + e.debit, 0);
      const totalCredit = mappedEntries.reduce((s, e) => s + e.credit, 0);
      const closingBalance = openingBalance + totalDebit - totalCredit;

      const period = startDate && endDate
        ? `${startDate} to ${endDate}`
        : startDate
        ? `From ${startDate}`
        : endDate
        ? `Up to ${endDate}`
        : "All Time";

      const filters = [
        partyNameFilter ? `Party: ${partyNameFilter}` : null,
        accountType && accountType !== "ALL" ? `Account: ${accountType}` : null,
        referenceType && referenceType !== "ALL" ? `Transaction: ${referenceType.replace(/_/g, " ")}` : null,
      ].filter(Boolean).join(" | ") || "All Transactions";

      filename = `General-Ledger-${startDate || "all"}-to-${endDate || "present"}.pdf`;
      docElement = React.createElement(GeneralLedgerPdfView, {
        period,
        filterInfo: filters,
        openingBalance,
        totalDebit,
        totalCredit,
        closingBalance,
        entries: mappedEntries,
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
        "X-Content-Type-Options": "nosniff",
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

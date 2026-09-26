"use server";

import { runAction } from "@/actions/_helpers";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { AccountType } from "@prisma/client";
import { formatSequenceDisplay } from "@/lib/financial-year";

export async function listLedgerEntriesAction(filters?: {
  partyId?: string;
  accountType?: AccountType | "ALL";
  referenceType?: string | "ALL";
  startDate?: string;
  endDate?: string;
  limit?: number;
  sortOrder?: "asc" | "desc";
}) {
  return runAction("ledger.list", async () => {
    await requireSession();

    const where: Record<string, unknown> = {};

    if (filters?.partyId && filters.partyId !== "ALL") {
      where.partyId = filters.partyId;
    }
    if (filters?.accountType && filters.accountType !== "ALL") {
      where.accountType = filters.accountType;
    }
    if (filters?.referenceType && filters.referenceType !== "ALL") {
      where.referenceType = filters.referenceType;
    }

    // 1. Calculate opening balance prior to startDate if startDate is supplied
    let openingBalance = 0;
    if (filters?.startDate) {
      const start = new Date(filters.startDate);
      start.setHours(0, 0, 0, 0);

      const priorAgg = await prisma.ledgerEntry.aggregate({
        where: {
          ...where,
          date: { lt: start },
        },
        _sum: { debit: true, credit: true },
      });

      const priorDebit = Number(priorAgg._sum.debit ?? 0);
      const priorCredit = Number(priorAgg._sum.credit ?? 0);
      openingBalance = priorDebit - priorCredit;
    }

    // 2. Set current period date filter
    if (filters?.startDate || filters?.endDate) {
      const dateFilter: Record<string, Date> = {};
      if (filters.startDate) {
        const start = new Date(filters.startDate);
        start.setHours(0, 0, 0, 0);
        dateFilter.gte = start;
      }
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.lte = end;
      }
      where.date = dateFilter;
    }

    const takeLimit = typeof filters?.limit === "number" && filters.limit > 0 ? filters.limit : 1000;

    // 3. Query entries chronologically for accounting running balance calculation
    const entries = await prisma.ledgerEntry.findMany({
      where,
      orderBy: { date: "asc" },
      take: takeLimit,
      include: {
        party: { select: { id: true, name: true, type: true } },
        createdBy: { select: { name: true } },
      },
    });

    // 4. Resolve human-readable voucher details
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

    // 5. Compute running balances row by row
    let currentBalance = openingBalance;
    const mapped = entries.map((e) => {
      const debit = Number(e.debit);
      const credit = Number(e.credit);
      currentBalance += debit - credit;

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
        ...e,
        description,
        debit,
        credit,
        runningBalance: currentBalance,
        voucherType: docInfo.voucherType,
        docNo: docInfo.docNo,
      };
    });

    const totalDebit = mapped.reduce((sum, e) => sum + e.debit, 0);
    const totalCredit = mapped.reduce((sum, e) => sum + e.credit, 0);
    const closingBalance = openingBalance + totalDebit - totalCredit;

    // If reverse order requested for display, reverse mapped items (each retains its true row balance)
    const resultEntries = filters?.sortOrder === "desc" ? [...mapped].reverse() : mapped;

    return {
      entries: resultEntries,
      totalDebit,
      totalCredit,
      openingBalance,
      closingBalance,
    };
  });
}


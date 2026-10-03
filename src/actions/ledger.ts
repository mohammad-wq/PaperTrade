"use server";

import { runAction } from "@/actions/_helpers";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { AccountType } from "@prisma/client";
import { formatSequenceDisplay } from "@/lib/financial-year";
import { userError } from "@/lib/errors";
import { canPerformAction } from "@/lib/auth/permissions";

export async function listLedgerEntriesAction(filters?: {
  partyId?: string;
  accountType?: AccountType | "ALL";
  referenceType?: string | "ALL";
  partnershipFilter?: "REGULAR" | "PARTNERSHIP" | "ALL";
  startDate?: string;
  endDate?: string;
  limit?: number;
  sortOrder?: "asc" | "desc";
}) {
  return runAction("ledger.list", async () => {
    const session = await requireSession();
    if (
      !canPerformAction(session.user.role, "ledger", "view", (session.user as any).permissions) &&
      !canPerformAction(session.user.role, "parties", "view", (session.user as any).permissions)
    ) {
      throw userError("You do not have permission to view the general ledger.");
    }

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
    if (filters?.partnershipFilter === "REGULAR") {
      where.isPartnership = false;
      where.partnershipId = null;
    } else if (filters?.partnershipFilter === "PARTNERSHIP") {
      where.OR = [{ isPartnership: true }, { partnershipId: { not: null } }];
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
              isPartnership: true,
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
        ? prisma.payment.findMany({
            where: { id: { in: paymentIds } },
            select: {
              id: true,
              receiptNo: true,
              sequenceNo: true,
              direction: true,
              amount: true,
              saleInvoice: {
                select: { id: true, invoiceNo: true, sequenceNo: true, date: true, totalAmount: true },
              },
              purchaseInvoice: {
                select: { id: true, invoiceNo: true, sequenceNo: true, date: true, totalAmount: true },
              },
              allocations: {
                select: {
                  id: true,
                  amount: true,
                  saleInvoice: {
                    select: { id: true, invoiceNo: true, sequenceNo: true, date: true, totalAmount: true },
                  },
                  purchaseInvoice: {
                    select: { id: true, invoiceNo: true, sequenceNo: true, date: true, totalAmount: true },
                  },
                },
              },
            },
          })
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
    const itemsListMap = new Map<string, Array<{ productNo: string; name: string; quantity: number; unit: string }>>();
    const paymentAllocationsMap = new Map<string, Array<{ amount: number; docNo: string; date?: Date }>>();

    for (const s of saleInvoices) {
      docMap.set(s.id, {
        voucherType: "Estimate",
        docNo: `#${formatSequenceDisplay(s.sequenceNo, s.invoiceNo)}`,
      });
      if (s.items && s.items.length > 0) {
        itemsListMap.set(
          s.id,
          s.items.map((i) => ({
            productNo: i.product.productNo,
            name: i.product.name,
            quantity: Number(i.quantity),
            unit: i.product.unit || "pkts",
          }))
        );
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
        voucherType: p.isPartnership ? "Partnership Intake" : "Purchase",
        docNo: `#${formatSequenceDisplay(p.sequenceNo, p.invoiceNo)}`,
      });
      if (p.items && p.items.length > 0) {
        itemsListMap.set(
          p.id,
          p.items.map((i) => ({
            productNo: i.product.productNo,
            name: i.product.name,
            quantity: Number(i.quantity),
            unit: i.product.unit || "pkts",
          }))
        );
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

      const allocList: Array<{ amount: number; docNo: string; date?: Date }> = [];
      if (pay.allocations && pay.allocations.length > 0) {
        for (const a of pay.allocations) {
          if (a.saleInvoice) {
            allocList.push({
              amount: Number(a.amount),
              docNo: `#${formatSequenceDisplay(a.saleInvoice.sequenceNo, a.saleInvoice.invoiceNo)}`,
              date: a.saleInvoice.date,
            });
          } else if (a.purchaseInvoice) {
            allocList.push({
              amount: Number(a.amount),
              docNo: `#${formatSequenceDisplay(a.purchaseInvoice.sequenceNo, a.purchaseInvoice.invoiceNo)}`,
              date: a.purchaseInvoice.date,
            });
          }
        }
      } else if (pay.saleInvoice) {
        allocList.push({
          amount: Number(pay.amount),
          docNo: `#${formatSequenceDisplay(pay.saleInvoice.sequenceNo, pay.saleInvoice.invoiceNo)}`,
          date: pay.saleInvoice.date,
        });
      } else if (pay.purchaseInvoice) {
        allocList.push({
          amount: Number(pay.amount),
          docNo: `#${formatSequenceDisplay(pay.purchaseInvoice.sequenceNo, pay.purchaseInvoice.invoiceNo)}`,
          date: pay.purchaseInvoice.date,
        });
      }

      if (allocList.length > 0) {
        paymentAllocationsMap.set(pay.id, allocList);
      }
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

      // Generate clean document label
      let docLabel = "";
      if (e.referenceType === "PURCHASE_INVOICE") {
        docLabel =
          docInfo.voucherType === "Partnership Intake"
            ? `Partnership Intake ${docInfo.docNo}`
            : `Purchase Invoice ${docInfo.docNo}`;
      } else if (e.referenceType === "SALE_INVOICE") {
        docLabel = `Sale Invoice ${docInfo.docNo}`;
      } else if (e.referenceType === "PAYMENT") {
        docLabel = `${docInfo.voucherType} ${docInfo.docNo}`;
      } else if (e.referenceType === "SALE_RETURN") {
        docLabel = `Sale Return ${docInfo.docNo}`;
      } else if (e.referenceType === "PURCHASE_RETURN") {
        docLabel = `Purchase Return ${docInfo.docNo}`;
      } else if (e.referenceType === "EXPENSE") {
        docLabel = `Expense ${docInfo.docNo}`;
      } else if (e.referenceType === "STORAGE_CHARGE") {
        docLabel = `Storage Charge ${docInfo.docNo}`;
      } else if (e.referenceType === "OPENING_BALANCE") {
        docLabel = `Opening Balance`;
      } else {
        docLabel = `${docInfo.voucherType} ${docInfo.docNo}`;
      }

      // Clean up description boilerplate
      let cleanDesc = (e.description || "")
        .replace(/^(?:Payable to|Receivable from)\s+(?:vendor|supplier|customer)\s+.+?\s+for\s+/i, "")
        .replace(/^Payment (?:to|from)\s+.+?\s+[—–-]\s*/i, "")
        .trim();

      return {
        ...e,
        description,
        cleanDescription: cleanDesc,
        docLabel,
        lineItems: itemsListMap.get(e.referenceId) || [],
        debit,
        credit,
        runningBalance: currentBalance,
        voucherType: docInfo.voucherType,
        docNo: docInfo.docNo,
        allocations: e.referenceType === "PAYMENT" ? paymentAllocationsMap.get(e.referenceId) || [] : [],
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

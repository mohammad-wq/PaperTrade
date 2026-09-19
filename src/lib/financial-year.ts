import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { userError } from "@/lib/errors";

export type DocumentTypeKey =
  | "SALE_INVOICE"
  | "PURCHASE_INVOICE"
  | "PURCHASE_ORDER"
  | "DELIVERY_ORDER"
  | "SALE_RETURN"
  | "PURCHASE_RETURN"
  | "PAYMENT_RECEIPT";

export const DOC_TYPE_PREFIXES: Record<DocumentTypeKey, string> = {
  SALE_INVOICE: "SI",
  PURCHASE_INVOICE: "PI",
  PURCHASE_ORDER: "PO",
  DELIVERY_ORDER: "DO",
  SALE_RETURN: "SR",
  PURCHASE_RETURN: "PR",
  PAYMENT_RECEIPT: "RCT",
};

/**
 * Formats document number as: {yearLabel}-{sequenceNo padded to 3+ digits starting at 001} (e.g. 2026-001, Q1-2026-001)
 */
export function formatDocumentNumber(
  yearLabel: string,
  sequenceNo: number
): string {
  const paddedSeq = String(sequenceNo).padStart(3, "0");
  return `${yearLabel}-${paddedSeq}`;
}

/**
 * Gets or initializes the currently active financial year.
 * If none exists, creates a default initial year (e.g. 2026-2027) and links any unassigned records.
 */
export async function getActiveFinancialYear(
  tx: Prisma.TransactionClient | typeof prisma = prisma
) {
  let activeYear = await tx.financialYear.findFirst({
    where: { isActive: true, isClosed: false },
    orderBy: { startDate: "desc" },
  });

  if (!activeYear) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const label = `${currentYear}-${currentYear + 1}`;
    const startDate = new Date(currentYear, 0, 1);
    const endDate = new Date(currentYear + 1, 11, 31, 23, 59, 59);

    activeYear = await tx.financialYear.create({
      data: {
        label,
        startDate,
        endDate,
        isActive: true,
        isClosed: false,
      },
    });

    // Backfill any existing unassigned records
    await backfillUnassignedRecords(activeYear.id, tx);
  }

  return activeYear;
}

/**
 * Backfills legacy documents created prior to the Financial Year system.
 */
async function backfillUnassignedRecords(
  financialYearId: string,
  tx: Prisma.TransactionClient | typeof prisma
) {
  const tables = [
    { model: "saleInvoice", type: "SALE_INVOICE" as DocumentTypeKey },
    { model: "purchaseInvoice", type: "PURCHASE_INVOICE" as DocumentTypeKey },
    { model: "purchaseOrder", type: "PURCHASE_ORDER" as DocumentTypeKey },
    { model: "deliveryOrder", type: "DELIVERY_ORDER" as DocumentTypeKey },
    { model: "saleReturn", type: "SALE_RETURN" as DocumentTypeKey },
    { model: "purchaseReturn", type: "PURCHASE_RETURN" as DocumentTypeKey },
  ];

  for (const { model, type } of tables) {
    const unassigned = await (tx as any)[model].findMany({
      where: { financialYearId: null },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });

    if (unassigned.length > 0) {
      let seq = 0;
      for (const item of unassigned) {
        seq++;
        await (tx as any)[model].update({
          where: { id: item.id },
          data: {
            financialYearId,
            sequenceNo: seq,
          },
        });
      }

      await tx.documentSequence.upsert({
        where: {
          financialYearId_documentType: {
            financialYearId,
            documentType: type,
          },
        },
        create: {
          financialYearId,
          documentType: type,
          lastSequence: seq,
        },
        update: {
          lastSequence: seq,
        },
      });
    }
  }
}

/**
 * Concurrency-safe, atomic sequence number generation for a financial year.
 * Uses PostgreSQL row-level locking via atomic upsert with increment.
 */
export async function getNextAtomicSequence(
  tx: Prisma.TransactionClient,
  financialYearId: string,
  documentType: DocumentTypeKey
): Promise<{ sequenceNo: number; formattedNumber: string }> {
  // Confirm the financial year is active and open
  const fy = await tx.financialYear.findUnique({
    where: { id: financialYearId },
    select: { id: true, label: true, isActive: true, isClosed: true },
  });

  if (!fy) {
    throw userError("Financial year not found.");
  }
  if (fy.isClosed || !fy.isActive) {
    throw userError(`Financial year "${fy.label}" is closed or inactive. Further invoice creation is locked.`);
  }

  // Atomic row lock & increment in PostgreSQL
  const seqRecord = await tx.documentSequence.upsert({
    where: {
      financialYearId_documentType: {
        financialYearId,
        documentType,
      },
    },
    create: {
      financialYearId,
      documentType,
      lastSequence: 1,
    },
    update: {
      lastSequence: { increment: 1 },
    },
    select: { lastSequence: true },
  });

  const sequenceNo = seqRecord.lastSequence;
  const formattedNumber = formatDocumentNumber(fy.label, sequenceNo);

  return { sequenceNo, formattedNumber };
}

/**
 * Checks and updates invoice status (OPEN vs SETTLED) based on linked payments and ledger entries.
 */
export async function updateInvoiceSettlementStatus(
  tx: Prisma.TransactionClient,
  invoiceId: string,
  type: "SALE" | "PURCHASE"
) {
  if (type === "SALE") {
    const invoice = await tx.saleInvoice.findUnique({
      where: { id: invoiceId },
      include: {
        payments: true,
        returns: true,
      },
    });

    if (!invoice) return;

    const totalAmount = Number(invoice.totalAmount);
    const totalPayments = invoice.payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const totalReturns = invoice.returns.reduce((sum, r) => sum + Number(r.totalAmount), 0);
    const totalSettled = totalPayments + totalReturns;
    const balanceDue = totalAmount - totalSettled;

    const newStatus = balanceDue <= 0 ? "SETTLED" : "OPEN";

    await tx.saleInvoice.update({
      where: { id: invoiceId },
      data: {
        amountPaid: totalPayments,
        status: invoice.status === "CANCELLED" ? "CANCELLED" : newStatus,
      },
    });
  } else {
    const invoice = await tx.purchaseInvoice.findUnique({
      where: { id: invoiceId },
      include: {
        payments: true,
        returns: true,
      },
    });

    if (!invoice) return;

    const totalAmount = Number(invoice.totalAmount);
    const totalPayments = invoice.payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const totalReturns = invoice.returns.reduce((sum, r) => sum + Number(r.totalAmount), 0);
    const totalSettled = totalPayments + totalReturns;
    const balanceDue = totalAmount - totalSettled;

    const newStatus = balanceDue <= 0 ? "SETTLED" : "OPEN";

    await tx.purchaseInvoice.update({
      where: { id: invoiceId },
      data: {
        status: invoice.status === "CANCELLED" ? "CANCELLED" : newStatus,
      },
    });
  }
}


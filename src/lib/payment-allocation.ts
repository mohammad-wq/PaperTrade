import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import {
  InvoiceAllocationItem,
  AllocationPreviewResult,
  simulateFifoAllocation,
} from "./payment-allocation-calc";

export type { InvoiceAllocationItem, AllocationPreviewResult };
export { simulateFifoAllocation };

/**
 * Fetch candidate open invoices for a party ordered chronologically (oldest first).
 */
export async function getOpenInvoicesForParty(
  partyId: string,
  direction: "IN" | "OUT",
  tx: Prisma.TransactionClient = prisma,
): Promise<InvoiceAllocationItem[]> {
  if (direction === "IN") {
    // Customer receipts: match against Sale Invoices
    const invoices = await tx.saleInvoice.findMany({
      where: {
        customerId: partyId,
        status: { not: "CANCELLED" },
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        invoiceNo: true,
        sequenceNo: true,
        date: true,
        totalAmount: true,
        paidAmount: true,
        amountPaid: true,
        balanceAmount: true,
        paymentStatus: true,
      },
    });

    return invoices
      .map((inv) => {
        const total = Number(inv.totalAmount);
        const paid = Number(inv.paidAmount ?? inv.amountPaid ?? 0);
        // If balanceAmount is explicitly tracked and > 0, use it; otherwise compute total - paid
        const rawDue = inv.balanceAmount != null && Number(inv.balanceAmount) > 0
          ? Number(inv.balanceAmount)
          : total - paid;
        const totalDue = Math.max(0, rawDue);

        return {
          invoiceId: inv.id,
          invoiceNo: inv.invoiceNo,
          sequenceNo: inv.sequenceNo,
          date: inv.date,
          invType: "SALE" as const,
          totalAmount: total,
          currentPaid: paid,
          totalDue,
          allocatedNow: 0,
          newBalance: totalDue,
          newStatus: (inv.paymentStatus as "PAID" | "PARTIAL" | "UNPAID") || (totalDue <= 0 ? "PAID" : paid > 0 ? "PARTIAL" : "UNPAID"),
        };
      })
      .filter((inv) => inv.totalDue > 0.001);
  } else {
    // Supplier payments: match against Purchase Invoices
    const invoices = await tx.purchaseInvoice.findMany({
      where: {
        supplierId: partyId,
        status: { not: "CANCELLED" },
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        invoiceNo: true,
        sequenceNo: true,
        date: true,
        totalAmount: true,
        paidAmount: true,
        amountPaid: true,
        balanceAmount: true,
        paymentStatus: true,
      },
    });

    return invoices
      .map((inv) => {
        const total = Number(inv.totalAmount);
        const paid = Number(inv.paidAmount ?? inv.amountPaid ?? 0);
        const rawDue = inv.balanceAmount != null && Number(inv.balanceAmount) > 0
          ? Number(inv.balanceAmount)
          : total - paid;
        const totalDue = Math.max(0, rawDue);

        return {
          invoiceId: inv.id,
          invoiceNo: inv.invoiceNo,
          sequenceNo: inv.sequenceNo,
          date: inv.date,
          invType: "PURCHASE" as const,
          totalAmount: total,
          currentPaid: paid,
          totalDue,
          allocatedNow: 0,
          newBalance: totalDue,
          newStatus: (inv.paymentStatus as "PAID" | "PARTIAL" | "UNPAID") || (totalDue <= 0 ? "PAID" : paid > 0 ? "PARTIAL" : "UNPAID"),
        };
      })
      .filter((inv) => inv.totalDue > 0.001);
  }
}

/**
 * Execute payment settlement within a Prisma transaction:
 * Creates InvoicePaymentAllocation records and updates invoice paidAmount, balanceAmount, and paymentStatus.
 */
export async function executePaymentAllocation(
  tx: Prisma.TransactionClient,
  params: {
    paymentId: string;
    partyId: string;
    amount: number;
    direction: "IN" | "OUT";
    targetInvoiceId?: string | null;
    manualAllocations?: Array<{ invoiceId: string; amount: number }>;
  },
): Promise<AllocationPreviewResult> {
  const openInvoices = await getOpenInvoicesForParty(params.partyId, params.direction, tx);
  const outcome = simulateFifoAllocation(
    openInvoices,
    params.amount,
    params.targetInvoiceId,
    params.manualAllocations,
  );

  for (const item of outcome.allocations) {
    if (item.allocatedNow <= 0.001) continue;

    // 1. Create allocation record
    await tx.invoicePaymentAllocation.create({
      data: {
        paymentId: params.paymentId,
        saleInvoiceId: item.invType === "SALE" ? item.invoiceId : null,
        purchaseInvoiceId: item.invType === "PURCHASE" ? item.invoiceId : null,
        amount: item.allocatedNow,
      },
    });

    // 2. Update invoice status and balances
    const newPaidAmount = item.currentPaid + item.allocatedNow;
    const finalStatus = item.newBalance <= 0.001 ? "SETTLED" : "OPEN";

    if (item.invType === "SALE") {
      await tx.saleInvoice.update({
        where: { id: item.invoiceId },
        data: {
          paidAmount: newPaidAmount,
          amountPaid: newPaidAmount,
          balanceAmount: item.newBalance,
          paymentStatus: item.newStatus,
          status: finalStatus,
        },
      });
    } else {
      await tx.purchaseInvoice.update({
        where: { id: item.invoiceId },
        data: {
          paidAmount: newPaidAmount,
          amountPaid: newPaidAmount,
          balanceAmount: item.newBalance,
          paymentStatus: item.newStatus,
          status: finalStatus,
        },
      });
    }
  }

  return outcome;
}

/**
 * Reversal / Void: Reverse all allocations for a given payment.
 * Restores each invoice's paidAmount, balanceAmount, and paymentStatus, then removes the allocation records.
 */
export async function reversePaymentAllocations(
  tx: Prisma.TransactionClient,
  paymentId: string,
): Promise<void> {
  const allocations = await tx.invoicePaymentAllocation.findMany({
    where: { paymentId },
  });

  for (const alloc of allocations) {
    const allocatedAmount = Number(alloc.amount);

    if (alloc.saleInvoiceId) {
      const inv = await tx.saleInvoice.findUnique({
        where: { id: alloc.saleInvoiceId },
        select: { id: true, totalAmount: true, paidAmount: true, amountPaid: true, balanceAmount: true },
      });

      if (inv) {
        const currentPaid = Number(inv.paidAmount ?? inv.amountPaid ?? 0);
        const restoredPaid = Math.max(0, currentPaid - allocatedAmount);
        const total = Number(inv.totalAmount);
        const restoredBalance = Math.min(total, Math.max(0, total - restoredPaid));
        const restoredStatus = restoredBalance <= 0.001 ? "PAID" : restoredPaid > 0 ? "PARTIAL" : "UNPAID";
        const invoiceSettledStatus = restoredBalance <= 0.001 ? "SETTLED" : "OPEN";

        await tx.saleInvoice.update({
          where: { id: inv.id },
          data: {
            paidAmount: restoredPaid,
            amountPaid: restoredPaid,
            balanceAmount: restoredBalance,
            paymentStatus: restoredStatus,
            status: invoiceSettledStatus,
          },
        });
      }
    }

    if (alloc.purchaseInvoiceId) {
      const inv = await tx.purchaseInvoice.findUnique({
        where: { id: alloc.purchaseInvoiceId },
        select: { id: true, totalAmount: true, paidAmount: true, amountPaid: true, balanceAmount: true },
      });

      if (inv) {
        const currentPaid = Number(inv.paidAmount ?? inv.amountPaid ?? 0);
        const restoredPaid = Math.max(0, currentPaid - allocatedAmount);
        const total = Number(inv.totalAmount);
        const restoredBalance = Math.min(total, Math.max(0, total - restoredPaid));
        const restoredStatus = restoredBalance <= 0.001 ? "PAID" : restoredPaid > 0 ? "PARTIAL" : "UNPAID";
        const invoiceSettledStatus = restoredBalance <= 0.001 ? "SETTLED" : "OPEN";

        await tx.purchaseInvoice.update({
          where: { id: inv.id },
          data: {
            paidAmount: restoredPaid,
            amountPaid: restoredPaid,
            balanceAmount: restoredBalance,
            paymentStatus: restoredStatus,
            status: invoiceSettledStatus,
          },
        });
      }
    }
  }

  // Remove all allocation records for this payment
  await tx.invoicePaymentAllocation.deleteMany({
    where: { paymentId },
  });
}

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
        const totalDue = Math.max(0, total - paid);

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

/**
 * Auto-consume unallocated advance payment credits for a party when a new invoice is created/posted.
 */
export async function consumeAdvanceCreditsForInvoice(
  tx: Prisma.TransactionClient,
  params: {
    invoiceId: string;
    partyId: string;
    direction: "IN" | "OUT";
    totalAmount: number;
    initialPaid: number;
  },
): Promise<{
  paidAmount: number;
  balanceDue: number;
  paymentStatus: "PAID" | "PARTIAL" | "UNPAID";
}> {
  let currentPaid = Math.max(0, params.initialPaid);
  let remainingDue = Math.max(0, params.totalAmount - currentPaid);

  if (remainingDue <= 0.001) {
    return { paidAmount: params.totalAmount, balanceDue: 0, paymentStatus: "PAID" };
  }

  // Find all unallocated or partially allocated payments for this party in the matching direction
  const payments = await tx.payment.findMany({
    where: {
      partyId: params.partyId,
      direction: params.direction,
    },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    include: {
      allocations: true,
    },
  });

  for (const payment of payments) {
    if (remainingDue <= 0.001) break;
    const paymentTotal = Number(payment.amount);
    const allocatedSum = payment.allocations.reduce((sum, a) => sum + Number(a.amount), 0);
    const availableCredit = Math.max(0, paymentTotal - allocatedSum);

    if (availableCredit > 0.001) {
      const allocateNow = Math.min(availableCredit, remainingDue);
      await tx.invoicePaymentAllocation.create({
        data: {
          paymentId: payment.id,
          saleInvoiceId: params.direction === "IN" ? params.invoiceId : null,
          purchaseInvoiceId: params.direction === "OUT" ? params.invoiceId : null,
          amount: allocateNow,
        },
      });

      currentPaid += allocateNow;
      remainingDue = Math.max(0, params.totalAmount - currentPaid);
    }
  }

  const finalDue = Math.max(0, params.totalAmount - currentPaid);
  const finalStatus: "PAID" | "PARTIAL" | "UNPAID" =
    finalDue <= 0.001 ? "PAID" : currentPaid > 0.001 ? "PARTIAL" : "UNPAID";

  return {
    paidAmount: currentPaid,
    balanceDue: finalDue,
    paymentStatus: finalStatus,
  };
}

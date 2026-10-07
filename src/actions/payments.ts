"use server";

import { parseInput, runAction } from "@/actions/_helpers";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { userError } from "@/lib/errors";
import { canPerformAction } from "@/lib/auth/permissions";
import { cleanPartyDisplayName } from "@/lib/party-display";
import { miscExpenseSchema, paymentSchema, paymentSplitItemSchema } from "@/schemas/payment";
import { AccountType, PartyType, PaymentMethod } from "@prisma/client";
import { withResourceQueue, generateDocumentNumber } from "@/lib/concurrency";
import { emitRealtimeEvent } from "@/lib/realtime";
import { getPartyBalance } from "@/lib/ledger";
import { z } from "zod";
import {
  getActiveFinancialYear,
  getNextAtomicSequence,
  updateInvoiceSettlementStatus,
} from "@/lib/financial-year";
import {
  executePaymentAllocation,
  reversePaymentAllocations,
  simulateFifoAllocation,
  getOpenInvoicesForParty,
} from "@/lib/payment-allocation";
import { getPaymentDestination } from "@/lib/payment-destinations";

export async function listPaymentsAction() {
  return runAction("payments.list", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "payments", "view", (session.user as any).permissions)) {
      throw userError("You do not have permission to view payments.");
    }
    const payments = await prisma.payment.findMany({
      orderBy: { date: "desc" },
      include: {
        financialYear: { select: { id: true, label: true, isActive: true } },
        party: { select: { id: true, name: true, type: true, phone: true } },
        saleInvoice: { select: { id: true, invoiceNo: true, sequenceNo: true, totalAmount: true } },
        purchaseInvoice: { select: { id: true, invoiceNo: true, sequenceNo: true, totalAmount: true } },
        allocations: {
          include: {
            saleInvoice: { select: { id: true, invoiceNo: true, sequenceNo: true, totalAmount: true } },
            purchaseInvoice: { select: { id: true, invoiceNo: true, sequenceNo: true, totalAmount: true } },
          },
        },
        splits: true,
      },
    });

    return payments.map((p) => ({
      ...p,
      party: p.party
        ? { ...p.party, name: cleanPartyDisplayName(p.party.name) }
        : null,
      amount: Number(p.amount),
      remainingBalance: p.remainingBalance ? Number(p.remainingBalance) : null,
      saleInvoice: p.saleInvoice
        ? { ...p.saleInvoice, totalAmount: Number(p.saleInvoice.totalAmount ?? 0) }
        : null,
      purchaseInvoice: p.purchaseInvoice
        ? { ...p.purchaseInvoice, totalAmount: Number(p.purchaseInvoice.totalAmount ?? 0) }
        : null,
      allocations: p.allocations.map((a) => ({
        id: a.id,
        amount: Number(a.amount),
        saleInvoice: a.saleInvoice
          ? { ...a.saleInvoice, totalAmount: Number(a.saleInvoice.totalAmount ?? 0) }
          : null,
        purchaseInvoice: a.purchaseInvoice
          ? { ...a.purchaseInvoice, totalAmount: Number(a.purchaseInvoice.totalAmount ?? 0) }
          : null,
      })),
      splits: p.splits.map((s) => ({
        ...s,
        amount: Number(s.amount),
      })),
    }));
  });
}

export async function previewPaymentAllocationAction(params: {
  partyId: string;
  amount: number;
  direction: "IN" | "OUT";
  targetInvoiceId?: string | null;
  manualAllocations?: Array<{ invoiceId: string; amount: number }>;
}) {
  return runAction("payments.previewAllocation", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "payments", "view", (session.user as any).permissions)) {
      throw userError("You do not have permission to view payment allocations.");
    }
    if (!params.partyId) {
      return { allocations: [], totalAllocated: 0, unallocatedCredit: params.amount || 0 };
    }
    const openInvoices = await getOpenInvoicesForParty(params.partyId, params.direction);
    return simulateFifoAllocation(
      openInvoices,
      params.amount,
      params.targetInvoiceId,
      params.manualAllocations,
    );
  });
}

export async function createMiscExpenseAction(raw: unknown) {
  return runAction("payments.miscExpense.create", async () => {
    const session = await requireSession();
    if (
      !canPerformAction(session.user.role, "payments", "create", (session.user as any).permissions) &&
      !canPerformAction(session.user.role, "expenses", "create", (session.user as any).permissions)
    ) {
      throw userError("You do not have permission to record expenses.");
    }
    const input = parseInput(miscExpenseSchema, raw);

    const expenseId = generateDocumentNumber("MISC");

    const res = await withResourceQueue(["ledger:expense", "doc:misc-expense"], async (tx) => {
      await tx.ledgerEntry.create({
        data: {
          partyId: null,
          accountType: AccountType.EXPENSE,
          debit: input.amount,
          credit: 0,
          referenceType: "MISC_EXPENSE",
          referenceId: expenseId,
          date: input.date,
          description: input.description,
          createdById: session.user.id,
        },
      });

      await tx.ledgerEntry.create({
        data: {
          partyId: null,
          accountType: AccountType.CASH,
          debit: 0,
          credit: input.amount,
          referenceType: "MISC_EXPENSE",
          referenceId: expenseId,
          date: input.date,
          description: `Miscellaneous expense paid (${input.method})`,
          createdById: session.user.id,
        },
      });

      return {
        id: expenseId,
        amount: input.amount,
      };
    });

    emitRealtimeEvent(["payments", "expenses", "ledger", "dashboard"], "create", "MiscExpense", {
      id: res.id,
      amount: res.amount,
    });

    return res;
  });
}

const updatePaymentSchema = z.object({
  id: z.string().min(1, "Payment ID is required"),
  partyId: z.string().min(1, "Party is required"),
  direction: z.enum(["IN", "OUT"]).default("IN"),
  saleInvoiceId: z.string().optional().nullable(),
  purchaseInvoiceId: z.string().optional().nullable(),
  amount: z.coerce.number().gt(0, "Amount must be greater than 0"),
  method: z.nativeEnum(PaymentMethod).default(PaymentMethod.CASH),
  splits: z.array(paymentSplitItemSchema).optional(),
  isPartnership: z.boolean().default(false),
  partnershipId: z.string().optional().nullable(),
  autoAllocate: z.boolean().default(true).optional(),
  manualAllocations: z
    .array(
      z.object({
        invoiceId: z.string().min(1),
        amount: z.coerce.number().min(0),
      })
    )
    .optional(),
  date: z.coerce.date(),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
}).refine((value) => !(value.saleInvoiceId && value.purchaseInvoiceId), {
  message: "A payment cannot be linked to both a sale and a purchase invoice",
  path: ["saleInvoiceId"],
}).refine(
  (data) => {
    if (data.splits && data.splits.length > 0) {
      const totalSplits = data.splits.reduce((acc, s) => acc + (Number(s.amount) || 0), 0);
      return Math.abs(totalSplits - (Number(data.amount) || 0)) < 0.01;
    }
    return true;
  },
  {
    message: "The sum of payment splits must exactly equal the total payment amount",
    path: ["splits"],
  }
);

export async function updatePaymentAction(raw: unknown) {
  return runAction("payments.update", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "payments", "update", (session.user as any).permissions)) {
      throw userError("You do not have permission to edit payments.");
    }
    const input = parseInput(updatePaymentSchema, raw);

    const lockKeys = [`party:${input.partyId}`, "doc:payment", `payment:${input.id}`];
    if (input.saleInvoiceId) lockKeys.push(`invoice:${input.saleInvoiceId}`);
    if (input.purchaseInvoiceId) lockKeys.push(`invoice:${input.purchaseInvoiceId}`);

    const result = await withResourceQueue(lockKeys, async (tx) => {
      const existing = await tx.payment.findUnique({
        where: { id: input.id },
        include: { splits: true, saleInvoice: true, purchaseInvoice: true },
      });
      if (!existing) {
        throw userError("Payment record not found.");
      }

      await tx.ledgerEntry.deleteMany({
        where: { referenceType: "PAYMENT", referenceId: existing.id },
      });
      await tx.paymentSplit.deleteMany({
        where: { paymentId: existing.id },
      });

      // Reverse previous allocations cleanly
      await reversePaymentAllocations(tx, existing.id);

      const totalAmount =
        input.splits && input.splits.length > 0
          ? input.splits.reduce((acc, s) => acc + s.amount, 0)
          : input.amount;

      const primaryMethod =
        input.splits && input.splits.length > 0 ? input.splits[0].method : input.method;
      const direction = input.direction || "IN";

      let isPartnership = input.isPartnership ?? existing.isPartnership;
      let partnershipId = input.partnershipId ?? existing.partnershipId;

      if (!isPartnership && input.saleInvoiceId) {
        const inv = await tx.saleInvoice.findUnique({
          where: { id: input.saleInvoiceId },
          select: { isPartnership: true, partnershipId: true },
        });
        if (inv?.isPartnership) {
          isPartnership = true;
          partnershipId = inv.partnershipId || partnershipId;
        }
      } else if (!isPartnership && input.purchaseInvoiceId) {
        const inv = await tx.purchaseInvoice.findUnique({
          where: { id: input.purchaseInvoiceId },
          select: { isPartnership: true, partnershipId: true },
        });
        if (inv?.isPartnership) {
          isPartnership = true;
          partnershipId = inv.partnershipId || partnershipId;
        }
      }

      // Validate split sum invariant
      if (input.splits && input.splits.length > 0) {
        const splitSum = input.splits.reduce((acc, s) => acc + (Number(s.amount) || 0), 0);
        if (Math.abs(splitSum - input.amount) >= 0.01) {
          throw userError(`The sum of payment splits (${splitSum}) must exactly equal the payment amount (${input.amount}).`);
        }
      }

      // Validate invoice allocation limits (reject over-allocation / overpayment)
      if (input.saleInvoiceId) {
        const inv = await tx.saleInvoice.findUnique({
          where: { id: input.saleInvoiceId },
          select: { id: true, invoiceNo: true, totalAmount: true, paidAmount: true, amountPaid: true, customerId: true },
        });
        if (!inv) throw userError("Linked sale invoice not found.");
        if (inv.customerId !== input.partyId) throw userError("Linked sale invoice does not belong to the selected customer.");
        const due = Math.max(0, Number(inv.totalAmount) - Number(inv.paidAmount ?? inv.amountPaid ?? 0));
        if (totalAmount > due + 0.01) {
          throw userError(`Payment amount (PKR ${totalAmount}) exceeds the outstanding balance (PKR ${due}) for invoice ${inv.invoiceNo}.`);
        }
      } else if (input.purchaseInvoiceId) {
        const inv = await tx.purchaseInvoice.findUnique({
          where: { id: input.purchaseInvoiceId },
          select: { id: true, invoiceNo: true, totalAmount: true, paidAmount: true, amountPaid: true, supplierId: true },
        });
        if (!inv) throw userError("Linked purchase invoice not found.");
        if (inv.supplierId !== input.partyId) throw userError("Linked purchase invoice does not belong to the selected supplier.");
        const due = Math.max(0, Number(inv.totalAmount) - Number(inv.paidAmount ?? inv.amountPaid ?? 0));
        if (totalAmount > due + 0.01) {
          throw userError(`Payment amount (PKR ${totalAmount}) exceeds the outstanding balance (PKR ${due}) for invoice ${inv.invoiceNo}.`);
        }
      }

      if (input.manualAllocations && input.manualAllocations.length > 0) {
        let manualTotal = 0;
        for (const alloc of input.manualAllocations) {
          if (alloc.amount < 0) throw userError("Allocated amount cannot be negative.");
          manualTotal += alloc.amount;
          if (direction === "IN") {
            const inv = await tx.saleInvoice.findUnique({
              where: { id: alloc.invoiceId },
              select: { id: true, invoiceNo: true, totalAmount: true, paidAmount: true, amountPaid: true, customerId: true },
            });
            if (!inv) throw userError("Invoice not found for manual allocation.");
            if (inv.customerId !== input.partyId) throw userError(`Invoice ${inv.invoiceNo} does not belong to the selected customer.`);
            const due = Math.max(0, Number(inv.totalAmount) - Number(inv.paidAmount ?? inv.amountPaid ?? 0));
            if (alloc.amount > due + 0.01) {
              throw userError(`Allocated amount (PKR ${alloc.amount}) exceeds outstanding balance (PKR ${due}) for invoice ${inv.invoiceNo}.`);
            }
          } else {
            const inv = await tx.purchaseInvoice.findUnique({
              where: { id: alloc.invoiceId },
              select: { id: true, invoiceNo: true, totalAmount: true, paidAmount: true, amountPaid: true, supplierId: true },
            });
            if (!inv) throw userError("Invoice not found for manual allocation.");
            if (inv.supplierId !== input.partyId) throw userError(`Invoice ${inv.invoiceNo} does not belong to the selected supplier.`);
            const due = Math.max(0, Number(inv.totalAmount) - Number(inv.paidAmount ?? inv.amountPaid ?? 0));
            if (alloc.amount > due + 0.01) {
              throw userError(`Allocated amount (PKR ${alloc.amount}) exceeds outstanding balance (PKR ${due}) for invoice ${inv.invoiceNo}.`);
            }
          }
        }
        if (manualTotal > totalAmount + 0.01) {
          throw userError(`Total manual allocations (PKR ${manualTotal}) cannot exceed total payment amount (PKR ${totalAmount}).`);
        }
      }

      const splitsToRecord: Array<{ method: PaymentMethod; amount: number; reference: string | null }> =
        input.splits && input.splits.length > 0
          ? input.splits.map((s) => ({
              method: (s.method ?? PaymentMethod.CASH) as PaymentMethod,
              amount: s.amount,
              reference: s.reference || null,
            }))
          : [{ method: (input.method ?? PaymentMethod.CASH) as PaymentMethod, amount: totalAmount, reference: null }];

      const updatedPayment = await tx.payment.update({
        where: { id: input.id },
        data: {
          partyId: input.partyId,
          direction,
          saleInvoiceId: input.saleInvoiceId || null,
          purchaseInvoiceId: input.purchaseInvoiceId || null,
          isPartnership,
          partnershipId,
          amount: totalAmount,
          method: primaryMethod,
          date: input.date,
          notes: input.notes || null,
          splits: {
            create: splitsToRecord.map((s) => ({
              method: s.method,
              amount: s.amount,
              reference: s.reference || null,
            })),
          },
        },
      });

      if (direction === "IN") {
        const party = await tx.party.findUnique({ where: { id: input.partyId } });
        if (!party) throw userError("Party not found.");

        for (const split of splitsToRecord) {
          const dest = getPaymentDestination(split.method);
          const refDesc = split.reference ? ` [Ref: ${split.reference}]` : "";
          await tx.ledgerEntry.create({
            data: {
              partyId: input.partyId,
              accountType: dest.accountType,
              debit: split.amount,
              credit: 0,
              isPartnership,
              partnershipId,
              referenceType: "PAYMENT",
              referenceId: updatedPayment.id,
              date: input.date,
              description: `Receipt #${updatedPayment.receiptNo} from ${party.name} (${dest.accountName})${refDesc}`,
              createdById: session.user.id,
            },
          });
        }

      } else {
        const party = await tx.party.findUnique({ where: { id: input.partyId } });
        if (!party) throw userError("Party not found.");

        for (const split of splitsToRecord) {
          const dest = getPaymentDestination(split.method);
          const refDesc = split.reference ? ` [Ref: ${split.reference}]` : "";
          await tx.ledgerEntry.create({
            data: {
              partyId: input.partyId,
              accountType: dest.accountType,
              debit: 0,
              credit: split.amount,
              isPartnership,
              partnershipId,
              referenceType: "PAYMENT",
              referenceId: updatedPayment.id,
              date: input.date,
              description: `Payment Voucher #${updatedPayment.receiptNo} to ${party.name} (${dest.accountName})${refDesc}`,
              createdById: session.user.id,
            },
          });
        }
      }

      // Re-allocate settlement
      const shouldAllocate =
        input.autoAllocate !== false ||
        (input.manualAllocations && input.manualAllocations.length > 0);

      if (shouldAllocate) {
        await executePaymentAllocation(tx, {
          paymentId: updatedPayment.id,
          partyId: input.partyId,
          amount: totalAmount,
          direction,
          targetInvoiceId: input.saleInvoiceId || input.purchaseInvoiceId || null,
          manualAllocations: input.manualAllocations,
        });
      } else if (input.saleInvoiceId) {
        await tx.invoicePaymentAllocation.create({
          data: {
            paymentId: updatedPayment.id,
            saleInvoiceId: input.saleInvoiceId,
            amount: totalAmount,
          },
        });
        await updateInvoiceSettlementStatus(tx, input.saleInvoiceId, "SALE");
      } else if (input.purchaseInvoiceId) {
        await tx.invoicePaymentAllocation.create({
          data: {
            paymentId: updatedPayment.id,
            purchaseInvoiceId: input.purchaseInvoiceId,
            amount: totalAmount,
          },
        });
        await updateInvoiceSettlementStatus(tx, input.purchaseInvoiceId, "PURCHASE");
      }

      const postBalance = await getPartyBalance(input.partyId, tx);
      await tx.payment.update({
        where: { id: updatedPayment.id },
        data: { remainingBalance: postBalance },
      });

      return {
        id: updatedPayment.id,
        amount: totalAmount,
        receiptNo: updatedPayment.receiptNo,
        sequenceNo: updatedPayment.sequenceNo,
        remainingBalance: postBalance,
      };
    });

    emitRealtimeEvent(["payments", "parties", "sales", "purchases", "ledger", "dashboard"], "update", "Payment", {
      id: result.id,
      amount: Number(result.amount),
      partyId: input.partyId,
    });

    return result;
  });
}

export async function deletePaymentAction(raw: unknown) {
  return runAction("payments.delete", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "payments", "delete", (session.user as any).permissions)) {
      throw userError("You do not have permission to delete payments.");
    }

    const schema = z.object({ id: z.string().min(1, "Payment ID is required") });
    const { id } = parseInput(schema, raw);

    const result = await withResourceQueue([`payment:${id}`], async (tx) => {
      const existing = await tx.payment.findUnique({
        where: { id },
        include: { splits: true },
      });
      if (!existing) {
        throw userError("Payment record not found.");
      }

      // Reverse all allocations for this payment and restore invoice balances
      await reversePaymentAllocations(tx, id);

      await tx.ledgerEntry.deleteMany({
        where: { referenceType: "PAYMENT", referenceId: id },
      });
      await tx.paymentSplit.deleteMany({
        where: { paymentId: id },
      });
      await tx.payment.delete({
        where: { id },
      });

      const postBalance = await getPartyBalance(existing.partyId, tx);
      return { id, partyId: existing.partyId, remainingBalance: postBalance };
    });

    emitRealtimeEvent(["payments", "parties", "sales", "purchases", "ledger", "dashboard"], "delete", "Payment", {
      id: result.id,
      partyId: result.partyId,
    });

    return result;
  });
}

export async function createPaymentAction(raw: unknown) {
  return runAction("payments.create", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "payments", "create", (session.user as any).permissions)) {
      throw userError("You do not have permission to record payments.");
    }
    const input = parseInput(paymentSchema, raw);

    const lockKeys = [`party:${input.partyId}`, "doc:payment"];
    if (input.saleInvoiceId) lockKeys.push(`invoice:${input.saleInvoiceId}`);
    if (input.purchaseInvoiceId) lockKeys.push(`invoice:${input.purchaseInvoiceId}`);

    const result = await withResourceQueue(lockKeys, async (tx) => {
      const party = await tx.party.findUnique({
        where: { id: input.partyId },
      });

      if (!party) {
        throw userError("Party not found.");
      }

      const activeYear = await getActiveFinancialYear(tx);
      const { sequenceNo, formattedNumber } = await getNextAtomicSequence(
        tx,
        activeYear.id,
        "PAYMENT_RECEIPT",
      );
      const receiptNo = `RCT-${formattedNumber}`;

      const totalAmount =
        input.splits && input.splits.length > 0
          ? input.splits.reduce((acc, s) => acc + s.amount, 0)
          : input.amount;

      const primaryMethod =
        input.splits && input.splits.length > 0
          ? input.splits[0].method
          : (input.method || "CASH");

      const direction = input.direction || (party.type === PartyType.CUSTOMER ? "IN" : "OUT");

      let isPartnership = input.isPartnership ?? false;
      let partnershipId = input.partnershipId ?? null;

      if (!isPartnership && input.saleInvoiceId) {
        const inv = await tx.saleInvoice.findUnique({
          where: { id: input.saleInvoiceId },
          select: { isPartnership: true, partnershipId: true },
        });
        if (inv?.isPartnership) {
          isPartnership = true;
          partnershipId = inv.partnershipId || partnershipId;
        }
      } else if (!isPartnership && input.purchaseInvoiceId) {
        const inv = await tx.purchaseInvoice.findUnique({
          where: { id: input.purchaseInvoiceId },
          select: { isPartnership: true, partnershipId: true },
        });
        if (inv?.isPartnership) {
          isPartnership = true;
          partnershipId = inv.partnershipId || partnershipId;
        }
      }

      // Validate split sum invariant
      if (input.splits && input.splits.length > 0) {
        const splitSum = input.splits.reduce((acc, s) => acc + (Number(s.amount) || 0), 0);
        if (Math.abs(splitSum - input.amount) >= 0.01) {
          throw userError(`The sum of payment splits (${splitSum}) must exactly equal the payment amount (${input.amount}).`);
        }
      }

      // Validate invoice allocation limits (reject over-allocation / overpayment)
      if (input.saleInvoiceId) {
        const inv = await tx.saleInvoice.findUnique({
          where: { id: input.saleInvoiceId },
          select: { id: true, invoiceNo: true, totalAmount: true, paidAmount: true, amountPaid: true, customerId: true },
        });
        if (!inv) throw userError("Linked sale invoice not found.");
        if (inv.customerId !== input.partyId) throw userError("Linked sale invoice does not belong to the selected customer.");
        const due = Math.max(0, Number(inv.totalAmount) - Number(inv.paidAmount ?? inv.amountPaid ?? 0));
        if (totalAmount > due + 0.01) {
          throw userError(`Payment amount (PKR ${totalAmount}) exceeds the outstanding balance (PKR ${due}) for invoice ${inv.invoiceNo}.`);
        }
      } else if (input.purchaseInvoiceId) {
        const inv = await tx.purchaseInvoice.findUnique({
          where: { id: input.purchaseInvoiceId },
          select: { id: true, invoiceNo: true, totalAmount: true, paidAmount: true, amountPaid: true, supplierId: true },
        });
        if (!inv) throw userError("Linked purchase invoice not found.");
        if (inv.supplierId !== input.partyId) throw userError("Linked purchase invoice does not belong to the selected supplier.");
        const due = Math.max(0, Number(inv.totalAmount) - Number(inv.paidAmount ?? inv.amountPaid ?? 0));
        if (totalAmount > due + 0.01) {
          throw userError(`Payment amount (PKR ${totalAmount}) exceeds the outstanding balance (PKR ${due}) for invoice ${inv.invoiceNo}.`);
        }
      }

      if (input.manualAllocations && input.manualAllocations.length > 0) {
        let manualTotal = 0;
        for (const alloc of input.manualAllocations) {
          if (alloc.amount < 0) throw userError("Allocated amount cannot be negative.");
          manualTotal += alloc.amount;
          if (direction === "IN") {
            const inv = await tx.saleInvoice.findUnique({
              where: { id: alloc.invoiceId },
              select: { id: true, invoiceNo: true, totalAmount: true, paidAmount: true, amountPaid: true, customerId: true },
            });
            if (!inv) throw userError("Invoice not found for manual allocation.");
            if (inv.customerId !== input.partyId) throw userError(`Invoice ${inv.invoiceNo} does not belong to the selected customer.`);
            const due = Math.max(0, Number(inv.totalAmount) - Number(inv.paidAmount ?? inv.amountPaid ?? 0));
            if (alloc.amount > due + 0.01) {
              throw userError(`Allocated amount (PKR ${alloc.amount}) exceeds outstanding balance (PKR ${due}) for invoice ${inv.invoiceNo}.`);
            }
          } else {
            const inv = await tx.purchaseInvoice.findUnique({
              where: { id: alloc.invoiceId },
              select: { id: true, invoiceNo: true, totalAmount: true, paidAmount: true, amountPaid: true, supplierId: true },
            });
            if (!inv) throw userError("Invoice not found for manual allocation.");
            if (inv.supplierId !== input.partyId) throw userError(`Invoice ${inv.invoiceNo} does not belong to the selected supplier.`);
            const due = Math.max(0, Number(inv.totalAmount) - Number(inv.paidAmount ?? inv.amountPaid ?? 0));
            if (alloc.amount > due + 0.01) {
              throw userError(`Allocated amount (PKR ${alloc.amount}) exceeds outstanding balance (PKR ${due}) for invoice ${inv.invoiceNo}.`);
            }
          }
        }
        if (manualTotal > totalAmount + 0.01) {
          throw userError(`Total manual allocations (PKR ${manualTotal}) cannot exceed total payment amount (PKR ${totalAmount}).`);
        }
      }

      const splitsToRecord: Array<{ method: PaymentMethod; amount: number; reference: string | null }> =
        input.splits && input.splits.length > 0
          ? input.splits.map((s) => ({
              method: (s.method ?? PaymentMethod.CASH) as PaymentMethod,
              amount: s.amount,
              reference: s.reference || null,
            }))
          : [{ method: (primaryMethod ?? PaymentMethod.CASH) as PaymentMethod, amount: totalAmount, reference: null }];

      const payment = await tx.payment.create({
        data: {
          receiptNo,
          financialYearId: activeYear.id,
          sequenceNo,
          partyId: input.partyId,
          direction,
          saleInvoiceId: input.saleInvoiceId || null,
          purchaseInvoiceId: input.purchaseInvoiceId || null,
          isPartnership,
          partnershipId,
          amount: totalAmount,
          method: primaryMethod,
          date: input.date,
          notes: input.notes || null,
          createdById: session.user.id,
          splits: {
            create: splitsToRecord.map((s) => ({
              method: s.method,
              amount: s.amount,
              reference: s.reference || null,
            })),
          },
        },
      });

      if (direction === "IN") {
        // Customer Receipt: increases Cash/Bank/Wallet (Debit), decreases Receivable (Credit)
        for (const split of splitsToRecord) {
          const dest = getPaymentDestination(split.method);
          const refDesc = split.reference ? ` [Ref: ${split.reference}]` : "";
          await tx.ledgerEntry.create({
            data: {
              partyId: party.id,
              accountType: dest.accountType,
              debit: split.amount,
              credit: 0,
              isPartnership,
              partnershipId,
              referenceType: "PAYMENT",
              referenceId: payment.id,
              date: input.date,
              description: `Receipt #${receiptNo} from ${party.name} (${dest.accountName})${refDesc}`,
              createdById: session.user.id,
            },
          });
        }

      } else {
        // Supplier Payment: decreases Accounts Payable (Debit), decreases Cash/Bank/Wallet (Credit)
        for (const split of splitsToRecord) {
          const dest = getPaymentDestination(split.method);
          const refDesc = split.reference ? ` [Ref: ${split.reference}]` : "";
          await tx.ledgerEntry.create({
            data: {
              partyId: party.id,
              accountType: dest.accountType,
              debit: 0,
              credit: split.amount,
              isPartnership,
              partnershipId,
              referenceType: "PAYMENT",
              referenceId: payment.id,
              date: input.date,
              description: `Payment Voucher #${receiptNo} to ${party.name} (${dest.accountName})${refDesc}`,
              createdById: session.user.id,
            },
          });
        }
      }

      // Automated FIFO Payment Allocation Against Open Invoices
      const shouldAllocate =
        input.autoAllocate !== false ||
        (input.manualAllocations && input.manualAllocations.length > 0);

      if (shouldAllocate) {
        await executePaymentAllocation(tx, {
          paymentId: payment.id,
          partyId: input.partyId,
          amount: totalAmount,
          direction,
          targetInvoiceId: input.saleInvoiceId || input.purchaseInvoiceId || null,
          manualAllocations: input.manualAllocations,
        });
      } else if (input.saleInvoiceId) {
        await tx.invoicePaymentAllocation.create({
          data: {
            paymentId: payment.id,
            saleInvoiceId: input.saleInvoiceId,
            amount: totalAmount,
          },
        });
        await updateInvoiceSettlementStatus(tx, input.saleInvoiceId, "SALE");
      } else if (input.purchaseInvoiceId) {
        await tx.invoicePaymentAllocation.create({
          data: {
            paymentId: payment.id,
            purchaseInvoiceId: input.purchaseInvoiceId,
            amount: totalAmount,
          },
        });
        await updateInvoiceSettlementStatus(tx, input.purchaseInvoiceId, "PURCHASE");
      }

      // Calculate running party balance and update remainingBalance on payment record
      const postBalance = await getPartyBalance(party.id, tx);
      await tx.payment.update({
        where: { id: payment.id },
        data: { remainingBalance: postBalance },
      });

      return {
        id: payment.id,
        amount: totalAmount,
        receiptNo: payment.receiptNo,
        sequenceNo: payment.sequenceNo,
        remainingBalance: postBalance,
      };
    });

    emitRealtimeEvent(["payments", "parties", "sales", "purchases", "ledger", "dashboard"], "create", "Payment", {
      id: result.id,
      amount: Number(result.amount),
      partyId: input.partyId,
    });

    return result;
  });
}

export const createPaymentVoucherAction = createPaymentAction;
export const deletePaymentVoucherAction = deletePaymentAction;
export const voidPaymentVoucherAction = deletePaymentAction;

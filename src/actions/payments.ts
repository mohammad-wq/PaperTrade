"use server";

import { parseInput, runAction } from "@/actions/_helpers";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { userError } from "@/lib/errors";
import { canPerformAction } from "@/lib/auth/permissions";
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
        splits: true,
      },
    });

    return payments.map((p) => ({
      ...p,
      amount: Number(p.amount),
      remainingBalance: p.remainingBalance ? Number(p.remainingBalance) : null,
      saleInvoice: p.saleInvoice
        ? { ...p.saleInvoice, totalAmount: Number(p.saleInvoice.totalAmount ?? 0) }
        : null,
      purchaseInvoice: p.purchaseInvoice
        ? { ...p.purchaseInvoice, totalAmount: Number(p.purchaseInvoice.totalAmount ?? 0) }
        : null,
      splits: p.splits.map((s) => ({
        ...s,
        amount: Number(s.amount),
      })),
    }));
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
  date: z.coerce.date(),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
}).refine((value) => !(value.saleInvoiceId && value.purchaseInvoiceId), {
  message: "A payment cannot be linked to both a sale and a purchase invoice",
  path: ["saleInvoiceId"],
});

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

      const oldAmount = Number(existing.amount);
      const oldPartyId = existing.partyId;
      const oldSaleInvoiceId = existing.saleInvoiceId;
      const oldPurchaseInvoiceId = existing.purchaseInvoiceId;

      await tx.ledgerEntry.deleteMany({
        where: { referenceType: "PAYMENT", referenceId: existing.id },
      });
      await tx.paymentSplit.deleteMany({
        where: { paymentId: existing.id },
      });

      if (oldSaleInvoiceId) {
        await tx.saleInvoice.update({
          where: { id: oldSaleInvoiceId },
          data: { amountPaid: { decrement: oldAmount } },
        });
        await updateInvoiceSettlementStatus(tx, oldSaleInvoiceId, "SALE");
      }

      if (oldPurchaseInvoiceId) {
        await tx.purchaseInvoice.update({
          where: { id: oldPurchaseInvoiceId },
          data: { amountPaid: { decrement: oldAmount } },
        });
        await updateInvoiceSettlementStatus(tx, oldPurchaseInvoiceId, "PURCHASE");
      }

      const totalAmount =
        input.splits && input.splits.length > 0
          ? input.splits.reduce((acc, s) => acc + s.amount, 0)
          : input.amount;

      const primaryMethod =
        input.splits && input.splits.length > 0 ? input.splits[0].method : input.method;
      const direction = input.direction || "IN";

      const updatedPayment = await tx.payment.update({
        where: { id: input.id },
        data: {
          partyId: input.partyId,
          direction,
          saleInvoiceId: input.saleInvoiceId || null,
          purchaseInvoiceId: input.purchaseInvoiceId || null,
          amount: totalAmount,
          method: primaryMethod,
          date: input.date,
          notes: input.notes || null,
          ...(input.splits && input.splits.length > 0
            ? {
                splits: {
                  create: input.splits.map((s) => ({
                    method: s.method,
                    amount: s.amount,
                    reference: s.reference || null,
                  })),
                },
              }
            : {}),
        },
      });

      const splitsToRecord =
        input.splits && input.splits.length > 0
          ? input.splits
          : [{ method: input.method, amount: totalAmount, reference: null }];

      if (direction === "IN") {
        const party = await tx.party.findUnique({ where: { id: input.partyId } });
        if (!party) throw userError("Party not found.");

        for (const split of splitsToRecord) {
          const refDesc = split.reference ? ` [Ref: ${split.reference}]` : "";
          await tx.ledgerEntry.create({
            data: {
              partyId: null,
              accountType: AccountType.CASH,
              debit: split.amount,
              credit: 0,
              referenceType: "PAYMENT",
              referenceId: updatedPayment.id,
              date: input.date,
              description: `Receipt #${updatedPayment.receiptNo} from ${party.name} (${split.method})${refDesc}`,
              createdById: session.user.id,
            },
          });
        }

        await tx.ledgerEntry.create({
          data: {
            partyId: input.partyId,
            accountType: AccountType.RECEIVABLE,
            debit: 0,
            credit: totalAmount,
            referenceType: "PAYMENT",
            referenceId: updatedPayment.id,
            date: input.date,
            description: `Payment received from customer against Voucher #${updatedPayment.receiptNo}`,
            createdById: session.user.id,
          },
        });

        if (input.saleInvoiceId) {
          await tx.saleInvoice.update({
            where: { id: input.saleInvoiceId },
            data: { amountPaid: { increment: totalAmount } },
          });
          await updateInvoiceSettlementStatus(tx, input.saleInvoiceId, "SALE");
        }
      } else {
        const party = await tx.party.findUnique({ where: { id: input.partyId } });
        if (!party) throw userError("Party not found.");

        await tx.ledgerEntry.create({
          data: {
            partyId: input.partyId,
            accountType: AccountType.PAYABLE,
            debit: totalAmount,
            credit: 0,
            referenceType: "PAYMENT",
            referenceId: updatedPayment.id,
            date: input.date,
            description: `Payment to supplier against Voucher #${updatedPayment.receiptNo}`,
            createdById: session.user.id,
          },
        });

        for (const split of splitsToRecord) {
          const refDesc = split.reference ? ` [Ref: ${split.reference}]` : "";
          await tx.ledgerEntry.create({
            data: {
              partyId: null,
              accountType: AccountType.CASH,
              debit: 0,
              credit: split.amount,
              referenceType: "PAYMENT",
              referenceId: updatedPayment.id,
              date: input.date,
              description: `Payment Voucher #${updatedPayment.receiptNo} to ${party.name} (${split.method})${refDesc}`,
              createdById: session.user.id,
            },
          });
        }

        if (input.purchaseInvoiceId) {
          await tx.purchaseInvoice.update({
            where: { id: input.purchaseInvoiceId },
            data: { amountPaid: { increment: totalAmount } },
          });
          await updateInvoiceSettlementStatus(tx, input.purchaseInvoiceId, "PURCHASE");
        }
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

      if (existing.saleInvoiceId) {
        await tx.saleInvoice.update({
          where: { id: existing.saleInvoiceId },
          data: { amountPaid: { decrement: Number(existing.amount) } },
        });
        await updateInvoiceSettlementStatus(tx, existing.saleInvoiceId, "SALE");
      }
      if (existing.purchaseInvoiceId) {
        await tx.purchaseInvoice.update({
          where: { id: existing.purchaseInvoiceId },
          data: { amountPaid: { decrement: Number(existing.amount) } },
        });
        await updateInvoiceSettlementStatus(tx, existing.purchaseInvoiceId, "PURCHASE");
      }

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

      const payment = await tx.payment.create({
        data: {
          receiptNo,
          financialYearId: activeYear.id,
          sequenceNo,
          partyId: input.partyId,
          direction,
          saleInvoiceId: input.saleInvoiceId || null,
          purchaseInvoiceId: input.purchaseInvoiceId || null,
          amount: totalAmount,
          method: primaryMethod,
          date: input.date,
          notes: input.notes || null,
          createdById: session.user.id,
          ...(input.splits && input.splits.length > 0
            ? {
                splits: {
                  create: input.splits.map((s) => ({
                    method: s.method,
                    amount: s.amount,
                    reference: s.reference || null,
                  })),
                },
              }
            : {}),
        },
      });

      const splitsToRecord =
        input.splits && input.splits.length > 0
          ? input.splits
          : [{ method: input.method, amount: totalAmount, reference: null }];

      if (direction === "IN") {
        // Customer Receipt: increases Cash/Bank (Debit), decreases Receivable (Credit)
        for (const split of splitsToRecord) {
          const refDesc = split.reference ? ` [Ref: ${split.reference}]` : "";
          await tx.ledgerEntry.create({
            data: {
              partyId: null,
              accountType: AccountType.CASH,
              debit: split.amount,
              credit: 0,
              referenceType: "PAYMENT",
              referenceId: payment.id,
              date: input.date,
              description: `Receipt #${receiptNo} from ${party.name} (${split.method})${refDesc}`,
              createdById: session.user.id,
            },
          });
        }

        await tx.ledgerEntry.create({
          data: {
            partyId: party.id,
            accountType: AccountType.RECEIVABLE,
            debit: 0,
            credit: totalAmount,
            referenceType: "PAYMENT",
            referenceId: payment.id,
            date: input.date,
            description: `Payment received from customer against Voucher #${receiptNo}`,
            createdById: session.user.id,
          },
        });

        if (input.saleInvoiceId) {
          await tx.saleInvoice.update({
            where: { id: input.saleInvoiceId },
            data: {
              amountPaid: { increment: totalAmount },
            },
          });
          await updateInvoiceSettlementStatus(tx, input.saleInvoiceId, "SALE");
        }
      } else {
        // Supplier Payment Voucher: decreases Payable (Debit), decreases Cash/Bank (Credit)
        await tx.ledgerEntry.create({
          data: {
            partyId: party.id,
            accountType: AccountType.PAYABLE,
            debit: totalAmount,
            credit: 0,
            referenceType: "PAYMENT",
            referenceId: payment.id,
            date: input.date,
            description: `Payment to supplier against Voucher #${receiptNo}`,
            createdById: session.user.id,
          },
        });

        for (const split of splitsToRecord) {
          const refDesc = split.reference ? ` [Ref: ${split.reference}]` : "";
          await tx.ledgerEntry.create({
            data: {
              partyId: null,
              accountType: AccountType.CASH,
              debit: 0,
              credit: split.amount,
              referenceType: "PAYMENT",
              referenceId: payment.id,
              date: input.date,
              description: `Payment Voucher #${receiptNo} to ${party.name} (${split.method})${refDesc}`,
              createdById: session.user.id,
            },
          });
        }

        if (input.purchaseInvoiceId) {
          await tx.purchaseInvoice.update({
            where: { id: input.purchaseInvoiceId },
            data: {
              amountPaid: { increment: totalAmount },
            },
          });
          await updateInvoiceSettlementStatus(tx, input.purchaseInvoiceId, "PURCHASE");
        }
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

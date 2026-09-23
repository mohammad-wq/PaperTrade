"use server";

import { parseInput, runAction } from "@/actions/_helpers";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { userError } from "@/lib/errors";
import { canPerformAction } from "@/lib/auth/permissions";
import { miscExpenseSchema, paymentSchema } from "@/schemas/payment";
import { AccountType, PartyType } from "@prisma/client";
import { withResourceQueue, generateDocumentNumber } from "@/lib/concurrency";
import { emitRealtimeEvent } from "@/lib/realtime";
import { getPartyBalance } from "@/lib/ledger";
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

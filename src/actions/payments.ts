"use server";

import { parseInput, runAction } from "@/actions/_helpers";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { userError } from "@/lib/errors";
import { paymentSchema } from "@/schemas/payment";
import { AccountType, PartyType } from "@prisma/client";

export async function listPaymentsAction() {
  return runAction("payments.list", async () => {
    await requireSession();
    const payments = await prisma.payment.findMany({
      orderBy: { date: "desc" },
      include: {
        party: { select: { id: true, name: true, type: true } },
        saleInvoice: { select: { id: true, invoiceNo: true } },
        purchaseInvoice: { select: { id: true, invoiceNo: true } },
      },
    });

    return payments.map((p) => ({
      ...p,
      amount: Number(p.amount),
    }));
  });
}

export async function createPaymentAction(raw: unknown) {
  return runAction("payments.create", async () => {
    const session = await requireSession();
    const input = parseInput(paymentSchema, raw);

    const party = await prisma.party.findUnique({
      where: { id: input.partyId },
    });

    if (!party) {
      throw userError("Party not found.");
    }

    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          partyId: input.partyId,
          saleInvoiceId: input.saleInvoiceId || null,
          purchaseInvoiceId: input.purchaseInvoiceId || null,
          amount: input.amount,
          method: input.method,
          date: input.date,
          notes: input.notes || null,
          createdById: session.user.id,
        },
      });

      if (party.type === PartyType.CUSTOMER) {
        // Customer Payment: increases Cash (Debit), decreases Receivable (Credit)
        await tx.ledgerEntry.create({
          data: {
            partyId: null,
            accountType: AccountType.CASH,
            debit: input.amount,
            credit: 0,
            referenceType: "PAYMENT",
            referenceId: payment.id,
            date: input.date,
            description: `Payment received from ${party.name} (${input.method})`,
            createdById: session.user.id,
          },
        });

        await tx.ledgerEntry.create({
          data: {
            partyId: party.id,
            accountType: AccountType.RECEIVABLE,
            debit: 0,
            credit: input.amount,
            referenceType: "PAYMENT",
            referenceId: payment.id,
            date: input.date,
            description: `Payment from customer (${input.method})`,
            createdById: session.user.id,
          },
        });

        // If linked to sale invoice, increment amountPaid
        if (input.saleInvoiceId) {
          await tx.saleInvoice.update({
            where: { id: input.saleInvoiceId },
            data: {
              amountPaid: { increment: input.amount },
            },
          });
        }
      } else {
        // Supplier Payment: decreases Payable (Debit), decreases Cash (Credit)
        await tx.ledgerEntry.create({
          data: {
            partyId: party.id,
            accountType: AccountType.PAYABLE,
            debit: input.amount,
            credit: 0,
            referenceType: "PAYMENT",
            referenceId: payment.id,
            date: input.date,
            description: `Payment made to supplier ${party.name} (${input.method})`,
            createdById: session.user.id,
          },
        });

        await tx.ledgerEntry.create({
          data: {
            partyId: null,
            accountType: AccountType.CASH,
            debit: 0,
            credit: input.amount,
            referenceType: "PAYMENT",
            referenceId: payment.id,
            date: input.date,
            description: `Payment to supplier (${input.method})`,
            createdById: session.user.id,
          },
        });
      }

      return payment;
    });

    return { id: result.id, amount: Number(result.amount) };
  });
}

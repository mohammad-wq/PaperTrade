"use server";

import { parseInput, runAction } from "@/actions/_helpers";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { userError } from "@/lib/errors";
import { canPerformAction } from "@/lib/auth/permissions";
import { storageChargeSchema } from "@/schemas/inventory";
import { AccountType } from "@prisma/client";
import { emitRealtimeEvent } from "@/lib/realtime";

export async function listStorageChargesAction() {
  return runAction("storageCharges.list", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "storage-charges", "view", (session.user as any).permissions)) {
      throw userError("You do not have permission to view storage charges.");
    }
    const charges = await prisma.warehouseStorageCharge.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        location: { select: { id: true, name: true } },
      },
    });

    return charges.map((c) => ({
      ...c,
      weightInTonnes: Number(c.weightInTonnes),
      ratePerTonne: Number(c.ratePerTonne),
      totalCharge: Number(c.totalCharge),
    }));
  });
}

export async function createStorageChargeAction(raw: unknown) {
  return runAction("storageCharges.create", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "storage-charges", "create", (session.user as any).permissions)) {
      throw userError("You do not have permission to create storage charges.");
    }
    const input = parseInput(storageChargeSchema, raw);

    const totalCharge = input.weightInTonnes * input.ratePerTonne;

    const res = await prisma.$transaction(async (tx) => {
      const charge = await tx.warehouseStorageCharge.create({
        data: {
          locationId: input.locationId,
          weightInTonnes: input.weightInTonnes,
          ratePerTonne: input.ratePerTonne,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          totalCharge,
        },
      });

      // Record in Ledger as Storage Expense (Debit)
      await tx.ledgerEntry.create({
        data: {
          partyId: null,
          accountType: AccountType.EXPENSE,
          debit: totalCharge,
          credit: 0,
          referenceType: "STORAGE_CHARGE",
          referenceId: charge.id,
          date: input.periodEnd,
          description: `Warehouse storage charge (${input.weightInTonnes} tonnes @ ${input.ratePerTonne}/tonne)`,
          createdById: session.user.id,
        },
      });

      // Record in Ledger as Storage Charges Payable (Credit)
      await tx.ledgerEntry.create({
        data: {
          partyId: null,
          accountType: AccountType.PAYABLE,
          debit: 0,
          credit: totalCharge,
          referenceType: "STORAGE_CHARGE",
          referenceId: charge.id,
          date: input.periodEnd,
          description: `Accrued storage charges payable for ${input.weightInTonnes} tonnes`,
          createdById: session.user.id,
        },
      });

      return {
        id: charge.id,
        totalCharge,
      };
    });

    emitRealtimeEvent(["storage-charges", "expenses", "ledger", "dashboard"], "create", "StorageCharge", {
      id: res.id,
      totalCharge: res.totalCharge,
    });

    return res;
  });
}

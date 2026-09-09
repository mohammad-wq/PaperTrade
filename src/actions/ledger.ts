"use server";

import { runAction } from "@/actions/_helpers";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { AccountType } from "@prisma/client";

export async function listLedgerEntriesAction(filters?: {
  partyId?: string;
  accountType?: AccountType | "ALL";
  startDate?: string;
  endDate?: string;
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
    if (filters?.startDate || filters?.endDate) {
      where.date = {
        ...(filters.startDate ? { gte: new Date(filters.startDate) } : {}),
        ...(filters.endDate ? { lte: new Date(filters.endDate) } : {}),
      };
    }

    const entries = await prisma.ledgerEntry.findMany({
      where,
      orderBy: { date: "desc" },
      take: 300,
      include: {
        party: { select: { id: true, name: true, type: true } },
        createdBy: { select: { name: true } },
      },
    });

    const mapped = entries.map((e) => ({
      ...e,
      debit: Number(e.debit),
      credit: Number(e.credit),
    }));

    const totalDebit = mapped.reduce((sum, e) => sum + e.debit, 0);
    const totalCredit = mapped.reduce((sum, e) => sum + e.credit, 0);

    return {
      entries: mapped,
      totalDebit,
      totalCredit,
    };
  });
}

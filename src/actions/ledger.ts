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

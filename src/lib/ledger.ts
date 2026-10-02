import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export async function getPartyBalance(
  partyId: string,
  tx?: Prisma.TransactionClient,
  asOfDate?: Date,
  partnershipMode?: "REGULAR" | "PARTNERSHIP" | "ALL",
): Promise<number> {
  const db = tx ?? prisma;
  const where: Prisma.LedgerEntryWhereInput = {
    partyId,
    ...(asOfDate ? { date: { lte: asOfDate } } : {}),
  };

  if (partnershipMode === "REGULAR") {
    where.isPartnership = false;
    where.partnershipId = null;
  } else if (partnershipMode === "PARTNERSHIP") {
    where.OR = [
      { isPartnership: true },
      { partnershipId: { not: null } },
    ];
  }

  const entries = await db.ledgerEntry.groupBy({
    by: ["accountType"],
    where,
    _sum: { debit: true, credit: true },
  });

  return entries.reduce((total, row) => {
    const debit = Number(row._sum.debit ?? 0);
    const credit = Number(row._sum.credit ?? 0);
    return total + debit - credit;
  }, 0);
}

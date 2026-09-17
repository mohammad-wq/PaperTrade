import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export async function getPartyBalance(
  partyId: string,
  tx?: Prisma.TransactionClient,
  asOfDate?: Date,
): Promise<number> {
  const db = tx ?? prisma;
  const entries = await db.ledgerEntry.groupBy({
    by: ["accountType"],
    where: {
      partyId,
      ...(asOfDate ? { date: { lte: asOfDate } } : {}),
    },
    _sum: { debit: true, credit: true },
  });

  return entries.reduce((total, row) => {
    const debit = Number(row._sum.debit ?? 0);
    const credit = Number(row._sum.credit ?? 0);
    return total + debit - credit;
  }, 0);
}

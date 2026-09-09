import { prisma } from "@/lib/db";

export async function getPartyBalance(partyId: string): Promise<number> {
  const entries = await prisma.ledgerEntry.groupBy({
    by: ["accountType"],
    where: { partyId },
    _sum: { debit: true, credit: true },
  });

  return entries.reduce((total, row) => {
    const debit = Number(row._sum.debit ?? 0);
    const credit = Number(row._sum.credit ?? 0);
    return total + debit - credit;
  }, 0);
}

import { prisma } from "../src/lib/db";
import { assertJournalBalanced } from "../src/lib/ledger";

async function main() {
  const refs = await prisma.ledgerEntry.groupBy({
    by: ["referenceType", "referenceId"],
    _sum: { debit: true, credit: true },
  });

  const imbalances: string[] = [];
  for (const row of refs) {
    const d = Number(row._sum.debit ?? 0);
    const c = Number(row._sum.credit ?? 0);
    if (Math.abs(d - c) > 0.02) {
      imbalances.push(`${row.referenceType}/${row.referenceId}: ${d} vs ${c}`);
    }
  }

  if (imbalances.length) {
    console.error("Unbalanced journal references:");
    imbalances.slice(0, 20).forEach((l) => console.error(l));
    process.exit(1);
  }

  assertJournalBalanced([
    { accountType: "SALES" as any, debit: 0, credit: 1, description: "x" },
    { accountType: "CASH" as any, debit: 1, credit: 0, description: "y" },
  ]);

  console.log("Invariant checks passed.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

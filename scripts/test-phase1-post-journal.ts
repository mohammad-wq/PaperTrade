/**
 * Phase 1: postJournal helper and account classification
 */
import { AccountType, LedgerAccountSubtype } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { assertJournalBalanced, postJournal } from "../src/lib/ledger";

async function main() {
  const user = await prisma.user.findFirst();
  if (!user) throw new Error("No user in database");

  let threw = false;
  try {
    assertJournalBalanced([
      { accountType: AccountType.SALES, debit: 0, credit: 100, description: "x" },
      { accountType: AccountType.CASH, debit: 50, credit: 0, description: "y" },
    ]);
  } catch {
    threw = true;
  }
  if (!threw) throw new Error("Expected unbalanced journal to throw");

  await prisma.$transaction(async (tx) => {
    const refId = `test-journal-${Date.now()}`;
    await postJournal(
      {
        referenceType: "TEST_JOURNAL",
        referenceId: refId,
        date: new Date(),
        createdById: user.id,
        lines: [
          {
            accountType: AccountType.SALES,
            accountSubtype: LedgerAccountSubtype.PRODUCT_SALES,
            debit: 0,
            credit: 100,
            description: "Product revenue",
          },
          {
            accountType: AccountType.CASH,
            accountSubtype: LedgerAccountSubtype.CASH_DRAWER,
            debit: 100,
            credit: 0,
            description: "Cash received",
          },
        ],
      },
      tx,
    );

    const rows = await tx.ledgerEntry.findMany({
      where: { referenceType: "TEST_JOURNAL", referenceId: refId },
    });
    if (rows.length !== 2) throw new Error(`Expected 2 rows, got ${rows.length}`);
    const subtype = rows.find((r) => r.accountSubtype === LedgerAccountSubtype.PRODUCT_SALES);
    if (!subtype) throw new Error("PRODUCT_SALES subtype not persisted");

    await tx.ledgerEntry.deleteMany({ where: { referenceType: "TEST_JOURNAL", referenceId: refId } });
  });

  console.log("Phase 1 postJournal tests passed.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

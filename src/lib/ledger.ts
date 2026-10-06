import { AccountType, LedgerAccountSubtype, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { userError } from "@/lib/errors";

export type JournalLineInput = {
  partyId?: string | null;
  accountType: AccountType;
  accountSubtype?: LedgerAccountSubtype | null;
  lineType?: string | null;
  lineNo?: number | null;
  idempotencyKey?: string | null;
  ownershipType?: string | null;
  ownershipKey?: string | null;
  debit: number;
  credit: number;
  description: string;
  isPartnership?: boolean;
  partnershipId?: string | null;
  sourceFinancialYearId?: string | null;
};

export type PostJournalParams = {
  referenceType: string;
  referenceId: string;
  date: Date;
  createdById: string;
  lines: JournalLineInput[];
};

const BALANCE_TOLERANCE = 0.01;

export function assertJournalBalanced(lines: JournalLineInput[]): void {
  if (!lines.length) {
    throw userError("Journal must contain at least one line.");
  }

  let totalDebit = 0;
  let totalCredit = 0;

  for (const line of lines) {
    const debit = Number(line.debit) || 0;
    const credit = Number(line.credit) || 0;

    if (debit < 0 || credit < 0) {
      throw userError("Journal line amounts cannot be negative.");
    }
    if (debit > 0 && credit > 0) {
      throw userError("Journal line cannot have both debit and credit.");
    }
    if (debit === 0 && credit === 0) {
      throw userError("Journal line must have a non-zero debit or credit.");
    }

    totalDebit += debit;
    totalCredit += credit;
  }

  if (Math.abs(totalDebit - totalCredit) > BALANCE_TOLERANCE) {
    throw userError(
      `Journal is unbalanced: debits ${totalDebit.toFixed(2)} vs credits ${totalCredit.toFixed(2)}.`,
    );
  }
}

export async function postJournal(
  params: PostJournalParams,
  tx: Prisma.TransactionClient,
): Promise<void> {
  assertJournalBalanced(params.lines);

  for (const line of params.lines) {
    if (line.idempotencyKey) {
      const existing = await tx.ledgerEntry.findUnique({
        where: { idempotencyKey: line.idempotencyKey },
        select: { id: true },
      });
      if (existing) {
        continue;
      }
    }

    await tx.ledgerEntry.create({
      data: {
        partyId: line.partyId ?? null,
        accountType: line.accountType,
        accountSubtype: line.accountSubtype ?? null,
        lineType: line.lineType ?? null,
        lineNo: line.lineNo ?? null,
        idempotencyKey: line.idempotencyKey ?? null,
        ownershipType: line.ownershipType ?? null,
        ownershipKey: line.ownershipKey ?? null,
        debit: line.debit,
        credit: line.credit,
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        date: params.date,
        description: line.description,
        createdById: params.createdById,
        isPartnership: line.isPartnership ?? false,
        partnershipId: line.partnershipId ?? null,
        sourceFinancialYearId: line.sourceFinancialYearId ?? null,
      },
    });
  }
}

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
    where.OR = [{ isPartnership: true }, { partnershipId: { not: null } }];
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

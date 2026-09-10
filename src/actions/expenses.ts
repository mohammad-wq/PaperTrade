"use server";

import { z } from "zod";
import { AccountType, ExpenseCategory, PaymentMethod } from "@prisma/client";
import { parseInput, runAction } from "@/actions/_helpers";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { canPerformAction } from "@/lib/auth/permissions";
import { userError } from "@/lib/errors";
import { withResourceQueue, generateDocumentNumber } from "@/lib/concurrency";
import { emitRealtimeEvent } from "@/lib/realtime";

export const expenseSchema = z.object({
  category: z.nativeEnum(ExpenseCategory).default(ExpenseCategory.OTHER),
  amount: z.coerce.number().gt(0, "Amount must be greater than 0"),
  method: z.nativeEnum(PaymentMethod).default(PaymentMethod.CASH),
  date: z.coerce.date(),
  description: z.string().trim().min(1, "Description is required").max(300),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export type ExpenseInput = z.infer<typeof expenseSchema>;

export async function listExpensesAction(filters?: {
  category?: ExpenseCategory;
  startDate?: string;
  endDate?: string;
}) {
  return runAction("expenses.list", async () => {
    await requireSession();

    const where: any = {};
    if (filters?.category) {
      where.category = filters.category;
    }
    if (filters?.startDate || filters?.endDate) {
      where.date = {};
      if (filters.startDate) where.date.gte = new Date(filters.startDate);
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        where.date.lte = end;
      }
    }

    const expenses = await prisma.expense.findMany({
      where,
      orderBy: { date: "desc" },
      include: {
        createdBy: { select: { id: true, name: true } },
      },
    });

    return expenses.map((exp) => ({
      ...exp,
      amount: Number(exp.amount),
    }));
  });
}

export async function createExpenseAction(raw: unknown) {
  return runAction("expenses.create", async () => {
    const session = await requireSession();
    if (
      !canPerformAction(session.user.role, "payments", "create", (session.user as any).permissions) &&
      !canPerformAction(session.user.role, "expenses", "create", (session.user as any).permissions)
    ) {
      throw userError("You do not have permission to record expenses.");
    }

    const input = parseInput(expenseSchema, raw);
    const expenseNo = generateDocumentNumber("EXP");

    const res = await withResourceQueue(["ledger:expense", "doc:expense"], async (tx) => {
      const expense = await tx.expense.create({
        data: {
          expenseNo,
          category: input.category,
          amount: input.amount,
          method: input.method,
          date: input.date,
          description: input.description,
          notes: input.notes || null,
          createdById: session.user.id,
        },
      });

      // 1. Debit Expense account
      await tx.ledgerEntry.create({
        data: {
          partyId: null,
          accountType: AccountType.EXPENSE,
          debit: input.amount,
          credit: 0,
          referenceType: "MISC_EXPENSE",
          referenceId: expense.id,
          date: input.date,
          description: `${(input.category || ExpenseCategory.OTHER).replace(/_/g, " ")}: ${input.description}`,
          createdById: session.user.id,
        },
      });

      // 2. Credit Cash or Bank account
      const paymentAccount = input.method === PaymentMethod.BANK ? AccountType.CASH : AccountType.CASH;
      await tx.ledgerEntry.create({
        data: {
          partyId: null,
          accountType: paymentAccount,
          debit: 0,
          credit: input.amount,
          referenceType: "MISC_EXPENSE",
          referenceId: expense.id,
          date: input.date,
          description: `Paid via ${input.method}: ${input.description}`,
          createdById: session.user.id,
        },
      });

      return {
        id: expense.id,
        expenseNo: expense.expenseNo,
        amount: Number(expense.amount),
      };
    });

    emitRealtimeEvent(["expenses", "payments", "ledger", "dashboard"], "create", "Expense", {
      id: res.id,
      expenseNo: res.expenseNo,
      amount: res.amount,
    });

    return res;
  });
}


"use server";

import { AccountType, ExpenseCategory, PaymentMethod } from "@prisma/client";
import { parseInput, runAction } from "@/actions/_helpers";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { canPerformAction } from "@/lib/auth/permissions";
import { userError } from "@/lib/errors";
import { withResourceQueue, generateDocumentNumber } from "@/lib/concurrency";
import { emitRealtimeEvent } from "@/lib/realtime";
import { expenseSchema } from "@/schemas/expense";

export async function listExpensesAction(filters?: {
  category?: ExpenseCategory;
  startDate?: string;
  endDate?: string;
}) {
  return runAction("expenses.list", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "expenses", "view", (session.user as any).permissions)) {
      throw userError("You do not have permission to view expenses.");
    }

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
          categoryLabel: input.categoryLabel || null,
          isOperatingExpense: input.isOperatingExpense ?? true,
          partnershipLotId: input.partnershipLotId || null,
          amount: input.amount,
          method: input.method,
          date: input.date,
          description: input.description,
          notes: input.notes || null,
          createdById: session.user.id,
        },
      });

      if (input.isOperatingExpense !== false) {
        await tx.ledgerEntry.create({
          data: {
            partyId: null,
            accountType: AccountType.EXPENSE,
            debit: input.amount,
            credit: 0,
            referenceType: "MISC_EXPENSE",
            referenceId: expense.id,
            idempotencyKey: `expense:${expense.id}:debit`,
            date: input.date,
            description: `${(input.categoryLabel || input.category || ExpenseCategory.OTHER).toString().replace(/_/g, " ")}: ${input.description}`,
            createdById: session.user.id,
          },
        });
      }

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


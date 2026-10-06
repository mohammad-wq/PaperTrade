import { z } from "zod";
import { ExpenseCategory, PaymentMethod } from "@prisma/client";

export const expenseSchema = z.object({
  category: z.nativeEnum(ExpenseCategory).default(ExpenseCategory.OTHER),
  amount: z.coerce.number().gt(0, "Amount must be greater than 0"),
  method: z.nativeEnum(PaymentMethod).default(PaymentMethod.CASH),
  date: z.coerce.date(),
  description: z.string().trim().min(1, "Description is required").max(300),
  notes: z.string().trim().max(1000).optional().nullable(),
  isOperatingExpense: z.boolean().optional().default(true),
  partnershipLotId: z.string().trim().optional().nullable(),
  categoryLabel: z.string().trim().max(120).optional().nullable(),
});

export type ExpenseInput = z.infer<typeof expenseSchema>;


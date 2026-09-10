import { z } from "zod";
import { PaymentMethod } from "@prisma/client";

export const paymentSchema = z
  .object({
    partyId: z.string().min(1, "Party is required"),
    saleInvoiceId: z.string().optional().nullable(),
    purchaseInvoiceId: z.string().optional().nullable(),
    amount: z.coerce.number().gt(0, "Amount must be greater than 0"),
    method: z.nativeEnum(PaymentMethod),
    date: z.coerce.date(),
    notes: z.string().trim().max(500).optional().or(z.literal("")),
  })
  .refine((value) => !(value.saleInvoiceId && value.purchaseInvoiceId), {
    message: "A payment cannot be linked to both a sale and a purchase invoice",
    path: ["saleInvoiceId"],
  });

export const miscExpenseSchema = z.object({
  amount: z.coerce.number().gt(0, "Amount must be greater than 0"),
  method: z.nativeEnum(PaymentMethod).default(PaymentMethod.CASH),
  date: z.coerce.date(),
  description: z.string().trim().min(3, "Expense description is required").max(500),
});

export type PaymentInput = z.infer<typeof paymentSchema>;
export type MiscExpenseInput = z.infer<typeof miscExpenseSchema>;

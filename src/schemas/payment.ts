import { z } from "zod";
import { PaymentMethod } from "@prisma/client";

export const paymentSplitItemSchema = z.object({
  method: z.nativeEnum(PaymentMethod),
  amount: z.coerce.number().gt(0, "Split amount must be greater than 0"),
  reference: z.string().trim().max(100).optional().nullable(),
});

export const paymentSchema = z
  .object({
    partyId: z.string().min(1, "Party is required"),
    direction: z.enum(["IN", "OUT"]).default("IN"),
    saleInvoiceId: z.string().optional().nullable(),
    purchaseInvoiceId: z.string().optional().nullable(),
    amount: z.coerce.number().gt(0, "Amount must be greater than 0"),
    method: z.nativeEnum(PaymentMethod).default(PaymentMethod.CASH),
    splits: z.array(paymentSplitItemSchema).optional(),
    isPartnership: z.boolean().default(false),
    partnershipId: z.string().optional().nullable(),
    autoAllocate: z.boolean().default(true).optional(),
    manualAllocations: z
      .array(
        z.object({
          invoiceId: z.string().min(1),
          amount: z.coerce.number().min(0),
        })
      )
      .optional(),
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
export type PaymentSplitInput = z.infer<typeof paymentSplitItemSchema>;
export type MiscExpenseInput = z.infer<typeof miscExpenseSchema>;

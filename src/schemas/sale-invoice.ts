import { z } from "zod";
import { PaymentMethod } from "@prisma/client";
import { paymentSplitItemSchema } from "./payment";

const lineItem = z.object({
  productId: z.string().min(1, "Product is required"),
  locationId: z.string().optional().nullable(),
  warehouseLotId: z.string().optional().nullable(),
  quantity: z.coerce.number().gt(0, "Quantity must be greater than 0"),
  unitPrice: z.coerce.number().min(0),
  unitCost: z.coerce.number().optional().nullable(),
});

export const saleInvoiceBaseSchema = z.object({
  customerType: z.enum(["REGISTERED", "WALK_IN"]).default("REGISTERED"),
  customerId: z.string().optional().nullable(),
  walkInName: z.string().trim().max(200).optional().nullable(),
  walkInPhone: z.string().trim().max(50).optional().nullable(),
  walkInAddress: z.string().trim().max(500).optional().nullable(),
  saveCustomer: z.boolean().default(false),
  paidImmediately: z.boolean().default(false),
  paymentMethod: z.nativeEnum(PaymentMethod).default(PaymentMethod.CASH),
  paymentSplits: z.array(paymentSplitItemSchema).optional().nullable(),
  amountPaid: z.coerce.number().min(0).default(0),
  freightCharges: z.coerce.number().min(0).default(0),
  locationId: z.string().optional().nullable(),
  deliveryOrderId: z.string().optional().nullable(),
  date: z.coerce.date(),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
  items: z.array(lineItem).min(1, "Add at least one line item"),
});

const refineCustomer = (data: { customerType: string; customerId?: string | null }) => {
  if (data.customerType === "REGISTERED") {
    return Boolean(data.customerId && data.customerId.trim().length > 0);
  }
  return true;
};

const refineWalkInCash = (data: {
  customerType: string;
  amountPaid: number;
  freightCharges?: number;
  items: Array<{ quantity: number; unitPrice: number }>;
}) => {
  if (data.customerType === "WALK_IN") {
    const subtotal = data.items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0);
    const total = subtotal + (Number(data.freightCharges) || 0);
    return Number(data.amountPaid) >= total - 0.001;
  }
  return true;
};

const refinePaymentSplits = (data: {
  amountPaid?: number;
  paymentSplits?: Array<{ amount: number }> | null;
}) => {
  if (data.paymentSplits && data.paymentSplits.length > 0) {
    const totalSplits = data.paymentSplits.reduce((acc, s) => acc + (Number(s.amount) || 0), 0);
    return Math.abs(totalSplits - (Number(data.amountPaid) || 0)) < 0.05;
  }
  return true;
};

export const saleInvoiceSchema = saleInvoiceBaseSchema
  .refine(refineCustomer, {
    message: "Please select a registered customer",
    path: ["customerId"],
  })
  .refine(refineWalkInCash, {
    message: "Walk-in customers cannot buy on credit. Amount paid must equal the total invoice amount.",
    path: ["amountPaid"],
  })
  .refine(refinePaymentSplits, {
    message: "The sum of multiple payment splits must equal the total Amount Paid.",
    path: ["paymentSplits"],
  });

export const updateSaleInvoiceSchema = saleInvoiceBaseSchema
  .extend({
    id: z.string().min(1, "Invoice ID is required"),
  })
  .refine(refineCustomer, {
    message: "Please select a registered customer",
    path: ["customerId"],
  })
  .refine(refineWalkInCash, {
    message: "Walk-in customers cannot buy on credit. Amount paid must equal the total invoice amount.",
    path: ["amountPaid"],
  })
  .refine(refinePaymentSplits, {
    message: "The sum of multiple payment splits must equal the total Amount Paid.",
    path: ["paymentSplits"],
  });

export type SaleInvoiceInput = z.infer<typeof saleInvoiceSchema>;
export type UpdateSaleInvoiceInput = z.infer<typeof updateSaleInvoiceSchema>;

import { z } from "zod";
import { PaymentMethod } from "@prisma/client";
import { paymentSplitItemSchema } from "./payment";

const lineItem = z.object({
  productId: z.string().min(1, "Product is required"),
  locationId: z.string().trim().optional().nullable(),
  warehouseLotId: z.string().trim().optional().nullable(),
  sourceWarehouseLotId: z.string().trim().optional().nullable(),
  ownershipKey: z.string().trim().optional().nullable(),
  lotId: z.string().trim().optional().nullable(),
  quantity: z.coerce.number().gt(0, "Quantity must be greater than 0"),
  unitCost: z.coerce.number().min(0),
});

const refineSupplier = (data: { supplierType: string; supplierId?: string | null }) => {
  if (data.supplierType === "REGISTERED") {
    return Boolean(data.supplierId && data.supplierId.trim().length > 0);
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

export const purchaseInvoiceSchema = z
  .object({
    supplierType: z.enum(["REGISTERED", "ONE_TIME"]).default("REGISTERED"),
    supplierId: z.string().optional().nullable(),
    oneTimeSupplierName: z.string().trim().max(200).optional().nullable(),
    oneTimeSupplierPhone: z.string().trim().max(50).optional().nullable(),
    saveSupplier: z.boolean().default(false),
    locationId: z.string().optional().nullable(),
    warehouseLotId: z.string().trim().optional().nullable(),
    paymentMethod: z.nativeEnum(PaymentMethod).optional().default(PaymentMethod.CASH),
    paymentSplits: z.array(paymentSplitItemSchema).optional().nullable(),
    amountPaid: z.coerce.number().min(0).default(0),
    freightCharges: z.coerce.number().min(0).default(0),
    purchaseOrderId: z.string().optional().nullable(),
    date: z.coerce.date(),
    isPartnership: z.boolean().default(false),
    partnershipId: z.string().optional().nullable(),
    partnerSharePct: z.coerce.number().min(0).max(100).optional().nullable(),
    clientSharePct: z.coerce.number().min(0).max(100).optional().nullable(),
    sourceWarehouseLotId: z.string().trim().optional().nullable(),
    notes: z.string().trim().max(1000).optional().or(z.literal("")),
    items: z.array(lineItem).min(1, "Add at least one line item"),
  })
  .refine(refineSupplier, {
    message: "Please select a registered supplier",
    path: ["supplierId"],
  })
  .refine(refinePaymentSplits, {
    message: "The sum of multiple payment splits must equal the total Amount Paid.",
    path: ["paymentSplits"],
  });

export type PurchaseInvoiceInput = z.infer<typeof purchaseInvoiceSchema>;

export const updatePurchaseInvoiceSchema = z
  .object({
    id: z.string().min(1, "Invoice ID is required"),
    supplierType: z.enum(["REGISTERED", "ONE_TIME"]).default("REGISTERED"),
    supplierId: z.string().optional().nullable(),
    oneTimeSupplierName: z.string().trim().max(200).optional().nullable(),
    oneTimeSupplierPhone: z.string().trim().max(50).optional().nullable(),
    saveSupplier: z.boolean().default(false),
    locationId: z.string().optional().nullable(),
    warehouseLotId: z.string().trim().optional().nullable(),
    paymentMethod: z.nativeEnum(PaymentMethod).optional().default(PaymentMethod.CASH),
    paymentSplits: z.array(paymentSplitItemSchema).optional().nullable(),
    amountPaid: z.coerce.number().min(0).default(0),
    freightCharges: z.coerce.number().min(0).default(0),
    purchaseOrderId: z.string().optional().nullable(),
    date: z.coerce.date(),
    isPartnership: z.boolean().default(false),
    partnershipId: z.string().optional().nullable(),
    partnerSharePct: z.coerce.number().min(0).max(100).optional().nullable(),
    clientSharePct: z.coerce.number().min(0).max(100).optional().nullable(),
    sourceWarehouseLotId: z.string().trim().optional().nullable(),
    notes: z.string().trim().max(1000).optional().or(z.literal("")),
    items: z.array(lineItem).min(1, "Add at least one line item"),
  })
  .refine(refineSupplier, {
    message: "Please select a registered supplier",
    path: ["supplierId"],
  })
  .refine(refinePaymentSplits, {
    message: "The sum of multiple payment splits must equal the total Amount Paid.",
    path: ["paymentSplits"],
  });

export type UpdatePurchaseInvoiceInput = z.infer<typeof updatePurchaseInvoiceSchema>;

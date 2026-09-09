import { z } from "zod";
import { PaymentMethod } from "@prisma/client";

const lineItem = z.object({
  productId: z.string().min(1, "Product is required"),
  quantity: z.coerce.number().gt(0, "Quantity must be greater than 0"),
  unitPrice: z.coerce.number().min(0),
});

export const saleInvoiceSchema = z
  .object({
    customerType: z.enum(["REGISTERED", "WALK_IN"]).default("REGISTERED"),
    customerId: z.string().optional().nullable(),
    walkInName: z.string().trim().max(200).optional().nullable(),
    walkInPhone: z.string().trim().max(50).optional().nullable(),
    walkInAddress: z.string().trim().max(500).optional().nullable(),
    saveCustomer: z.boolean().default(false),
    paidImmediately: z.boolean().default(false),
    paymentMethod: z.nativeEnum(PaymentMethod).default(PaymentMethod.CASH),
    amountPaid: z.coerce.number().min(0).default(0),
    locationId: z.string().min(1, "Location is required"),
    deliveryOrderId: z.string().optional().nullable(),
    date: z.coerce.date(),
    notes: z.string().trim().max(1000).optional().or(z.literal("")),
    items: z.array(lineItem).min(1, "Add at least one line item"),
  })
  .refine(
    (data) => {
      if (data.customerType === "REGISTERED") {
        return Boolean(data.customerId && data.customerId.trim().length > 0);
      }
      return true;
    },
    {
      message: "Please select a registered customer",
      path: ["customerId"],
    },
  );

export type SaleInvoiceInput = z.infer<typeof saleInvoiceSchema>;


import { z } from "zod";

const lineItem = z.object({
  productId: z.string().min(1, "Product is required"),
  quantity: z.coerce.number().gt(0, "Quantity must be greater than 0"),
  unitCost: z.coerce.number().min(0),
});

export const purchaseInvoiceSchema = z.object({
  supplierId: z.string().min(1, "Supplier is required"),
  locationId: z.string().min(1, "Location is required"),
  purchaseOrderId: z.string().optional().nullable(),
  date: z.coerce.date(),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
  items: z.array(lineItem).min(1, "Add at least one line item"),
});

export type PurchaseInvoiceInput = z.infer<typeof purchaseInvoiceSchema>;

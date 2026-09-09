import { z } from "zod";

export const returnItemSchema = z.object({
  productId: z.string().min(1, "Product is required"),
  quantity: z.coerce.number().gt(0, "Quantity must be greater than 0"),
  unitPriceOrCost: z.coerce.number().min(0, "Price/Cost must be 0 or greater"),
});

export const saleReturnSchema = z.object({
  saleInvoiceId: z.string().min(1, "Sale invoice is required"),
  date: z.coerce.date(),
  reason: z.string().trim().min(3, "Please provide a valid reason"),
  items: z
    .array(
      z.object({
        productId: z.string().min(1, "Product is required"),
        quantity: z.coerce.number().gt(0, "Quantity must be greater than 0"),
        unitPrice: z.coerce.number().min(0, "Price must be 0 or greater"),
      }),
    )
    .min(1, "At least one item must be returned"),
});

export type SaleReturnInput = z.infer<typeof saleReturnSchema>;

export const purchaseReturnSchema = z.object({
  purchaseInvoiceId: z.string().min(1, "Purchase invoice is required"),
  date: z.coerce.date(),
  reason: z.string().trim().min(3, "Please provide a valid reason"),
  items: z
    .array(
      z.object({
        productId: z.string().min(1, "Product is required"),
        quantity: z.coerce.number().gt(0, "Quantity must be greater than 0"),
        unitCost: z.coerce.number().min(0, "Cost must be 0 or greater"),
      }),
    )
    .min(1, "At least one item must be returned"),
});

export type PurchaseReturnInput = z.infer<typeof purchaseReturnSchema>;

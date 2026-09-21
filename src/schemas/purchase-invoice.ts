import { z } from "zod";

const lineItem = z.object({
  productId: z.string().min(1, "Product is required"),
  warehouseLotId: z.string().trim().optional().nullable(),
  quantity: z.coerce.number().gt(0, "Quantity must be greater than 0"),
  unitCost: z.coerce.number().min(0),
});

export const purchaseInvoiceSchema = z
  .object({
    supplierType: z.enum(["REGISTERED", "ONE_TIME"]).default("REGISTERED"),
    supplierId: z.string().optional().nullable(),
    oneTimeSupplierName: z.string().trim().max(200).optional().nullable(),
    oneTimeSupplierPhone: z.string().trim().max(50).optional().nullable(),
    saveSupplier: z.boolean().default(false),
    locationId: z.string().min(1, "Location is required"),
    warehouseLotId: z.string().trim().optional().nullable(),
    purchaseOrderId: z.string().optional().nullable(),
    date: z.coerce.date(),
    notes: z.string().trim().max(1000).optional().or(z.literal("")),
    items: z.array(lineItem).min(1, "Add at least one line item"),
  })
  .refine(
    (data) => {
      if (data.supplierType === "REGISTERED") {
        return Boolean(data.supplierId && data.supplierId.trim().length > 0);
      }
      return true;
    },
    {
      message: "Please select a registered supplier",
      path: ["supplierId"],
    }
  );

export type PurchaseInvoiceInput = z.infer<typeof purchaseInvoiceSchema>;

import { z } from "zod";

export const stockAdjustmentSchema = z.object({
  productId: z.string().min(1, "Product is required"),
  locationId: z.string().min(1, "Location is required"),
  warehouseLotId: z.string().trim().optional().nullable(),
  quantity: z.coerce.number().gt(0, "Quantity must be greater than 0"),
  direction: z.enum(["IN", "OUT"]),
  reason: z.string().trim().min(3, "A reason is required"),
});

export const stockTransferSchema = z.object({
  productId: z.string().min(1, "Product is required"),
  fromLocationId: z.string().min(1, "From location is required"),
  fromWarehouseLotId: z.string().trim().optional().nullable(),
  toLocationId: z.string().min(1, "To location is required"),
  toWarehouseLotId: z.string().trim().optional().nullable(),
  quantity: z.coerce.number().gt(0, "Quantity must be greater than 0"),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
}).refine((value) => {
  if (value.fromLocationId !== value.toLocationId) return true;
  return Boolean(
    value.fromWarehouseLotId &&
    value.toWarehouseLotId &&
    value.fromWarehouseLotId !== value.toWarehouseLotId
  );
}, {
  message: "Source and destination must differ (either different locations or different lots)",
  path: ["toLocationId"],
});

export const bulkStockAdjustmentSchema = z.object({
  locationId: z.string().min(1, "Location is required"),
  reason: z.string().trim().min(3, "A reason is required"),
  items: z
    .array(
      z.object({
        productId: z.string().min(1, "Product is required"),
        warehouseLotId: z.string().trim().optional().nullable(),
        quantity: z.coerce.number().gt(0, "Quantity must be greater than 0"),
        direction: z.enum(["IN", "OUT"]),
        notes: z.string().trim().optional().nullable(),
      })
    )
    .min(1, "At least one product item is required"),
});

export const bulkStockTransferSchema = z
  .object({
    fromLocationId: z.string().min(1, "From location is required"),
    toLocationId: z.string().min(1, "To location is required"),
    notes: z.string().trim().max(500).optional().nullable(),
    items: z
      .array(
        z.object({
          productId: z.string().min(1, "Product is required"),
          fromWarehouseLotId: z.string().trim().optional().nullable(),
          toWarehouseLotId: z.string().trim().optional().nullable(),
          quantity: z.coerce.number().gt(0, "Quantity must be greater than 0"),
        })
      )
      .min(1, "At least one product item is required"),
  })
  .refine(
    (value) => {
      if (value.fromLocationId !== value.toLocationId) return true;
      return value.items.every(
        (it) =>
          Boolean(it.fromWarehouseLotId) &&
          Boolean(it.toWarehouseLotId) &&
          it.fromWarehouseLotId !== it.toWarehouseLotId
      );
    },
    {
      message: "For intra-warehouse transfer, source and destination lots must differ for all items",
      path: ["toLocationId"],
    }
  );

export const storageChargeSchema = z.object({
  locationId: z.string().min(1, "Location is required"),
  weightInTonnes: z.coerce.number().gt(0, "Weight must be greater than 0"),
  ratePerTonne: z.coerce.number().min(0, "Rate must be 0 or greater"),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
}).refine((value) => value.periodEnd >= value.periodStart, {
  message: "Period end must be on or after period start",
  path: ["periodEnd"],
});

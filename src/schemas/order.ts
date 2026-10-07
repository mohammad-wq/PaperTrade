import { z } from "zod";
import { PurchaseOrderStatus, DeliveryOrderStatus, Unit } from "@prisma/client";

export const purchaseOrderItemSchema = z.object({
  productId: z.string().min(1, "Product is required"),
  destinationLocationId: z.string().trim().optional().nullable().or(z.literal("")),
  warehouseLotId: z.string().trim().optional().nullable().or(z.literal("")),
  quantity: z.coerce.number().gt(0, "Quantity must be greater than 0"),
  unitCost: z.coerce.number().min(0, "Unit cost must be 0 or greater").optional().nullable(),
});

export const purchaseOrderSchema = z
  .object({
    id: z.string().optional(),
    supplierType: z.enum(["REGISTERED", "ONE_TIME"]).default("REGISTERED"),
    supplierId: z.string().optional().nullable(),
    oneTimeSupplierName: z.string().trim().max(200).optional().nullable(),
    oneTimeSupplierPhone: z.string().trim().max(50).optional().nullable(),
    saveSupplier: z.boolean().default(false),
    locationId: z.string().optional().nullable().or(z.literal("")),
    date: z.coerce.date(),
    status: z.nativeEnum(PurchaseOrderStatus).default(PurchaseOrderStatus.DRAFT),
    includePricing: z.boolean().default(true),
    isPartnership: z.boolean().default(false),
    partnershipId: z.string().optional().nullable(),
    notes: z.string().trim().max(1000).optional().or(z.literal("")),
    items: z.array(purchaseOrderItemSchema).min(1, "At least one item is required"),
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

export type PurchaseOrderInput = z.infer<typeof purchaseOrderSchema>;

export const deliveryOrderItemSchema = z.object({
  productId: z.string().min(1, "Product is required"),
  locationId: z.string().trim().optional().nullable().or(z.literal("")),
  warehouseLotId: z.string().trim().optional().nullable().or(z.literal("")),
  quantity: z.coerce.number().gt(0, "Quantity must be greater than 0"),
  unit: z.nativeEnum(Unit).default(Unit.PACKET),
});

export const deliveryOrderSchema = z
  .object({
    id: z.string().optional(),
    orderType: z.enum(["CUSTOMER", "INTERNAL_TRANSFER"]).default("CUSTOMER"),
    customerId: z.string().optional().nullable().or(z.literal("")),
    locationId: z.string().optional().nullable().or(z.literal("")),
    destinationLocationId: z.string().optional().nullable().or(z.literal("")),
    destinationWarehouseLotId: z.string().optional().nullable().or(z.literal("")),
    saleInvoiceId: z.string().optional().nullable(),
    date: z.coerce.date(),
    status: z.nativeEnum(DeliveryOrderStatus).default(DeliveryOrderStatus.DISPATCHED),
    vehicleNo: z.string().trim().max(100).optional().nullable().or(z.literal("")),
    driverName: z.string().trim().max(100).optional().nullable().or(z.literal("")),
    deliveredTo: z.string().trim().max(255).optional().nullable().or(z.literal("")),
    recipientName: z.string().trim().max(255).optional().nullable().or(z.literal("")),
    notes: z.string().trim().max(1000).optional().nullable().or(z.literal("")),
    items: z.array(deliveryOrderItemSchema).min(1, "At least one item is required"),
  })
  .superRefine((data, ctx) => {
    if (data.orderType === "CUSTOMER" && (!data.customerId || !data.customerId.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customerId"],
        message: "Customer is required for customer deliveries",
      });
    }
    if (data.orderType === "INTERNAL_TRANSFER") {
      if (!data.destinationLocationId || !data.destinationLocationId.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["destinationLocationId"],
          message: "Destination location is required for internal transfer",
        });
      }
      if (data.destinationLocationId === data.locationId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["destinationLocationId"],
          message: "Source and destination locations cannot be the same",
        });
      }
    }
  });

export type DeliveryOrderInput = z.infer<typeof deliveryOrderSchema>;

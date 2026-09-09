import { z } from "zod";
import { PurchaseOrderStatus, DeliveryOrderStatus, Unit } from "@prisma/client";

export const purchaseOrderItemSchema = z.object({
  productId: z.string().min(1, "Product is required"),
  quantity: z.coerce.number().gt(0, "Quantity must be greater than 0"),
  unitCost: z.coerce.number().min(0, "Unit cost must be 0 or greater"),
});

export const purchaseOrderSchema = z.object({
  id: z.string().optional(),
  supplierId: z.string().min(1, "Supplier is required"),
  locationId: z.string().min(1, "Location is required"),
  date: z.coerce.date(),
  status: z.nativeEnum(PurchaseOrderStatus).default(PurchaseOrderStatus.DRAFT),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
  items: z.array(purchaseOrderItemSchema).min(1, "At least one item is required"),
});

export type PurchaseOrderInput = z.infer<typeof purchaseOrderSchema>;

export const deliveryOrderItemSchema = z.object({
  productId: z.string().min(1, "Product is required"),
  quantity: z.coerce.number().gt(0, "Quantity must be greater than 0"),
  unit: z.nativeEnum(Unit).default(Unit.PACKET),
});

export const deliveryOrderSchema = z.object({
  id: z.string().optional(),
  customerId: z.string().min(1, "Customer is required"),
  locationId: z.string().min(1, "Location is required"),
  saleInvoiceId: z.string().optional().nullable(),
  date: z.coerce.date(),
  status: z.nativeEnum(DeliveryOrderStatus).default(DeliveryOrderStatus.DRAFT),
  vehicleNo: z.string().trim().max(100).optional().or(z.literal("")),
  driverName: z.string().trim().max(100).optional().or(z.literal("")),
  deliveredTo: z.string().trim().max(255).optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
  items: z.array(deliveryOrderItemSchema).min(1, "At least one item is required"),
});

export type DeliveryOrderInput = z.infer<typeof deliveryOrderSchema>;

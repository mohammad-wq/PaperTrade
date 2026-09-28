"use server";

import { parseInput, runAction } from "@/actions/_helpers";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { userError } from "@/lib/errors";
import { getStockOnHand } from "@/lib/stock";
import { withResourceQueue, generateDocumentNumber } from "@/lib/concurrency";
import { emitRealtimeEvent } from "@/lib/realtime";
import { purchaseOrderSchema, purchaseOrderItemSchema, deliveryOrderSchema, deliveryOrderItemSchema } from "@/schemas/order";
import { DeliveryOrderStatus, PartyType, PurchaseOrderStatus, StockMovementType, Unit } from "@prisma/client";
import { canPerformAction } from "@/lib/auth/permissions";
import { getActiveFinancialYear, getNextAtomicSequence } from "@/lib/financial-year";
import { z } from "zod";

async function resolveInternalTransferLocationId(
  tx: any,
  sourceLocationId: string,
  deliveredTo?: string | null,
  destinationLocationId?: string | null,
) {
  if (destinationLocationId && destinationLocationId !== sourceLocationId) {
    return destinationLocationId;
  }

  const trimmedDestination = deliveredTo?.trim();
  if (!trimmedDestination) {
    return null;
  }

  const locations = await tx.location.findMany({
    select: { id: true, name: true },
  });

  const normalizedDestination = trimmedDestination.toLowerCase();
  const match = locations.find(
    (location: { id: string; name: string }) =>
      location.id.toLowerCase() === normalizedDestination ||
      location.name.toLowerCase() === normalizedDestination,
  );

  if (!match || match.id === sourceLocationId) {
    return null;
  }

  return match.id;
}

async function createDeliveryOrderStockMovements(
  tx: any,
  sessionUserId: string,
  order: {
    id: string;
    doNo: string;
    locationId: string;
    destinationLocationId?: string | null;
    deliveredTo?: string | null;
    saleInvoiceId?: string | null;
    items: Array<{ productId: string; quantity: number; warehouseLotId?: string | null }>;
  },
) {
  const destinationLocationId = await resolveInternalTransferLocationId(
    tx,
    order.locationId,
    order.deliveredTo,
    order.destinationLocationId,
  );

  if (destinationLocationId) {
    for (const item of order.items) {
      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          locationId: order.locationId,
          warehouseLotId: (item as any).warehouseLotId || null,
          type: StockMovementType.TRANSFER_OUT,
          quantity: item.quantity,
          referenceType: "DELIVERY_ORDER",
          referenceId: order.id,
          createdById: sessionUserId,
          notes: `Transfer via DO ${order.doNo}`,
        },
      });

      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          locationId: destinationLocationId,
          type: StockMovementType.TRANSFER_IN,
          quantity: item.quantity,
          referenceType: "DELIVERY_ORDER",
          referenceId: order.id,
          createdById: sessionUserId,
          notes: `Transfer via DO ${order.doNo}`,
        },
      });
    }

    return;
  }

  // Check if stock has ALREADY been deducted by a linked Sale Invoice
  if (order.saleInvoiceId) {
    const existingSaleMovement = await tx.stockMovement.findFirst({
      where: {
        referenceType: "SALE_INVOICE",
        referenceId: order.saleInvoiceId,
      },
    });
    if (existingSaleMovement) {
      // Stock already deducted upon sale invoice creation; avoid duplicate DELIVERY_OUT
      return;
    }
  }

  // Also check reverse link if SaleInvoice points to this delivery order
  const linkedSaleInvoice = await tx.saleInvoice.findFirst({
    where: { deliveryOrderId: order.id },
    select: { id: true },
  });
  if (linkedSaleInvoice) {
    const existingSaleMovement = await tx.stockMovement.findFirst({
      where: {
        referenceType: "SALE_INVOICE",
        referenceId: linkedSaleInvoice.id,
      },
    });
    if (existingSaleMovement) {
      return;
    }
  }

  for (const item of order.items) {
    await tx.stockMovement.create({
      data: {
        productId: item.productId,
        locationId: order.locationId,
        warehouseLotId: (item as any).warehouseLotId || null,
        type: StockMovementType.DELIVERY_OUT,
        quantity: item.quantity,
        referenceType: "DELIVERY_ORDER",
        referenceId: order.id,
        createdById: sessionUserId,
        notes: `Dispatched via DO ${order.doNo}`,
      },
    });
  }
}

export async function listPurchaseOrdersAction() {
  return runAction("orders.po.list", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "purchase-orders", "view", (session.user as any).permissions)) {
      throw userError("You do not have permission to view purchase orders.");
    }
    const orders = await prisma.purchaseOrder.findMany({
      orderBy: { date: "desc" },
      include: {
        financialYear: { select: { id: true, label: true, isActive: true } },
        supplier: { select: { id: true, name: true, phone: true } },
        location: { select: { id: true, name: true } },
        items: {
          include: {
            product: { select: { id: true, productNo: true, name: true, unit: true } },
          },
        },
      },
    });

    return orders.map((order) => ({
      ...order,
      items: order.items.map((item) => ({
        ...item,
        quantity: Number(item.quantity),
        unitCost: Number(item.unitCost),
        lineTotal: Number(item.lineTotal),
      })),
    }));
  });
}

export async function createPurchaseOrderAction(raw: unknown) {
  return runAction("orders.po.create", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "purchase-orders", "create", (session.user as any).permissions)) {
      throw userError("You do not have permission to create purchase orders.");
    }
    const input = parseInput(purchaseOrderSchema, raw);

    const stockKeys = input.status === PurchaseOrderStatus.FULFILLED
      ? input.items.map((item) => `stock:${item.productId}:${input.locationId}`)
      : [];
    const partyKey = input.supplierId ? `party:${input.supplierId}` : "party:one-time";
    const docKey = "doc:purchase_order";
    const lockKeys = [...stockKeys, partyKey, docKey];

    const res = await withResourceQueue(lockKeys, async (tx) => {
      let targetSupplierId = input.supplierId;
      if (input.supplierType === "ONE_TIME") {
        let genericParty = await tx.party.findFirst({
          where: { name: "Market Vendor" },
        });
        if (!genericParty) {
          genericParty = await tx.party.create({
            data: {
              name: "Market Vendor",
              type: PartyType.SUPPLIER,
              email: "vendor@internal.local",
              isActive: true,
            },
          });
        }
        targetSupplierId = genericParty.id;
      } else {
        if (!input.supplierId) {
          throw userError("Please select a supplier.");
        }
        targetSupplierId = input.supplierId;
      }

      const activeFy = await getActiveFinancialYear(tx);
      const { sequenceNo, formattedNumber: orderNo } = await getNextAtomicSequence(
        tx,
        activeFy.id,
        "PURCHASE_ORDER"
      );
      const order = await tx.purchaseOrder.create({
        data: {
          orderNo,
          financialYearId: activeFy.id,
          sequenceNo,
          supplierId: targetSupplierId!,
          locationId: input.locationId,
          date: input.date,
          status: input.status,
          notes: input.notes || null,
          createdById: session.user.id,
          items: {
            create: input.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              unitCost: item.unitCost,
              lineTotal: item.quantity * item.unitCost,
            })),
          },
        },
      });

      // If created directly with FULFILLED status, update inventory immediately
      if (input.status === PurchaseOrderStatus.FULFILLED) {
        for (const item of input.items) {
          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              locationId: input.locationId,
              type: StockMovementType.PURCHASE_IN,
              quantity: item.quantity,
              referenceType: "PURCHASE_ORDER",
              referenceId: order.id,
              createdById: session.user.id,
              notes: `Purchase Order fulfilled via ${order.orderNo}`,
            },
          });
        }
      }

      return { id: order.id, orderNo: order.orderNo };
    });

    emitRealtimeEvent(["purchase-orders", "inventory", "stock-movements", "dashboard"], "create", "PurchaseOrder", {
      id: res.id,
      orderNo: res.orderNo,
    });

    return res;
  });
}

const updatePurchaseOrderSchema = z.object({
  id: z.string().min(1, "Purchase order ID is required"),
  supplierType: z.enum(["REGISTERED", "ONE_TIME"]).default("REGISTERED"),
  supplierId: z.string().optional().nullable(),
  oneTimeSupplierName: z.string().trim().max(200).optional().nullable(),
  oneTimeSupplierPhone: z.string().trim().max(50).optional().nullable(),
  saveSupplier: z.boolean().default(false),
  locationId: z.string().min(1, "Location is required"),
  date: z.coerce.date(),
  status: z.nativeEnum(PurchaseOrderStatus).default(PurchaseOrderStatus.DRAFT),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
  items: z.array(purchaseOrderItemSchema).min(1, "At least one item is required"),
}).refine(
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

export async function updatePurchaseOrderAction(raw: unknown) {
  return runAction("orders.po.update", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "purchase-orders", "update", (session.user as any).permissions)) {
      throw userError("You do not have permission to update purchase orders.");
    }

    const input = parseInput(updatePurchaseOrderSchema, raw);
    const lockKeys = [`order:po:${input.id}`, "doc:purchase_order"];

    const res = await withResourceQueue(lockKeys, async (tx) => {
      const existing = await tx.purchaseOrder.findUnique({
        where: { id: input.id },
        include: { items: true },
      });
      if (!existing) throw userError("Purchase order not found.");
      if (existing.status === PurchaseOrderStatus.FULFILLED || existing.status === PurchaseOrderStatus.CANCELLED) {
        throw userError("Only draft or sent purchase orders can be edited.");
      }

      let targetSupplierId = input.supplierId;
      if (input.supplierType === "ONE_TIME") {
        let mv = await tx.party.findFirst({ where: { name: "Market Vendor" } });
        if (!mv) {
          mv = await tx.party.create({
            data: { name: "Market Vendor", type: PartyType.SUPPLIER, email: "vendor@internal.local", isActive: true },
          });
        }
        targetSupplierId = mv.id;
      }
      if (!targetSupplierId) throw userError("Please select a supplier.");

      await tx.purchaseOrderItem.deleteMany({ where: { orderId: existing.id } });
      const updated = await tx.purchaseOrder.update({
        where: { id: existing.id },
        data: {
          supplierId: targetSupplierId,
          locationId: input.locationId,
          date: input.date,
          status: input.status,
          notes: input.notes || null,
          items: {
            create: input.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              unitCost: item.unitCost,
              lineTotal: item.quantity * item.unitCost,
            })),
          },
        },
      });

      if (input.status === PurchaseOrderStatus.FULFILLED) {
        for (const item of input.items) {
          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              locationId: input.locationId,
              type: StockMovementType.PURCHASE_IN,
              quantity: item.quantity,
              referenceType: "PURCHASE_ORDER",
              referenceId: updated.id,
              createdById: session.user.id,
              notes: `Purchase Order fulfilled via ${updated.orderNo}`,
            },
          });
        }
      }

      return { id: updated.id, orderNo: updated.orderNo };
    });

    emitRealtimeEvent(["purchase-orders", "inventory", "stock-movements", "dashboard"], "update", "PurchaseOrder", {
      id: res.id,
      orderNo: res.orderNo,
    });

    return res;
  });
}

export async function deletePurchaseOrderAction(raw: unknown) {
  return runAction("orders.po.delete", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "purchase-orders", "delete", (session.user as any).permissions)) {
      throw userError("You do not have permission to delete purchase orders.");
    }
    const schema = z.object({ id: z.string().min(1, "Purchase order ID is required") });
    const { id } = parseInput(schema, raw);

    const res = await withResourceQueue([`order:po:${id}`], async (tx) => {
      const order = await tx.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
      if (!order) throw userError("Purchase order not found.");
      if (order.status === PurchaseOrderStatus.FULFILLED || order.status === PurchaseOrderStatus.CANCELLED) {
        throw userError("Only draft or sent purchase orders can be deleted.");
      }
      await tx.stockMovement.deleteMany({
        where: { referenceType: "PURCHASE_ORDER", referenceId: id },
      });
      await tx.purchaseOrderItem.deleteMany({ where: { orderId: id } });
      await tx.purchaseOrder.delete({ where: { id } });
      return { id, orderNo: order.orderNo };
    });

    emitRealtimeEvent(["purchase-orders", "inventory", "stock-movements", "dashboard"], "delete", "PurchaseOrder", {
      id: res.id,
      orderNo: res.orderNo,
    });

    return res;
  });
}

export async function updatePurchaseOrderStatusAction(raw: unknown) {
  return runAction("orders.po.updateStatus", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "purchase-orders", "update", (session.user as any).permissions)) {
      throw userError("You do not have permission to update purchase orders.");
    }
    const schema = z.object({
      id: z.string().min(1),
      status: z.nativeEnum(PurchaseOrderStatus),
    });
    const { id, status } = parseInput(schema, raw);

    const lockKeys = [`order:po:${id}`, "doc:purchase_order"];

    const res = await withResourceQueue(lockKeys, async (tx) => {
      const order = await tx.purchaseOrder.findUnique({
        where: { id },
        include: { items: true, invoices: true },
      });

      if (!order) {
        throw userError("Purchase order not found.");
      }

      if (status === PurchaseOrderStatus.FULFILLED && order.status !== PurchaseOrderStatus.FULFILLED) {
        const linkedInvoiceIds = order.invoices.map((inv: any) => inv.id);
        const existingStockMovement = await tx.stockMovement.findFirst({
          where: {
            OR: [
              { referenceType: "PURCHASE_ORDER", referenceId: order.id },
              ...(linkedInvoiceIds.length > 0
                ? [{ referenceType: "PURCHASE_INVOICE", referenceId: { in: linkedInvoiceIds } }]
                : []),
            ],
          },
        });

        if (!existingStockMovement) {
          for (const item of order.items) {
            await tx.stockMovement.create({
              data: {
                productId: item.productId,
                locationId: order.locationId,
                type: StockMovementType.PURCHASE_IN,
                quantity: item.quantity,
                referenceType: "PURCHASE_ORDER",
                referenceId: order.id,
                createdById: session.user.id,
                notes: `Purchase Order fulfilled via ${order.orderNo}`,
              },
            });
          }
        }
      }

      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: { status },
      });

      return { id: updated.id, status: updated.status };
    });

    emitRealtimeEvent(["purchase-orders", "inventory", "stock-movements", "dashboard"], "status", "PurchaseOrder", {
      id: res.id,
      status: res.status,
    });

    return res;
  });
}

export async function listDeliveryOrdersAction() {
  return runAction("orders.do.list", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "delivery-orders", "view", (session.user as any).permissions)) {
      throw userError("You do not have permission to view delivery orders.");
    }
    const orders = await prisma.deliveryOrder.findMany({
      orderBy: { date: "desc" },
      include: {
        financialYear: { select: { id: true, label: true, isActive: true } },
        customer: { select: { id: true, name: true, phone: true } },
        location: { select: { id: true, name: true } },
        destinationLocation: { select: { id: true, name: true } },
        linkedSaleInvoice: { select: { id: true, invoiceNo: true } },
        items: {
          include: {
            product: { select: { id: true, productNo: true, name: true } },
            warehouseLot: { select: { id: true, lotNumber: true } },
          },
        },
      },
    });

    return orders.map((order) => ({
      ...order,
      items: order.items.map((item) => ({
        ...item,
        quantity: Number(item.quantity),
      })),
    }));
  });
}

export async function createDeliveryOrderAction(raw: unknown) {
  return runAction("orders.do.create", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "delivery-orders", "create", (session.user as any).permissions)) {
      throw userError("You do not have permission to create delivery orders.");
    }
    const input = parseInput(deliveryOrderSchema, raw);

    const stockKeys = input.items.map((i) => `stock:${i.productId}:${input.locationId}`);
    const partyKey = input.customerId ? `party:${input.customerId}` : null;
    const docKey = "doc:delivery_order";
    const lockKeys = [...stockKeys, ...(partyKey ? [partyKey] : []), docKey];

    const res = await withResourceQueue(lockKeys, async (tx) => {
      // 1. Verify dispatch location is a WAREHOUSE
      const dispatchLoc = await tx.location.findUnique({
        where: { id: input.locationId },
        select: { id: true, name: true, type: true },
      });
      if (!dispatchLoc || dispatchLoc.type !== "WAREHOUSE") {
        throw userError("Delivery Orders must be dispatched from a Warehouse location.");
      }

      // 2. Verify all consignment items have lots specified
      for (const item of input.items) {
        if (!item.warehouseLotId || !item.warehouseLotId.trim()) {
          const product = await tx.product.findUnique({
            where: { id: item.productId },
            select: { name: true, productNo: true },
          });
          throw userError(
            `A warehouse lot must be specified for "${product?.productNo ?? ""} ${product?.name ?? ""}". All warehouse consignments require lot tracking.`
          );
        }
      }

      const activeFy = await getActiveFinancialYear(tx);
      const { sequenceNo, formattedNumber: doNo } = await getNextAtomicSequence(
        tx,
        activeFy.id,
        "DELIVERY_ORDER"
      );

      // If creating directly with DISPATCHED status, verify stock first
      if (input.status === DeliveryOrderStatus.DISPATCHED) {
        let alreadyDeducted = false;
        if (input.saleInvoiceId) {
          const existingSaleMovement = await tx.stockMovement.findFirst({
            where: {
              referenceType: "SALE_INVOICE",
              referenceId: input.saleInvoiceId,
            },
          });
          if (existingSaleMovement) {
            alreadyDeducted = true;
          }
        }

        if (!alreadyDeducted) {
          for (const item of input.items) {
            const available = await getStockOnHand(item.productId, input.locationId, tx);
            if (available < Number(item.quantity)) {
              const product = await tx.product.findUnique({
                where: { id: item.productId },
                select: { name: true, productNo: true },
              });
              throw userError(
                `Insufficient stock for "${product?.productNo ?? ""} ${product?.name ?? ""}". Available: ${available}, Required: ${item.quantity}.`,
              );
            }
          }
        }
      }

      const order = await tx.deliveryOrder.create({
        data: {
          doNo,
          financialYearId: activeFy.id,
          sequenceNo,
          customerId: input.customerId || null,
          locationId: input.locationId,
          destinationLocationId: input.destinationLocationId || null,
          saleInvoiceId: input.saleInvoiceId || null,
          date: input.date,
          status: input.status,
          vehicleNo: input.vehicleNo || null,
          deliveredTo: input.deliveredTo || input.recipientName || null,
          recipientName: input.recipientName || input.deliveredTo || null,
          notes: input.notes || null,
          createdById: session.user.id,
          items: {
            create: input.items.map((item) => ({
              productId: item.productId,
              warehouseLotId: item.warehouseLotId || null,
              quantity: item.quantity,
              unit: (item.unit ?? Unit.PACKET) as Unit,
            })),
          },
        },
      });

      // If DISPATCHED, create dispatch or internal transfer stock movements
      if (input.status === DeliveryOrderStatus.DISPATCHED) {
        await createDeliveryOrderStockMovements(tx, session.user.id, {
          id: order.id,
          doNo: order.doNo,
          locationId: order.locationId,
          destinationLocationId: order.destinationLocationId,
          deliveredTo: order.deliveredTo,
          saleInvoiceId: order.saleInvoiceId,
          items: input.items.map((item) => ({
            productId: item.productId,
            quantity: Number(item.quantity),
            warehouseLotId: item.warehouseLotId || null,
          })),
        });
      }

      return { id: order.id, doNo: order.doNo };
    });

    emitRealtimeEvent(["delivery-orders", "inventory", "stock-movements", "dashboard"], "create", "DeliveryOrder", {
      id: res.id,
      doNo: res.doNo,
    });

    return res;
  });
}

const updateDeliveryOrderSchema = z.object({
  id: z.string().min(1, "Delivery order ID is required"),
  orderType: z.enum(["CUSTOMER", "INTERNAL_TRANSFER"]).default("CUSTOMER"),
  customerId: z.string().optional().nullable().or(z.literal("")),
  locationId: z.string().min(1, "Source / Dispatch Location is required"),
  destinationLocationId: z.string().optional().nullable().or(z.literal("")),
  saleInvoiceId: z.string().optional().nullable(),
  date: z.coerce.date(),
  status: z.nativeEnum(DeliveryOrderStatus).default(DeliveryOrderStatus.DISPATCHED),
  vehicleNo: z.string().trim().max(100).optional().nullable().or(z.literal("")),
  driverName: z.string().trim().max(100).optional().nullable().or(z.literal("")),
  deliveredTo: z.string().trim().max(255).optional().nullable().or(z.literal("")),
  recipientName: z.string().trim().max(255).optional().nullable().or(z.literal("")),
  notes: z.string().trim().max(1000).optional().nullable().or(z.literal("")),
  items: z.array(deliveryOrderItemSchema).min(1, "At least one item is required"),
}).superRefine((data, ctx) => {
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

export async function updateDeliveryOrderAction(raw: unknown) {
  return runAction("orders.do.update", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "delivery-orders", "update", (session.user as any).permissions)) {
      throw userError("You do not have permission to update delivery orders.");
    }

    const input = parseInput(updateDeliveryOrderSchema, raw);
    const lockKeys = [`order:do:${input.id}`, "doc:delivery_order"];

    const res = await withResourceQueue(lockKeys, async (tx) => {
      const existing = await tx.deliveryOrder.findUnique({
        where: { id: input.id },
        include: { items: true },
      });
      if (!existing) throw userError("Delivery order not found.");
      if (existing.status === DeliveryOrderStatus.DISPATCHED || existing.status === DeliveryOrderStatus.DELIVERED || existing.status === DeliveryOrderStatus.CANCELLED) {
        throw userError("Only draft delivery orders can be edited.");
      }

      await tx.stockMovement.deleteMany({
        where: { referenceType: "DELIVERY_ORDER", referenceId: existing.id },
      });
      await tx.deliveryOrderItem.deleteMany({ where: { doId: existing.id } });

      const updated = await tx.deliveryOrder.update({
        where: { id: existing.id },
        data: {
          customerId: input.customerId || null,
          locationId: input.locationId,
          destinationLocationId: input.destinationLocationId || null,
          saleInvoiceId: input.saleInvoiceId || null,
          date: input.date,
          status: input.status,
          vehicleNo: input.vehicleNo || null,
          driverName: input.driverName || null,
          deliveredTo: input.deliveredTo || input.recipientName || null,
          recipientName: input.recipientName || input.deliveredTo || null,
          notes: input.notes || null,
        },
      });

      await tx.deliveryOrderItem.createMany({
        data: input.items.map((item) => ({
          doId: existing.id,
          productId: item.productId,
          warehouseLotId: item.warehouseLotId || null,
          quantity: item.quantity,
          unit: (item.unit ?? Unit.PACKET) as Unit,
        })),
      });

      if (input.status === DeliveryOrderStatus.DISPATCHED) {
        await createDeliveryOrderStockMovements(tx, session.user.id, {
          id: updated.id,
          doNo: updated.doNo,
          locationId: updated.locationId,
          destinationLocationId: updated.destinationLocationId,
          deliveredTo: updated.deliveredTo,
          saleInvoiceId: updated.saleInvoiceId,
          items: input.items.map((item) => ({
            productId: item.productId,
            quantity: Number(item.quantity),
            warehouseLotId: item.warehouseLotId || null,
          })),
        });
      }

      return { id: updated.id, doNo: updated.doNo };
    });

    emitRealtimeEvent(["delivery-orders", "inventory", "stock-movements", "dashboard"], "update", "DeliveryOrder", {
      id: res.id,
      doNo: res.doNo,
    });

    return res;
  });
}

export async function deleteDeliveryOrderAction(raw: unknown) {
  return runAction("orders.do.delete", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "delivery-orders", "delete", (session.user as any).permissions)) {
      throw userError("You do not have permission to delete delivery orders.");
    }
    const schema = z.object({ id: z.string().min(1, "Delivery order ID is required") });
    const { id } = parseInput(schema, raw);

    const res = await withResourceQueue([`order:do:${id}`], async (tx) => {
      const order = await tx.deliveryOrder.findUnique({ where: { id }, include: { items: true } });
      if (!order) throw userError("Delivery order not found.");
      if (order.status === DeliveryOrderStatus.DISPATCHED || order.status === DeliveryOrderStatus.DELIVERED) {
        throw userError("Dispatches already made cannot be deleted. Cancel or reverse the order instead.");
      }
      await tx.stockMovement.deleteMany({ where: { referenceType: "DELIVERY_ORDER", referenceId: id } });
      await tx.deliveryOrderItem.deleteMany({ where: { doId: id } });
      await tx.deliveryOrder.delete({ where: { id } });
      return { id, doNo: order.doNo };
    });

    emitRealtimeEvent(["delivery-orders", "inventory", "stock-movements", "dashboard"], "delete", "DeliveryOrder", {
      id: res.id,
      doNo: res.doNo,
    });

    return res;
  });
}

export async function updateDeliveryOrderStatusAction(raw: unknown) {
  return runAction("orders.do.updateStatus", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "delivery-orders", "update", (session.user as any).permissions)) {
      throw userError("You do not have permission to update delivery orders.");
    }
    const schema = z.object({
      id: z.string().min(1),
      status: z.nativeEnum(DeliveryOrderStatus),
    });
    const { id, status } = parseInput(schema, raw);

    const lockKeys = [`order:do:${id}`, "doc:delivery_order"];

    const res = await withResourceQueue(lockKeys, async (tx) => {
      const order = await tx.deliveryOrder.findUnique({
        where: { id },
        include: { items: { include: { product: true } } },
      });

      if (!order) {
        throw userError("Delivery order not found.");
      }

      if (
        status === DeliveryOrderStatus.CANCELLED &&
        (order.status === DeliveryOrderStatus.DISPATCHED || order.status === DeliveryOrderStatus.DELIVERED)
      ) {
        throw userError(
          "Cannot cancel a delivery order that has already been dispatched or delivered. Use a return or stock adjustment instead.",
        );
      }

      // If status is transitioning to DISPATCHED and wasn't previously DISPATCHED/DELIVERED:
      // Check stock and create dispatch or internal transfer movements
      if (
        status === DeliveryOrderStatus.DISPATCHED &&
        order.status !== DeliveryOrderStatus.DISPATCHED &&
        order.status !== DeliveryOrderStatus.DELIVERED
      ) {
        let alreadyDeducted = false;
        if (order.saleInvoiceId) {
          const existingSaleMovement = await tx.stockMovement.findFirst({
            where: {
              referenceType: "SALE_INVOICE",
              referenceId: order.saleInvoiceId,
            },
          });
          if (existingSaleMovement) {
            alreadyDeducted = true;
          }
        }
        if (!alreadyDeducted) {
          const linkedSaleInvoice = await tx.saleInvoice.findFirst({
            where: { deliveryOrderId: order.id },
            select: { id: true },
          });
          if (linkedSaleInvoice) {
            const existingSaleMovement = await tx.stockMovement.findFirst({
              where: {
                referenceType: "SALE_INVOICE",
                referenceId: linkedSaleInvoice.id,
              },
            });
            if (existingSaleMovement) {
              alreadyDeducted = true;
            }
          }
        }

        if (!alreadyDeducted) {
          for (const item of order.items) {
            const available = await getStockOnHand(item.productId, order.locationId, tx);
            if (available < Number(item.quantity)) {
              throw userError(
                `Insufficient stock for "${item.product.productNo} - ${item.product.name}" to dispatch. Available: ${available} ${item.unit}, Required: ${item.quantity}.`,
              );
            }
          }
        }

        await createDeliveryOrderStockMovements(tx, session.user.id, {
          id: order.id,
          doNo: order.doNo,
          locationId: order.locationId,
          destinationLocationId: order.destinationLocationId,
          deliveredTo: order.deliveredTo,
          saleInvoiceId: order.saleInvoiceId,
          items: order.items.map((item) => ({
            productId: item.productId,
            quantity: Number(item.quantity),
            warehouseLotId: item.warehouseLotId || null,
          })),
        });
      }

      const updated = await tx.deliveryOrder.update({
        where: { id },
        data: { status },
      });

      return { id: updated.id, status: updated.status };
    });

    emitRealtimeEvent(["delivery-orders", "inventory", "stock-movements", "dashboard"], "status", "DeliveryOrder", {
      id: res.id,
      status: res.status,
    });

    return res;
  });
}

export async function listLocationsAction() {
  return runAction("locations.list", async () => {
    await requireSession();
    return prisma.location.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, address: true, type: true },
    });
  });
}


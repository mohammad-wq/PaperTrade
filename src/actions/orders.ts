"use server";

import { parseInput, runAction } from "@/actions/_helpers";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { userError } from "@/lib/errors";
import { getStockOnHand } from "@/lib/stock";
import { withResourceQueue, generateDocumentNumber } from "@/lib/concurrency";
import { emitRealtimeEvent } from "@/lib/realtime";
import { purchaseOrderSchema } from "@/schemas/order";
import { deliveryOrderSchema } from "@/schemas/order";
import { DeliveryOrderStatus, PurchaseOrderStatus, StockMovementType, Unit } from "@prisma/client";
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
    const partyKey = `party:${input.supplierId}`;
    const docKey = "doc:purchase_order";
    const lockKeys = [...stockKeys, partyKey, docKey];

    const res = await withResourceQueue(lockKeys, async (tx) => {
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
          supplierId: input.supplierId,
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
          driverName: input.driverName || null,
          deliveredTo: input.deliveredTo || null,
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
      select: { id: true, name: true, address: true },
    });
  });
}


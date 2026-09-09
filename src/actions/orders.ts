"use server";

import { parseInput, runAction } from "@/actions/_helpers";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { userError } from "@/lib/errors";
import { getStockOnHand } from "@/lib/stock";
import { purchaseOrderSchema } from "@/schemas/order";
import { deliveryOrderSchema } from "@/schemas/order";
import { DeliveryOrderStatus, PurchaseOrderStatus, StockMovementType, Unit } from "@prisma/client";
import { z } from "zod";

export async function listPurchaseOrdersAction() {
  return runAction("orders.po.list", async () => {
    await requireSession();
    const orders = await prisma.purchaseOrder.findMany({
      orderBy: { date: "desc" },
      include: {
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
    const input = parseInput(purchaseOrderSchema, raw);

    const orderNo = `PO-${Date.now().toString().slice(-6)}`;

    const order = await prisma.purchaseOrder.create({
      data: {
        orderNo,
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

    return { id: order.id, orderNo: order.orderNo };
  });
}

export async function updatePurchaseOrderStatusAction(raw: unknown) {
  return runAction("orders.po.updateStatus", async () => {
    await requireSession();
    const schema = z.object({
      id: z.string().min(1),
      status: z.nativeEnum(PurchaseOrderStatus),
    });
    const { id, status } = parseInput(schema, raw);

    const updated = await prisma.purchaseOrder.update({
      where: { id },
      data: { status },
    });

    return { id: updated.id, status: updated.status };
  });
}

export async function listDeliveryOrdersAction() {
  return runAction("orders.do.list", async () => {
    await requireSession();
    const orders = await prisma.deliveryOrder.findMany({
      orderBy: { date: "desc" },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        location: { select: { id: true, name: true } },
        linkedSaleInvoice: { select: { id: true, invoiceNo: true } },
        items: {
          include: {
            product: { select: { id: true, productNo: true, name: true } },
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
    const input = parseInput(deliveryOrderSchema, raw);

    const doNo = `DO-${Date.now().toString().slice(-6)}`;

    return prisma.$transaction(async (tx) => {
      // If creating directly with DISPATCHED status, verify stock first
      if (input.status === DeliveryOrderStatus.DISPATCHED) {
        for (const item of input.items) {
          const available = await getStockOnHand(item.productId, input.locationId);
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

      const order = await tx.deliveryOrder.create({
        data: {
          doNo,
          customerId: input.customerId,
          locationId: input.locationId,
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
              quantity: item.quantity,
              unit: (item.unit ?? Unit.PACKET) as Unit,
            })),
          },
        },
      });

      // If DISPATCHED, create DELIVERY_OUT stock movements
      if (input.status === DeliveryOrderStatus.DISPATCHED) {
        for (const item of input.items) {
          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              locationId: input.locationId,
              type: StockMovementType.DELIVERY_OUT,
              quantity: item.quantity,
              referenceType: "DELIVERY_ORDER",
              referenceId: order.id,
              createdById: session.user.id,
              notes: `Dispatched on creation via DO ${order.doNo}`,
            },
          });
        }
      }

      return { id: order.id, doNo: order.doNo };
    });
  });
}

export async function updateDeliveryOrderStatusAction(raw: unknown) {
  return runAction("orders.do.updateStatus", async () => {
    const session = await requireSession();
    const schema = z.object({
      id: z.string().min(1),
      status: z.nativeEnum(DeliveryOrderStatus),
    });
    const { id, status } = parseInput(schema, raw);

    return prisma.$transaction(async (tx) => {
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
      // Check stock and create DELIVERY_OUT movements
      if (
        status === DeliveryOrderStatus.DISPATCHED &&
        order.status !== DeliveryOrderStatus.DISPATCHED &&
        order.status !== DeliveryOrderStatus.DELIVERED
      ) {
        for (const item of order.items) {
          const available = await getStockOnHand(item.productId, order.locationId);
          if (available < Number(item.quantity)) {
            throw userError(
              `Insufficient stock for "${item.product.productNo} - ${item.product.name}" to dispatch. Available: ${available} ${item.unit}, Required: ${item.quantity}.`,
            );
          }

          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              locationId: order.locationId,
              type: StockMovementType.DELIVERY_OUT,
              quantity: item.quantity,
              referenceType: "DELIVERY_ORDER",
              referenceId: order.id,
              createdById: session.user.id,
              notes: `Dispatched via DO ${order.doNo}`,
            },
          });
        }
      }

      const updated = await tx.deliveryOrder.update({
        where: { id },
        data: { status },
      });

      return { id: updated.id, status: updated.status };
    });
  });
}

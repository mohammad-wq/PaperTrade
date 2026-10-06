"use server";

import { parseInput, runAction } from "@/actions/_helpers";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { userError } from "@/lib/errors";
import { assertStockDeductionsAvailable, getStockOnHand } from "@/lib/stock";
import { withResourceQueue, generateDocumentNumber } from "@/lib/concurrency";
import { emitRealtimeEvent } from "@/lib/realtime";
import { purchaseOrderSchema, purchaseOrderItemSchema, deliveryOrderSchema, deliveryOrderItemSchema } from "@/schemas/order";
import { DeliveryOrderStatus, PartyType, PurchaseOrderStatus, StockMovementType, Unit, Prisma } from "@prisma/client";
import { canPerformAction } from "@/lib/auth/permissions";
import { getActiveFinancialYear, getNextAtomicSequence } from "@/lib/financial-year";
import {
  postInflow,
  postTransfer,
  reverseMovement,
  resolveOwnershipKey,
  resolvePurchaseOwnership,
  resolveSaleOwnership,
} from "@/lib/inventoryCost.service";
import { z } from "zod";

async function postPurchaseOrderFulfillmentLayers(
  tx: Prisma.TransactionClient,
  order: { id: string; orderNo: string },
  items: Array<{
    productId: string;
    destinationLocationId?: string | null;
    warehouseLotId?: string | null;
    quantity: number | Prisma.Decimal | any;
    unitCost?: number | Prisma.Decimal | null;
  }>,
  defaultLocationId: string | null,
) {
  for (const item of items) {
    const locationId = item.destinationLocationId || defaultLocationId;
    if (!locationId) continue;
    const qty = Number(item.quantity);
    const unitCost =
      item.unitCost != null && Number(item.unitCost) > 0 ? Number(item.unitCost) : null;
    if (!unitCost) continue;
    const ownership = await resolvePurchaseOwnership(tx, {
      warehouseLotId: item.warehouseLotId,
    });
    await postInflow(tx, {
      productId: item.productId,
      locationId,
      ownership,
      quantity: qty,
      unitCost,
      movementType: "PURCHASE",
      referenceType: "PURCHASE_ORDER",
      referenceId: order.id,
    });
  }
}

async function resolveInternalTransferLocationId(
  tx: any,
  sourceLocationId: string,
  deliveredTo?: string | null,
  destinationLocationId?: string | null,
) {
  if (destinationLocationId) {
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
    locationId?: string | null;
    destinationLocationId?: string | null;
    deliveredTo?: string | null;
    saleInvoiceId?: string | null;
    items: Array<{
      productId: string;
      quantity: number | Prisma.Decimal | any;
      locationId?: string | null;
      warehouseLotId?: string | null;
    }>;
  },
) {
  // 1. Invoice-Sourced DO:
  // When a DO has saleInvoiceId set, it serves solely as a physical dispatch or pickup receipt.
  // Completely disable any inventory triggers. Stock has already been deducted upon Sale Invoice posting.
  if (order.saleInvoiceId) {
    return;
  }

  // Also check reverse link if SaleInvoice points to this delivery order
  const linkedSaleInvoice = await tx.saleInvoice.findFirst({
    where: { deliveryOrderId: order.id },
    select: { id: true },
  });
  if (linkedSaleInvoice) {
    return;
  }

  // 2. Standalone DO (no saleInvoiceId):
  // Represents an internal stock transfer between two locations.
  // Destination location can come from destinationLocationId or deliveredTo.
  const destinationLocationId = await resolveInternalTransferLocationId(
    tx,
    order.locationId || "",
    order.deliveredTo,
    order.destinationLocationId,
  );

  // If no destination location is set, treat as a pure printed slip with no inventory bindings
  if (!destinationLocationId) {
    return;
  }

  await assertStockDeductionsAvailable(
    order.items.flatMap((item) => {
      const sourceLocationId = item.locationId || order.locationId;
      return sourceLocationId && sourceLocationId !== destinationLocationId
        ? [{
            productId: item.productId,
            locationId: sourceLocationId,
            warehouseLotId: item.warehouseLotId,
            quantity: Number(item.quantity),
          }]
        : [];
    }),
    tx,
  );

  for (const item of order.items) {
    // Line location strictly takes precedence over header location
    const sourceLocId = item.locationId || order.locationId;
    if (!sourceLocId || sourceLocId === destinationLocationId) {
      continue;
    }

    // TRANSFER_OUT from source location
    await tx.stockMovement.create({
      data: {
        productId: item.productId,
        locationId: sourceLocId,
        warehouseLotId: item.warehouseLotId || null,
        type: StockMovementType.TRANSFER_OUT,
        quantity: item.quantity,
        referenceType: "DELIVERY_ORDER",
        referenceId: order.id,
        createdById: sessionUserId,
        notes: `Transfer via DO ${order.doNo}`,
      },
    });

    // TRANSFER_IN to destination location
    await tx.stockMovement.create({
      data: {
        productId: item.productId,
        locationId: destinationLocationId,
        warehouseLotId: item.warehouseLotId || null,
        type: StockMovementType.TRANSFER_IN,
        quantity: item.quantity,
        referenceType: "DELIVERY_ORDER",
        referenceId: order.id,
        createdById: sessionUserId,
        notes: `Transfer via DO ${order.doNo}`,
      },
    });

    const ownership = await resolveSaleOwnership(tx, {
      productId: item.productId,
      locationId: sourceLocId,
      warehouseLotId: item.warehouseLotId,
      partnershipLotId: (item as any).partnershipLotId,
      ownershipType: (item as any).ownershipType,
      ownershipKey: (item as any).ownershipKey,
    });
    const ownershipKey = resolveOwnershipKey(ownership);
    await postTransfer(tx, {
      productId: item.productId,
      fromLocationId: sourceLocId,
      toLocationId: destinationLocationId,
      ownership,
      quantity: Number(item.quantity),
      referenceType: "DELIVERY_ORDER",
      referenceId: `${order.id}:${item.productId}`,
    });
    await tx.stockMovement.updateMany({
      where: {
        referenceType: "DELIVERY_ORDER",
        referenceId: order.id,
        productId: item.productId,
      },
      data: {
        ownershipType: ownership.ownershipType,
        ownershipKey,
      },
    });

  }
}

export async function executeDeliveryOrderStockMovements(doId: string, userId: string) {
  const order = await prisma.deliveryOrder.findUnique({
    where: { id: doId },
    include: { items: true },
  });
  if (!order) return;
  await createDeliveryOrderStockMovements(prisma, userId, order);
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
        supplier: { select: { id: true, name: true, phone: true, isPartner: true, isBeneficiary: true } },
        location: { select: { id: true, name: true } },
        items: {
          include: {
            product: { select: { id: true, productNo: true, name: true, unit: true } },
            destinationLocation: { select: { id: true, name: true, type: true } },
            warehouseLot: { select: { id: true, lotNumber: true } },
          },
        },
      },
    });

    return orders.map((order) => ({
      ...order,
      includePricing: order.includePricing,
      items: order.items.map((item) => ({
        ...item,
        quantity: Number(item.quantity),
        unitCost: item.unitCost !== null ? Number(item.unitCost) : null,
        lineTotal: item.lineTotal !== null ? Number(item.lineTotal) : null,
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
      ? input.items.map((item) => `stock:${item.productId}:${item.destinationLocationId || input.locationId}`)
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

      let effectiveLocationId = input.locationId;
      if (!effectiveLocationId) {
        effectiveLocationId = input.items.find((i) => i.destinationLocationId)?.destinationLocationId || "";
      }
      if (!effectiveLocationId) {
        const defaultLoc = await tx.location.findFirst({ where: { isActive: true } });
        effectiveLocationId = defaultLoc?.id || "";
      }

      const order = await tx.purchaseOrder.create({
        data: {
          orderNo,
          financialYearId: activeFy.id,
          sequenceNo,
          supplierId: targetSupplierId!,
          locationId: effectiveLocationId,
          date: input.date,
          status: input.status,
          includePricing: input.includePricing ?? true,
          isPartnership: input.isPartnership ?? false,
          partnershipId: input.partnershipId ?? null,
          notes: input.notes || null,
          createdById: session.user.id,
          items: {
            create: input.items.map((item) => ({
              productId: item.productId,
              destinationLocationId: item.destinationLocationId || effectiveLocationId || null,
              warehouseLotId: item.warehouseLotId || null,
              quantity: item.quantity,
              unitCost: (input.includePricing ?? true) ? (item.unitCost ?? null) : null,
              lineTotal: (input.includePricing ?? true) && item.unitCost != null ? item.quantity * item.unitCost : null,
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
              locationId: item.destinationLocationId || effectiveLocationId,
              warehouseLotId: item.warehouseLotId || null,
              type: StockMovementType.PURCHASE_IN,
              quantity: item.quantity,
              referenceType: "PURCHASE_ORDER",
              referenceId: order.id,
              createdById: session.user.id,
              notes: `Purchase Order fulfilled via ${order.orderNo}`,
            },
          });
        }
        await postPurchaseOrderFulfillmentLayers(
          tx,
          order,
          input.items.map((item) => ({
            productId: item.productId,
            destinationLocationId: item.destinationLocationId || effectiveLocationId,
            warehouseLotId: item.warehouseLotId || null,
            quantity: item.quantity,
            unitCost: item.unitCost ?? null,
          })),
          effectiveLocationId,
        );
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
  locationId: z.string().optional().nullable().or(z.literal("")),
  date: z.coerce.date(),
  status: z.nativeEnum(PurchaseOrderStatus).default(PurchaseOrderStatus.DRAFT),
  includePricing: z.boolean().optional(),
  isPartnership: z.boolean().optional(),
  partnershipId: z.string().optional().nullable(),
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

      let effectiveLocationId = input.locationId;
      if (!effectiveLocationId) {
        effectiveLocationId = input.items.find((i) => i.destinationLocationId)?.destinationLocationId || existing.locationId;
      }

      await tx.purchaseOrderItem.deleteMany({ where: { orderId: existing.id } });
      const effectiveIncludePricing = input.includePricing !== undefined ? input.includePricing : existing.includePricing;
      const updated = await tx.purchaseOrder.update({
        where: { id: existing.id },
        data: {
          supplierId: targetSupplierId,
          locationId: effectiveLocationId,
          date: input.date,
          status: input.status,
          includePricing: effectiveIncludePricing,
          isPartnership: input.isPartnership !== undefined ? input.isPartnership : existing.isPartnership,
          partnershipId: input.partnershipId !== undefined ? input.partnershipId : existing.partnershipId,
          notes: input.notes || null,
          items: {
            create: input.items.map((item) => ({
              productId: item.productId,
              destinationLocationId: item.destinationLocationId || effectiveLocationId || null,
              warehouseLotId: item.warehouseLotId || null,
              quantity: item.quantity,
              unitCost: effectiveIncludePricing ? (item.unitCost ?? null) : null,
              lineTotal: effectiveIncludePricing && item.unitCost != null ? item.quantity * item.unitCost : null,
            })),
          },
        },
      });

      if (input.status === PurchaseOrderStatus.FULFILLED) {
        for (const item of input.items) {
          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              locationId: item.destinationLocationId || effectiveLocationId,
              warehouseLotId: item.warehouseLotId || null,
              type: StockMovementType.PURCHASE_IN,
              quantity: item.quantity,
              referenceType: "PURCHASE_ORDER",
              referenceId: updated.id,
              createdById: session.user.id,
              notes: `Purchase Order fulfilled via ${updated.orderNo}`,
            },
          });
        }
        await postPurchaseOrderFulfillmentLayers(
          tx,
          updated,
          input.items.map((item) => ({
            productId: item.productId,
            destinationLocationId: item.destinationLocationId || effectiveLocationId,
            warehouseLotId: item.warehouseLotId || null,
            quantity: item.quantity,
            unitCost: item.unitCost ?? null,
          })),
          effectiveLocationId,
        );
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
                locationId: (item as any).destinationLocationId || order.locationId,
                warehouseLotId: (item as any).warehouseLotId || null,
                type: StockMovementType.PURCHASE_IN,
                quantity: item.quantity,
                referenceType: "PURCHASE_ORDER",
                referenceId: order.id,
                createdById: session.user.id,
                notes: `Purchase Order fulfilled via ${order.orderNo}`,
              },
            });
          }
          await postPurchaseOrderFulfillmentLayers(
            tx,
            order,
            order.items.map((item) => ({
              productId: item.productId,
              destinationLocationId: (item as any).destinationLocationId || order.locationId,
              warehouseLotId: (item as any).warehouseLotId || null,
              quantity: item.quantity,
              unitCost: item.unitCost ?? null,
            })),
            order.locationId,
          );
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
        location: { select: { id: true, name: true, type: true } },
        destinationLocation: { select: { id: true, name: true, type: true } },
        linkedSaleInvoice: { select: { id: true, invoiceNo: true } },
        items: {
          include: {
            product: { select: { id: true, productNo: true, name: true, unit: true } },
            location: { select: { id: true, name: true, type: true } },
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

    const stockKeys = input.items.map((i) => `stock:${i.productId}:${i.locationId || input.locationId || "unassigned"}`);
    const partyKey = input.customerId ? `party:${input.customerId}` : null;
    const docKey = "doc:delivery_order";
    const lockKeys = [...stockKeys, ...(partyKey ? [partyKey] : []), docKey];

    const res = await withResourceQueue(lockKeys, async (tx) => {
      // Resolve fallback location if header locationId was omitted
      let headerLocationId = input.locationId;
      if (!headerLocationId) {
        headerLocationId = input.items.find((it) => it.locationId)?.locationId || (await tx.location.findFirst({ select: { id: true } }))?.id || "";
      }

      const activeFy = await getActiveFinancialYear(tx);
      const { sequenceNo, formattedNumber: doNo } = await getNextAtomicSequence(
        tx,
        activeFy.id,
        "DELIVERY_ORDER"
      );

      // If creating directly with DISPATCHED status, verify stock first ONLY for standalone DOs
      if (input.status === DeliveryOrderStatus.DISPATCHED && !input.saleInvoiceId) {
        for (const item of input.items) {
          const sourceLoc = item.locationId || headerLocationId;
          if (sourceLoc) {
            const available = await getStockOnHand(item.productId, sourceLoc, tx);
            if (available < Number(item.quantity)) {
              const product = await tx.product.findUnique({
                where: { id: item.productId },
                select: { name: true, productNo: true },
              });
              const loc = await tx.location.findUnique({
                where: { id: sourceLoc },
                select: { name: true },
              });
              throw userError(
                `Insufficient stock for "${product?.productNo ?? ""} ${product?.name ?? ""}" at ${loc?.name || "selected location"}. Available: ${available}, Required: ${item.quantity}.`,
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
          locationId: headerLocationId,
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
              locationId: item.locationId || input.locationId || null,
              warehouseLotId: item.warehouseLotId || null,
              quantity: item.quantity,
              unit: (item.unit ?? Unit.PACKET) as Unit,
            })),
          },
        },
      });

      // If DISPATCHED, create internal transfer movements for standalone DOs
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
            locationId: item.locationId || input.locationId || null,
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
  locationId: z.string().optional().nullable().or(z.literal("")),
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
    if (data.locationId && data.destinationLocationId === data.locationId) {
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

      const headerLocationId = input.locationId || existing.locationId;

      const updated = await tx.deliveryOrder.update({
        where: { id: existing.id },
        data: {
          customerId: input.customerId || null,
          locationId: headerLocationId,
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
          locationId: item.locationId || headerLocationId || null,
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
            locationId: item.locationId || headerLocationId || null,
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
        // Only standalone DOs move inventory or need stock checks!
        const isInvoiceSourced = Boolean(
          order.saleInvoiceId ||
          (await tx.saleInvoice.findFirst({ where: { deliveryOrderId: order.id }, select: { id: true } }))
        );

        if (!isInvoiceSourced) {
          for (const item of order.items) {
            const sourceLoc = (item as any).locationId || order.locationId;
            if (sourceLoc) {
              const available = await getStockOnHand(item.productId, sourceLoc, tx);
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
              locationId: (item as any).locationId || order.locationId || null,
              warehouseLotId: item.warehouseLotId || null,
            })),
          });
        }
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

export async function dispatchDeliveryOrderAction(id: string) {
  return updateDeliveryOrderStatusAction({ id, status: DeliveryOrderStatus.DISPATCHED });
}

"use server";

import { z } from "zod";
import { parseInput, runAction } from "@/actions/_helpers";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { userError } from "@/lib/errors";
import { LocationType, Role, StockMovementType } from "@prisma/client";
import { emitRealtimeEvent } from "@/lib/realtime";
import { revalidatePath } from "next/cache";
import { getLotStockOnHand } from "@/lib/stock";

import { revalidateWarehouseLots } from "@/lib/cached-lookups";
import { canPerformAction } from "@/lib/auth/permissions";

const createLotSchema = z.object({
  locationId: z.string().min(1, "Location is required"),
  lotNumber: z.string().trim().min(1, "Lot number is required").max(50),
  description: z.string().trim().max(255).optional().nullable(),
});

const updateLotSchema = z.object({
  id: z.string().min(1, "Lot ID is required"),
  lotNumber: z.string().trim().min(1, "Lot number is required").max(50),
  description: z.string().trim().max(255).optional().nullable(),
  isActive: z.boolean().optional(),
});

export async function listWarehouseLotsAction(
  locationId?: string,
  includeInactive: boolean = false,
) {
  return runAction("warehouseLots.list", async () => {
    await requireSession();

    const lots = await prisma.warehouseLot.findMany({
      where: {
        ...(locationId ? { locationId } : {}),
        ...(includeInactive ? {} : { isActive: true, deletedAt: null }),
      },
      include: {
        location: {
          select: { id: true, name: true, type: true },
        },
      },
      orderBy: [{ isActive: "desc" }, { lotNumber: "asc" }],
    });

    const lotIds = lots.map((l) => l.id);
    const stockSums =
      lotIds.length > 0
        ? await prisma.stockMovement.groupBy({
            by: ["warehouseLotId", "type"],
            where: { warehouseLotId: { in: lotIds } },
            _sum: { quantity: true },
          })
        : [];

    const INBOUND_SET = new Set<StockMovementType>([
      StockMovementType.PURCHASE_IN,
      StockMovementType.TRANSFER_IN,
      StockMovementType.SALE_RETURN,
    ]);

    const OUTBOUND_SET = new Set<StockMovementType>([
      StockMovementType.SALE_OUT,
      StockMovementType.TRANSFER_OUT,
      StockMovementType.DELIVERY_OUT,
      StockMovementType.PURCHASE_RETURN,
    ]);

    const stockMap = new Map<string, number>();
    for (const row of stockSums) {
      if (!row.warehouseLotId) continue;
      const current = stockMap.get(row.warehouseLotId) ?? 0;
      const qty = Number(row._sum.quantity ?? 0);
      let delta = 0;
      if (row.type === StockMovementType.ADJUSTMENT || INBOUND_SET.has(row.type)) {
        delta = qty;
      } else if (OUTBOUND_SET.has(row.type)) {
        delta = -qty;
      }
      stockMap.set(row.warehouseLotId, current + delta);
    }

    return lots.map((lot) => ({
      id: lot.id,
      locationId: lot.locationId,
      locationName: lot.location.name,
      locationType: lot.location.type,
      lotNumber: lot.lotNumber,
      description: lot.description,
      isActive: lot.isActive,
      deletedAt: lot.deletedAt ? lot.deletedAt.toISOString() : null,
      createdAt: lot.createdAt.toISOString(),
      updatedAt: lot.updatedAt.toISOString(),
      currentStock: stockMap.get(lot.id) ?? 0,
    }));
  });
}

export async function createWarehouseLotAction(raw: unknown) {
  return runAction("warehouseLots.create", async () => {
    const session = await requireSession();
    if (
      !canPerformAction(session.user.role, "inventory", "create", (session.user as any).permissions) &&
      !canPerformAction(session.user.role, "partnerships", "create", (session.user as any).permissions)
    ) {
      throw userError("You do not have permission to create warehouse lots.");
    }
    const input = parseInput(createLotSchema, raw);

    const location = await prisma.location.findUnique({
      where: { id: input.locationId },
    });

    if (!location) {
      throw userError("Specified location does not exist.");
    }
    if (location.type !== LocationType.WAREHOUSE) {
      throw userError("Lots can only be assigned to Warehouse locations.");
    }
    if (!location.isActive) {
      throw userError("Cannot add lots to an inactive location.");
    }

    const lotNumber = input.lotNumber.trim();

    const existing = await prisma.warehouseLot.findFirst({
      where: {
        locationId: input.locationId,
        lotNumber: { equals: lotNumber, mode: "insensitive" },
      },
    });

    if (existing) {
      if (!existing.isActive) {
        throw userError(`A deactivated lot "${lotNumber}" already exists for this warehouse. You can reactivate it.`);
      }
      throw userError(`Lot "${lotNumber}" already exists in ${location.name}.`);
    }

    const lot = await prisma.warehouseLot.create({
      data: {
        locationId: input.locationId,
        lotNumber,
        description: input.description?.trim() || null,
        isActive: true,
      },
      include: {
        location: { select: { id: true, name: true } },
      },
    });

    emitRealtimeEvent(["warehouse-lots", "inventory"], "create", "WarehouseLot", {
      id: lot.id,
      locationId: lot.locationId,
      lotNumber: lot.lotNumber,
    });

    revalidateWarehouseLots();
    revalidatePath("/settings/locations");
    revalidatePath("/inventory");
    revalidatePath("/purchases");
    revalidatePath("/delivery-orders");

    return lot;
  });
}

export async function updateWarehouseLotAction(raw: unknown) {
  return runAction("warehouseLots.update", async () => {
    const session = await requireSession();
    if (
      !canPerformAction(session.user.role, "inventory", "update", (session.user as any).permissions) &&
      !canPerformAction(session.user.role, "partnerships", "update", (session.user as any).permissions)
    ) {
      throw userError("You do not have permission to update warehouse lots.");
    }
    const input = parseInput(updateLotSchema, raw);

    const lot = await prisma.warehouseLot.findUnique({
      where: { id: input.id },
    });
    if (!lot) {
      throw userError("Warehouse lot not found.");
    }

    const lotNumber = input.lotNumber.trim();
    const duplicate = await prisma.warehouseLot.findFirst({
      where: {
        id: { not: input.id },
        locationId: lot.locationId,
        lotNumber: { equals: lotNumber, mode: "insensitive" },
      },
    });
    if (duplicate) {
      throw userError(`Lot "${lotNumber}" already exists in this warehouse.`);
    }

    const updated = await prisma.warehouseLot.update({
      where: { id: input.id },
      data: {
        lotNumber,
        description: input.description?.trim() || null,
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });

    emitRealtimeEvent(["warehouse-lots", "inventory"], "update", "WarehouseLot", {
      id: updated.id,
      locationId: updated.locationId,
      lotNumber: updated.lotNumber,
    });

    revalidateWarehouseLots();
    revalidatePath("/settings/locations");
    revalidatePath("/inventory");
    revalidatePath("/purchases");
    revalidatePath("/delivery-orders");

    return updated;
  });
}

export async function deactivateWarehouseLotAction(raw: unknown) {
  return runAction("warehouseLots.deactivate", async () => {
    const session = await requireSession();
    if (session.user.role !== Role.OWNER && session.user.role !== Role.MANAGER) {
      throw userError("Only owners and managers can deactivate warehouse lots.");
    }
    const { id } = parseInput(z.object({ id: z.string().min(1) }), raw);

    const lot = await prisma.warehouseLot.update({
      where: { id },
      data: {
        isActive: false,
        deletedAt: new Date(),
      },
    });

    emitRealtimeEvent(["warehouse-lots", "inventory"], "delete", "WarehouseLot", {
      id: lot.id,
      locationId: lot.locationId,
    });

    revalidateWarehouseLots();
    revalidatePath("/settings/locations");
    revalidatePath("/inventory");
    revalidatePath("/purchases");
    revalidatePath("/delivery-orders");

    return lot;
  });
}

export async function reactivateWarehouseLotAction(raw: unknown) {
  return runAction("warehouseLots.reactivate", async () => {
    const session = await requireSession();
    if (session.user.role !== Role.OWNER && session.user.role !== Role.MANAGER) {
      throw userError("Only owners and managers can reactivate warehouse lots.");
    }
    const { id } = parseInput(z.object({ id: z.string().min(1) }), raw);

    const lot = await prisma.warehouseLot.update({
      where: { id },
      data: {
        isActive: true,
        deletedAt: null,
      },
    });

    emitRealtimeEvent(["warehouse-lots", "inventory"], "update", "WarehouseLot", {
      id: lot.id,
      locationId: lot.locationId,
    });

    revalidateWarehouseLots();
    revalidatePath("/settings/locations");
    revalidatePath("/inventory");
    revalidatePath("/purchases");
    revalidatePath("/delivery-orders");

    return lot;
  });
}

export async function deleteWarehouseLotAction(raw: unknown) {
  return runAction("warehouseLots.delete", async () => {
    const session = await requireSession();
    if (session.user.role !== Role.OWNER && session.user.role !== Role.MANAGER) {
      throw userError("Only owners and managers can delete warehouse lots.");
    }
    const { id } = parseInput(z.object({ id: z.string().min(1) }), raw);

    const lot = await prisma.warehouseLot.findUnique({
      where: { id },
      include: { location: true },
    });
    if (!lot) throw userError("Warehouse lot not found.");

    const [movementsCount, piItemCount, siItemCount, doItemCount, poItemCount] = await Promise.all([
      prisma.stockMovement.count({ where: { warehouseLotId: id } }),
      prisma.purchaseInvoiceItem.count({ where: { warehouseLotId: id } }),
      prisma.saleInvoiceItem.count({ where: { warehouseLotId: id } }),
      prisma.deliveryOrderItem.count({ where: { warehouseLotId: id } }),
      prisma.purchaseOrderItem.count({ where: { warehouseLotId: id } }),
    ]);

    if (movementsCount > 0 || piItemCount > 0 || siItemCount > 0 || doItemCount > 0 || poItemCount > 0) {
      const updated = await prisma.warehouseLot.update({
        where: { id },
        data: { isActive: false, deletedAt: new Date() },
      });
      emitRealtimeEvent(["warehouse-lots", "inventory"], "delete", "WarehouseLot", { id });
      revalidateWarehouseLots();
      revalidatePath("/settings/locations");
      return { ...updated, softDeleted: true, message: `Lot "${lot.lotNumber}" has transaction records and was deactivated instead of permanently deleted.` };
    }

    await prisma.warehouseLot.delete({ where: { id } });
    emitRealtimeEvent(["warehouse-lots", "inventory"], "delete", "WarehouseLot", { id });
    revalidateWarehouseLots();
    revalidatePath("/settings/locations");
    return { id, success: true, softDeleted: false, message: `Lot "${lot.lotNumber}" was deleted successfully.` };
  });
}


"use server";

import { z } from "zod";
import { parseInput, runAction } from "@/actions/_helpers";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { userError } from "@/lib/errors";
import { LocationType, Role } from "@prisma/client";
import { emitRealtimeEvent } from "@/lib/realtime";
import { revalidatePath } from "next/cache";
import { getLotStockOnHand } from "@/lib/stock";

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

    const lotsWithStock = await Promise.all(
      lots.map(async (lot) => {
        const totalStock = await getLotStockOnHand(lot.id);
        return {
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
          currentStock: totalStock,
        };
      }),
    );

    return lotsWithStock;
  });
}

export async function createWarehouseLotAction(raw: unknown) {
  return runAction("warehouseLots.create", async () => {
    await requireSession();
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

    revalidatePath("/settings/locations");
    revalidatePath("/inventory");
    revalidatePath("/purchases");
    revalidatePath("/delivery-orders");

    return lot;
  });
}

export async function updateWarehouseLotAction(raw: unknown) {
  return runAction("warehouseLots.update", async () => {
    await requireSession();
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

    revalidatePath("/settings/locations");
    revalidatePath("/inventory");
    revalidatePath("/purchases");
    revalidatePath("/delivery-orders");

    return lot;
  });
}


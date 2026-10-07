"use server";

import { z } from "zod";
import { parseInput, runAction } from "@/actions/_helpers";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { userError } from "@/lib/errors";
import { LocationType, Role } from "@prisma/client";
import { emitRealtimeEvent } from "@/lib/realtime";
import { revalidatePath } from "next/cache";
import { revalidateLocations, revalidateWarehouseLots } from "@/lib/cached-lookups";
import { isPartnershipTagLot, loadPartnershipTagIndex } from "@/lib/location-lots";

const locationSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, "Location name must be at least 2 characters").max(100),
  type: z.nativeEnum(LocationType, { errorMap: () => ({ message: "Invalid location type" }) }),
  address: z.string().trim().max(255).optional().nullable(),
});

export async function listLocationsAction(includeInactive: boolean = false) {
  return runAction("locations.list", async () => {
    await requireSession();
    const locations = await prisma.location.findMany({
      where: includeInactive ? undefined : { isActive: true, deletedAt: null },
      orderBy: [{ isActive: "desc" }, { type: "asc" }, { name: "asc" }],
      include: {
        _count: {
          select: {
            warehouseLots: {
              where: { isActive: true, deletedAt: null },
            },
            stockMovements: true,
          },
        },
      },
    });

    const tags = await loadPartnershipTagIndex();
    const taggedLots = await prisma.warehouseLot.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, locationId: true, lotNumber: true, description: true },
    });
    const taggedCountByLocation = new Map<string, number>();
    for (const lot of taggedLots) {
      if (!isPartnershipTagLot(lot, tags)) continue;
      taggedCountByLocation.set(lot.locationId, (taggedCountByLocation.get(lot.locationId) ?? 0) + 1);
    }

    return locations.map((loc) => ({
      id: loc.id,
      name: loc.name,
      type: loc.type,
      address: loc.address,
      isActive: loc.isActive,
      deletedAt: loc.deletedAt ? loc.deletedAt.toISOString() : null,
      createdAt: loc.createdAt.toISOString(),
      updatedAt: loc.updatedAt.toISOString(),
      activeLotsCount: Math.max(0, loc._count.warehouseLots - (taggedCountByLocation.get(loc.id) ?? 0)),
      movementsCount: loc._count.stockMovements,
    }));
  });
}

export async function createLocationAction(raw: unknown) {
  return runAction("locations.create", async () => {
    const session = await requireSession();
    if (session.user.role !== Role.OWNER) {
      throw userError("Only owners can create locations.");
    }

    const input = parseInput(locationSchema, raw);

    const existing = await prisma.location.findFirst({
      where: {
        name: { equals: input.name, mode: "insensitive" },
        type: input.type,
      },
    });

    if (existing) {
      if (!existing.isActive) {
        throw userError(`A deactivated ${input.type.toLowerCase()} named "${input.name}" already exists. You can reactivate it instead.`);
      }
      throw userError(`A ${input.type.toLowerCase()} named "${input.name}" already exists.`);
    }

    const location = await prisma.location.create({
      data: {
        name: input.name,
        type: input.type,
        address: input.address?.trim() || null,
        isActive: true,
        deletedAt: null,
      },
    });

    emitRealtimeEvent(["locations", "inventory"], "create", "Location", {
      id: location.id,
      name: location.name,
      type: location.type,
    });

    revalidateLocations();
    revalidatePath("/settings/locations");
    revalidatePath("/inventory");
    revalidatePath("/purchases");
    revalidatePath("/delivery-orders");
    revalidatePath("/sales");
    revalidatePath("/orders");

    return location;
  });
}

export async function updateLocationAction(raw: unknown) {
  return runAction("locations.update", async () => {
    const session = await requireSession();
    if (session.user.role !== Role.OWNER) {
      throw userError("Only owners can modify locations.");
    }

    const input = parseInput(locationSchema, raw);
    if (!input.id) {
      throw userError("Location ID is required for updates.");
    }

    const existing = await prisma.location.findUnique({
      where: { id: input.id },
    });
    if (!existing) {
      throw userError("Location not found.");
    }

    const duplicate = await prisma.location.findFirst({
      where: {
        id: { not: input.id },
        name: { equals: input.name, mode: "insensitive" },
        type: input.type,
      },
    });
    if (duplicate) {
      throw userError(`Another ${input.type.toLowerCase()} with the name "${input.name}" already exists.`);
    }

    const updated = await prisma.location.update({
      where: { id: input.id },
      data: {
        name: input.name,
        type: input.type,
        address: input.address?.trim() || null,
      },
    });

    emitRealtimeEvent(["locations", "inventory"], "update", "Location", {
      id: updated.id,
      name: updated.name,
      type: updated.type,
    });

    revalidateLocations();
    revalidatePath("/settings/locations");
    revalidatePath("/inventory");
    revalidatePath("/purchases");
    revalidatePath("/delivery-orders");
    revalidatePath("/sales");

    return updated;
  });
}

export async function deactivateLocationAction(raw: unknown) {
  return runAction("locations.deactivate", async () => {
    const session = await requireSession();
    if (session.user.role !== Role.OWNER) {
      throw userError("Only owners can deactivate locations.");
    }

    const { id } = parseInput(z.object({ id: z.string().min(1) }), raw);

    const activeCount = await prisma.location.count({
      where: { isActive: true, deletedAt: null },
    });
    if (activeCount <= 1) {
      throw userError("Cannot deactivate the only active location. At least one location must remain active.");
    }

    const location = await prisma.location.update({
      where: { id },
      data: {
        isActive: false,
        deletedAt: new Date(),
      },
    });

    // Cascade deactivate all lots belonging to this deactivated location
    await prisma.warehouseLot.updateMany({
      where: { locationId: id, isActive: true },
      data: {
        isActive: false,
        deletedAt: new Date(),
      },
    });

    emitRealtimeEvent(["locations", "inventory", "warehouse-lots"], "delete", "Location", { id });

    revalidateLocations();
    revalidateWarehouseLots();
    revalidatePath("/settings/locations");
    revalidatePath("/inventory");
    revalidatePath("/purchases");
    revalidatePath("/delivery-orders");

    return location;
  });
}

export async function reactivateLocationAction(raw: unknown) {
  return runAction("locations.reactivate", async () => {
    const session = await requireSession();
    if (session.user.role !== Role.OWNER) {
      throw userError("Only owners can reactivate locations.");
    }

    const { id } = parseInput(z.object({ id: z.string().min(1) }), raw);

    const location = await prisma.location.update({
      where: { id },
      data: {
        isActive: true,
        deletedAt: null,
      },
    });

    emitRealtimeEvent(["locations", "inventory", "warehouse-lots"], "update", "Location", { id });

    revalidateLocations();
    revalidateWarehouseLots();
    revalidatePath("/settings/locations");
    revalidatePath("/inventory");
    revalidatePath("/purchases");
    revalidatePath("/delivery-orders");

    return location;
  });
}

export async function deleteLocationAction(raw: unknown) {
  return runAction("locations.delete", async () => {
    const session = await requireSession();
    if (session.user.role !== Role.OWNER) {
      throw userError("Only owners can delete locations.");
    }

    const { id } = parseInput(z.object({ id: z.string().min(1) }), raw);

    const loc = await prisma.location.findUnique({ where: { id } });
    if (!loc) throw userError("Location not found.");

    const activeCount = await prisma.location.count({
      where: { isActive: true, deletedAt: null },
    });
    if (activeCount <= 1) {
      throw userError("Cannot delete the only active location. At least one location must remain active.");
    }

    const [movementsCount, doCount, poCount, siCount, piCount, lotCount] = await Promise.all([
      prisma.stockMovement.count({ where: { locationId: id } }),
      prisma.deliveryOrder.count({ where: { OR: [{ locationId: id }, { destinationLocationId: id }] } }),
      prisma.purchaseOrder.count({ where: { locationId: id } }),
      prisma.saleInvoice.count({ where: { locationId: id } }),
      prisma.purchaseInvoice.count({ where: { locationId: id } }),
      prisma.warehouseLot.count({ where: { locationId: id } }),
    ]);

    if (movementsCount > 0 || doCount > 0 || poCount > 0 || siCount > 0 || piCount > 0 || lotCount > 0) {
      const updated = await prisma.location.update({
        where: { id },
        data: { isActive: false, deletedAt: new Date() },
      });
      // Cascade deactivate all lots belonging to this location
      await prisma.warehouseLot.updateMany({
        where: { locationId: id, isActive: true },
        data: { isActive: false, deletedAt: new Date() },
      });
      emitRealtimeEvent(["locations", "inventory", "warehouse-lots"], "delete", "Location", { id });
      revalidateLocations();
      revalidateWarehouseLots();
      revalidatePath("/settings/locations");
      return { ...updated, softDeleted: true, message: `Location "${loc.name}" has historical records and was deactivated instead of permanently deleted.` };
    }

    await prisma.location.delete({ where: { id } });
    emitRealtimeEvent(["locations", "inventory", "warehouse-lots"], "delete", "Location", { id });
    revalidateLocations();
    revalidateWarehouseLots();
    revalidatePath("/settings/locations");
    return { id, success: true, softDeleted: false, message: `Location "${loc.name}" was deleted successfully.` };
  });
}


import { unstable_cache, revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { StockMovementType } from "@prisma/client";

export const getCachedCategories = unstable_cache(
  async () => {
    let categories = await prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });

    if (categories.length === 0) {
      const defaults = ["Writing Paper", "Board", "Newsprint", "Copier", "Offset", "Art Paper"];
      for (const name of defaults) {
        await prisma.category.upsert({
          where: { name },
          update: { isActive: true },
          create: { name, isActive: true },
        });
      }
      categories = await prisma.category.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      });
    }

    return categories;
  },
  ["shared-categories"],
  { tags: ["categories"], revalidate: 300 }
);

export const getCachedQualities = unstable_cache(
  async () => {
    let qualities = await prisma.quality.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });

    if (qualities.length === 0) {
      const defaults = ["A Grade", "B Grade", "C Grade", "Standard", "Premium", "Economy"];
      for (const name of defaults) {
        await prisma.quality.upsert({
          where: { name },
          update: { isActive: true },
          create: { name, isActive: true },
        });
      }
      qualities = await prisma.quality.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      });
    }

    return qualities;
  },
  ["shared-qualities"],
  { tags: ["qualities"], revalidate: 300 }
);

export const getCachedLocations = unstable_cache(
  async () => {
    const locations = await prisma.location.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: [{ type: "asc" }, { name: "asc" }],
      select: { id: true, name: true, address: true, type: true },
    });
    return locations;
  },
  ["shared-locations"],
  { tags: ["locations"], revalidate: 300 }
);

export const getCachedWarehouseLots = unstable_cache(
  async (locationId?: string) => {
    const lots = await prisma.warehouseLot.findMany({
      where: {
        ...(locationId ? { locationId } : {}),
        isActive: true,
        deletedAt: null,
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

    const stockMap = new Map<string, number>();
    for (const row of stockSums) {
      if (!row.warehouseLotId) continue;
      const current = stockMap.get(row.warehouseLotId) ?? 0;
      const qty = Number(row._sum.quantity ?? 0);
      let delta = 0;
      if (row.type === StockMovementType.ADJUSTMENT) {
        delta = qty;
      } else if (
        row.type === StockMovementType.PURCHASE_IN ||
        row.type === StockMovementType.TRANSFER_IN ||
        row.type === StockMovementType.SALE_RETURN
      ) {
        delta = qty;
      } else {
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
  },
  ["shared-warehouse-lots"],
  { tags: ["warehouse-lots"], revalidate: 300 }
);

export function revalidateLocations() {
  (revalidateTag as any)("locations");
}

export function revalidateWarehouseLots() {
  (revalidateTag as any)("warehouse-lots");
}

export function revalidateCategories() {
  (revalidateTag as any)("categories");
}

export function revalidateQualities() {
  (revalidateTag as any)("qualities");
}

export function revalidateDashboard() {
  (revalidateTag as any)("dashboard");
}

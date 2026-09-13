"use server";

import { runAction } from "@/actions/_helpers";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { StockMovementType } from "@prisma/client";

export async function listStockMovementsAction(filters?: {
  productId?: string;
  locationId?: string;
  type?: StockMovementType | "ALL";
  startDate?: string;
  endDate?: string;
}) {
  return runAction("stockMovements.list", async () => {
    await requireSession();

    const where: Record<string, unknown> = {};

    if (filters?.productId && filters.productId !== "ALL") {
      where.productId = filters.productId;
    }
    if (filters?.locationId && filters.locationId !== "ALL") {
      where.locationId = filters.locationId;
    }
    if (filters?.type && filters.type !== "ALL") {
      where.type = filters.type;
    }
    if (filters?.startDate || filters?.endDate) {
      const dateFilter: Record<string, Date> = {};
      if (filters.startDate) {
        const start = new Date(filters.startDate);
        start.setHours(0, 0, 0, 0);
        dateFilter.gte = start;
      }
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.lte = end;
      }
      where.createdAt = dateFilter;
    }

    const movements = await prisma.stockMovement.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        product: { select: { productNo: true, name: true, unit: true } },
        location: { select: { name: true } },
        createdBy: { select: { name: true } },
      },
    });

    return movements.map((m) => ({
      ...m,
      quantity: Number(m.quantity),
    }));
  });
}


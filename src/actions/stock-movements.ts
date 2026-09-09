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
      where.createdAt = {
        ...(filters.startDate ? { gte: new Date(filters.startDate) } : {}),
        ...(filters.endDate ? { lte: new Date(filters.endDate) } : {}),
      };
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


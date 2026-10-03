import { Prisma, PrismaClient, StockMovementType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { userError } from "@/lib/errors";

type StockDatabase = Prisma.TransactionClient | PrismaClient;

const INBOUND: StockMovementType[] = [
  StockMovementType.PURCHASE_IN,
  StockMovementType.TRANSFER_IN,
  StockMovementType.SALE_RETURN,
];

const OUTBOUND: StockMovementType[] = [
  StockMovementType.SALE_OUT,
  StockMovementType.TRANSFER_OUT,
  StockMovementType.DELIVERY_OUT,
  StockMovementType.PURCHASE_RETURN,
];

export async function getStockOnHand(
  productId: string,
  locationId: string,
  tx?: StockDatabase,
  warehouseLotId?: string | null,
): Promise<number> {
  const db = tx ?? prisma;
  const whereClause: Prisma.StockMovementWhereInput = {
    productId,
    locationId,
  };
  if (warehouseLotId !== undefined) {
    whereClause.warehouseLotId = warehouseLotId;
  }

  const movements = await db.stockMovement.groupBy({
    by: ["type"],
    where: whereClause,
    _sum: { quantity: true },
  });

  return movements.reduce((total, row) => {
    const qty = Number(row._sum.quantity ?? 0);
    if (row.type === StockMovementType.ADJUSTMENT) {
      return total + qty;
    }
    if (INBOUND.includes(row.type)) return total + qty;
    if (OUTBOUND.includes(row.type)) return total - qty;
    return total;
  }, 0);
}

export async function assertStockAvailableForDeduction(
  productId: string,
  locationId: string,
  quantity: number,
  tx: StockDatabase,
  warehouseLotId?: string | null,
): Promise<number> {
  const [location, product] = await Promise.all([
    tx.location.findUnique({
      where: { id: locationId },
      select: {
        id: true,
        name: true,
        type: true,
        warehouseLots: {
          where: { isActive: true, deletedAt: null },
          select: { id: true },
        },
      },
    }),
    tx.product.findUnique({
      where: { id: productId },
      select: { id: true, productNo: true, name: true, unit: true },
    }),
  ]);

  if (!location) throw userError("Stock location not found.");
  if (!product) throw userError("Stock product not found.");
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw userError("Stock deduction quantity must be greater than zero.");
  }

  if (warehouseLotId) {
    const selectedLot = location.warehouseLots.find((lot) => lot.id === warehouseLotId);
    if (!selectedLot) {
      throw userError(`Select an active lot belonging to ${location.name}.`);
    }
  } else if (location.type === "WAREHOUSE" && location.warehouseLots.length > 0) {
    throw userError(`Select a specific lot before deducting stock at ${location.name}.`);
  }

  const available = await getStockOnHand(
    productId,
    locationId,
    tx,
    warehouseLotId ?? null,
  );
  if (available - quantity < 0) {
    const lotDescription = warehouseLotId ? " in the selected lot" : "";
    throw userError(
      `Insufficient stock for "${product.productNo} - ${product.name}"${lotDescription} at ${location.name}. Available: ${available} ${product.unit}, requested: ${quantity} ${product.unit}.`,
    );
  }

  return available;
}

export async function assertStockDeductionsAvailable(
  items: Array<{
    productId: string;
    locationId: string;
    warehouseLotId?: string | null;
    quantity: number;
  }>,
  tx: StockDatabase,
): Promise<void> {
  const totals = new Map<string, (typeof items)[number]>();
  for (const item of items) {
    const key = `${item.productId}:${item.locationId}:${item.warehouseLotId ?? ""}`;
    const existing = totals.get(key);
    totals.set(key, {
      ...item,
      quantity: (existing?.quantity ?? 0) + item.quantity,
    });
  }

  for (const item of totals.values()) {
    await assertStockAvailableForDeduction(
      item.productId,
      item.locationId,
      item.quantity,
      tx,
      item.warehouseLotId,
    );
  }
}

export interface LotStockInfo {
  lotId: string | null;
  lotNumber: string;
  description: string | null;
  available: number;
}

export async function getProductStockByLot(
  productId: string,
  locationId: string,
  tx?: StockDatabase,
): Promise<LotStockInfo[]> {
  const db = tx ?? prisma;

  // Find all active lots for this location
  const lots = await db.warehouseLot.findMany({
    where: { locationId, isActive: true },
    orderBy: { lotNumber: "asc" },
  });

  // Calculate stock for each active lot
  const lotResults: LotStockInfo[] = await Promise.all(
    lots.map(async (lot): Promise<LotStockInfo> => {
      const available = await getStockOnHand(productId, locationId, tx, lot.id);
      return {
        lotId: lot.id,
        lotNumber: lot.lotNumber,
        description: lot.description,
        available,
      };
    }),
  );

  // Check if there is unassigned stock (warehouseLotId is null)
  const unassignedStock = await getStockOnHand(productId, locationId, tx, null);
  if (unassignedStock !== 0 || lots.length === 0) {
    lotResults.push({
      lotId: null,
      lotNumber: "Unassigned",
      description: "Stock without lot assignment",
      available: unassignedStock,
    });
  }

  return lotResults;
}

export async function getLotStockOnHand(
  warehouseLotId: string,
  productId?: string,
  tx?: StockDatabase,
): Promise<number> {
  const db = tx ?? prisma;
  const whereClause: Prisma.StockMovementWhereInput = {
    warehouseLotId,
    ...(productId ? { productId } : {}),
  };

  const movements = await db.stockMovement.groupBy({
    by: ["type"],
    where: whereClause,
    _sum: { quantity: true },
  });

  return movements.reduce((total, row) => {
    const qty = Number(row._sum.quantity ?? 0);
    if (row.type === StockMovementType.ADJUSTMENT) {
      return total + qty;
    }
    if (INBOUND.includes(row.type)) return total + qty;
    if (OUTBOUND.includes(row.type)) return total - qty;
    return total;
  }, 0);
}

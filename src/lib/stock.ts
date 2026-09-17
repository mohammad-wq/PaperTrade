import { Prisma, StockMovementType } from "@prisma/client";
import { prisma } from "@/lib/db";

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
  tx?: Prisma.TransactionClient,
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

export interface LotStockInfo {
  lotId: string | null;
  lotNumber: string;
  description: string | null;
  available: number;
}

export async function getProductStockByLot(
  productId: string,
  locationId: string,
  tx?: Prisma.TransactionClient,
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
  tx?: Prisma.TransactionClient,
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

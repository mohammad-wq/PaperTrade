import { StockMovementType } from "@prisma/client";
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

export async function getStockOnHand(productId: string, locationId: string): Promise<number> {
  const movements = await prisma.stockMovement.groupBy({
    by: ["type"],
    where: { productId, locationId },
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

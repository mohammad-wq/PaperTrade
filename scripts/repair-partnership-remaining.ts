/**
 * Recalculate PartnershipLotItem.remainingQuantity as warehouse custody only:
 * initial - pulled to shop - external partner liquidations (not internal POS shop sales).
 */
import { PrismaClient, StockMovementType } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const lots = await prisma.partnershipLot.findMany({
    include: { items: true },
  });
  let updated = 0;

  for (const lot of lots) {
    const movements = await prisma.stockMovement.findMany({
      where: { partnershipLotId: lot.id },
      select: { type: true, productId: true, quantity: true, referenceType: true },
    });

    const externalByProduct = new Map<string, number>();
    for (const a of await prisma.partnershipSaleAllocation.findMany({
      where: { lotId: lot.id, salesChannel: "EXTERNAL_PARTNER" },
      select: { productId: true, quantity: true },
    })) {
      externalByProduct.set(
        a.productId,
        (externalByProduct.get(a.productId) ?? 0) + Number(a.quantity),
      );
    }

    for (const item of lot.items) {
      const pulled = movements
        .filter(
          (m) =>
            m.productId === item.productId &&
            m.type === StockMovementType.TRANSFER_OUT &&
            m.referenceType === "DELIVERY_ORDER",
        )
        .reduce((s, m) => s + Number(m.quantity), 0);

      const external = externalByProduct.get(item.productId) ?? 0;
      const initial = Number(item.initialQuantity);
      const corrected = Math.max(0, initial - pulled - external);
      const current = Number(item.remainingQuantity);

      if (Math.abs(corrected - current) > 0.0001) {
        await prisma.partnershipLotItem.update({
          where: { id: item.id },
          data: { remainingQuantity: corrected },
        });
        updated += 1;
        console.log(
          JSON.stringify({
            lot: lot.lotNumber,
            productId: item.productId,
            from: current,
            to: corrected,
            initial,
            pulled,
            external,
          }),
        );
      }
    }
  }

  console.log(JSON.stringify({ updated }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

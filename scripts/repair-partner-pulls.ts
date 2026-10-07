/**
 * Reclassify historical partnership pulls that landed as unassigned regular stock.
 * Evidence: TRANSFER_IN rows with warehouseLotId null and notes containing partnership lot numbers.
 */
import { PrismaClient } from "@prisma/client";
import { postInflow } from "../src/lib/inventoryCost.service";

const prisma = new PrismaClient();

async function main() {
  const lots = await prisma.partnershipLot.findMany({
    include: { items: true, partner: true },
  });
  let updated = 0;
  let costPosted = 0;

  for (const lot of lots) {
    const outs = await prisma.stockMovement.findMany({
      where: {
        type: "TRANSFER_OUT",
        referenceType: "DELIVERY_ORDER",
        notes: { contains: lot.lotNumber },
      },
      select: { referenceId: true },
    });
    const refs = [...new Set(outs.map((o) => o.referenceId))];
    const pulls = await prisma.stockMovement.findMany({
      where: {
        type: "TRANSFER_IN",
        referenceType: "DELIVERY_ORDER",
        warehouseLotId: null,
        OR: [
          { notes: { contains: lot.lotNumber } },
          ...(refs.length ? [{ referenceId: { in: refs } }] : []),
        ],
      },
    });

    if (!pulls.length) continue;

    const locationId = pulls[0].locationId;
    let shopLot = await prisma.warehouseLot.findFirst({
      where: { locationId, lotNumber: lot.lotNumber },
    });
    if (!shopLot) {
      shopLot = await prisma.warehouseLot.create({
        data: {
          locationId,
          partnerId: lot.partnerId,
          lotNumber: lot.lotNumber,
          description: `Partner stock ${lot.lotNumber} (${lot.partner.name})`,
        },
      });
    } else if (!shopLot.partnerId) {
      shopLot = await prisma.warehouseLot.update({
        where: { id: shopLot.id },
        data: { partnerId: lot.partnerId },
      });
    }

    for (const move of pulls) {
      await prisma.stockMovement.update({
        where: { id: move.id },
        data: {
          warehouseLotId: shopLot.id,
          partnershipLotId: lot.id,
          ownershipType: "LOT",
          ownershipKey: `LOT:${lot.id}`,
        },
      });
      updated += 1;

      const existing = await prisma.costMovement.findFirst({
        where: {
          productId: move.productId,
          locationId: move.locationId,
          ownershipKey: `LOT:${lot.id}`,
          referenceId: { contains: String(move.referenceId) },
        },
      });
      if (existing) continue;

      const lotItem = lot.items.find((it) => it.productId === move.productId);
      const unitCost = Number(lotItem?.unitCostRate ?? 0);
      await prisma.$transaction(async (tx) => {
        await postInflow(tx, {
          productId: move.productId,
          locationId: move.locationId,
          ownership: { ownershipType: "LOT", partnershipLotId: lot.id },
          quantity: Number(move.quantity),
          unitCost,
          movementType: "TRANSFER_IN",
          referenceType: "DELIVERY_ORDER",
          referenceId: `${move.referenceId}:${move.productId}:repair`,
        });
      });
      costPosted += 1;
    }
  }

  console.log(JSON.stringify({ updated, costPosted }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

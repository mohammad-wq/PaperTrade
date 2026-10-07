import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const shop = await prisma.location.findFirst({ where: { type: "SHOP", deletedAt: null } });
  if (!shop) return;
  const lots = await prisma.partnershipLot.findMany({ where: { type: "CO_INVESTED_POOL" } });
  for (const lot of lots) {
    const pct = Math.round(Number(lot.partnerMarginRatio) * 10000) / 100;
    const wh = await prisma.warehouseLot.findFirst({
      where: { locationId: shop.id, lotNumber: lot.lotNumber },
    });
    if (wh) {
      await prisma.warehouseLot.update({
        where: { id: wh.id },
        data: {
          partnerId: lot.partnerId,
          partnerSharePct: pct,
          clientSharePct: Math.max(0, 100 - pct),
        },
      });
      console.log(`updated ${wh.lotNumber} -> ${pct}% partner`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

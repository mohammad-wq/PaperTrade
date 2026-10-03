const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const locCount = await prisma.location.count();
  const partyCount = await prisma.party.count();
  const prodCount = await prisma.product.count();
  const lotCount = await prisma.warehouseLot.count();
  const smCount = await prisma.stockMovement.count();
  const leCount = await prisma.ledgerEntry.count();
  const siCount = await prisma.saleInvoice.count();
  const piCount = await prisma.purchaseInvoice.count();

  console.log({
    locCount,
    partyCount,
    prodCount,
    lotCount,
    smCount,
    leCount,
    siCount,
    piCount,
  });

  const allLots = await prisma.warehouseLot.findMany({ include: { location: true } });
  console.log('Lots:', allLots);

  const allLocations = await prisma.location.findMany();
  console.log('Locations:', allLocations.map(l => l.name));
}

main().catch(console.error).finally(() => prisma.$disconnect());

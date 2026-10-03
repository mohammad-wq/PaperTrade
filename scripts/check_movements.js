const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const movements = await prisma.stockMovement.findMany({
    include: {
      location: true,
      product: true,
      warehouseLot: true,
    }
  });

  console.log(`Total stock movements: ${movements.length}`);
  const partnershipWh = await prisma.location.findFirst({
    where: { name: { contains: "Partnership", mode: "insensitive" } },
    include: { warehouseLots: true },
  });
  console.log('Partnership Warehouse:', partnershipWh ? { id: partnershipWh.id, name: partnershipWh.name, lots: partnershipWh.warehouseLots.map(l => ({ id: l.id, num: l.lotNumber })) } : 'Not found');

  const nullLotPartnership = movements.filter(m => m.location?.name?.toLowerCase().includes("partnership") && !m.warehouseLotId);
  console.log('Null lot movements in Partnership Warehouse:', nullLotPartnership.length);
  for (const m of nullLotPartnership) {
    console.log(`  id=${m.id}, prod=${m.product?.name}, qty=${m.quantity}, type=${m.type}, ref=${m.referenceType}/${m.referenceId}, notes=${m.notes}`);
  }

  const allNegativeNull = movements.filter(m => Number(m.quantity) < 0 && !m.warehouseLotId);
  console.log('All negative null-lot movements across all locations:', allNegativeNull.length);
  for (const m of allNegativeNull) {
    console.log(`  id=${m.id}, loc=${m.location?.name}, prod=${m.product?.name}, qty=${m.quantity}, type=${m.type}, ref=${m.referenceType}/${m.referenceId}, notes=${m.notes}`);
  }

  const allMovementsSummary = movements.map(m => ({
    id: m.id,
    loc: m.location?.name,
    prod: m.product?.name,
    lot: m.warehouseLot?.lotNumber || 'NULL',
    qty: Number(m.quantity),
    type: m.type,
    ref: `${m.referenceType}:${m.referenceId}`,
    notes: m.notes,
  }));
  console.log('All movements summary:');
  console.table(allMovementsSummary);
}

main().catch(console.error).finally(() => prisma.$disconnect());

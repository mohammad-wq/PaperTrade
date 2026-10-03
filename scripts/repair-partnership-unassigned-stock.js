const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.includes("--apply");
  const explicitLotArg = process.argv.find((arg) => arg.startsWith("--lot-id="));
  const explicitLotId = explicitLotArg?.slice("--lot-id=".length);

  const location = await prisma.location.findFirst({
    where: {
      name: { equals: "Partnership Warehouse", mode: "insensitive" },
      type: "WAREHOUSE",
    },
    select: { id: true, name: true },
  });
  if (!location) {
    throw new Error('Could not find the "Partnership Warehouse" location.');
  }

  const [movements, lots] = await Promise.all([
    prisma.stockMovement.findMany({
      where: {
        locationId: location.id,
        warehouseLotId: null,
        quantity: { lt: 0 },
      },
      select: { id: true, productId: true, quantity: true, notes: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.warehouseLot.findMany({
      where: { locationId: location.id, isActive: true, deletedAt: null },
      select: { id: true, lotNumber: true },
    }),
  ]);

  let explicitLot = null;
  if (explicitLotId) {
    explicitLot = lots.find((lot) => lot.id === explicitLotId) || null;
    if (!explicitLot) {
      throw new Error(`Lot ${explicitLotId} is not an active lot in ${location.name}.`);
    }
  }

  const repairs = movements.map((movement) => {
    const noteLot = movement.notes?.match(/\[Lot:\s*([^\]]+)\]/i)?.[1]?.trim();
    const matchedLot = explicitLot || lots.find((lot) => lot.lotNumber === noteLot);
    return { movement, matchedLot };
  });

  console.log(`${location.name}: found ${movements.length} negative unassigned movement(s).`);
  for (const { movement, matchedLot } of repairs) {
    console.log(
      `${movement.id} product=${movement.productId} quantity=${movement.quantity.toString()} lot=${matchedLot?.lotNumber || "UNRESOLVED"}${movement.notes ? ` notes=${movement.notes}` : ""}`,
    );
  }

  const resolvedRepairs = repairs.filter((repair) => repair.matchedLot);
  const unresolvedCount = repairs.length - resolvedRepairs.length;
  if (!apply) {
    console.log(`Dry run only; ${resolvedRepairs.length} movement(s) are safely matchable and ${unresolvedCount} unresolved.`);
    console.log("Use --apply to re-link note-matched lots, or --apply --lot-id=<active-lot-id> only after verifying the intended lot.");
    return;
  }

  await prisma.$transaction(
    resolvedRepairs.map(({ movement, matchedLot }) =>
      prisma.stockMovement.update({
        where: { id: movement.id },
        data: { warehouseLotId: matchedLot.id },
      }),
    ),
  );
  console.log(`Re-linked ${resolvedRepairs.length} movement(s); left ${unresolvedCount} unresolved movement(s) unchanged.`);
}

main()
  .catch((error) => {
    console.error("Partnership stock repair failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

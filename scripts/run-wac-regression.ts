/**
 * WAC + document P&L smoke checks (local dev).
 * Run: npx tsx scripts/run-wac-regression.ts
 */
import { PrismaClient } from "@prisma/client";
import { calculateProfitLoss } from "../src/lib/financial-reports";
import { resolveOwnershipKey } from "../src/lib/inventoryCost.service";

const prisma = new PrismaClient();

async function main() {
  const states = await prisma.productCostState.count();
  const movements = await prisma.costMovement.count();
  const fifoLayers = await prisma.inventoryCostLayer.count({
    where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  });

  const key = resolveOwnershipKey({ ownershipType: "OWN" });
  if (key !== "OWN") throw new Error("resolveOwnershipKey failed");

  const pl = await calculateProfitLoss({});
  if (typeof pl.sales !== "number" || typeof pl.grossProfit !== "number") {
    throw new Error("P&L shape invalid");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        productCostStateRows: states,
        costMovementRows: movements,
        fifoLayersLast24h: fifoLayers,
        pl: {
          netSales: pl.sales,
          grossProfit: pl.grossProfit,
          netProfit: pl.netProfit,
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

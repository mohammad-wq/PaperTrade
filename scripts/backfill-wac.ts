/**
 * Staging-only WAC backfill from InventoryCostLayer (primary) with StockMovement fallback.
 * STOP: Do not run against production without explicit approval and a written report review.
 *
 * Usage: npx tsx scripts/backfill-wac.ts [--dry-run]
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

type BucketKey = string;

function bucketKey(productId: string, locationId: string, ownershipKey: string): BucketKey {
  return `${productId}|${locationId}|${ownershipKey}`;
}

function resolveOwnershipKeyFromLayer(partnershipLotId: string | null): string {
  return partnershipLotId ? `LOT:${partnershipLotId}` : "OWN";
}

async function main() {
  const report = {
    dryRun,
    layersProcessed: 0,
    buckets: 0,
    stockMovementFallbackWarnings: [] as string[],
    negativeQtyBuckets: [] as string[],
    skippedExisting: 0,
  };

  const existingStates = await prisma.productCostState.count();
  if (existingStates > 0 && !dryRun) {
    console.error(
      `ProductCostState already has ${existingStates} rows. Refuse to overwrite. Use --dry-run or truncate staging first.`,
    );
    process.exit(1);
  }

  const layers = await prisma.inventoryCostLayer.findMany({
    where: { remainingQty: { gt: 0 } },
    orderBy: { createdAt: "asc" },
  });

  type Agg = {
    productId: string;
    locationId: string;
    ownershipKey: string;
    ownershipType: string;
    partnershipLotId: string | null;
    quantity: number;
    totalValue: number;
  };

  const agg = new Map<BucketKey, Agg>();

  for (const layer of layers) {
    report.layersProcessed += 1;
    const qty = Number(layer.remainingQty);
    const unit = Number(layer.unitCost);
    const ownershipKey = resolveOwnershipKeyFromLayer(layer.partnershipLotId);
    const key = bucketKey(layer.productId, layer.locationId, ownershipKey);
    const row = agg.get(key) ?? {
      productId: layer.productId,
      locationId: layer.locationId,
      ownershipKey,
      ownershipType: layer.partnershipLotId ? "LOT" : "OWN",
      partnershipLotId: layer.partnershipLotId,
      quantity: 0,
      totalValue: 0,
    };
    row.quantity += qty;
    row.totalValue += qty * unit;
    agg.set(key, row);
  }

  if (agg.size === 0) {
    const movements = await prisma.stockMovement.groupBy({
      by: ["productId", "locationId", "partnershipLotId"],
      _sum: { quantity: true },
    });

    for (const m of movements) {
      const sum = Number(m._sum.quantity ?? 0);
      if (Math.abs(sum) < 0.0001) continue;
      const ownershipKey = resolveOwnershipKeyFromLayer(m.partnershipLotId);
      const key = bucketKey(m.productId, m.locationId, ownershipKey);
      if (agg.has(key)) continue;
      report.stockMovementFallbackWarnings.push(
        `Fallback bucket ${key} from StockMovement net qty ${sum} (no cost — review manually).`,
      );
      agg.set(key, {
        productId: m.productId,
        locationId: m.locationId,
        ownershipKey,
        ownershipType: m.partnershipLotId ? "LOT" : "OWN",
        partnershipLotId: m.partnershipLotId,
        quantity: sum,
        totalValue: 0,
      });
    }
  }

  report.buckets = agg.size;

  for (const row of agg.values()) {
    const avgCost = row.quantity !== 0 ? row.totalValue / row.quantity : 0;
    if (row.quantity < 0) {
      report.negativeQtyBuckets.push(bucketKey(row.productId, row.locationId, row.ownershipKey));
    }

    if (dryRun) continue;

    await prisma.$transaction(async (tx) => {
      await tx.productCostState.create({
        data: {
          productId: row.productId,
          locationId: row.locationId,
          ownershipType: row.ownershipType,
          partnershipLotId: row.partnershipLotId,
          ownershipKey: row.ownershipKey,
          quantity: row.quantity,
          avgCost,
          totalValue: row.quantity * avgCost,
          hasNegativeStock: row.quantity < 0,
        },
      });

      await tx.costMovement.create({
        data: {
          productId: row.productId,
          locationId: row.locationId,
          ownershipKey: row.ownershipKey,
          movementType: "OPENING",
          referenceType: "WAC_BACKFILL",
          referenceId: `backfill:${row.productId}:${row.locationId}:${row.ownershipKey}`,
          qtyBefore: 0,
          avgBefore: 0,
          qtyDelta: row.quantity,
          unitCost: avgCost,
          totalCost: row.quantity * avgCost,
          qtyAfter: row.quantity,
          avgAfter: avgCost,
        },
      });
    });
  }

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { userError } from "@/lib/errors";

type DatabaseClient = Prisma.TransactionClient | PrismaClient;

export type CostLayerConsumption = {
  layerId: string;
  sourceType: string;
  sourceId: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
};

export type ConsumptionResult = {
  totalCOGS: number;
  averageUnitCost: number;
  allocations: CostLayerConsumption[];
  consumedQty: number;
};

/**
 * Record a new inventory cost layer (FIFO queue).
 * Triggered on Opening Stock, Purchase Invoices, and Inward Transfers.
 */
export async function recordCostLayer(
  params: {
    productId: string;
    locationId: string;
    warehouseLotId?: string | null;
    partnershipLotId?: string | null;
    sourceType: "OPENING_STOCK" | "PURCHASE" | "TRANSFER" | "ADJUSTMENT";
    sourceId: string;
    unitCost: number;
    quantity: number;
    createdAt?: Date;
  },
  tx: DatabaseClient,
) {
  const qty = Number(params.quantity);
  const cost = Number(params.unitCost);

  // Validation rules (Constraint 11)
  if (!Number.isFinite(qty) || qty <= 0) {
    throw userError("Cost layer quantity must be greater than zero.");
  }
  if (!Number.isFinite(cost) || cost < 0) {
    throw userError("Cost layer unit cost cannot be negative.");
  }

  const layer = await (tx as any).inventoryCostLayer.create({
    data: {
      productId: params.productId,
      locationId: params.locationId,
      warehouseLotId: params.warehouseLotId || null,
      partnershipLotId: params.partnershipLotId || null,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      unitCost: new Prisma.Decimal(cost),
      initialQty: new Prisma.Decimal(qty),
      remainingQty: new Prisma.Decimal(qty),
      ...(params.createdAt ? { createdAt: params.createdAt } : {}),
    },
  });

  return layer;
}

/**
 * Consume cost layers strictly in FIFO order (earliest createdAt first, deterministic secondary sort on id).
 * Validates that remainingQty never becomes negative and cannot exceed initialQty.
 * Throws userError if available cost layer quantity is less than requested quantity.
 */
export async function consumeCostLayersFIFO(
  params: {
    productId: string;
    locationId: string;
    warehouseLotId?: string | null;
    quantity: number;
    allowFallback?: boolean;
    fallbackUnitCost?: number;
    referenceType?: string;
    referenceId?: string;
  },
  tx: Prisma.TransactionClient,
): Promise<ConsumptionResult> {
  const requestedQty = Number(params.quantity);

  if (!Number.isFinite(requestedQty) || requestedQty <= 0) {
    throw userError("Requested consumption quantity must be greater than zero.");
  }

  // 1. Fetch available layers with deterministic ordering (createdAt ASC, id ASC)
  // Utilizing row-level locking (SELECT ... FOR UPDATE) in PostgreSQL to prevent concurrent race conditions
  let availableLayers: Array<{
    id: string;
    productId: string;
    locationId: string;
    warehouseLotId: string | null;
    sourceType: string;
    sourceId: string;
    unitCost: any;
    initialQty: any;
    remainingQty: any;
    createdAt: Date;
  }>;

  try {
    if (params.warehouseLotId) {
      availableLayers = await tx.$queryRaw`
        SELECT id, "productId", "locationId", "warehouseLotId", "sourceType", "sourceId", "unitCost", "initialQty", "remainingQty", "createdAt"
        FROM "InventoryCostLayer"
        WHERE "productId" = ${params.productId}
          AND "locationId" = ${params.locationId}
          AND "warehouseLotId" = ${params.warehouseLotId}
          AND "remainingQty" > 0
        ORDER BY "createdAt" ASC, "id" ASC
        FOR UPDATE
      `;
    } else if (params.warehouseLotId === null) {
      availableLayers = await tx.$queryRaw`
        SELECT id, "productId", "locationId", "warehouseLotId", "sourceType", "sourceId", "unitCost", "initialQty", "remainingQty", "createdAt"
        FROM "InventoryCostLayer"
        WHERE "productId" = ${params.productId}
          AND "locationId" = ${params.locationId}
          AND "warehouseLotId" IS NULL
          AND "remainingQty" > 0
        ORDER BY "createdAt" ASC, "id" ASC
        FOR UPDATE
      `;
    } else {
      availableLayers = await tx.$queryRaw`
        SELECT id, "productId", "locationId", "warehouseLotId", "sourceType", "sourceId", "unitCost", "initialQty", "remainingQty", "createdAt"
        FROM "InventoryCostLayer"
        WHERE "productId" = ${params.productId}
          AND "locationId" = ${params.locationId}
          AND "remainingQty" > 0
        ORDER BY "createdAt" ASC, "id" ASC
        FOR UPDATE
      `;
    }
  } catch {
    // Fallback if queryRaw is mocked or in non-raw environment
    const whereClause: Prisma.InventoryCostLayerWhereInput = {
      productId: params.productId,
      locationId: params.locationId,
      remainingQty: { gt: 0 },
    };
    if (params.warehouseLotId) {
      whereClause.warehouseLotId = params.warehouseLotId;
    } else if (params.warehouseLotId === null) {
      whereClause.warehouseLotId = null;
    }
    availableLayers = await tx.inventoryCostLayer.findMany({
      where: whereClause,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  }

  const totalAvailableInLayers = availableLayers.reduce(
    (sum, l) => sum + Number(l.remainingQty),
    0
  );

  // Constraint 11: FIFO consumption cannot exceed available cost-layer quantity unless explicitly allowed
  if (totalAvailableInLayers < requestedQty && !params.allowFallback) {
    throw userError(
      `Insufficient cost-layer stock for product. Available in cost layers: ${totalAvailableInLayers}, requested: ${requestedQty}.`,
    );
  }

  let remainingNeeded = requestedQty;
  let totalCOGS = 0;
  const allocations: CostLayerConsumption[] = [];

  for (const layer of availableLayers) {
    if (remainingNeeded <= 0.00001) break;

    const layerRemaining = Number(layer.remainingQty);
    const initialQty = Number(layer.initialQty);
    const take = Math.min(layerRemaining, remainingNeeded);
    const unitCost = Number(layer.unitCost);
    const lineCost = take * unitCost;

    totalCOGS += lineCost;
    remainingNeeded -= take;

    allocations.push({
      layerId: layer.id,
      sourceType: layer.sourceType,
      sourceId: layer.sourceId,
      quantity: take,
      unitCost,
      totalCost: lineCost,
    });

    const newRemaining = layerRemaining - take;

    // Constraint 11 invariants:
    if (newRemaining < 0) {
      throw userError(`Cost layer ${layer.id} remainingQty cannot become negative.`);
    }
    if (newRemaining > initialQty) {
      throw userError(`Cost layer ${layer.id} remainingQty cannot exceed initialQty.`);
    }

    // Atomic update
    await tx.inventoryCostLayer.update({
      where: { id: layer.id },
      data: { remainingQty: new Prisma.Decimal(newRemaining) },
    });

    if (params.referenceType && params.referenceId) {
      await tx.inventoryCostLayerConsumption.create({
        data: {
          layerId: layer.id,
          productId: params.productId,
          locationId: params.locationId,
          warehouseLotId: params.warehouseLotId ?? null,
          quantity: new Prisma.Decimal(take),
          unitCost: new Prisma.Decimal(unitCost),
          referenceType: params.referenceType,
          referenceId: params.referenceId,
        },
      });
    }
  }

  // If allowFallback is true and there is still remaining needed, fallback to product cost price
  if (remainingNeeded > 0.00001 && params.allowFallback) {
    let fallbackCost = params.fallbackUnitCost;
    if (fallbackCost === undefined || fallbackCost === null) {
      const prod = await tx.product.findUnique({
        where: { id: params.productId },
        select: { costPrice: true },
      });
      fallbackCost = Number(prod?.costPrice || 0);
    }

    const unlayeredCost = remainingNeeded * fallbackCost;
    totalCOGS += unlayeredCost;

    allocations.push({
      layerId: "FALLBACK_BASE_COST",
      sourceType: "PRODUCT_BASE_COST",
      sourceId: params.productId,
      quantity: remainingNeeded,
      unitCost: fallbackCost,
      totalCost: unlayeredCost,
    });
  }

  const averageUnitCost = requestedQty > 0 ? totalCOGS / requestedQty : 0;

  return {
    totalCOGS,
    averageUnitCost,
    allocations,
    consumedQty: requestedQty,
  };
}

/**
 * Handle transfers between locations or lots preserving FIFO cost layers.
 * Consumes cost layers at source location, and creates corresponding cost layers at destination location.
 */
export async function transferCostLayersFIFO(
  params: {
    productId: string;
    fromLocationId: string;
    fromWarehouseLotId?: string | null;
    toLocationId: string;
    toWarehouseLotId?: string | null;
    quantity: number;
    referenceId: string;
  },
  tx: Prisma.TransactionClient,
) {
  // 1. Consume from source location via FIFO
  const consumption = await consumeCostLayersFIFO(
    {
      productId: params.productId,
      locationId: params.fromLocationId,
      warehouseLotId: params.fromWarehouseLotId,
      quantity: params.quantity,
      allowFallback: false,
      referenceType: "TRANSFER",
      referenceId: params.referenceId,
    },
    tx,
  );

  // 2. Ingest into destination location preserving the exact unit costs of each consumed chunk
  const createdLayers = [];
  for (const chunk of consumption.allocations) {
    const layer = await recordCostLayer(
      {
        productId: params.productId,
        locationId: params.toLocationId,
        warehouseLotId: params.toWarehouseLotId || null,
        sourceType: "TRANSFER",
        sourceId: params.referenceId,
        unitCost: chunk.unitCost,
        quantity: chunk.quantity,
      },
      tx,
    );
    createdLayers.push(layer);
  }

  return {
    consumption,
    createdLayers,
  };
}

/**
 * Audit / inspection helper:
 * Calculates total remaining cost-layer quantity and total valuation for a product at a location.
 */
export async function getCostLayerBalance(
  productId: string,
  locationId?: string,
  warehouseLotId?: string | null,
  tx?: DatabaseClient,
) {
  const db = tx ?? prisma;
  const whereClause: Prisma.InventoryCostLayerWhereInput = {
    productId,
    remainingQty: { gt: 0 },
  };

  if (locationId) whereClause.locationId = locationId;
  if (warehouseLotId !== undefined) whereClause.warehouseLotId = warehouseLotId;

  const layers = await db.inventoryCostLayer.findMany({
    where: whereClause,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const totalQuantity = layers.reduce((sum, l) => sum + Number(l.remainingQty), 0);
  const totalValuation = layers.reduce(
    (sum, l) => sum + Number(l.remainingQty) * Number(l.unitCost),
    0
  );

  return {
    totalQuantity,
    totalValuation,
    layers: layers.map((l) => ({
      id: l.id,
      locationId: l.locationId,
      warehouseLotId: l.warehouseLotId,
      sourceType: l.sourceType,
      sourceId: l.sourceId,
      unitCost: Number(l.unitCost),
      initialQty: Number(l.initialQty),
      remainingQty: Number(l.remainingQty),
      createdAt: l.createdAt,
    })),
  };
}

/** Remove cost layers created from a source document (e.g. purchase invoice). */
export async function deleteCostLayersBySource(
  sourceType: string,
  sourceId: string,
  tx: Prisma.TransactionClient,
) {
  const layers = await tx.inventoryCostLayer.findMany({
    where: { sourceType, sourceId },
    select: { id: true, remainingQty: true, initialQty: true },
  });
  for (const layer of layers) {
    const remaining = Number(layer.remainingQty);
    const initial = Number(layer.initialQty);
    if (remaining < initial - 0.0001) {
      throw userError(
        `Cannot remove cost layers for ${sourceType}/${sourceId}: layer ${layer.id} has partially consumed quantity.`,
      );
    }
  }
  await tx.inventoryCostLayer.deleteMany({ where: { sourceType, sourceId } });
}

/** Restore layer quantities previously consumed under a reference (sale edit/delete). */
export async function restoreCostLayersByReference(
  referenceType: string,
  referenceId: string,
  tx: Prisma.TransactionClient,
) {
  const rows = await tx.inventoryCostLayerConsumption.findMany({
    where: { referenceType, referenceId },
    orderBy: { createdAt: "desc" },
  });

  for (const row of rows) {
    const qty = Number(row.quantity);
    const layer = await tx.inventoryCostLayer.findUnique({ where: { id: row.layerId } });
    if (!layer) continue;
    const newRemaining = Number(layer.remainingQty) + qty;
    const initial = Number(layer.initialQty);
    if (newRemaining > initial + 0.0001) {
      throw userError(`Restore would exceed initial quantity on layer ${layer.id}.`);
    }
    await tx.inventoryCostLayer.update({
      where: { id: layer.id },
      data: { remainingQty: new Prisma.Decimal(newRemaining) },
    });
  }

  await tx.inventoryCostLayerConsumption.deleteMany({
    where: { referenceType, referenceId },
  });
}

/** Remove TRANSFER destination layers created for a transfer reference. */
export async function deleteTransferDestinationLayers(
  referenceId: string,
  tx: Prisma.TransactionClient,
) {
  await deleteCostLayersBySource("TRANSFER", referenceId, tx);
}

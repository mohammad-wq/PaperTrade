import { Prisma } from "@prisma/client";
import { userError } from "@/lib/errors";

export class InsufficientStockError extends Error {
  constructor(
    message: string,
    public readonly productId: string,
    public readonly locationId: string,
    public readonly ownershipKey: string,
    public readonly requested: number,
    public readonly available: number,
  ) {
    super(message);
    this.name = "InsufficientStockError";
  }
}

export type OwnershipInput = {
  ownershipType: string;
  partnershipLotId?: string | null;
};

export type CostMovementType =
  | "OPENING"
  | "PURCHASE"
  | "SALE"
  | "TRANSFER_IN"
  | "TRANSFER_OUT"
  | "ADJUSTMENT_IN"
  | "ADJUSTMENT_OUT"
  | "RETURN_IN"
  | "RETURN_OUT"
  | "PARTNER_SALE"
  | "REVERSAL";

const QTY_SCALE = 4;
const VALUE_TOLERANCE = 0.01;

function round4(n: number): number {
  return Math.round(n * 10 ** QTY_SCALE) / 10 ** QTY_SCALE;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function resolveOwnershipKey(input: OwnershipInput): string {
  const type = (input.ownershipType ?? "").toUpperCase();
  if (type === "OWN" || type === "ENTITY" || type === "OWNED") {
    return "OWN";
  }
  if (type === "LOT" || type === "PARTNERSHIP" || type === "PARTNERSHIP_LOT") {
    const lotId = input.partnershipLotId?.trim();
    if (!lotId) {
      throw userError("Partnership lot is required for lot-owned stock.");
    }
    return `LOT:${lotId}`;
  }
  throw userError(`Unknown ownership type: ${input.ownershipType}`);
}

export async function resolveSaleOwnership(
  tx: Prisma.TransactionClient,
  params: {
    productId: string;
    locationId: string;
    lotId?: string | null;
    warehouseLotId?: string | null;
    ownershipType?: string | null;
    ownershipKey?: string | null;
    partnershipLotId?: string | null;
  },
): Promise<OwnershipInput> {
  if (params.partnershipLotId) {
    return { ownershipType: "LOT", partnershipLotId: params.partnershipLotId };
  }
  if (params.ownershipType?.trim() && params.ownershipKey?.trim()) {
    const key = params.ownershipKey.trim();
    if (key === "OWN") {
      return { ownershipType: "OWN" };
    }
    if (key.startsWith("LOT:")) {
      return { ownershipType: "LOT", partnershipLotId: key.slice(4) };
    }
    throw userError(`Invalid ownership key: ${key}`);
  }

  if (params.lotId) {
    return { ownershipType: "LOT", partnershipLotId: params.lotId };
  }

  const fromWarehouse = await resolvePurchaseOwnership(tx, {
    warehouseLotId: params.warehouseLotId,
  });
  if (fromWarehouse.ownershipType === "LOT") {
    return fromWarehouse;
  }

  const buckets = await tx.productCostState.findMany({
    where: {
      productId: params.productId,
      locationId: params.locationId,
      quantity: { gt: 0 },
    },
    select: { ownershipKey: true },
  });
  const keys = [...new Set(buckets.map((b) => b.ownershipKey))];
  if (keys.length > 1) {
    throw userError(
      "Multiple ownership buckets hold this product at this location. Select an ownership bucket on the line.",
    );
  }
  if (keys.length === 1 && keys[0] !== "OWN") {
    const parsed = ownershipTypeFromKey(keys[0]);
    return { ownershipType: parsed.ownershipType, partnershipLotId: parsed.partnershipLotId };
  }

  return { ownershipType: "OWN" };
}

export async function resolvePurchaseOwnership(
  tx: Prisma.TransactionClient,
  params: {
    warehouseLotId?: string | null;
    partnershipLotId?: string | null;
  },
): Promise<OwnershipInput> {
  if (params.partnershipLotId) {
    return { ownershipType: "LOT", partnershipLotId: params.partnershipLotId };
  }
  if (params.warehouseLotId) {
    const linked = await tx.partnershipLot.findFirst({
      where: { warehouseLotId: params.warehouseLotId },
      select: { id: true },
    });
    if (linked) {
      return { ownershipType: "LOT", partnershipLotId: linked.id };
    }
    const warehouseLot = await tx.warehouseLot.findUnique({
      where: { id: params.warehouseLotId },
      select: { partnerId: true, lotNumber: true },
    });
    if (warehouseLot?.partnerId) {
      const byPartner = await tx.partnershipLot.findFirst({
        where: { partnerId: warehouseLot.partnerId, lotNumber: warehouseLot.lotNumber },
        select: { id: true },
      });
      if (byPartner) {
        return { ownershipType: "LOT", partnershipLotId: byPartner.id };
      }
    }
  }
  return { ownershipType: "OWN" };
}

export function ownershipTypeFromKey(ownershipKey: string): {
  ownershipType: string;
  partnershipLotId: string | null;
} {
  if (ownershipKey === "OWN") {
    return { ownershipType: "OWN", partnershipLotId: null };
  }
  if (ownershipKey.startsWith("LOT:")) {
    return { ownershipType: "LOT", partnershipLotId: ownershipKey.slice(4) };
  }
  throw userError(`Invalid ownership key: ${ownershipKey}`);
}

type StateRow = {
  quantity: number;
  avgCost: number;
  totalValue: number;
  hasNegativeStock: boolean;
};

function emptyState(): StateRow {
  return { quantity: 0, avgCost: 0, totalValue: 0, hasNegativeStock: false };
}

async function loadOrCreateState(
  tx: Prisma.TransactionClient,
  productId: string,
  locationId: string,
  ownershipKey: string,
): Promise<{ id: string | null; state: StateRow }> {
  const { ownershipType, partnershipLotId } = ownershipTypeFromKey(ownershipKey);
  const row = await tx.productCostState.findUnique({
    where: {
      productId_locationId_ownershipKey: { productId, locationId, ownershipKey },
    },
  });

  if (!row) {
    return { id: null, state: emptyState() };
  }

  return {
    id: row.id,
    state: {
      quantity: Number(row.quantity),
      avgCost: Number(row.avgCost),
      totalValue: Number(row.totalValue),
      hasNegativeStock: row.hasNegativeStock,
    },
  };
}

async function persistState(
  tx: Prisma.TransactionClient,
  params: {
    productId: string;
    locationId: string;
    ownershipKey: string;
    stateId: string | null;
    state: StateRow;
  },
): Promise<void> {
  const { ownershipType, partnershipLotId } = ownershipTypeFromKey(params.ownershipKey);
  const qty = round4(params.state.quantity);
  const avg = round4(params.state.avgCost);
  const totalValue = roundMoney(qty * avg);

  const data = {
    quantity: qty,
    avgCost: avg,
    totalValue,
    hasNegativeStock: params.state.hasNegativeStock,
    ownershipType,
    partnershipLotId,
    ownershipKey: params.ownershipKey,
  };

  if (params.stateId) {
    await tx.productCostState.update({
      where: { id: params.stateId },
      data,
    });
  } else {
    await tx.productCostState.create({
      data: {
        productId: params.productId,
        locationId: params.locationId,
        ...data,
      },
    });
  }
}

async function appendMovement(
  tx: Prisma.TransactionClient,
  params: {
    productId: string;
    locationId: string;
    ownershipKey: string;
    movementType: CostMovementType;
    referenceType: string;
    referenceId: string;
    qtyBefore: number;
    avgBefore: number;
    qtyDelta: number;
    unitCost: number;
    totalCost: number;
    qtyAfter: number;
    avgAfter: number;
  },
): Promise<void> {
  await tx.costMovement.create({
    data: {
      productId: params.productId,
      locationId: params.locationId,
      ownershipKey: params.ownershipKey,
      movementType: params.movementType,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      qtyBefore: round4(params.qtyBefore),
      avgBefore: round4(params.avgBefore),
      qtyDelta: round4(params.qtyDelta),
      unitCost: round4(params.unitCost),
      totalCost: roundMoney(params.totalCost),
      qtyAfter: round4(params.qtyAfter),
      avgAfter: round4(params.avgAfter),
    },
  });
}

export async function sumProductCostStateValuation(
  tx: Prisma.TransactionClient,
  asOf?: Date,
): Promise<{ totalValue: number; totalQuantity: number }> {
  void asOf;
  const agg = await tx.productCostState.aggregate({
    _sum: { totalValue: true, quantity: true },
  });
  return {
    totalValue: Number(agg._sum.totalValue ?? 0),
    totalQuantity: Number(agg._sum.quantity ?? 0),
  };
}

export function partnershipArchetypeFromLot(lot: {
  archetype?: string | null;
  type?: string | null;
}): "CONSIGNMENT" | "CO_INVESTED" {
  if (lot.archetype === "CONSIGNMENT" || lot.type === "CONSIGNMENT_VMI") {
    return "CONSIGNMENT";
  }
  return "CO_INVESTED";
}

export async function getProductCostState(
  tx: Prisma.TransactionClient,
  productId: string,
  locationId: string,
  ownershipKey: string,
): Promise<{ quantity: number; avgCost: number; totalValue: number }> {
  const loaded = await loadOrCreateState(tx, productId, locationId, ownershipKey);
  return {
    quantity: loaded.state.quantity,
    avgCost: loaded.state.avgCost,
    totalValue: roundMoney(loaded.state.quantity * loaded.state.avgCost),
  };
}

export async function postInflow(
  tx: Prisma.TransactionClient,
  params: {
    productId: string;
    locationId: string;
    ownership: OwnershipInput;
    quantity: number;
    unitCost: number;
    movementType: CostMovementType;
    referenceType: string;
    referenceId: string;
  },
): Promise<{ avgCost: number; totalValue: number }> {
  const qtyIn = round4(params.quantity);
  const unitCost = round4(params.unitCost);
  if (qtyIn <= 0) {
    throw userError("Inflow quantity must be positive.");
  }
  if (unitCost < 0) {
    throw userError("Unit cost cannot be negative.");
  }

  const ownershipKey = resolveOwnershipKey(params.ownership);
  const loaded = await loadOrCreateState(tx, params.productId, params.locationId, ownershipKey);
  const before = loaded.state;
  const qtyBefore = before.quantity;
  const avgBefore = before.avgCost;

  const inflowValue = roundMoney(qtyIn * unitCost);
  const qtyAfter = round4(qtyBefore + qtyIn);
  let avgAfter = avgBefore;
  if (qtyAfter > 0) {
    const totalValueBefore = roundMoney(qtyBefore * avgBefore);
    avgAfter = round4((totalValueBefore + inflowValue) / qtyAfter);
  } else {
    avgAfter = unitCost;
  }

  const after: StateRow = {
    quantity: qtyAfter,
    avgCost: avgAfter,
    totalValue: roundMoney(qtyAfter * avgAfter),
    hasNegativeStock: false,
  };

  await appendMovement(tx, {
    productId: params.productId,
    locationId: params.locationId,
    ownershipKey,
    movementType: params.movementType,
    referenceType: params.referenceType,
    referenceId: params.referenceId,
    qtyBefore,
    avgBefore,
    qtyDelta: qtyIn,
    unitCost,
    totalCost: inflowValue,
    qtyAfter: after.quantity,
    avgAfter: after.avgCost,
  });

  await persistState(tx, {
    productId: params.productId,
    locationId: params.locationId,
    ownershipKey,
    stateId: loaded.id,
    state: after,
  });

  return { avgCost: after.avgCost, totalValue: after.totalValue };
}

export async function postOutflow(
  tx: Prisma.TransactionClient,
  params: {
    productId: string;
    locationId: string;
    ownership: OwnershipInput;
    quantity: number;
    movementType: CostMovementType;
    referenceType: string;
    referenceId: string;
    allowNegative?: boolean;
  },
): Promise<{ unitCost: number; totalCost: number }> {
  const qtyOut = round4(params.quantity);
  if (qtyOut <= 0) {
    throw userError("Outflow quantity must be positive.");
  }

  const ownershipKey = resolveOwnershipKey(params.ownership);
  const loaded = await loadOrCreateState(tx, params.productId, params.locationId, ownershipKey);
  const before = loaded.state;
  const qtyBefore = before.quantity;
  const avgBefore = before.avgCost;

  if (qtyBefore < qtyOut && !params.allowNegative) {
    throw new InsufficientStockError(
      `Insufficient stock for product at location (bucket ${ownershipKey}).`,
      params.productId,
      params.locationId,
      ownershipKey,
      qtyOut,
      qtyBefore,
    );
  }

  const unitCost = avgBefore;
  const totalCost = roundMoney(qtyOut * unitCost);
  const qtyAfter = round4(qtyBefore - qtyOut);
  const avgAfter = avgBefore;
  const hasNegative = qtyAfter < -VALUE_TOLERANCE;

  if (hasNegative && !params.allowNegative) {
    throw new InsufficientStockError(
      `Insufficient stock for product at location (bucket ${ownershipKey}).`,
      params.productId,
      params.locationId,
      ownershipKey,
      qtyOut,
      qtyBefore,
    );
  }

  const after: StateRow = {
    quantity: qtyAfter,
    avgCost: avgAfter,
    totalValue: roundMoney(qtyAfter * avgAfter),
    hasNegativeStock: hasNegative,
  };

  await appendMovement(tx, {
    productId: params.productId,
    locationId: params.locationId,
    ownershipKey,
    movementType: params.movementType,
    referenceType: params.referenceType,
    referenceId: params.referenceId,
    qtyBefore,
    avgBefore,
    qtyDelta: -qtyOut,
    unitCost,
    totalCost,
    qtyAfter: after.quantity,
    avgAfter: after.avgCost,
  });

  await persistState(tx, {
    productId: params.productId,
    locationId: params.locationId,
    ownershipKey,
    stateId: loaded.id,
    state: after,
  });

  return { unitCost, totalCost };
}

export async function postTransfer(
  tx: Prisma.TransactionClient,
  params: {
    productId: string;
    fromLocationId: string;
    toLocationId: string;
    ownership: OwnershipInput;
    quantity: number;
    referenceType: string;
    referenceId: string;
  },
): Promise<void> {
  const ownershipKey = resolveOwnershipKey(params.ownership);
  const { unitCost } = await postOutflow(tx, {
    productId: params.productId,
    locationId: params.fromLocationId,
    ownership: params.ownership,
    quantity: params.quantity,
    movementType: "TRANSFER_OUT",
    referenceType: params.referenceType,
    referenceId: params.referenceId,
  });

  await postInflow(tx, {
    productId: params.productId,
    locationId: params.toLocationId,
    ownership: params.ownership,
    quantity: params.quantity,
    unitCost,
    movementType: "TRANSFER_IN",
    referenceType: params.referenceType,
    referenceId: params.referenceId,
  });
}

export async function reverseMovementsByReferencePrefix(
  tx: Prisma.TransactionClient,
  referenceType: string,
  referenceIdPrefix: string,
): Promise<void> {
  const refs = await tx.costMovement.findMany({
    where: {
      referenceType,
      referenceId: { startsWith: referenceIdPrefix },
    },
    select: { referenceId: true },
    distinct: ["referenceId"],
  });

  for (const row of refs) {
    await reverseMovement(tx, referenceType, row.referenceId);
  }
}

export async function reverseMovement(
  tx: Prisma.TransactionClient,
  referenceType: string,
  referenceId: string,
): Promise<void> {
  const originals = await tx.costMovement.findMany({
    where: { referenceType, referenceId },
    orderBy: { createdAt: "asc" },
  });

  if (!originals.length) {
    return;
  }

  const alreadyReversed = await tx.costMovement.count({
    where: {
      referenceType,
      referenceId,
      movementType: "REVERSAL",
    },
  });
  if (alreadyReversed > 0) {
    return;
  }

  for (const row of originals) {
    const qtyDelta = Number(row.qtyDelta);
    const unitCost = Number(row.unitCost);
    const ownershipKey = row.ownershipKey;
    const { ownershipType, partnershipLotId } = ownershipTypeFromKey(ownershipKey);
    const ownership: OwnershipInput = {
      ownershipType,
      partnershipLotId,
    };

    if (qtyDelta > 0) {
      await postOutflow(tx, {
        productId: row.productId,
        locationId: row.locationId,
        ownership,
        quantity: qtyDelta,
        movementType: "REVERSAL",
        referenceType,
        referenceId: `${referenceId}:rev:${row.id}`,
        allowNegative: true,
      });
    } else if (qtyDelta < 0) {
      await postInflow(tx, {
        productId: row.productId,
        locationId: row.locationId,
        ownership,
        quantity: -qtyDelta,
        unitCost,
        movementType: "REVERSAL",
        referenceType,
        referenceId: `${referenceId}:rev:${row.id}`,
      });
    }
  }
}

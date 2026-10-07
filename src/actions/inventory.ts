"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { runAction, parseInput } from "@/actions/_helpers";
import { requireSession } from "@/lib/auth/session";
import { userError } from "@/lib/errors";
import { StockMovementType, AccountType, LedgerAccountSubtype } from "@prisma/client";
import { postJournal } from "@/lib/ledger";
import { assertStockDeductionsAvailable, getNonPartnershipOnHand, getStockOnHand } from "@/lib/stock";
import { generateDocumentNumber, withResourceQueue } from "@/lib/concurrency";
import { emitRealtimeEvent } from "@/lib/realtime";
import { revalidatePath } from "next/cache";
import { canPerformAction } from "@/lib/auth/permissions";
import {
  stockAdjustmentSchema,
  bulkStockAdjustmentSchema,
  stockTransferSchema,
} from "@/schemas/inventory";
import {
  postInflow,
  postOutflow,
  postTransfer,
  reverseMovement,
  resolveOwnershipKey,
  resolvePurchaseOwnership,
  resolveSaleOwnership,
  ownershipTypeFromKey,
  getProductCostState,
} from "@/lib/inventoryCost.service";
import { isPartnershipTagLot, loadPartnershipTagIndex } from "@/lib/location-lots";

async function ownershipForLine(
  tx: Parameters<typeof getProductCostState>[0],
  productId: string,
  locationId: string,
  ownershipKey?: string | null,
) {
  if (ownershipKey) {
    const parsed = ownershipTypeFromKey(ownershipKey);
    return parsed.ownershipType === "LOT"
      ? { ownershipType: "LOT" as const, partnershipLotId: parsed.partnershipLotId }
      : { ownershipType: "OWN" as const, partnershipLotId: null as string | null };
  }
  const resolved = await resolveSaleOwnership(tx, { productId, locationId });
  return {
    ownershipType: resolved.ownershipType === "LOT" ? ("LOT" as const) : ("OWN" as const),
    partnershipLotId: resolved.partnershipLotId ?? null,
  };
}

/**
 * Adjust stock for a single product with CPA-grade double entry posting:
 * If adjusted upward (IN):
 *   Debit: Inventory on Hand (Asset)
 *   Credit: Opening Stock Equity / Inventory Valuation Reserve
 */
export async function adjustStockAction(raw: unknown) {
  return runAction("inventory.adjust", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "inventory", "update", (session.user as any).permissions)) {
      throw userError("You do not have permission to adjust inventory stock.");
    }
    const input = parseInput(stockAdjustmentSchema, raw);

    const location = await prisma.location.findUnique({
      where: { id: input.locationId },
      include: {
        warehouseLots: {
          where: { isActive: true, deletedAt: null },
        },
      },
    });
    if (!location) throw userError("Location not found.");

    const tagIndex = await loadPartnershipTagIndex();
    const physicalLots = location.warehouseLots.filter((lot) => !isPartnershipTagLot(lot, tagIndex));
    if (input.warehouseLotId) {
      const lot = physicalLots.find((l) => l.id === input.warehouseLotId);
      if (!lot) throw userError("Selected lot does not exist in this location.");
    } else if (physicalLots.length > 0) {
      throw userError(`Select a specific lot before adjusting stock at ${location.name}.`);
    }

    const lockKeys = [`stock:${input.productId}:${input.locationId}`];

    const res = await withResourceQueue(lockKeys, async (tx) => {
      const currentStock = await getStockOnHand(
        input.productId,
        input.locationId,
        tx,
        input.warehouseLotId ? input.warehouseLotId : null,
      );
      const desired = input.direction === "OUT" ? currentStock - input.quantity : currentStock + input.quantity;

      if (input.direction === "OUT") {
        await assertStockDeductionsAvailable(
          [{
            productId: input.productId,
            locationId: input.locationId,
            warehouseLotId: input.warehouseLotId,
            quantity: input.quantity,
          }],
          tx,
        );
      }

      const movementType = "ADJUSTMENT";
      const referenceId = generateDocumentNumber("ADJ");
      await tx.stockMovement.create({
        data: {
          productId: input.productId,
          locationId: input.locationId,
          warehouseLotId: input.warehouseLotId || null,
          type: movementType,
          quantity: input.direction === "IN" ? input.quantity : -input.quantity,
          referenceType: "ADJUSTMENT",
          referenceId,
          createdById: session.user.id,
          notes: input.reason,
        },
      });

      // Post double entry for opening balances / upward stock adjustments
      if (input.direction === "IN") {
        const prod = await tx.product.findUnique({
          where: { id: input.productId },
          select: { name: true, productNo: true, costPrice: true },
        });
        const unitCostRate = input.unitCost != null && input.unitCost > 0
          ? Number(input.unitCost)
          : Number(prod?.costPrice || 0);
        const adjustmentValue = Number(input.quantity) * unitCostRate;

        if (adjustmentValue > 0) {
          await postJournal(
            {
              referenceType: "INVENTORY_ADJUSTMENT",
              referenceId,
              date: new Date(),
              createdById: session.user.id,
              lines: [
                {
                  accountType: AccountType.INVENTORY,
                  debit: adjustmentValue,
                  credit: 0,
                  description: `Inventory on Hand (Asset): Stock adjusted upward for [${prod?.productNo || ""}] ${prod?.name || "Product"} (+${input.quantity})`,
                },
                {
                  accountType: AccountType.EQUITY,
                  accountSubtype: LedgerAccountSubtype.OPENING_STOCK_EQUITY,
                  debit: 0,
                  credit: adjustmentValue,
                  description: `Opening Stock Equity: Stock adjusted upward for [${prod?.productNo || ""}] ${prod?.name || "Product"} (+${input.quantity})`,
                },
              ],
            },
            tx,
          );
        }

        const ownership = await ownershipForLine(
          tx,
          input.productId,
          input.locationId,
          input.ownershipKey,
        );
        const ownershipKey = resolveOwnershipKey(ownership);
        await postInflow(tx, {
          productId: input.productId,
          locationId: input.locationId,
          ownership,
          quantity: input.quantity,
          unitCost: unitCostRate,
          movementType: "OPENING",
          referenceType: "INVENTORY_ADJUSTMENT",
          referenceId,
        });
        await tx.stockMovement.updateMany({
          where: { referenceType: "ADJUSTMENT", referenceId },
          data: {
            ownershipType: ownership.ownershipType,
            ownershipKey,
            partnershipLotId: ownership.partnershipLotId,
          },
        });
      } else {
        const ownership = await ownershipForLine(
          tx,
          input.productId,
          input.locationId,
          input.ownershipKey,
        );
        await postOutflow(tx, {
          productId: input.productId,
          locationId: input.locationId,
          ownership,
          quantity: input.quantity,
          movementType: "ADJUSTMENT_OUT",
          referenceType: "INVENTORY_ADJUSTMENT",
          referenceId,
        });
        const ownershipKey = resolveOwnershipKey(ownership);
        await tx.stockMovement.updateMany({
          where: { referenceType: "ADJUSTMENT", referenceId },
          data: {
            ownershipType: ownership.ownershipType,
            ownershipKey,
            partnershipLotId: ownership.partnershipLotId,
          },
        });
      }

      return { availableStock: desired };
    });

    emitRealtimeEvent(["inventory", "stock-movements", "dashboard"], "update", "StockAdjustment", {
      productId: input.productId,
      locationId: input.locationId,
    });

    revalidatePath("/inventory");
    revalidatePath("/stock-movements");
    revalidatePath("/ledger");
    revalidatePath("/dashboard");

    return res;
  });
}

/**
 * Bulk stock adjustment with double-entry general ledger posting
 */
export async function bulkAdjustStockAction(raw: unknown) {
  return runAction("inventory.bulkAdjust", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "inventory", "update", (session.user as any).permissions)) {
      throw userError("You do not have permission to adjust inventory stock.");
    }
    const input = parseInput(bulkStockAdjustmentSchema, raw);

    const normalizedItems = input.items.map((item: any) => {
      const locId = item.locationId || input.locationId;
      if (!locId) {
        throw userError("Location is required for each adjustment item.");
      }
      return {
        ...item,
        locationId: locId as string,
      };
    });

    const uniqueLocationIds = Array.from(new Set(normalizedItems.map((it: any) => it.locationId)));
    const locations = await prisma.location.findMany({
      where: { id: { in: uniqueLocationIds } },
      include: {
        warehouseLots: {
          where: { isActive: true, deletedAt: null },
        },
      },
    });

    const locationMap = new Map(locations.map((l) => [l.id, l]));
    for (const locId of uniqueLocationIds) {
      if (!locationMap.has(locId)) {
        throw userError(`Location not found: ${locId}`);
      }
    }

    for (const item of normalizedItems) {
      if (item.warehouseLotId) {
        const loc = locationMap.get(item.locationId)!;
        const lotExists = loc.warehouseLots.some((l) => l.id === item.warehouseLotId);
        if (!lotExists) {
          throw userError(`Selected lot does not exist in warehouse "${loc.name}".`);
        }
      } else if (locationMap.get(item.locationId)!.warehouseLots.length > 0) {
        throw userError(`Select a specific lot before adjusting stock at ${locationMap.get(item.locationId)!.name}.`);
      }
    }

    const lockKeys = normalizedItems.map((it: any) => `stock:${it.productId}:${it.locationId}`);

    const res = await withResourceQueue(lockKeys, async (tx) => {
      const referenceId = generateDocumentNumber("ADJ");

      await assertStockDeductionsAvailable(
        normalizedItems
          .filter((item: any) => item.direction === "OUT")
          .map((item: any) => ({
            productId: item.productId,
            locationId: item.locationId,
            warehouseLotId: item.warehouseLotId,
            quantity: item.quantity,
          })),
        tx,
      );

      const prodIds = normalizedItems.map((it: any) => it.productId);
      const prods = await tx.product.findMany({
        where: { id: { in: prodIds } },
        select: { id: true, name: true, productNo: true, costPrice: true },
      });
      const prodMap = new Map(prods.map((p) => [p.id, p]));

      let totalUpwardValuation = 0;

      for (const item of normalizedItems) {
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            locationId: item.locationId,
            warehouseLotId: item.warehouseLotId || null,
            type: "ADJUSTMENT",
            quantity: item.direction === "IN" ? item.quantity : -item.quantity,
            referenceType: "ADJUSTMENT",
            referenceId,
            createdById: session.user.id,
            notes: item.notes || input.reason,
          },
        });

        if (item.direction === "IN") {
          const p = prodMap.get(item.productId);
          const unitCost = item.unitCost != null && item.unitCost > 0
            ? Number(item.unitCost)
            : Number(p?.costPrice || 0);
          totalUpwardValuation += Number(item.quantity) * unitCost;

          const ownership = await ownershipForLine(tx, item.productId, item.locationId, (item as any).ownershipKey);
          await postInflow(tx, {
            productId: item.productId,
            locationId: item.locationId,
            ownership,
            quantity: item.quantity,
            unitCost,
            movementType: "ADJUSTMENT_IN",
            referenceType: "INVENTORY_ADJUSTMENT",
            referenceId,
          });
        } else {
          const ownership = await ownershipForLine(
            tx,
            item.productId,
            item.locationId,
            (item as any).ownershipKey,
          );
          await postOutflow(tx, {
            productId: item.productId,
            locationId: item.locationId,
            ownership,
            quantity: item.quantity,
            movementType: "ADJUSTMENT_OUT",
            referenceType: "INVENTORY_ADJUSTMENT",
            referenceId,
          });
        }
      }

      if (totalUpwardValuation > 0) {
        await tx.ledgerEntry.create({
          data: {
            partyId: null,
            accountType: AccountType.INVENTORY,
            debit: totalUpwardValuation,
            credit: 0,
            referenceType: "INVENTORY_ADJUSTMENT",
            referenceId,
            date: new Date(),
            description: `Inventory on Hand (Asset): Bulk stock upward adjustment (${normalizedItems.length} items)`,
            createdById: session.user.id,
          },
        });

        await tx.ledgerEntry.create({
          data: {
            partyId: null,
            accountType: AccountType.INVENTORY,
            debit: 0,
            credit: totalUpwardValuation,
            referenceType: "INVENTORY_ADJUSTMENT",
            referenceId,
            date: new Date(),
            description: `Opening Stock Equity / Inventory Valuation Reserve: Bulk stock upward adjustment`,
            createdById: session.user.id,
          },
        });
      }

      return { success: true, count: normalizedItems.length, referenceId };
    });

    emitRealtimeEvent(["inventory", "stock-movements", "dashboard"], "update", "BulkStockAdjustment", {
      referenceId: res.referenceId,
    });

    revalidatePath("/inventory");
    revalidatePath("/stock-movements");
    revalidatePath("/ledger");
    revalidatePath("/dashboard");

    return res;
  });
}

/**
 * Transfer stock between locations
 */
export async function transferStockAction(raw: unknown) {
  return runAction("inventory.transfer", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "inventory", "update", (session.user as any).permissions)) {
      throw userError("You do not have permission to transfer inventory stock.");
    }
    const input = parseInput(stockTransferSchema, raw);

    if (input.fromLocationId === input.toLocationId) {
      throw userError("Source and destination locations must be different.");
    }

    const [fromLoc, toLoc] = await Promise.all([
      prisma.location.findUnique({
        where: { id: input.fromLocationId },
        include: { warehouseLots: { where: { isActive: true, deletedAt: null } } },
      }),
      prisma.location.findUnique({
        where: { id: input.toLocationId },
        include: { warehouseLots: { where: { isActive: true, deletedAt: null } } },
      }),
    ]);
    if (!fromLoc) throw userError("Source location not found.");
    if (!toLoc) throw userError("Destination location not found.");

    const tagIndex = await loadPartnershipTagIndex();
    const fromPhysical = fromLoc.warehouseLots.filter((lot) => !isPartnershipTagLot(lot, tagIndex));
    const toPhysical = toLoc.warehouseLots.filter((lot) => !isPartnershipTagLot(lot, tagIndex));
    if (input.fromWarehouseLotId) {
      const lot = fromPhysical.find((l) => l.id === input.fromWarehouseLotId);
      if (!lot) throw userError("Selected lot does not exist in source location.");
    } else if (fromPhysical.length > 0) {
      throw userError(`Select a specific lot before transferring stock from ${fromLoc.name}.`);
    }

    if (toPhysical.length > 0 && !input.toWarehouseLotId) {
      throw userError(`Select a specific lot to receive stock at ${toLoc.name}.`);
    }

    const lockKeys = [
      `stock:${input.productId}:${input.fromLocationId}`,
      `stock:${input.productId}:${input.toLocationId}`,
    ];

    const res = await withResourceQueue(lockKeys, async (tx) => {
      await assertStockDeductionsAvailable(
        [{
          productId: input.productId,
          locationId: input.fromLocationId,
          warehouseLotId: input.fromWarehouseLotId,
          quantity: input.quantity,
        }],
        tx,
      );

      const referenceId = generateDocumentNumber("TRF");

      await tx.stockMovement.create({
        data: {
          productId: input.productId,
          locationId: input.fromLocationId,
          warehouseLotId: input.fromWarehouseLotId || null,
          type: StockMovementType.TRANSFER_OUT,
          quantity: input.quantity,
          referenceType: "TRANSFER",
          referenceId,
          createdById: session.user.id,
          notes: input.notes ? `Transfer out: ${input.notes}` : `Transfer to ${toLoc.name}`,
        },
      });

      await tx.stockMovement.create({
        data: {
          productId: input.productId,
          locationId: input.toLocationId,
          warehouseLotId: input.toWarehouseLotId || null,
          type: StockMovementType.TRANSFER_IN,
          quantity: input.quantity,
          referenceType: "TRANSFER",
          referenceId,
          createdById: session.user.id,
          notes: input.notes ? `Transfer in: ${input.notes}` : `Transfer from ${fromLoc.name}`,
        },
      });

      const ownership = await ownershipForLine(
        tx,
        input.productId,
        input.fromLocationId,
        input.ownershipKey,
      );
      const ownershipKey = resolveOwnershipKey(ownership);
      await postTransfer(tx, {
        productId: input.productId,
        fromLocationId: input.fromLocationId,
        toLocationId: input.toLocationId,
        ownership,
        quantity: input.quantity,
        referenceType: "TRANSFER",
        referenceId,
      });
      await tx.stockMovement.updateMany({
        where: { referenceType: "TRANSFER", referenceId },
        data: {
            ownershipType: ownership.ownershipType,
            ownershipKey,
            partnershipLotId: ownership.partnershipLotId,
          },
      });

      return { success: true, referenceId };
    });

    emitRealtimeEvent(["inventory", "stock-movements", "dashboard"], "update", "StockTransfer", {
      productId: input.productId,
      fromLocationId: input.fromLocationId,
      toLocationId: input.toLocationId,
    });

    revalidatePath("/inventory");
    revalidatePath("/stock-movements");
    revalidatePath("/dashboard");

    return res;
  });
}

const saleOwnershipBucketsSchema = z.object({
  productId: z.string().min(1),
  locationId: z.string().min(1),
  warehouseLotId: z.string().optional().nullable(),
  stockSource: z.enum(["AUTO_SPLIT", "REGULAR_ONLY", "PARTNER_ONLY"]).optional(),
});

export async function listSaleOwnershipBucketsAction(raw: unknown) {
  return runAction("inventory.saleOwnershipBuckets", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "sales", "view", (session.user as any).permissions)) {
      throw userError("You do not have permission to view ownership buckets.");
    }
    const input = parseInput(saleOwnershipBucketsSchema, raw);

    const rows = await prisma.productCostState.findMany({
      where: {
        productId: input.productId,
        locationId: input.locationId,
        quantity: { gt: 0 },
      },
      include: {
        partnershipLot: { select: { id: true, lotNumber: true } },
      },
      orderBy: [{ ownershipKey: "asc" }],
    });

    const ownRow = rows.find((row) => row.ownershipKey === "OWN");
    const buckets = rows
      .filter((row) => row.ownershipKey !== "OWN")
      .map((row) => ({
        ownershipType: row.ownershipType,
        ownershipKey: row.ownershipKey,
        partnershipLotId: row.partnershipLotId,
        quantity: Number(row.quantity),
        avgCost: Number(row.avgCost),
        label: row.partnershipLot?.lotNumber || row.ownershipKey,
      }));

    const regularOnHand = await getNonPartnershipOnHand(
      input.productId,
      input.locationId,
      prisma,
      input.warehouseLotId || null,
    );
    const regularQty = input.warehouseLotId
      ? regularOnHand
      : Math.max(Number(ownRow?.quantity ?? 0), regularOnHand);
    if (regularQty > 0.0001) {
      buckets.unshift({
        ownershipType: "OWN",
        ownershipKey: "OWN",
        partnershipLotId: null,
        quantity: regularQty,
        avgCost: Number(ownRow?.avgCost ?? 0),
        label: "Regular",
      });
    }

    let suggestedOwnershipKey: string | null = null;
    if (input.warehouseLotId) {
      const ownership = await resolvePurchaseOwnership(prisma, {
        warehouseLotId: input.warehouseLotId,
      });
      suggestedOwnershipKey = resolveOwnershipKey(ownership);
    } else if (input.stockSource === "REGULAR_ONLY") {
      suggestedOwnershipKey = buckets.some((b) => b.ownershipKey === "OWN") ? "OWN" : null;
    } else if (input.stockSource === "PARTNER_ONLY") {
      suggestedOwnershipKey = buckets.find((b) => b.ownershipKey !== "OWN")?.ownershipKey ?? null;
    } else if (buckets.length === 1) {
      suggestedOwnershipKey = buckets[0].ownershipKey;
    } else if (input.stockSource === "AUTO_SPLIT") {
      suggestedOwnershipKey = null;
    } else if (buckets.some((b) => b.ownershipKey === "OWN")) {
      suggestedOwnershipKey = "OWN";
    }

    return { buckets, suggestedOwnershipKey };
  });
}

const locationBatchStockSchema = z.object({
  locationId: z.string().optional().nullable(),
});

export async function listLocationBatchStockAction(raw: unknown) {
  return runAction("inventory.locationBatchStock", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "inventory", "view", (session.user as any).permissions)) {
      throw userError("You do not have permission to view stock batches.");
    }
    const input = parseInput(locationBatchStockSchema, raw ?? {});
    const rows = await prisma.productCostState.findMany({
      where: {
        quantity: { gt: 0 },
        ownershipKey: { not: "OWN" },
        ...(input.locationId ? { locationId: input.locationId } : {}),
      },
      include: { partnershipLot: { select: { lotNumber: true } } },
    });
    const movements = await prisma.stockMovement.groupBy({
      by: ["productId", "locationId", "type"],
      where: {
        partnershipLotId: null,
        ...(input.locationId ? { locationId: input.locationId } : {}),
      },
      _sum: { quantity: true },
    });
    const regularQty = new Map<string, number>();
    for (const movement of movements) {
      const key = `${movement.productId}:${movement.locationId}`;
      const qty = Number(movement._sum.quantity ?? 0);
      const signed =
        movement.type === "ADJUSTMENT" ||
        movement.type === "PURCHASE_IN" ||
        movement.type === "TRANSFER_IN" ||
        movement.type === "SALE_RETURN"
          ? qty
          : movement.type === "SALE_OUT" ||
              movement.type === "TRANSFER_OUT" ||
              movement.type === "DELIVERY_OUT" ||
              movement.type === "PURCHASE_RETURN"
            ? -qty
            : 0;
      regularQty.set(key, (regularQty.get(key) ?? 0) + signed);
    }
    const regularRows = [...regularQty.entries()]
      .filter(([, quantity]) => quantity > 0.0001)
      .map(([key, quantity]) => {
        const [productId, locationId] = key.split(":");
        return {
          productId,
          locationId,
          ownershipKey: "OWN",
          quantity,
          label: "Regular",
        };
      });
    return [
      ...regularRows,
      ...rows.map((row) => ({
        productId: row.productId,
        locationId: row.locationId,
        ownershipKey: row.ownershipKey,
        quantity: Number(row.quantity),
        label: row.partnershipLot?.lotNumber || row.ownershipKey,
      })),
    ];
  });
}

const assignUnassignedSchema = z.object({
  productId: z.string().min(1),
  locationId: z.string().min(1),
  warehouseLotId: z.string().min(1),
  quantity: z.number().positive(),
});

export async function assignUnassignedStockToLotAction(raw: unknown) {
  return runAction("inventory.assignUnassignedLot", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "inventory", "update", (session.user as any).permissions)) {
      throw userError("You do not have permission to assign warehouse stock to a lot.");
    }
    const input = parseInput(assignUnassignedSchema, raw);
    const location = await prisma.location.findUnique({
      where: { id: input.locationId },
      include: {
        warehouseLots: {
          where: { isActive: true, deletedAt: null },
          select: { id: true, lotNumber: true },
        },
      },
    });
    if (!location || location.type !== "WAREHOUSE") {
      throw userError("Lots are only required on warehouse locations.");
    }
    const lot = location.warehouseLots.find((l) => l.id === input.warehouseLotId);
    if (!lot) throw userError("Select a lot that belongs to this warehouse.");
    if (location.warehouseLots.length === 0) {
      throw userError("This warehouse has no lots.");
    }

    const unassigned = await getStockOnHand(input.productId, input.locationId, prisma, null);
    if (unassigned + 0.0001 < input.quantity) {
      throw userError(`Only ${unassigned} unassigned units are available to assign.`);
    }

    await prisma.$transaction(async (tx) => {
      await tx.stockMovement.create({
        data: {
          productId: input.productId,
          locationId: input.locationId,
          warehouseLotId: null,
          type: StockMovementType.TRANSFER_OUT,
          quantity: input.quantity,
          referenceType: "LOT_ASSIGNMENT",
          referenceId: input.warehouseLotId,
          createdById: session.user.id,
          notes: `Move unassigned stock onto lot ${lot.lotNumber}`,
        },
      });
      await tx.stockMovement.create({
        data: {
          productId: input.productId,
          locationId: input.locationId,
          warehouseLotId: input.warehouseLotId,
          type: StockMovementType.TRANSFER_IN,
          quantity: input.quantity,
          referenceType: "LOT_ASSIGNMENT",
          referenceId: input.warehouseLotId,
          createdById: session.user.id,
          notes: `Assigned to lot ${lot.lotNumber}`,
        },
      });
    });

    revalidatePath("/inventory");
    revalidatePath("/sales");
    return { lotNumber: lot.lotNumber, quantity: input.quantity };
  });
}

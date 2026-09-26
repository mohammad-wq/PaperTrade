"use server";

import { z } from "zod";
import { AccountType, PartyType, Role } from "@prisma/client";
import { parseInput, runAction } from "@/actions/_helpers";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getPartyBalance } from "@/lib/ledger";
import { partySchema } from "@/schemas/party";
import {
  stockAdjustmentSchema,
  stockTransferSchema,
  bulkStockAdjustmentSchema,
  bulkStockTransferSchema,
} from "@/schemas/inventory";
import { getStockOnHand } from "@/lib/stock";
import { userError } from "@/lib/errors";
import { canPerformAction } from "@/lib/auth/permissions";
import { withResourceQueue, generateDocumentNumber } from "@/lib/concurrency";
import { emitRealtimeEvent } from "@/lib/realtime";
import { revalidatePath } from "next/cache";

const deletePartySchema = z.object({ id: z.string().min(1, "Party is required") });

export async function listPartiesAction() {
  return runAction("parties.list", async () => {
    await requireSession();
    const parties = await prisma.party.findMany({
      where: { deletedAt: null },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    });

    const result = await Promise.all(
      parties.map(async (party) => ({
        ...party,
        creditLimit: party.creditLimit ? Number(party.creditLimit) : null,
        balance: await getPartyBalance(party.id),
      })),
    );

    return result;
  });
}

export async function getPartyDetailsAction(partyId: string) {
  return runAction("parties.getDetails", async () => {
    await requireSession();
    const party = await prisma.party.findUnique({
      where: { id: partyId },
    });
    if (!party) {
      throw userError("Party not found.");
    }

    const [balance, entries, payments] = await Promise.all([
      getPartyBalance(party.id),
      prisma.ledgerEntry.findMany({
        where: { partyId: party.id },
        orderBy: { date: "desc" },
        include: {
          sourceFinancialYear: { select: { label: true } },
        },
        take: 200,
      }),
      prisma.payment.findMany({
        where: { partyId: party.id },
        orderBy: { date: "desc" },
        include: {
          financialYear: { select: { label: true } },
          saleInvoice: { select: { id: true, invoiceNo: true } },
          purchaseInvoice: { select: { id: true, invoiceNo: true } },
        },
        take: 100,
      }),
    ]);

    return {
      party: {
        ...party,
        creditLimit: party.creditLimit ? Number(party.creditLimit) : null,
        balance,
      },
      ledgerEntries: entries.map((e) => ({
        id: e.id,
        date: e.date.toISOString(),
        accountType: e.accountType,
        debit: Number(e.debit),
        credit: Number(e.credit),
        referenceType: e.referenceType,
        referenceId: e.referenceId,
        description: e.description,
        sourceYear: e.sourceFinancialYear?.label || null,
      })),
      payments: payments.map((p) => ({
        id: p.id,
        receiptNo: p.receiptNo || null,
        date: p.date.toISOString(),
        amount: Number(p.amount),
        method: p.method,
        notes: p.notes,
        financialYearLabel: p.financialYear?.label || null,
        invoiceNo: p.saleInvoice?.invoiceNo || p.purchaseInvoice?.invoiceNo || null,
      })),
    };
  });
}

export async function listInventoryAction() {
  return runAction("inventory.list", async () => {
    await requireSession();
    const [products, locations] = await Promise.all([
      prisma.product.findMany({
        where: { deletedAt: null, isActive: true },
        orderBy: { name: "asc" },
      }),
      prisma.location.findMany({
        where: { isActive: true, deletedAt: null },
        orderBy: [{ type: "asc" }, { name: "asc" }],
        include: {
          warehouseLots: {
            where: { isActive: true, deletedAt: null },
            orderBy: { lotNumber: "asc" },
          },
        },
      }),
    ]);

    const rows = await Promise.all(
      locations.flatMap((location) =>
        products.map(async (product) => {
          const available = await getStockOnHand(product.id, location.id);
          let lots: Array<{
            id: string | null;
            lotNumber: string;
            description: string | null;
            available: number;
          }> = [];

          if (location.warehouseLots.length > 0) {
            const lotStocks: Array<{
              id: string | null;
              lotNumber: string;
              description: string | null;
              available: number;
            }> = await Promise.all(
              location.warehouseLots.map(async (lot) => ({
                id: lot.id,
                lotNumber: lot.lotNumber,
                description: lot.description,
                available: await getStockOnHand(product.id, location.id, undefined, lot.id),
              })),
            );

            const unassigned = await getStockOnHand(product.id, location.id, undefined, null);
            if (unassigned !== 0) {
              lotStocks.push({
                id: null,
                lotNumber: "Unassigned",
                description: "Stock without lot assignment",
                available: unassigned,
              });
            }

            lots = lotStocks;
          }

          return {
            productId: product.id,
            productNo: product.productNo,
            productName: product.name,
            locationId: location.id,
            locationName: location.name,
            locationType: location.type,
            available,
            unit: product.unit,
            reorderLevel: product.reorderLevel ? Number(product.reorderLevel) : null,
            gsm: Number(product.gsm),
            length: Number(product.length),
            breadth: Number(product.breadth),
            packetWeight: Number(product.packetWeight),
            reamWeight: Number(product.reamWeight),
            isActive: product.isActive,
            lots,
          };
        }),
      ),
    );

    return rows.flat();
  });
}

export async function upsertPartyAction(raw: unknown) {
  return runAction("parties.upsert", async () => {
    const session = await requireSession();
    const input = parseInput(partySchema, raw);

    const actionType = input.id ? "update" : "create";
    if (!canPerformAction(session.user.role, "parties", actionType, (session.user as any).permissions)) {
      throw userError(`You do not have permission to ${actionType} parties.`);
    }

    const email = input.email?.trim() ? input.email.trim() : null;
    const phone = input.phone?.trim() ? input.phone.trim() : null;
    const address = input.address?.trim() ? input.address.trim() : null;
    const creditLimit =
      input.type === PartyType.CUSTOMER && input.creditLimit != null
        ? Number(input.creditLimit)
        : null;

    let party;
    if (input.id) {
      party = await prisma.party.update({
        where: { id: input.id },
        data: {
          name: input.name.trim(),
          type: input.type,
          phone,
          email,
          address,
          creditLimit,
          isActive: Boolean(input.isActive),
          deletedAt: null,
        },
      });
    } else {
      party = await prisma.party.create({
        data: {
          name: input.name.trim(),
          type: input.type,
          phone,
          email,
          address,
          creditLimit,
          isActive: Boolean(input.isActive),
          deletedAt: null,
        },
      });
    }

    emitRealtimeEvent(["parties", "sales", "purchases", "payments"], input.id ? "update" : "create", "Party", {
      id: party.id,
      name: party.name,
      type: party.type,
    });

    revalidatePath("/parties");
    revalidatePath("/dashboard");

    return party;
  });
}

export async function softDeletePartyAction(raw: unknown) {
  return runAction("parties.delete", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "parties", "delete", (session.user as any).permissions)) {
      throw userError("You do not have permission to delete parties.");
    }
    const input = parseInput(deletePartySchema, raw);

    const res = await prisma.$transaction(async (tx) => {
      const party = await tx.party.update({
        where: { id: input.id },
        data: {
          isActive: false,
          deletedAt: new Date(),
        },
      });

      return { id: party.id, success: true };
    });

    emitRealtimeEvent(["parties", "sales", "purchases", "payments"], "delete", "Party", {
      id: input.id,
    });

    revalidatePath("/parties");
    revalidatePath("/dashboard");

    return res;
  });
}

const adjustPartyBalanceSchema = z.object({
  partyId: z.string().min(1, "Party ID is required"),
  amount: z.coerce.number().positive("Adjustment amount must be greater than zero"),
  type: z.enum(["DEBIT", "CREDIT"]),
  reason: z.string().trim().min(3, "A mandatory reason must be provided for audit purposes"),
  date: z.coerce.date().default(() => new Date()),
});

export async function adjustPartyBalanceAction(raw: unknown) {
  return runAction("parties.adjustBalance", async () => {
    const session = await requireSession();
    if (session.user.role !== Role.OWNER) {
      throw userError("Only owners can manually adjust party balances.");
    }

    const input = parseInput(adjustPartyBalanceSchema, raw);

    const party = await prisma.party.findUnique({
      where: { id: input.partyId },
    });
    if (!party) {
      throw userError("Party not found.");
    }

    const referenceId = generateDocumentNumber("BADJ");
    const accountType =
      party.type === PartyType.CUSTOMER ? AccountType.RECEIVABLE : AccountType.PAYABLE;

    const debit = input.type === "DEBIT" ? input.amount : 0;
    const credit = input.type === "CREDIT" ? input.amount : 0;

    const entry = await prisma.ledgerEntry.create({
      data: {
        partyId: party.id,
        accountType,
        debit,
        credit,
        referenceType: "MANUAL_ADJUSTMENT",
        referenceId,
        date: input.date ?? new Date(),
        description: `Manual balance adjustment (${input.type}): ${input.reason}`,
        createdById: session.user.id,
      },
    });

    emitRealtimeEvent(["parties", "ledger", "dashboard"], "create", "LedgerEntry", {
      id: entry.id,
      partyId: party.id,
    });

    revalidatePath("/parties");
    revalidatePath(`/parties/${party.id}`);
    revalidatePath("/ledger");
    revalidatePath("/dashboard");

    return {
      success: true,
      entryId: entry.id,
      newBalance: await getPartyBalance(party.id),
    };
  });
}

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

    if (input.warehouseLotId) {
      const lot = location.warehouseLots.find((l) => l.id === input.warehouseLotId);
      if (!lot) throw userError("Selected lot does not exist in this location.");
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

      if (input.direction === "OUT" && currentStock < input.quantity) {
        const targetDesc = input.warehouseLotId ? "the selected lot" : "standard stock";
        throw userError(`Insufficient stock for this adjustment. Available in ${targetDesc}: ${currentStock}, Requested: ${input.quantity}.`);
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

      return { availableStock: desired };
    });

    emitRealtimeEvent(["inventory", "stock-movements", "dashboard"], "update", "StockAdjustment", {
      productId: input.productId,
      locationId: input.locationId,
    });

    revalidatePath("/inventory");
    revalidatePath("/stock-movements");
    revalidatePath("/dashboard");

    return res;
  });
}

export async function transferStockAction(raw: unknown) {
  return runAction("inventory.transfer", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "inventory", "update", (session.user as any).permissions)) {
      throw userError("You do not have permission to transfer inventory stock.");
    }
    const input = parseInput(stockTransferSchema, raw);

    const [fromLocation, toLocation] = await Promise.all([
      prisma.location.findUnique({
        where: { id: input.fromLocationId },
        include: { warehouseLots: { where: { isActive: true, deletedAt: null } } },
      }),
      prisma.location.findUnique({
        where: { id: input.toLocationId },
        include: { warehouseLots: { where: { isActive: true, deletedAt: null } } },
      }),
    ]);

    if (!fromLocation) throw userError("Source location not found.");
    if (!toLocation) throw userError("Destination location not found.");

    if (input.fromWarehouseLotId) {
      const lot = fromLocation.warehouseLots.find((l) => l.id === input.fromWarehouseLotId);
      if (!lot) throw userError(`Selected source lot does not exist in "${fromLocation.name}".`);
    }
    if (input.toWarehouseLotId) {
      const lot = toLocation.warehouseLots.find((l) => l.id === input.toWarehouseLotId);
      if (!lot) throw userError(`Selected destination lot does not exist in "${toLocation.name}".`);
    }

    if (input.fromLocationId === input.toLocationId && (input.fromWarehouseLotId || "") === (input.toWarehouseLotId || "")) {
      throw userError("Source and destination lot cannot be identical in the same location.");
    }

    const lockKeys = [
      `stock:${input.productId}:${input.fromLocationId}`,
      `stock:${input.productId}:${input.toLocationId}`,
    ];

    const res = await withResourceQueue(lockKeys, async (tx) => {
      const fromStock = await getStockOnHand(
        input.productId,
        input.fromLocationId,
        tx,
        input.fromWarehouseLotId ? input.fromWarehouseLotId : null,
      );
      if (fromStock < input.quantity) {
        const totalLocStock = await getStockOnHand(input.productId, input.fromLocationId, tx, undefined);
        const prod = await tx.product.findUnique({ where: { id: input.productId }, select: { productNo: true, name: true } });
        const prodLabel = `"${prod?.productNo || ""} ${prod?.name || ""}"`;
        if (!input.fromWarehouseLotId && totalLocStock >= input.quantity) {
          throw userError(
            `Insufficient stock for ${prodLabel} in standard/unassigned stock (Available: ${fromStock}). However, ${totalLocStock} units exist in lots at this location. Please select the specific source lot.`
          );
        }
        throw userError(
          input.fromWarehouseLotId
            ? `Not enough stock available for ${prodLabel} in the selected source lot. Available: ${fromStock}, Required: ${input.quantity}.`
            : `Not enough stock available for ${prodLabel} in standard stock. Available: ${fromStock}, Required: ${input.quantity}.`,
        );
      }

      const referenceId = generateDocumentNumber("TRF");
      await tx.stockMovement.createMany({
        data: [
          {
            productId: input.productId,
            locationId: input.fromLocationId,
            warehouseLotId: input.fromWarehouseLotId || null,
            type: "TRANSFER_OUT",
            quantity: input.quantity,
            referenceType: "TRANSFER",
            referenceId,
            createdById: session.user.id,
            notes: input.notes || "Stock transfer",
          },
          {
            productId: input.productId,
            locationId: input.toLocationId,
            warehouseLotId: input.toWarehouseLotId || null,
            type: "TRANSFER_IN",
            quantity: input.quantity,
            referenceType: "TRANSFER",
            referenceId,
            createdById: session.user.id,
            notes: input.notes || "Stock transfer",
          },
        ],
      });

      return { success: true };
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

export async function bulkAdjustStockAction(raw: unknown) {
  return runAction("inventory.bulkAdjust", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "inventory", "update", (session.user as any).permissions)) {
      throw userError("You do not have permission to adjust inventory stock.");
    }
    const input = parseInput(bulkStockAdjustmentSchema, raw);

    // Resolve location for each item (item-level location or header fallback)
    const normalizedItems = input.items.map((item) => {
      const locId = item.locationId || input.locationId;
      if (!locId) {
        throw userError("Location is required for each adjustment item.");
      }
      return {
        ...item,
        locationId: locId,
      };
    });

    const uniqueLocationIds = Array.from(new Set(normalizedItems.map((it) => it.locationId)));
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

    // Validate warehouse lots where specified
    for (const item of normalizedItems) {
      if (item.warehouseLotId) {
        const loc = locationMap.get(item.locationId)!;
        const lotExists = loc.warehouseLots.some((l) => l.id === item.warehouseLotId);
        if (!lotExists) {
          throw userError(`Selected lot does not exist in warehouse "${loc.name}".`);
        }
      }
    }

    const lockKeys = normalizedItems.map((it) => `stock:${it.productId}:${it.locationId}`);

    const res = await withResourceQueue(lockKeys, async (tx) => {
      const referenceId = generateDocumentNumber("ADJ");

      for (const item of normalizedItems) {
        const lotFilter = item.warehouseLotId ? item.warehouseLotId : null;
        const currentStock = await getStockOnHand(
          item.productId,
          item.locationId,
          tx,
          lotFilter,
        );

        if (item.direction === "OUT" && currentStock < item.quantity) {
          const prod = await tx.product.findUnique({ where: { id: item.productId }, select: { productNo: true, name: true } });
          const targetDesc = item.warehouseLotId ? "in the selected lot" : "in standard stock";
          throw userError(
            `Insufficient stock for "${prod?.productNo || ""} ${prod?.name || ""}" ${targetDesc}. Available: ${currentStock}, Required: ${item.quantity}.`
          );
        }

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
      }

      return { success: true, count: normalizedItems.length, referenceId };
    });

    emitRealtimeEvent(["inventory", "stock-movements", "dashboard"], "update", "BulkStockAdjustment", {
      referenceId: res.referenceId,
    });

    revalidatePath("/inventory");
    revalidatePath("/stock-movements");
    revalidatePath("/dashboard");

    return res;
  });
}

export async function bulkTransferStockAction(raw: unknown) {
  return runAction("inventory.bulkTransfer", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "inventory", "update", (session.user as any).permissions)) {
      throw userError("You do not have permission to transfer inventory stock.");
    }
    const input = parseInput(bulkStockTransferSchema, raw);

    const [fromLocation, toLocation] = await Promise.all([
      prisma.location.findUnique({
        where: { id: input.fromLocationId },
        include: { warehouseLots: { where: { isActive: true, deletedAt: null } } },
      }),
      prisma.location.findUnique({
        where: { id: input.toLocationId },
        include: { warehouseLots: { where: { isActive: true, deletedAt: null } } },
      }),
    ]);

    if (!fromLocation) throw userError("Source location not found.");
    if (!toLocation) throw userError("Destination location not found.");

    if (input.fromLocationId === input.toLocationId) {
      for (const item of input.items) {
        if ((item.fromWarehouseLotId || "") === (item.toWarehouseLotId || "")) {
          throw userError("Source and destination lot cannot be identical for intra-warehouse transfer.");
        }
      }
    }

    for (const item of input.items) {
      if (item.fromWarehouseLotId) {
        const lot = fromLocation.warehouseLots.find((l) => l.id === item.fromWarehouseLotId);
        if (!lot) throw userError(`Selected source lot does not exist in "${fromLocation.name}".`);
      }
      if (item.toWarehouseLotId) {
        const lot = toLocation.warehouseLots.find((l) => l.id === item.toWarehouseLotId);
        if (!lot) throw userError(`Selected destination lot does not exist in "${toLocation.name}".`);
      }
    }

    const lockKeys = input.items.flatMap((it) => [
      `stock:${it.productId}:${input.fromLocationId}`,
      `stock:${it.productId}:${input.toLocationId}`,
    ]);

    const res = await withResourceQueue(lockKeys, async (tx) => {
      const referenceId = generateDocumentNumber("TRF");

      for (const item of input.items) {
        const fromLotFilter = item.fromWarehouseLotId ? item.fromWarehouseLotId : null;
        const fromStock = await getStockOnHand(
          item.productId,
          input.fromLocationId,
          tx,
          fromLotFilter,
        );

        if (fromStock < item.quantity) {
          const totalLocStock = await getStockOnHand(item.productId, input.fromLocationId, tx, undefined);
          const prod = await tx.product.findUnique({ where: { id: item.productId }, select: { productNo: true, name: true } });
          const prodTitle = `"${prod?.productNo || ""} ${prod?.name || ""}"`;
          if (!item.fromWarehouseLotId && totalLocStock >= item.quantity) {
            throw userError(
              `Insufficient stock for ${prodTitle} in standard/unassigned stock (Available: ${fromStock}). However, ${totalLocStock} units exist in lots at this location. Please select the specific source lot.`
            );
          }
          const locDesc = item.fromWarehouseLotId ? "in the selected source lot" : "in standard stock";
          throw userError(
            `Insufficient stock for ${prodTitle} ${locDesc}. Available: ${fromStock}, Required: ${item.quantity}.`
          );
        }

        await tx.stockMovement.createMany({
          data: [
            {
              productId: item.productId,
              locationId: input.fromLocationId,
              warehouseLotId: item.fromWarehouseLotId || null,
              type: "TRANSFER_OUT",
              quantity: item.quantity,
              referenceType: "TRANSFER",
              referenceId,
              createdById: session.user.id,
              notes: input.notes || "Bulk stock transfer",
            },
            {
              productId: item.productId,
              locationId: input.toLocationId,
              warehouseLotId: item.toWarehouseLotId || null,
              type: "TRANSFER_IN",
              quantity: item.quantity,
              referenceType: "TRANSFER",
              referenceId,
              createdById: session.user.id,
              notes: input.notes || "Bulk stock transfer",
            },
          ],
        });
      }

      return { success: true, count: input.items.length, referenceId };
    });

    emitRealtimeEvent(["inventory", "stock-movements", "dashboard"], "update", "BulkStockTransfer", {
      fromLocationId: input.fromLocationId,
      toLocationId: input.toLocationId,
      referenceId: res.referenceId,
    });

    revalidatePath("/inventory");
    revalidatePath("/stock-movements");
    revalidatePath("/dashboard");

    return res;
  });
}

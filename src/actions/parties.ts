"use server";

import { z } from "zod";
import { AccountType, PartyType, Role, StockMovementType } from "@prisma/client";
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
import { assertStockDeductionsAvailable, getStockOnHand } from "@/lib/stock";
import { userError } from "@/lib/errors";
import { canPerformAction } from "@/lib/auth/permissions";
import { withResourceQueue, generateDocumentNumber } from "@/lib/concurrency";
import { emitRealtimeEvent } from "@/lib/realtime";
import { revalidatePath } from "next/cache";
import { cleanPartyDisplayName } from "@/lib/party-display";
import {
  postTransfer,
  resolveOwnershipKey,
  resolveSaleOwnership,
} from "@/lib/inventoryCost.service";

const deletePartySchema = z.object({ id: z.string().min(1, "Party is required") });

export async function listPartiesAction() {
  return runAction("parties.list", async () => {
    const session = await requireSession();
    if (
      !canPerformAction(session.user.role, "parties", "view", (session.user as any).permissions) &&
      !canPerformAction(session.user.role, "sales", "view", (session.user as any).permissions) &&
      !canPerformAction(session.user.role, "purchases", "view", (session.user as any).permissions) &&
      !canPerformAction(session.user.role, "payments", "view", (session.user as any).permissions) &&
      !canPerformAction(session.user.role, "partnerships", "view", (session.user as any).permissions) &&
      !canPerformAction(session.user.role, "ledger", "view", (session.user as any).permissions)
    ) {
      throw userError("You do not have permission to view parties.");
    }
    const parties = await prisma.party.findMany({
      where: { deletedAt: null },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    });

    if (parties.length === 0) return [];

    const partyIds = parties.map((p) => p.id);
    const balanceAggregates = await prisma.ledgerEntry.groupBy({
      by: ["partyId"],
      where: { partyId: { in: partyIds } },
      _sum: { debit: true, credit: true },
    });

    const balanceMap = new Map<string, number>();
    for (const b of balanceAggregates) {
      if (b.partyId) {
        balanceMap.set(b.partyId, Number(b._sum.debit ?? 0) - Number(b._sum.credit ?? 0));
      }
    }

    return parties.map((party) => ({
      ...party,
      name: cleanPartyDisplayName(party.name),
      creditLimit: party.creditLimit ? Number(party.creditLimit) : null,
      balance: balanceMap.get(party.id) ?? 0,
    }));
  });
}

export async function getPartyDetailsAction(partyId: string, filterMode: "REGULAR" | "PARTNERSHIP" | "ALL" = "REGULAR") {
  return runAction("parties.getDetails", async () => {
    const session = await requireSession();
    if (
      !canPerformAction(session.user.role, "parties", "view", (session.user as any).permissions) &&
      !canPerformAction(session.user.role, "ledger", "view", (session.user as any).permissions)
    ) {
      throw userError("You do not have permission to view party details.");
    }
    const party = await prisma.party.findUnique({
      where: { id: partyId },
    });
    if (!party) {
      throw userError("Party not found.");
    }

    const ledgerWhere: any = { partyId: party.id };
    const paymentWhere: any = { partyId: party.id };

    if (filterMode === "REGULAR") {
      ledgerWhere.isPartnership = false;
      ledgerWhere.partnershipId = null;
      paymentWhere.isPartnership = false;
      paymentWhere.partnershipId = null;
    } else if (filterMode === "PARTNERSHIP") {
      ledgerWhere.OR = [{ isPartnership: true }, { partnershipId: { not: null } }];
      paymentWhere.OR = [{ isPartnership: true }, { partnershipId: { not: null } }];
    }

    const [regularBalance, partnershipBalance, consolidatedBalance, entries, payments] = await Promise.all([
      getPartyBalance(party.id, undefined, undefined, "REGULAR"),
      getPartyBalance(party.id, undefined, undefined, "PARTNERSHIP"),
      getPartyBalance(party.id, undefined, undefined, "ALL"),
      prisma.ledgerEntry.findMany({
        where: ledgerWhere,
        orderBy: { date: "desc" },
        include: {
          sourceFinancialYear: { select: { label: true } },
        },
        take: 300,
      }),
      prisma.payment.findMany({
        where: paymentWhere,
        orderBy: { date: "desc" },
        include: {
          financialYear: { select: { label: true } },
          saleInvoice: { select: { id: true, invoiceNo: true } },
          purchaseInvoice: { select: { id: true, invoiceNo: true } },
        },
        take: 100,
      }),
    ]);

    const activeBalance =
      filterMode === "REGULAR"
        ? regularBalance
        : filterMode === "PARTNERSHIP"
        ? partnershipBalance
        : consolidatedBalance;

    return {
      party: {
        ...party,
        name: cleanPartyDisplayName(party.name),
        creditLimit: party.creditLimit ? Number(party.creditLimit) : null,
        balance: activeBalance,
        regularBalance,
        partnershipBalance,
        consolidatedBalance,
      },
      filterMode,
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
        isPartnership: Boolean(e.isPartnership || e.partnershipId),
        partnershipId: e.partnershipId || null,
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
        isPartnership: Boolean(p.isPartnership || p.partnershipId),
        partnershipId: p.partnershipId || null,
      })),
    };
  });
}

export async function listInventoryAction() {
  return runAction("inventory.list", async () => {
    const session = await requireSession();
    if (
      !canPerformAction(session.user.role, "inventory", "view", (session.user as any).permissions) &&
      !canPerformAction(session.user.role, "sales", "view", (session.user as any).permissions) &&
      !canPerformAction(session.user.role, "purchases", "view", (session.user as any).permissions) &&
      !canPerformAction(session.user.role, "delivery-orders", "view", (session.user as any).permissions) &&
      !canPerformAction(session.user.role, "partnerships", "view", (session.user as any).permissions)
    ) {
      throw userError("You do not have permission to view inventory.");
    }
    const [products, locations, rawMovements] = await Promise.all([
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
            include: {
              partner: { select: { id: true, name: true, isBeneficiary: true } },
            },
          },
        },
      }),
      prisma.stockMovement.groupBy({
        by: ["productId", "locationId", "warehouseLotId", "type"],
        _sum: { quantity: true },
      }),
    ]);

    const INBOUND_SET = new Set<StockMovementType>([
      StockMovementType.PURCHASE_IN,
      StockMovementType.TRANSFER_IN,
      StockMovementType.SALE_RETURN,
    ]);
    const OUTBOUND_SET = new Set<StockMovementType>([
      StockMovementType.SALE_OUT,
      StockMovementType.TRANSFER_OUT,
      StockMovementType.DELIVERY_OUT,
      StockMovementType.PURCHASE_RETURN,
    ]);

    // Build ultra-fast in-memory stock lookup maps
    const locStockMap = new Map<string, number>();
    const lotStockMap = new Map<string, number>();

    for (const m of rawMovements) {
      const qty = Number(m._sum.quantity ?? 0);
      let delta = 0;
      if (m.type === StockMovementType.ADJUSTMENT) {
        delta = qty;
      } else if (INBOUND_SET.has(m.type)) {
        delta = qty;
      } else if (OUTBOUND_SET.has(m.type)) {
        delta = -qty;
      }

      const locKey = `${m.productId}:${m.locationId}`;
      locStockMap.set(locKey, (locStockMap.get(locKey) ?? 0) + delta);

      const lotKey = `${m.productId}:${m.locationId}:${m.warehouseLotId || ""}`;
      lotStockMap.set(lotKey, (lotStockMap.get(lotKey) ?? 0) + delta);
    }

    const rows = locations.flatMap((location) =>
      products.flatMap((product) => {
        const partnerLots = location.warehouseLots.filter(
          (lot) => lot.partnerId || lot.partner?.isBeneficiary
        );
        const nonPartnerLots = location.warehouseLots.filter(
          (lot) => !lot.partnerId && !lot.partner?.isBeneficiary
        );

        const unassignedStockRaw = lotStockMap.get(`${product.id}:${location.id}:`) ?? 0;
        // Clamp unassigned to 0 so corrupted null-lot movements don't cancel valid lot stock
        const unassignedStock = Math.max(0, unassignedStockRaw);
        const nonPartnerLotsStock = nonPartnerLots.reduce(
          (sum, lot) => sum + Math.max(0, lotStockMap.get(`${product.id}:${location.id}:${lot.id}`) ?? 0),
          0
        );
        const regularAvailable = unassignedStock + nonPartnerLotsStock;

        const resultRows: Array<any> = [];

        // Regular Stock Row
        const allRegularLots = [
          ...nonPartnerLots.map((lot) => ({
            id: lot.id,
            lotNumber: lot.lotNumber,
            description: lot.description,
            available: lotStockMap.get(`${product.id}:${location.id}:${lot.id}`) ?? 0,
          })),
          ...(unassignedStock > 0
            ? [
                {
                  id: null,
                  lotNumber: "Unassigned",
                  description: "Stock without lot assignment",
                  available: unassignedStock,
                },
              ]
            : []),
        ];

        resultRows.push({
          productId: product.id,
          productNo: product.productNo,
          productName: partnerLots.length > 0 ? `${product.name} [Regular Stock]` : product.name,
          baseProductName: product.name,
          stockCategory: "REGULAR",
          beneficiaryName: null,
          beneficiaryId: null,
          lotId: null,
          lotNumber: null,
          unitCost: Number(product.costPrice),
          locationId: location.id,
          locationName: location.name,
          locationType: location.type,
          available: regularAvailable,
          unit: product.unit,
          reorderLevel: product.reorderLevel ? Number(product.reorderLevel) : null,
          gsm: Number(product.gsm),
          length: Number(product.length),
          breadth: Number(product.breadth),
          packetWeight: Number(product.packetWeight),
          reamWeight: Number(product.reamWeight),
          isActive: product.isActive,
          lots: allRegularLots,
        });

        // Separate row for each Partner / Beneficiary lot
        for (const pLot of partnerLots) {
          const lotStockRaw = lotStockMap.get(`${product.id}:${location.id}:${pLot.id}`) ?? 0;
          const lotStock = Math.max(0, lotStockRaw);
          // Only create partner row if stock exists or if lots are configured
          resultRows.push({
            productId: product.id,
            productNo: product.productNo,
            productName: `${product.name} [Beneficiary: ${pLot.partner?.name || "Person B"} - Lot ${pLot.lotNumber}]`,
            baseProductName: product.name,
            stockCategory: "BENEFICIARY",
            beneficiaryName: pLot.partner?.name || "Person B",
            beneficiaryId: pLot.partnerId,
            lotId: pLot.id,
            lotNumber: pLot.lotNumber,
            unitCost: pLot.unitCost != null ? Number(pLot.unitCost) : Number(product.costPrice),
            locationId: location.id,
            locationName: location.name,
            locationType: location.type,
            available: lotStock,
            unit: product.unit,
            reorderLevel: product.reorderLevel ? Number(product.reorderLevel) : null,
            gsm: Number(product.gsm),
            length: Number(product.length),
            breadth: Number(product.breadth),
            packetWeight: Number(product.packetWeight),
            reamWeight: Number(product.reamWeight),
            isActive: product.isActive,
            lots: [
              {
                id: pLot.id,
                lotNumber: pLot.lotNumber,
                description: pLot.description,
                available: lotStock,
              },
            ],
          });
        }

        return resultRows;
      })
    );

    return rows;
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
    const isPartner = Boolean(input.isPartner || input.isBeneficiary);
    let isCustomer = Boolean(input.isCustomer);
    let isSupplier = Boolean(input.isSupplier);

    // If neither role was set, deduce from type
    if (!isCustomer && !isSupplier) {
      if (input.type === PartyType.CUSTOMER) isCustomer = true;
      if (input.type === PartyType.SUPPLIER) isSupplier = true;
      if (isPartner) {
        isCustomer = true;
        isSupplier = true;
      }
    }

    const type = isSupplier && !isCustomer ? PartyType.SUPPLIER : isCustomer && !isSupplier ? PartyType.CUSTOMER : input.type;

    const partyData = {
      name: input.name.trim(),
      type,
      isCustomer,
      isSupplier,
      isPartner,
      isBeneficiary: isPartner,
      partnerWarehouseId: input.partnerWarehouseId || null,
      phone,
      email,
      address,
      creditLimit: (isCustomer || type === PartyType.CUSTOMER) && input.creditLimit != null ? Number(input.creditLimit) : null,
      isActive: Boolean(input.isActive),
      deletedAt: null,
    };

    let party;
    if (input.id) {
      party = await prisma.party.update({
        where: { id: input.id },
        data: partyData,
      });
    } else {
      party = await prisma.party.create({
        data: partyData,
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
import {
  adjustStockAction as _adjustStockAction,
  bulkAdjustStockAction as _bulkAdjustStockAction,
  transferStockAction as _transferStockAction,
} from "@/actions/inventory";

export async function adjustStockAction(raw: unknown) {
  return _adjustStockAction(raw);
}

export async function bulkAdjustStockAction(raw: unknown) {
  return _bulkAdjustStockAction(raw);
}

export async function transferStockAction(raw: unknown) {
  return _transferStockAction(raw);
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
      if (fromLocation.warehouseLots.length > 0 && !item.fromWarehouseLotId) {
        throw userError(`Select a specific source lot before transferring stock from ${fromLocation.name}.`);
      }
      if (toLocation.warehouseLots.length > 0 && !item.toWarehouseLotId) {
        throw userError(`Select a specific destination lot before transferring stock to ${toLocation.name}.`);
      }
    }

    const lockKeys = input.items.flatMap((it) => [
      `stock:${it.productId}:${input.fromLocationId}`,
      `stock:${it.productId}:${input.toLocationId}`,
    ]);

    const res = await withResourceQueue(lockKeys, async (tx) => {
      const referenceId = generateDocumentNumber("TRF");

      await assertStockDeductionsAvailable(
        input.items.map((item) => ({
          productId: item.productId,
          locationId: input.fromLocationId,
          warehouseLotId: item.fromWarehouseLotId,
          quantity: item.quantity,
        })),
        tx,
      );

      for (const item of input.items) {
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

        const ownership = await resolveSaleOwnership(tx, {
          productId: item.productId,
          locationId: input.fromLocationId,
          warehouseLotId: item.fromWarehouseLotId,
        });
        const ownershipKey = resolveOwnershipKey(ownership);
        await postTransfer(tx, {
          productId: item.productId,
          fromLocationId: input.fromLocationId,
          toLocationId: input.toLocationId,
          ownership,
          quantity: item.quantity,
          referenceType: "TRANSFER",
          referenceId: `${referenceId}:${item.productId}`,
        });
        await tx.stockMovement.updateMany({
          where: { referenceType: "TRANSFER", referenceId, productId: item.productId },
          data: { ownershipType: ownership.ownershipType, ownershipKey },
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

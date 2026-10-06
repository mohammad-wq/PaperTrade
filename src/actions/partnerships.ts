"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { runAction, parseInput } from "@/actions/_helpers";
import { requireSession } from "@/lib/auth/session";
import { userError } from "@/lib/errors";
import { getPartyBalance, postJournal } from "@/lib/ledger";
import { StockMovementType, InvoiceStatus, PaymentStatus, AccountType, PartnershipType, LotStatus, PaymentMethod, LedgerAccountSubtype } from "@prisma/client";
import { assertStockDeductionsAvailable, getStockOnHand } from "@/lib/stock";
import { generateDocumentNumber, withResourceQueue } from "@/lib/concurrency";
import { emitRealtimeEvent } from "@/lib/realtime";
import { canPerformAction } from "@/lib/auth/permissions";
import { cleanPartyDisplayName } from "@/lib/party-display";
import { createPaymentAction } from "@/actions/payments";
import {
  partnershipArchetypeFromLot,
  postOutflow,
} from "@/lib/inventoryCost.service";

export async function listPartnersAction() {
  return runAction("partnerships.list", async () => {
    const session = await requireSession();
    if (
      !canPerformAction(session.user.role, "partnerships", "view", (session.user as any).permissions) &&
      !canPerformAction(session.user.role, "parties", "view", (session.user as any).permissions)
    ) {
      throw userError("You do not have permission to view partners.");
    }
    // Return all parties marked as partner or beneficiary
    const partners = await prisma.party.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        OR: [
          { isPartner: true },
          { isBeneficiary: true },
        ],
      },
      orderBy: [
        { isPartner: "desc" },
        { isBeneficiary: "desc" },
        { name: "asc" },
      ],
      include: {
        partnerWarehouse: { select: { id: true, name: true, type: true } },
      },
    });

    return partners;
  });
}

const adjustSharedWarehouseStockItemSchema = z.object({
  productId: z.string().min(1, "Product is required"),
  warehouseLotId: z.string().optional().nullable(),
  quantity: z.coerce.number().gt(0, "Quantity must be greater than 0"),
  direction: z.enum(["OUT", "IN"]).default("OUT"),
  reason: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
});

const adjustSharedWarehouseStockSchema = z.object({
  partnerId: z.string().min(1, "Partner ID is required"),
  locationId: z.string().min(1, "Warehouse location is required"),
  reason: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  date: z.coerce.date().default(() => new Date()),
  // Single adjustment fields for backward compatibility
  productId: z.string().optional().nullable(),
  warehouseLotId: z.string().optional().nullable(),
  quantity: z.coerce.number().optional().nullable(),
  direction: z.enum(["OUT", "IN"]).optional().nullable(),
  // Bulk adjustment items
  items: z.array(adjustSharedWarehouseStockItemSchema).optional().nullable(),
}).refine(
  (data) => (data.items && data.items.length > 0) || (data.productId && data.quantity && data.quantity > 0),
  { message: "At least one product line item or adjustment item is required", path: ["items"] }
);

export async function adjustSharedWarehouseStockAction(raw: unknown) {
  return runAction("partnerships.adjustSharedStock", async () => {
    const session = await requireSession();
    if (
      !canPerformAction(session.user.role, "partnerships", "update", (session.user as any).permissions) &&
      !canPerformAction(session.user.role, "inventory", "update", (session.user as any).permissions)
    ) {
      throw userError("You do not have permission to adjust shared warehouse stock.");
    }
    const input = parseInput(adjustSharedWarehouseStockSchema, raw);

    const partner = await prisma.party.findUnique({
      where: { id: input.partnerId },
      select: { id: true, name: true },
    });
    if (!partner) throw userError("Partner not found.");

    const location = await prisma.location.findUnique({
      where: { id: input.locationId },
      select: {
        id: true,
        name: true,
        type: true,
        warehouseLots: {
          where: { isActive: true, deletedAt: null },
          select: { id: true, lotNumber: true },
        },
      },
    });
    if (!location) throw userError("Location not found.");
    if (location.type !== "WAREHOUSE") {
      throw userError("Shared warehouse adjustments must target a warehouse location.");
    }

    // Normalize items
    const itemsToProcess: Array<{
      productId: string;
      warehouseLotId?: string | null;
      quantity: number;
      direction: "OUT" | "IN";
      reason: string;
      notes?: string | null;
    }> = [];

    if (input.items && input.items.length > 0) {
      for (const it of input.items) {
        itemsToProcess.push({
          productId: it.productId,
          warehouseLotId: it.warehouseLotId || undefined,
          quantity: it.quantity,
          direction: it.direction || "OUT",
          reason: it.reason?.trim() || input.reason?.trim() || "Warehouse stock adjustment",
          notes: it.notes?.trim() || input.notes?.trim() || undefined,
        });
      }
    } else if (input.productId && input.quantity) {
      itemsToProcess.push({
        productId: input.productId,
        warehouseLotId: input.warehouseLotId || undefined,
        quantity: input.quantity,
        direction: input.direction || "OUT",
        reason: input.reason?.trim() || "Direct adjustment",
        notes: input.notes?.trim() || undefined,
      });
    }

    const createdMovements: string[] = [];

    await withResourceQueue(
      itemsToProcess.map((item) => `stock:${item.productId}:${input.locationId}`),
      async (tx) => {
      const deductions = itemsToProcess
        .filter((item) => item.direction === "OUT")
        .map((item) => ({
          productId: item.productId,
          locationId: input.locationId,
          warehouseLotId: item.warehouseLotId,
          quantity: item.quantity,
        }));
      await assertStockDeductionsAvailable(deductions, tx);

      for (const item of itemsToProcess) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
          select: { id: true, name: true, unit: true },
        });
        if (!product) throw userError(`Product with ID ${item.productId} not found.`);

        let lotRecord: { id: string; lotNumber: string; locationId: string } | null = null;
        if (item.warehouseLotId) {
          lotRecord = await tx.warehouseLot.findFirst({
            where: {
              id: item.warehouseLotId,
              locationId: input.locationId,
              isActive: true,
              deletedAt: null,
            },
            select: { id: true, lotNumber: true, locationId: true },
          });
          if (
            !lotRecord ||
            lotRecord.locationId !== input.locationId ||
            !location.warehouseLots.some((lot) => lot.id === item.warehouseLotId)
          ) {
            throw userError(`The selected lot does not belong to ${location.name}.`);
          }
        }

        if (location.warehouseLots.length > 0 && !item.warehouseLotId) {
          throw userError(
            `A specific lot batch must be selected for stock adjustments at ${location.name}.`
          );
        }

        const delta = item.direction === "IN" ? item.quantity : -item.quantity;
        const refNo = generateDocumentNumber(item.direction === "IN" ? "ADJ-IN" : "ADJ-OUT");
        const lotInfo = lotRecord ? ` [Lot: ${lotRecord.lotNumber}]` : "";
        const desc = `Direct adjustment at ${location.name} (${item.direction}${lotInfo}): ${item.reason}${item.notes ? ` — ${item.notes}` : ""} [Partner: ${partner.name}]`;

        const movement = await tx.stockMovement.create({
          data: {
            productId: item.productId,
            locationId: input.locationId,
            warehouseLotId: item.warehouseLotId || null,
            type: StockMovementType.ADJUSTMENT,
            quantity: delta,
            referenceType: "PARTNER_ADJUSTMENT",
            referenceId: refNo,
            createdById: session.user.id,
            notes: desc,
            createdAt: input.date ?? new Date(),
          },
        });

        createdMovements.push(movement.id);
      }
    },
    );

    emitRealtimeEvent(["inventory", "stock-movements", "dashboard"], "create", "StockMovement", {
      count: createdMovements.length,
      partnerId: partner.id,
    });

    return {
      success: true,
      movementCount: createdMovements.length,
      movementIds: createdMovements,
    };
  });
}

export async function deleteSharedWarehouseAdjustmentAction(raw: unknown) {
  return runAction("partnerships.deleteAdjustment", async () => {
    const session = await requireSession();
    if (
      !canPerformAction(session.user.role, "partnerships", "delete", (session.user as any).permissions) &&
      !canPerformAction(session.user.role, "inventory", "delete", (session.user as any).permissions)
    ) {
      throw userError("You do not have permission to delete shared warehouse adjustments.");
    }
    const { id } = parseInput(z.object({ id: z.string().min(1) }), raw);

    const movement = await prisma.stockMovement.findUnique({
      where: { id },
    });
    if (!movement) throw userError("Adjustment movement not found.");
    if (movement.referenceType !== "PARTNER_ADJUSTMENT" && movement.type !== StockMovementType.ADJUSTMENT) {
      throw userError("Only direct adjustment movements can be deleted here.");
    }

    await prisma.stockMovement.delete({
      where: { id },
    });

    emitRealtimeEvent(["inventory", "stock-movements", "dashboard"], "delete", "StockMovement", { id });

    return { success: true };
  });
}

async function txProduct(productId: string) {
  return prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true, productNo: true, unit: true, costPrice: true },
  });
}

// -------------------------------------------------------------
// Requirement 2: Dedicated Partnership Purchase Entry in the Hub
// -------------------------------------------------------------
const partnershipPurchaseIntakeSchema = z
  .object({
    partnerId: z.string().min(1, "Partner is required"),
    supplierId: z.string().trim().optional().nullable(),
    destinationLocationId: z.string().min(1, "Destination Location is required"),
    lotNumber: z.string().trim().min(1, "Lot Number / Reference is required"),
    warehouseLotId: z.string().trim().optional().nullable(),
    partnerSharePct: z.coerce.number().min(0).max(100).default(100),
    clientSharePct: z.coerce.number().min(0).max(100).default(0),
    date: z.coerce.date().default(() => new Date()),
    notes: z.string().trim().optional().nullable(),
    items: z
      .array(
        z.object({
          productId: z.string().min(1, "Product is required"),
          quantity: z.coerce.number().gt(0, "Quantity must be greater than 0"),
          unitCost: z.coerce.number().min(0, "Unit cost must be 0 or greater"),
        })
      )
      .min(1, "At least one product line item is required"),
  })
  .refine(
    (data) => Math.abs(data.partnerSharePct + data.clientSharePct - 100) < 0.01,
    {
      message: "Partner Share % and Client Share % must total exactly 100%",
      path: ["partnerSharePct"],
    }
  );

export async function partnershipPurchaseIntakeAction(raw: unknown) {
  return runAction("partnerships.purchaseIntake", async () => {
    const session = await requireSession();
    if (
      !canPerformAction(session.user.role, "partnerships", "create", (session.user as any).permissions) &&
      !canPerformAction(session.user.role, "purchases", "create", (session.user as any).permissions)
    ) {
      throw userError("You do not have permission to record partnership stock intake.");
    }
    const input = parseInput(partnershipPurchaseIntakeSchema, raw);

    const partner = await prisma.party.findUnique({
      where: { id: input.partnerId },
      select: { id: true, name: true, partnerWarehouseId: true },
    });
    if (!partner) throw userError("Partner not found.");

    let supplier: { id: string; name: string } | null = null;
    if (input.supplierId) {
      supplier = await prisma.party.findUnique({
        where: { id: input.supplierId },
        select: { id: true, name: true },
      });
      if (!supplier) throw userError("External supplier / vendor not found.");
    }

    const destinationLocation = await prisma.location.findUnique({
      where: { id: input.destinationLocationId },
      select: { id: true, name: true, type: true },
    });
    if (!destinationLocation) throw userError("Destination warehouse location not found.");

    const partnerSharePct = input.partnerSharePct ?? 100;
    const clientSharePct = input.clientSharePct ?? (100 - partnerSharePct);
    const intakeDate = input.date ?? new Date();

    const totalAmount = input.items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
    const partnerCapital = totalAmount * (partnerSharePct / 100);
    const clientCapital = totalAmount * (clientSharePct / 100);

    const activeYear = await prisma.financialYear.findFirst({
      where: { isActive: true, isClosed: false },
    });

    const averageUnitCost =
      input.items.length === 1
        ? input.items[0].unitCost
        : totalAmount / input.items.reduce((s, it) => s + it.quantity, 0);

    const res = await prisma.$transaction(async (tx) => {
      // 1. Create or update the WarehouseLot in Shared Warehouse (prefer explicit lot id)
      let lot =
        (input as { warehouseLotId?: string }).warehouseLotId
          ? await tx.warehouseLot.findUnique({
              where: { id: (input as { warehouseLotId?: string }).warehouseLotId! },
            })
          : null;

      if (lot && lot.locationId !== destinationLocation.id) {
        throw userError("Selected warehouse lot does not belong to the destination warehouse.");
      }

      if (!lot) {
        lot = await tx.warehouseLot.findFirst({
          where: {
            locationId: destinationLocation.id,
            lotNumber: input.lotNumber.trim(),
          },
        });
      }

      if (!lot) {
        lot = await tx.warehouseLot.create({
          data: {
            locationId: destinationLocation.id,
            partnerId: partner.id,
            lotNumber: input.lotNumber.trim(),
            description: `Partnership lot for ${partner.name} (${partnerSharePct}% Partner / ${clientSharePct}% Client)${input.notes ? ` — ${input.notes}` : ""}`,
            unitCost: averageUnitCost,
            partnerSharePct,
            clientSharePct,
            initialCapital: totalAmount,
          },
        });
      } else {
        lot = await tx.warehouseLot.update({
          where: { id: lot.id },
          data: {
            partnerId: partner.id,
            unitCost: averageUnitCost,
            partnerSharePct,
            clientSharePct,
            initialCapital: totalAmount,
          },
        });
      }

      // 2. Generate invoice number
      const invoiceNo = generateDocumentNumber("PINV-SH");

      // 3. Create Purchase Invoice record tagged with partnershipId
      // Decouple from commercial accounts payable:
      // - Marked as PAID with balanceAmount = 0 via PARTNER_CAPITAL
      // - If mill is selected, record in notes/metadata without creating commercial AP ledger liability
      const invoiceSupplierId = supplier ? supplier.id : partner.id;
      const originalSupplierNote = supplier ? ` [Vendor/Mill: ${supplier.name}]` : "";

      const invoice = await tx.purchaseInvoice.create({
        data: {
          invoiceNo,
          financialYearId: activeYear?.id || null,
          supplierId: invoiceSupplierId,
          locationId: destinationLocation.id,
          date: intakeDate,
          status: InvoiceStatus.SETTLED,
          paymentStatus: PaymentStatus.PAID,
          isPartnership: true,
          partnershipId: partner.id,
          partnerSharePct,
          clientSharePct,
          totalAmount,
          amountPaid: totalAmount,
          paidAmount: totalAmount,
          balanceAmount: 0,
          notes: `[Partnership Intake] [Payment Mode: PARTNER_CAPITAL] directly to ${destinationLocation.name} [Partner: ${partner.name}]${originalSupplierNote} (Equity: ${partnerSharePct}% Partner / ${clientSharePct}% Client). Lot: ${lot.lotNumber}${input.notes ? ` — ${input.notes}` : ""}`,
          createdById: session.user.id,
          items: {
            create: input.items.map((it) => ({
              productId: it.productId,
              locationId: destinationLocation.id,
              warehouseLotId: lot.id,
              quantity: it.quantity,
              unitCost: it.unitCost,
              lineTotal: it.quantity * it.unitCost,
            })),
          },
        },
      });

      // 4. Create StockMovement PURCHASE_IN directly into the Shared Warehouse under the specified Lot
      for (const it of input.items) {
        await tx.stockMovement.create({
          data: {
            productId: it.productId,
            locationId: destinationLocation.id,
            warehouseLotId: lot.id,
            type: StockMovementType.PURCHASE_IN,
            quantity: it.quantity,
            referenceType: "PURCHASE_INVOICE",
            referenceId: invoice.id,
            createdById: session.user.id,
            createdAt: intakeDate,
            notes: `Partnership Intake Lot ${lot.lotNumber} (${partnerSharePct}% Partner / ${clientSharePct}% Client)`,
          },
        });
      }

      // 5. Double-entry for Partner Capital Injection:
      // Purchases debit
      await tx.ledgerEntry.create({
        data: {
          partyId: null,
          accountType: AccountType.PURCHASES,
          debit: totalAmount,
          credit: 0,
          isPartnership: true,
          partnershipId: partner.id,
          referenceType: "PURCHASE_INVOICE",
          referenceId: invoice.id,
          date: intakeDate,
          description: `Partnership Intake ${invoice.invoiceNo}: Lot ${lot.lotNumber} (${partnerSharePct}% Partner / ${clientSharePct}% Client)`,
          createdById: session.user.id,
        },
      });

      // Credit Partner B Equity / Capital Account directly (NOT the external mill!)
      // When Partner B injects stock, it directly credits Partner B's capital account
      if (partnerCapital > 0) {
        await tx.ledgerEntry.create({
          data: {
            partyId: partner.id,
            accountType: AccountType.PAYABLE,
            debit: 0,
            credit: partnerCapital,
            isPartnership: true,
            partnershipId: partner.id,
            referenceType: "PURCHASE_INVOICE",
            referenceId: invoice.id,
            date: intakeDate,
            description: `Partner Capital Contribution (${partner.name}): Lot ${lot.lotNumber} (${invoice.invoiceNo}) - ${partnerSharePct}% Partner Equity`,
            createdById: session.user.id,
          },
        });
      }

      // If client share > 0, credit client capital equity
      if (clientCapital > 0) {
        await tx.ledgerEntry.create({
          data: {
            partyId: null,
            accountType: AccountType.PAYABLE,
            debit: 0,
            credit: clientCapital,
            isPartnership: true,
            partnershipId: partner.id,
            referenceType: "PURCHASE_INVOICE",
            referenceId: invoice.id,
            date: intakeDate,
            description: `Client Capital Contribution: Lot ${lot.lotNumber} (${invoice.invoiceNo}) - ${clientSharePct}% Client Equity`,
            createdById: session.user.id,
          },
        });
      }

      // CRITICAL: We intentionally do NOT create any Accounts Payable LedgerEntry for the mill/supplier.
      // Commercial mill payables remain decoupled from partnership capital injection.

      return {
        success: true,
        invoiceId: invoice.id,
        invoiceNo: invoice.invoiceNo,
        lotId: lot.id,
        lotNumber: lot.lotNumber,
        totalAmount,
        partnerCapital,
        clientCapital,
      };
    });

    emitRealtimeEvent(["inventory", "stock-movements", "purchases", "parties"], "create", "PartnershipIntake", {
      invoiceId: res.invoiceId,
    });

    return res;
  });
}

// --------------------------------------------------------------------------
const pullItemSchema = z.object({
  warehouseLotId: z.string().optional().nullable(),
  sourceLotId: z.string().optional().nullable(),
  productId: z.string().min(1, "Product is required"),
  quantity: z.coerce.number().gt(0, "Quantity must be greater than 0"),
  unitCost: z.coerce.number().min(0).optional().nullable(),
});

const pullPartnershipStockToShopSchema = z.object({
  partnerId: z.string().min(1, "Partner ID is required"),
  sourceLocationId: z.string().optional().nullable(),
  destinationLocationId: z.string().optional().nullable(),
  warehouseLotId: z.string().optional().nullable(),
  sourceLotId: z.string().optional().nullable(),
  productId: z.string().optional().nullable(),
  quantity: z.coerce.number().optional().nullable(),
  unitCost: z.coerce.number().min(0).optional().nullable(),
  date: z.coerce.date().default(() => new Date()),
  notes: z.string().trim().optional().nullable(),
  items: z.array(pullItemSchema).optional().nullable(),
});

export async function pullPartnershipStockToShopAction(raw: unknown) {
  return runAction("partnerships.pullToShop", async () => {
    const session = await requireSession();
    if (
      !canPerformAction(session.user.role, "partnerships", "update", (session.user as any).permissions) &&
      !canPerformAction(session.user.role, "inventory", "update", (session.user as any).permissions)
    ) {
      throw userError("You do not have permission to pull partnership stock to shop.");
    }
    const input = parseInput(pullPartnershipStockToShopSchema, raw);

    const partner = await prisma.party.findUnique({
      where: { id: input.partnerId },
      select: { id: true, name: true },
    });
    if (!partner) throw userError("Partner not found.");

    // Normalize single vs multi-item pull
    type NormalizedItem = {
      lotId: string;
      productId: string;
      quantity: number;
      unitCost?: number | null;
    };
    const pullItems: NormalizedItem[] = [];

    if (input.items && input.items.length > 0) {
      for (const it of input.items) {
        const lotId = it.warehouseLotId || it.sourceLotId;
        if (!lotId) throw userError("Warehouse Lot is required for all pull items.");
        if (!it.productId) throw userError("Product is required for all pull items.");
        if (!it.quantity || it.quantity <= 0) throw userError("Quantity must be greater than 0.");
        pullItems.push({
          lotId,
          productId: it.productId,
          quantity: Number(it.quantity),
          unitCost: it.unitCost != null ? Number(it.unitCost) : null,
        });
      }
    } else {
      const lotId = input.warehouseLotId || input.sourceLotId;
      if (!lotId) throw userError("Partnership Lot in Shared Warehouse is required.");
      if (!input.productId) throw userError("Product is required.");
      if (!input.quantity || input.quantity <= 0) throw userError("Quantity must be greater than 0.");
      pullItems.push({
        lotId,
        productId: input.productId,
        quantity: Number(input.quantity),
        unitCost: input.unitCost != null ? Number(input.unitCost) : null,
      });
    }

    // Resolve destination shop location
    let destinationLocation = input.destinationLocationId
      ? await prisma.location.findUnique({
          where: { id: input.destinationLocationId },
          select: { id: true, name: true, type: true },
        })
      : null;

    if (!destinationLocation) {
      destinationLocation = await prisma.location.findFirst({
        where: { isActive: true, deletedAt: null, type: "SHOP" },
        select: { id: true, name: true, type: true },
      });
    }
    if (!destinationLocation) throw userError("Destination Shop location not found.");
    if (destinationLocation.type !== "SHOP") {
      throw userError("Partnership stock must be received at a shop location.");
    }

    const activeYear = await prisma.financialYear.findFirst({
      where: { isActive: true, isClosed: false },
    });

    const pullDate = input.date ?? new Date();

    // Validate all items and their lots
    const validatedRows: Array<{
      sourceLot: { id: string; lotNumber: string; locationId: string; partnerSharePct: any; clientSharePct: any; unitCost: any };
      product: { id: string; name: string; productNo: string; unit: string; costPrice: any };
      sourceLocationId: string;
      sourceLocationName: string;
      quantity: number;
      baseCost: number;
      totalValuation: number;
      partnerSharePct: number;
      clientSharePct: number;
      payableToPartner: number;
    }> = [];

    for (const item of pullItems) {
      const sourceLot = await prisma.warehouseLot.findUnique({
        where: { id: item.lotId },
      });
      if (!sourceLot) throw userError(`Selected partnership source lot (${item.lotId}) not found.`);
      if (sourceLot.partnerId !== partner.id) {
        throw userError(`Selected lot ${sourceLot.lotNumber} is not assigned to ${partner.name}.`);
      }

      const sourceLocationId = input.sourceLocationId || sourceLot.locationId;
      const sourceLocation = await prisma.location.findUnique({
        where: { id: sourceLocationId },
        select: { id: true, name: true, type: true },
      });
      if (!sourceLocation) throw userError(`Source Warehouse location (${sourceLocationId}) not found.`);
      if (sourceLocation.type !== "WAREHOUSE" || sourceLot.locationId !== sourceLocation.id) {
        throw userError(`Selected lot ${sourceLot.lotNumber} does not belong to the source warehouse.`);
      }

      const product = await prisma.product.findUnique({
        where: { id: item.productId },
        select: { id: true, name: true, productNo: true, unit: true, costPrice: true },
      });
      if (!product) throw userError(`Product not found.`);

      const available = await getStockOnHand(item.productId, sourceLocationId, undefined, sourceLot.id);
      if (available < item.quantity) {
        throw userError(
          `Insufficient stock in ${sourceLocation.name} for ${product.name} (Lot ${sourceLot.lotNumber}). Available: ${available} ${product.unit}, Requested: ${item.quantity}`
        );
      }

      const partnerSharePct = sourceLot.partnerSharePct != null ? Number(sourceLot.partnerSharePct) : 100;
      const clientSharePct = sourceLot.clientSharePct != null ? Number(sourceLot.clientSharePct) : 0;
      const baseCost =
        item.unitCost != null && item.unitCost > 0
          ? item.unitCost
          : sourceLot.unitCost != null
          ? Number(sourceLot.unitCost)
          : Number(product.costPrice);

      const totalValuation = item.quantity * baseCost;
      const payableToPartner = totalValuation * (partnerSharePct / 100);

      validatedRows.push({
        sourceLot,
        product,
        sourceLocationId,
        sourceLocationName: sourceLocation.name,
        quantity: item.quantity,
        baseCost,
        totalValuation,
        partnerSharePct,
        clientSharePct,
        payableToPartner,
      });
    }

    const totalBatchValuation = validatedRows.reduce((sum, r) => sum + r.totalValuation, 0);
    const totalBatchPayable = validatedRows.reduce((sum, r) => sum + r.payableToPartner, 0);

    const res = await withResourceQueue(
      validatedRows.flatMap((row) => [
        `stock:${row.product.id}:${row.sourceLocationId}`,
        `stock:${row.product.id}:${destinationLocation.id}`,
      ]),
      async (tx) => {
      const invoiceNo = generateDocumentNumber("PINV-PULL");

      await assertStockDeductionsAvailable(
        validatedRows.map((row) => ({
          productId: row.product.id,
          locationId: row.sourceLocationId,
          warehouseLotId: row.sourceLot.id,
          quantity: row.quantity,
        })),
        tx,
      );

      // 1. Process or find shop lots for each line
      const invoiceItemsData: Array<{
        productId: string;
        locationId: string;
        warehouseLotId: string;
        quantity: number;
        unitCost: number;
        lineTotal: number;
      }> = [];

      for (const row of validatedRows) {
        let shopLot = await tx.warehouseLot.findFirst({
          where: {
            locationId: destinationLocation.id,
            lotNumber: row.sourceLot.lotNumber,
          },
        });

        if (!shopLot) {
          shopLot = await tx.warehouseLot.create({
            data: {
              locationId: destinationLocation.id,
              partnerId: partner.id,
              lotNumber: row.sourceLot.lotNumber,
              description: `Pulled from ${row.sourceLocationName} [Lot ${row.sourceLot.lotNumber}] (${row.partnerSharePct}% Partner / ${row.clientSharePct}% Client)`,
              unitCost: row.baseCost,
              partnerSharePct: row.partnerSharePct,
              clientSharePct: row.clientSharePct,
            },
          });
        } else if (shopLot.partnerId && shopLot.partnerId !== partner.id) {
          throw userError(
            `Shop lot ${shopLot.lotNumber} is already assigned to a different partner.`
          );
        } else if (!shopLot.partnerId) {
          shopLot = await tx.warehouseLot.update({
            where: { id: shopLot.id },
            data: {
              partnerId: partner.id,
              unitCost: row.baseCost,
              partnerSharePct: row.partnerSharePct,
              clientSharePct: row.clientSharePct,
            },
          });
        }

        invoiceItemsData.push({
          productId: row.product.id,
          locationId: destinationLocation.id,
          warehouseLotId: shopLot.id,
          quantity: row.quantity,
          unitCost: row.baseCost,
          lineTotal: row.totalValuation,
        });

        // Decrement shared warehouse
        await tx.stockMovement.create({
          data: {
            productId: row.product.id,
            locationId: row.sourceLocationId,
            warehouseLotId: row.sourceLot.id,
            type: StockMovementType.TRANSFER_OUT,
            quantity: row.quantity,
            referenceType: "PARTNERSHIP_PULL",
            referenceId: invoiceNo,
            createdById: session.user.id,
            createdAt: pullDate,
            notes: `Pulled to shop floor ${destinationLocation.name} via ${invoiceNo}`,
          },
        });

        // Receive in shop
        await tx.stockMovement.create({
          data: {
            productId: row.product.id,
            locationId: destinationLocation.id,
            warehouseLotId: shopLot.id,
            type: StockMovementType.PURCHASE_IN,
            quantity: row.quantity,
            referenceType: "PURCHASE_INVOICE",
            referenceId: invoiceNo,
            createdById: session.user.id,
            createdAt: pullDate,
            notes: `Stock pull received at ${destinationLocation.name} [Lot: ${shopLot.lotNumber}] at full cost PKR ${row.baseCost}`,
          },
        });
      }

      // 2. Create Purchase Invoice record tagged with partnershipId
      const invoice = await tx.purchaseInvoice.create({
        data: {
          invoiceNo,
          financialYearId: activeYear?.id || null,
          supplierId: partner.id,
          locationId: destinationLocation.id,
          date: pullDate,
          status: InvoiceStatus.OPEN,
          isPartnership: true,
          partnershipId: partner.id,
          partnerSharePct: validatedRows[0].partnerSharePct,
          clientSharePct: validatedRows[0].clientSharePct,
          totalAmount: totalBatchPayable,
          amountPaid: 0,
          notes: `Stock pull from Shared Warehouse into ${destinationLocation.name} (${validatedRows.length} item${validatedRows.length > 1 ? "s" : ""}). Total Valuation: PKR ${totalBatchValuation}, Payable Liability: PKR ${totalBatchPayable}${input.notes ? ` — ${input.notes}` : ""}`,
          createdById: session.user.id,
          items: {
            create: invoiceItemsData,
          },
        },
      });

      // 3. Ledger entries:
      // Purchases expense: total value of incoming stock
      await tx.ledgerEntry.create({
        data: {
          partyId: null,
          accountType: AccountType.PURCHASES,
          debit: totalBatchValuation,
          credit: 0,
          isPartnership: true,
          partnershipId: partner.id,
          referenceType: "PURCHASE_INVOICE",
          referenceId: invoice.id,
          date: pullDate,
          description: `Inventory pull to ${destinationLocation.name}: ${validatedRows.map((r) => `${r.quantity} ${r.product.unit} ${r.product.name}`).join(", ")}`,
          createdById: session.user.id,
        },
      });

      // Payable to Partner B: Total payable liability portion
      await tx.ledgerEntry.create({
        data: {
          partyId: partner.id,
          accountType: AccountType.PAYABLE,
          debit: 0,
          credit: totalBatchPayable,
          isPartnership: true,
          partnershipId: partner.id,
          referenceType: "PURCHASE_INVOICE",
          referenceId: invoice.id,
          date: pullDate,
          description: `Payable to ${partner.name} for inventory pull (${invoice.invoiceNo})`,
          createdById: session.user.id,
        },
      });

      return {
        success: true,
        invoiceId: invoice.id,
        invoiceNo: invoice.invoiceNo,
        payableToPartner: totalBatchPayable,
        totalValuation: totalBatchValuation,
        partnerSharePct: validatedRows[0].partnerSharePct,
        quantityMoved: validatedRows.reduce((sum, r) => sum + r.quantity, 0),
        itemsCount: validatedRows.length,
      };
      },
    );

    emitRealtimeEvent(["inventory", "stock-movements", "purchases", "parties", "ledger"], "create", "StockPull", {
      invoiceId: res.invoiceId,
    });

    return res;
  });
}

// --------------------------------------------------------------------------
// Requirement 4: Financial Tracking & Profit Settlement Engine
// --------------------------------------------------------------------------
export async function getPartnershipHubDataAction(
  partnerId: string,
  filters?: { startDate?: string; endDate?: string; lotId?: string }
) {
  return runAction("partnerships.hubData", async () => {
    const session = await requireSession();
    if (
      !canPerformAction(session.user.role, "partnerships", "view", (session.user as any).permissions) &&
      !canPerformAction(session.user.role, "inventory", "view", (session.user as any).permissions)
    ) {
      throw userError("You do not have permission to view partnership hub data.");
    }

    const partner = await prisma.party.findUnique({
      where: { id: partnerId },
      include: {
        partnerWarehouse: { select: { id: true, name: true, type: true } },
      },
    });

    if (!partner) {
      throw userError("Partner not found.");
    }

    // Resolve Partner Warehouse location
    let sharedWarehouse = partner.partnerWarehouse;
    if (!sharedWarehouse && partner.partnerWarehouseId) {
      sharedWarehouse = await prisma.location.findUnique({
        where: { id: partner.partnerWarehouseId },
        select: { id: true, name: true, type: true },
      });
    }
    if (!sharedWarehouse) {
      sharedWarehouse =
        (await prisma.location.findFirst({
          where: {
            isActive: true,
            deletedAt: null,
            type: "WAREHOUSE",
            OR: [
              { name: { contains: "Partner", mode: "insensitive" } },
              { name: { contains: "Shared", mode: "insensitive" } },
            ],
          },
          select: { id: true, name: true, type: true },
        })) ||
        (await prisma.location.findFirst({
          where: {
            isActive: true,
            deletedAt: null,
            type: "WAREHOUSE",
          },
          select: { id: true, name: true, type: true },
        })) ||
        null;
    }

    // Resolve Shop location
    const shopLocation =
      (await prisma.location.findFirst({
        where: {
          isActive: true,
          deletedAt: null,
          type: "SHOP",
        },
        select: { id: true, name: true, type: true },
      })) ||
      (await prisma.location.findFirst({
        where: { isActive: true, deletedAt: null },
        select: { id: true, name: true, type: true },
      }));

    // 1. Current ledger balance payable to Person B (Partnership isolated & Consolidated)
    const partnershipLedgerBalance = await getPartyBalance(partner.id, undefined, undefined, "PARTNERSHIP");
    const regularLedgerBalance = await getPartyBalance(partner.id, undefined, undefined, "REGULAR");
    const consolidatedLedgerBalance = await getPartyBalance(partner.id, undefined, undefined, "ALL");

    // 2. All purchase invoices tagged with this partnership
    const purchaseInvoices = await prisma.purchaseInvoice.findMany({
      where: {
        OR: [
          { partnershipId: partner.id },
          { supplierId: partner.id, isPartnership: true },
        ],
        status: { not: InvoiceStatus.CANCELLED },
      },
      include: {
        items: {
          include: {
            product: { select: { id: true, productNo: true, name: true, unit: true, costPrice: true } },
            warehouseLot: true,
            location: true,
          },
        },
      },
      orderBy: { date: "desc" },
    });

    const purchaseOrders = await prisma.purchaseOrder.findMany({
      where: {
        OR: [
          { partnershipId: partner.id },
          { supplierId: partner.id, isPartnership: true },
        ],
      },
      include: {
        location: { select: { id: true, name: true } },
        items: {
          include: {
            product: { select: { id: true, productNo: true, name: true, unit: true } },
            warehouseLot: { select: { id: true, lotNumber: true } },
            destinationLocation: { select: { id: true, name: true } },
          },
        },
        invoices: { select: { id: true, invoiceNo: true, status: true, date: true, totalAmount: true } },
      },
      orderBy: { date: "desc" },
    });

    // Collect all partnership lots belonging to Person B, or referenced in partnership invoices
    const partnerLots = await prisma.warehouseLot.findMany({
      where: {
        deletedAt: null,
        OR: [
          { partnerId: partner.id },
          { id: { in: purchaseInvoices.flatMap((inv) => inv.items.map((i) => i.warehouseLotId).filter(Boolean) as string[]) } },
        ],
      },
      include: {
        location: { select: { id: true, name: true, type: true } },
      },
    });

    const partnerLotIds = Array.from(new Set(partnerLots.map((l) => l.id)));

    // Collect all warehouse location IDs associated with partner lots
    const partnerWarehouseIds = new Set<string>();
    if (sharedWarehouse) partnerWarehouseIds.add(sharedWarehouse.id);
    if (partner.partnerWarehouseId) partnerWarehouseIds.add(partner.partnerWarehouseId);
    for (const lot of partnerLots) {
      if (lot.locationId && (!shopLocation || lot.locationId !== shopLocation.id)) {
        partnerWarehouseIds.add(lot.locationId);
      }
    }

    // 3. Stock Movements for partner lots and shared warehouse
    const lotStockMovements = await prisma.stockMovement.findMany({
      where: {
        warehouseLotId: { in: partnerLotIds },
      },
      include: {
        product: { select: { id: true, productNo: true, name: true, unit: true, costPrice: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    // 4. Calculate stock in Shop vs stock in Shared Warehouse by lot AND product
    const shopLotQtyMap = new Map<string, number>(); // compositeKey -> quantity in shop
    const sharedWhLotQtyMap = new Map<string, number>(); // compositeKey -> quantity in shared warehouse
    const lotReceivedQtyMap = new Map<string, number>(); // compositeKey -> total units received
    const lotPulledQtyMap = new Map<string, number>(); // compositeKey -> units transferred to shop
    const lotSoldDirectQtyMap = new Map<string, number>(); // compositeKey -> units sold directly from shared wh

    for (const m of lotStockMovements) {
      if (!m.warehouseLotId) continue;
      const qty = Number(m.quantity);
      const isShop = shopLocation && m.locationId === shopLocation.id;
      const isSharedWh =
        !isShop &&
        (partnerWarehouseIds.size === 0 ||
          partnerWarehouseIds.has(m.locationId) ||
          (sharedWarehouse && m.locationId === sharedWarehouse.id) ||
          !shopLocation ||
          m.locationId !== shopLocation.id);

      const lotKey = m.warehouseLotId;
      const compositeKey = m.productId ? `${lotKey}:${m.productId}` : lotKey;

      if (isSharedWh) {
        if (m.type === "PURCHASE_IN" || m.type === "TRANSFER_IN" || m.type === "SALE_RETURN" || (m.type === "ADJUSTMENT" && qty > 0)) {
          sharedWhLotQtyMap.set(compositeKey, (sharedWhLotQtyMap.get(compositeKey) ?? 0) + qty);
          if (m.type === "PURCHASE_IN") {
            lotReceivedQtyMap.set(compositeKey, (lotReceivedQtyMap.get(compositeKey) ?? 0) + qty);
          }
        } else if (m.type === "SALE_OUT" || m.type === "TRANSFER_OUT" || m.type === "DELIVERY_OUT" || m.type === "PURCHASE_RETURN" || (m.type === "ADJUSTMENT" && qty < 0)) {
          const absQty = Math.abs(qty);
          sharedWhLotQtyMap.set(compositeKey, (sharedWhLotQtyMap.get(compositeKey) ?? 0) - absQty);
          if (m.type === "TRANSFER_OUT" || m.referenceType === "PARTNERSHIP_PULL") {
            lotPulledQtyMap.set(compositeKey, (lotPulledQtyMap.get(compositeKey) ?? 0) + absQty);
          } else if (m.type === "SALE_OUT" || m.type === "ADJUSTMENT") {
            lotSoldDirectQtyMap.set(compositeKey, (lotSoldDirectQtyMap.get(compositeKey) ?? 0) + absQty);
          }
        }
      }

      if (isShop) {
        if (m.type === "PURCHASE_IN" || m.type === "TRANSFER_IN" || m.type === "SALE_RETURN" || (m.type === "ADJUSTMENT" && qty > 0)) {
          shopLotQtyMap.set(compositeKey, (shopLotQtyMap.get(compositeKey) ?? 0) + qty);
        } else if (m.type === "SALE_OUT" || m.type === "TRANSFER_OUT" || m.type === "DELIVERY_OUT" || m.type === "PURCHASE_RETURN" || (m.type === "ADJUSTMENT" && qty < 0)) {
          const absQty = Math.abs(qty);
          shopLotQtyMap.set(compositeKey, (shopLotQtyMap.get(compositeKey) ?? 0) - absQty);
        }
      }
    }

    // 5. Initial Capital Invested Breakdown
    let partnerCapitalInvested = 0;
    let clientCapitalInvested = 0;

    for (const lot of partnerLots) {
      if (shopLocation && lot.locationId === shopLocation.id) {
        continue;
      }
      const pShare = lot.partnerSharePct != null ? Number(lot.partnerSharePct) : 100;
      const cShare = lot.clientSharePct != null ? Number(lot.clientSharePct) : (100 - pShare);

      let lotCap = 0;
      if (lot.initialCapital != null && Number(lot.initialCapital) > 0) {
        lotCap = Number(lot.initialCapital);
      } else {
        const received = lotReceivedQtyMap.get(lot.id) ?? 0;
        const cost = lot.unitCost != null ? Number(lot.unitCost) : 0;
        lotCap = received * cost;
      }

      partnerCapitalInvested += lotCap * (pShare / 100);
      clientCapitalInvested += lotCap * (cShare / 100);
    }
    const totalInitialCapital = partnerCapitalInvested + clientCapitalInvested;

    // 6. Current Warehouse Stock Valuation
    let currentStockValuationSharedWarehouse = 0;
    const sharedWarehouseQtyMap = new Map<string, number>();

    let sharedMovements: Array<{
      id: string;
      productId: string;
      locationId: string;
      type: StockMovementType;
      quantity: any;
      referenceType: string | null;
      referenceId: string | null;
      notes: string | null;
      createdAt: Date;
      product: { id: string; productNo: string; name: string; unit: string; costPrice: any };
      createdBy: { id: string; name: string } | null;
    }> = [];

    if (sharedWarehouse || partnerWarehouseIds.size > 0 || partnerLotIds.length > 0) {
      sharedMovements = await prisma.stockMovement.findMany({
        where: {
          OR: [
            ...(partnerWarehouseIds.size > 0 ? [{ locationId: { in: Array.from(partnerWarehouseIds) } }] : []),
            ...(partnerLotIds.length > 0 ? [{ warehouseLotId: { in: partnerLotIds } }] : []),
          ],
        },
        include: {
          product: { select: { id: true, productNo: true, name: true, unit: true, costPrice: true } },
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      });

      for (const m of sharedMovements) {
        const qty = Number(m.quantity);
        const cur = sharedWarehouseQtyMap.get(m.productId) ?? 0;
        if (m.type === "PURCHASE_IN" || m.type === "TRANSFER_IN" || m.type === "SALE_RETURN" || (m.type === "ADJUSTMENT" && qty > 0)) {
          sharedWarehouseQtyMap.set(m.productId, cur + qty);
        } else if (m.type === "SALE_OUT" || m.type === "TRANSFER_OUT" || m.type === "DELIVERY_OUT" || m.type === "PURCHASE_RETURN" || (m.type === "ADJUSTMENT" && qty < 0)) {
          sharedWarehouseQtyMap.set(m.productId, cur - Math.abs(qty));
        }
      }

      const productIds = Array.from(sharedWarehouseQtyMap.keys());
      if (productIds.length > 0) {
        const prods = await prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, costPrice: true },
        });
        const costMap = new Map(prods.map((p) => [p.id, Number(p.costPrice)]));
        for (const [pId, qty] of sharedWarehouseQtyMap.entries()) {
          if (qty > 0) {
            currentStockValuationSharedWarehouse += qty * (costMap.get(pId) ?? 0);
          }
        }
      }
    }

    // 7. Capital Reimbursed / Owed from A pulling stock into the shop
    // Calculate total capital liability accrued to B from stock pulls
    let capitalLiabilityAccrued = 0;
    const stockMovedToShop: Array<{
      id: string;
      date: Date;
      invoiceNo: string;
      productNo: string;
      productName: string;
      lotNumber: string;
      quantity: number;
      unit: string;
      unitCost: number;
      totalCost: number;
      partnerSharePct: number;
      owedToB: number;
    }> = [];

    // Pulls come from purchase invoices where Person B is the supplier (Person A buying/pulling into shop)
    const pullInvoices = purchaseInvoices.filter(
      (inv) => inv.supplierId === partner.id && !inv.notes?.includes("Partnership Intake")
    );

    for (const inv of pullInvoices) {
      for (const item of inv.items) {
        const lot = item.warehouseLot;
        const pShare = lot?.partnerSharePct != null ? Number(lot.partnerSharePct) : (inv.partnerSharePct != null ? Number(inv.partnerSharePct) : 100);
        const qty = Number(item.quantity);
        const uCost = Number(item.unitCost);
        const lineTotal = qty * uCost;
        const owedToB = lineTotal * (pShare / 100);

        capitalLiabilityAccrued += owedToB;

        stockMovedToShop.push({
          id: item.id,
          date: inv.date,
          invoiceNo: inv.invoiceNo,
          productNo: item.product.productNo,
          productName: item.product.name,
          lotNumber: lot?.lotNumber || "N/A",
          quantity: qty,
          unit: item.product.unit,
          unitCost: uCost,
          totalCost: lineTotal,
          partnerSharePct: pShare,
          owedToB,
        });
      }
    }

    // Payments already made to B tagged with partnership or general payments to B
    const partnerPayments = await prisma.payment.findMany({
      where: {
        partyId: partner.id,
        direction: "OUT",
        ...(filters?.startDate || filters?.endDate
          ? {
              date: {
                ...(filters.startDate ? { gte: new Date(filters.startDate) } : {}),
                ...(filters.endDate ? { lte: new Date(filters.endDate) } : {}),
              },
            }
          : {}),
      },
      select: {
        id: true,
        receiptNo: true,
        date: true,
        amount: true,
        method: true,
        notes: true,
        isPartnership: true,
      },
      orderBy: { date: "desc" },
    });

    const totalPaymentsToB = partnerPayments.reduce((sum, p) => sum + Number(p.amount), 0);
    const capitalReimbursedToPartner = totalPaymentsToB;
    const unpaidCapitalReimbursement = Math.max(0, capitalLiabilityAccrued - capitalReimbursedToPartner);

    // 8. Sales & Settlement Log with dynamic equity splits
    const dateFilter: any = {};
    if (filters?.startDate) {
      dateFilter.gte = new Date(filters.startDate);
    }
    if (filters?.endDate) {
      dateFilter.lte = new Date(filters.endDate);
    }

    const statementLotIds = filters?.lotId ? [filters.lotId] : partnerLotIds;
    const allPartnerSaleMovements =
      statementLotIds.length > 0
        ? await prisma.stockMovement.findMany({
            where: {
              referenceType: "SALE_INVOICE",
              type: StockMovementType.SALE_OUT,
              warehouseLotId: { in: statementLotIds },
            },
            include: {
              product: {
                select: { id: true, productNo: true, name: true, unit: true, costPrice: true },
              },
              warehouseLot: {
                select: { id: true, lotNumber: true, unitCost: true, partnerSharePct: true, clientSharePct: true },
              },
            },
          })
        : [];
    const movementInvoiceIds = Array.from(
      new Set(allPartnerSaleMovements.map((movement) => movement.referenceId)),
    );
    const saleInvoicesForStatement = movementInvoiceIds.length
      ? await prisma.saleInvoice.findMany({
          where: {
            id: { in: movementInvoiceIds },
            status: { not: InvoiceStatus.CANCELLED },
            ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
          },
          select: {
            id: true,
            invoiceNo: true,
            date: true,
            customer: { select: { name: true } },
            walkInName: true,
          },
        })
      : [];
    const invoiceById = new Map(saleInvoicesForStatement.map((invoice) => [invoice.id, invoice]));
    const partnerSaleMovements = allPartnerSaleMovements.filter((movement) =>
      invoiceById.has(movement.referenceId),
    );
    const invoiceIds = Array.from(new Set(partnerSaleMovements.map((movement) => movement.referenceId)));
    const saleItemsForRates = invoiceIds.length
      ? await prisma.saleInvoiceItem.findMany({
          where: {
            invoiceId: { in: invoiceIds },
            productId: { in: Array.from(new Set(partnerSaleMovements.map((movement) => movement.productId))) },
          },
          select: { invoiceId: true, productId: true, quantity: true, unitPrice: true },
        })
      : [];
    const ratesByInvoiceProduct = new Map<string, { quantity: number; saleValue: number }>();
    for (const item of saleItemsForRates) {
      const key = `${item.invoiceId}:${item.productId}`;
      const aggregate = ratesByInvoiceProduct.get(key) || { quantity: 0, saleValue: 0 };
      const quantity = Number(item.quantity);
      aggregate.quantity += quantity;
      aggregate.saleValue += quantity * Number(item.unitPrice);
      ratesByInvoiceProduct.set(key, aggregate);
    }
    const soldByInvoiceProductLot = new Map<string, { movement: (typeof partnerSaleMovements)[number]; quantity: number }>();
    for (const movement of partnerSaleMovements) {
      const key = `${movement.referenceId}:${movement.productId}:${movement.warehouseLotId}`;
      const aggregate = soldByInvoiceProductLot.get(key);
      if (aggregate) {
        aggregate.quantity += Number(movement.quantity);
      } else {
        soldByInvoiceProductLot.set(key, { movement, quantity: Number(movement.quantity) });
      }
    }

    const settlementLog = Array.from(soldByInvoiceProductLot.values()).map(({ movement, quantity }) => {
      const invoice = invoiceById.get(movement.referenceId)!;
      const saleRate = ratesByInvoiceProduct.get(`${invoice.id}:${movement.productId}`);
      const unitSellingPrice = saleRate && saleRate.quantity > 0
        ? saleRate.saleValue / saleRate.quantity
        : 0;
      const unitLotCost =
        movement.warehouseLot?.unitCost != null
          ? Number(movement.warehouseLot.unitCost)
          : Number(movement.product.costPrice);

      const totalSale = quantity * unitSellingPrice;
      const totalCost = quantity * unitLotCost;
      const netMargin = totalSale - totalCost;

      const partnerSharePct = movement.warehouseLot?.partnerSharePct != null
        ? Number(movement.warehouseLot.partnerSharePct)
        : 100;
      const partnerProfitShare = netMargin * (partnerSharePct / 100);

      return {
        id: `${invoice.id}:${movement.productId}:${movement.warehouseLotId}`,
        date: invoice.date,
        invoiceId: invoice.id,
        invoiceNo: invoice.invoiceNo,
        customerName: invoice.customer?.name || invoice.walkInName || "Customer",
        productId: movement.productId,
        productName: movement.product.name,
        productNo: movement.product.productNo,
        lotNumber: movement.warehouseLot?.lotNumber || "N/A",
        partnerSharePct,
        quantity,
        unit: movement.product.unit,
        unitSellingPrice,
        unitLotCost,
        totalSale,
        totalCost,
        netMargin,
        partnerProfitShare,
      };
    });

    const totalSalesRevenue = settlementLog.reduce((sum, item) => sum + item.totalSale, 0);
    const totalCOGS = settlementLog.reduce((sum, item) => sum + item.totalCost, 0);
    const totalRealizedProfit = totalSalesRevenue - totalCOGS;
    const partnerProfitShare = settlementLog.reduce((sum, item) => sum + item.partnerProfitShare, 0);

    // Requirement 4: Net Payable to Partner = (Unpaid Capital Reimbursement) + (Unsettled Partner Profit Share)
    const netPayableToPartner = unpaidCapitalReimbursement + partnerProfitShare;

    // 9. Product Breakdown & Lot History Table
    const relevantProductIds = new Set<string>();
    for (const inv of purchaseInvoices) {
      for (const item of inv.items) {
        if (item.productId) relevantProductIds.add(item.productId);
      }
    }
    for (const m of sharedMovements) {
      if (m.productId) relevantProductIds.add(m.productId);
    }
    for (const m of lotStockMovements) {
      if (m.productId) relevantProductIds.add(m.productId);
    }
    for (const s of settlementLog) {
      if (s.productId) relevantProductIds.add(s.productId);
    }

    // Map all (lotId -> Set<productId>) associations
    const lotProductPairs = new Map<string, Set<string>>();
    for (const m of lotStockMovements) {
      if (m.warehouseLotId && m.productId) {
        if (!lotProductPairs.has(m.warehouseLotId)) lotProductPairs.set(m.warehouseLotId, new Set());
        lotProductPairs.get(m.warehouseLotId)!.add(m.productId);
      }
    }
    for (const inv of purchaseInvoices) {
      for (const item of inv.items) {
        if (item.warehouseLotId && item.productId) {
          if (!lotProductPairs.has(item.warehouseLotId)) lotProductPairs.set(item.warehouseLotId, new Set());
          lotProductPairs.get(item.warehouseLotId)!.add(item.productId);
        }
      }
    }

    const allRelevantProducts = await prisma.product.findMany({
      where: {
        id: { in: Array.from(relevantProductIds) },
        deletedAt: null,
      },
      select: { id: true, productNo: true, name: true, unit: true, costPrice: true },
    });

    const productAggregationMap = new Map<string, {
      product: { id: string; productNo: string; name: string; unit: string; costPrice: number };
      totalQtyPurchased: number;
      batchPurchaseCost: number;
      totalPurchaseCost: number;
      totalQtySold: number;
      totalSalesRevenue: number;
      totalCostOfSold: number;
      grossMargin: number;
      partnerProfitShare: number;
      remainingInShop: number;
      remainingInSharedWarehouse: number;
      lots: Array<{
        id: string;
        lotNumber: string;
        partnerSharePct: number;
        clientSharePct: number;
        equityBadge: string;
        inwardDate: Date;
        inwardPrice: number;
        qtyReceived: number;
        qtyTransferredToShop: number;
        qtySoldDirect: number;
        qtyRemainingSharedWarehouse: number;
        qtyRemainingInShop: number;
      }>;
    }>();

    for (const p of allRelevantProducts) {
      productAggregationMap.set(p.id, {
        product: {
          id: p.id,
          productNo: p.productNo,
          name: p.name,
          unit: p.unit,
          costPrice: Number(p.costPrice),
        },
        totalQtyPurchased: 0,
        batchPurchaseCost: 0,
        totalPurchaseCost: 0,
        totalQtySold: 0,
        totalSalesRevenue: 0,
        totalCostOfSold: 0,
        grossMargin: 0,
        partnerProfitShare: 0,
        remainingInShop: 0,
        remainingInSharedWarehouse: 0,
        lots: [],
      });
    }

    // Populate lots for each product
    for (const lot of partnerLots) {
      const productIds = lotProductPairs.get(lot.id);
      const targetPids = productIds && productIds.size > 0 ? Array.from(productIds) : [];

      if (targetPids.length === 0) {
        continue;
      }

      for (const pId of targetPids) {
        const entry = productAggregationMap.get(pId);
        if (!entry) continue;

        const pShare = lot.partnerSharePct != null ? Number(lot.partnerSharePct) : 100;
        const cShare = lot.clientSharePct != null ? Number(lot.clientSharePct) : (100 - pShare);
        const equityBadge =
          pShare === 100 && cShare === 0
            ? "100% Partner"
            : pShare === 50 && cShare === 50
            ? "50 / 50"
            : `${pShare}% Partner / ${cShare}% Client`;

        const compositeKey = `${lot.id}:${pId}`;
        const received = lotReceivedQtyMap.get(compositeKey) ?? 0;
        const pulled = lotPulledQtyMap.get(compositeKey) ?? 0;
        const soldDirect = lotSoldDirectQtyMap.get(compositeKey) ?? 0;
        const remainingWh = Math.max(0, sharedWhLotQtyMap.get(compositeKey) ?? 0);
        const remainingShop = Math.max(0, shopLotQtyMap.get(compositeKey) ?? 0);

        entry.lots.push({
          id: lot.id,
          lotNumber: lot.lotNumber,
          partnerSharePct: pShare,
          clientSharePct: cShare,
          equityBadge,
          inwardDate: lot.createdAt,
          inwardPrice: lot.unitCost != null ? Number(lot.unitCost) : entry.product.costPrice,
          qtyReceived: received,
          qtyTransferredToShop: pulled,
          qtySoldDirect: soldDirect,
          qtyRemainingSharedWarehouse: remainingWh,
          qtyRemainingInShop: remainingShop,
        });

        entry.totalQtyPurchased += received;
        entry.totalPurchaseCost += received * (lot.unitCost != null ? Number(lot.unitCost) : entry.product.costPrice);
      }
    }

    // Add sales data into products
    for (const sale of settlementLog) {
      const entry = productAggregationMap.get(sale.productId);
      if (entry) {
        entry.totalQtySold += sale.quantity;
        entry.totalSalesRevenue += sale.totalSale;
        entry.totalCostOfSold += sale.totalCost;
        entry.grossMargin = entry.totalSalesRevenue - entry.totalCostOfSold;
        entry.partnerProfitShare += sale.partnerProfitShare;
      }
    }

    // Compute remaining balances per product
    for (const [pId, entry] of productAggregationMap.entries()) {
      if (entry.totalQtyPurchased > 0) {
        entry.batchPurchaseCost = entry.totalPurchaseCost / entry.totalQtyPurchased;
      } else {
        entry.batchPurchaseCost = entry.product.costPrice;
      }

      entry.remainingInSharedWarehouse = Math.max(0, sharedWarehouseQtyMap.get(pId) ?? 0);
      entry.remainingInShop = entry.lots.reduce((sum, l) => sum + l.qtyRemainingInShop, 0);
    }

    const productBreakdown = Array.from(productAggregationMap.values()).sort((a, b) =>
      a.product.name.localeCompare(b.product.name)
    );

    // Active products list for modals
    const allProducts = (
      await prisma.product.findMany({
        where: { deletedAt: null, isActive: true },
        select: { id: true, productNo: true, name: true, unit: true, costPrice: true },
        orderBy: { name: "asc" },
      })
    ).map((p) => ({
      id: p.id,
      productNo: p.productNo,
      name: p.name,
      unit: p.unit,
      costPrice: Number(p.costPrice),
    }));

    // Active suppliers list for modal
    const allSuppliers = (
      await prisma.party.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          OR: [{ isSupplier: true }, { type: "SUPPLIER" }, { id: partner.id }],
        },
        select: { id: true, name: true, phone: true },
        orderBy: { name: "asc" },
      })
    );

    // Recent direct adjustments at shared warehouse
    const recentAdjustments = sharedMovements
      .filter((m) => m.type === StockMovementType.ADJUSTMENT)
      .slice(0, 20)
      .map((m) => ({
        id: m.id,
        date: m.createdAt,
        productId: m.productId,
        productNo: m.product.productNo,
        productName: m.product.name,
        quantity: Number(m.quantity),
        notes: m.notes,
        createdByName: m.createdBy?.name || "System",
      }));

    // All active warehouse lots for selection in intake
    const existingWarehouseLots = (
      await prisma.warehouseLot.findMany({
        where: {
          deletedAt: null,
          OR: [
            { partnerId: partner.id },
            ...(partnerWarehouseIds.size > 0
              ? [{ locationId: { in: Array.from(partnerWarehouseIds) } }]
              : []),
          ],
        },
        select: {
          id: true,
          lotNumber: true,
          locationId: true,
          partnerId: true,
          unitCost: true,
          partnerSharePct: true,
          clientSharePct: true,
          location: { select: { id: true, name: true, type: true } },
        },
        orderBy: { createdAt: "desc" },
      })
    ).map((l) => ({
      id: l.id,
      lotNumber: l.lotNumber,
      locationId: l.locationId,
      locationName: l.location?.name || "Warehouse",
      partnerId: l.partnerId,
      unitCost: l.unitCost != null ? Number(l.unitCost) : 0,
      partnerSharePct: l.partnerSharePct != null ? Number(l.partnerSharePct) : 100,
      clientSharePct: l.clientSharePct != null ? Number(l.clientSharePct) : 0,
    }));

    return {
      existingWarehouseLots,
      partner: {
        id: partner.id,
        name: cleanPartyDisplayName(partner.name),
        phone: partner.phone,
        email: partner.email,
        isPartner: (partner as any).isPartner ?? partner.isBeneficiary,
        isBeneficiary: partner.isBeneficiary,
        sharedWarehouse: sharedWarehouse
          ? { id: sharedWarehouse.id, name: sharedWarehouse.name }
          : null,
      },
      metrics: {
        // Initial capital invested broken down into Partner Capital vs Client Capital
        totalInitialCapital,
        partnerCapitalInvested,
        clientCapitalInvested,
        // Current Warehouse Stock Value
        currentStockValuationSharedWarehouse,
        // Shop Partner Lots Valuation
        currentStockValuationShopPartnerLots: productBreakdown.reduce(
          (sum, p) => sum + p.remainingInShop * p.batchPurchaseCost,
          0
        ),
        // Capital Reimbursed to Partner from A pulling stock into shop
        capitalLiabilityAccrued,
        capitalReimbursedToPartner,
        unpaidCapitalReimbursement,
        // Sales Revenue to Date
        totalSalesRevenue,
        // Realized Profit (Total Sales Revenue - Total COGS)
        totalCOGS,
        totalRealizedProfit,
        netGrossMargin: totalRealizedProfit,
        // Partner Profit Share (Total Realized Profit * partnerSharePct)
        partnerProfitShare,
        // Net Payable to Partner = (Unpaid Capital Reimbursement) + (Unsettled Partner Profit Share)
        netPayableToPartner,
        // Ledger balances
        partnershipLedgerBalance,
        regularLedgerBalance,
        consolidatedLedgerBalance,
      },
      productBreakdown,
      settlementLog,
      stockMovedToShop,
      partnerPayments: partnerPayments.map((p) => ({
        id: p.id,
        receiptNo: p.receiptNo || `RCT-${p.id.slice(0, 6)}`,
        date: p.date,
        amount: Number(p.amount),
        method: p.method,
        notes: p.notes,
        isPartnership: p.isPartnership,
      })),
      allProducts,
      allSuppliers,
      allLots: partnerLots.map((l) => ({
        id: l.id,
        lotNumber: l.lotNumber,
        locationId: l.locationId,
        locationName: l.location.name,
        partnerSharePct: l.partnerSharePct != null ? Number(l.partnerSharePct) : 100,
        clientSharePct: l.clientSharePct != null ? Number(l.clientSharePct) : 0,
        unitCost: l.unitCost != null ? Number(l.unitCost) : 0,
      })),
      recentAdjustments,
      purchaseOrders: purchaseOrders.map((po) => ({
        id: po.id,
        orderNo: po.orderNo,
        date: po.date,
        status: po.status,
        includePricing: po.includePricing,
        locationName: po.location?.name || "Warehouse",
        items: po.items.map((it) => ({
          id: it.id,
          productNo: it.product.productNo,
          productName: it.product.name,
          quantity: Number(it.quantity),
          unit: it.product.unit,
          unitCost: it.unitCost != null ? Number(it.unitCost) : null,
          destinationLocationName: it.destinationLocation?.name || null,
          lotNumber: it.warehouseLot?.lotNumber || null,
        })),
        invoices: po.invoices.map((inv) => ({
          id: inv.id,
          invoiceNo: inv.invoiceNo,
          status: inv.status,
          date: inv.date,
          totalAmount: Number(inv.totalAmount),
        })),
      })),
      purchaseInvoices: purchaseInvoices.map((inv) => ({
        id: inv.id,
        invoiceNo: inv.invoiceNo,
        date: inv.date,
        status: inv.status,
        totalAmount: Number(inv.totalAmount),
        paidAmount: Number(inv.paidAmount ?? inv.amountPaid ?? 0),
        balanceAmount: Number(inv.balanceAmount ?? 0),
        purchaseOrderId: inv.purchaseOrderId,
        items: inv.items.map((it) => ({
          id: it.id,
          productNo: it.product.productNo,
          productName: it.product.name,
          quantity: Number(it.quantity),
          unitCost: Number(it.unitCost),
          lineTotal: Number(it.lineTotal),
          lotNumber: it.warehouseLot?.lotNumber || null,
        })),
      })),
      locations: {
        sharedWarehouse: sharedWarehouse ? { id: sharedWarehouse.id, name: sharedWarehouse.name } : null,
        shop: shopLocation ? { id: shopLocation.id, name: shopLocation.name } : null,
      },
    };
  });
}

export const recordPartnershipIntakeAction = partnershipPurchaseIntakeAction;

export async function recordPartnerSettlementAction(raw: unknown) {
  return runAction("partnerships.recordSettlement", async () => {
    const session = await requireSession();
    if (
      !canPerformAction(session.user.role, "partnerships", "update", (session.user as any).permissions) &&
      !canPerformAction(session.user.role, "payments", "create", (session.user as any).permissions)
    ) {
      throw userError("You do not have permission to record partner settlements.");
    }
    return createPaymentAction(raw);
  });
}

// ============================================================================
// CPA-GRADE PARTNERSHIP HUB SUB-LEDGER & LOT MANAGEMENT
// Archetypes: CONSIGNMENT_VMI & CO_INVESTED_POOL
// ============================================================================

export async function listPartnershipLotsAction(filters?: {
  partnerId?: string;
  type?: PartnershipType;
  status?: LotStatus;
}) {
  return runAction("partnerships.lots.list", async () => {
    const session = await requireSession();
    if (
      !canPerformAction(session.user.role, "partnerships", "view", (session.user as any).permissions) &&
      !canPerformAction(session.user.role, "inventory", "view", (session.user as any).permissions)
    ) {
      throw userError("You do not have permission to view partnership lots.");
    }

    const where: any = {};
    if (filters?.partnerId) where.partnerId = filters.partnerId;
    if (filters?.type) where.type = filters.type;
    if (filters?.status) where.status = filters.status;

    const lots = await prisma.partnershipLot.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        partner: { select: { id: true, name: true, phone: true } },
        warehouse: { select: { id: true, name: true } },
        items: {
          include: {
            product: { select: { id: true, productNo: true, name: true, unit: true } },
          },
        },
        expenses: true,
        allocations: true,
      },
    });

    return lots.map((lot) => {
      const initialUnits = lot.items.reduce((sum, it) => sum + Number(it.initialQuantity), 0);
      const remainingUnits = lot.items.reduce((sum, it) => sum + Number(it.remainingQuantity), 0);
      const remainingValuation = lot.items.reduce(
        (sum, it) => sum + Number(it.remainingQuantity) * Number(it.unitCostRate),
        0
      );

      const totalRevenue = lot.allocations.reduce(
        (sum, a) => sum + Number(a.quantity) * Number(a.unitSaleRate),
        0
      );
      const totalCOGS = lot.allocations.reduce(
        (sum, a) => sum + Number(a.quantity) * Number(a.unitCostRate),
        0
      );
      const grossMargin = lot.allocations.reduce((sum, a) => sum + Number(a.grossMargin), 0);
      const partnerMarginShare = lot.allocations.reduce(
        (sum, a) => sum + Number(a.partnerMarginShare),
        0
      );
      const totalExpenses = lot.expenses.reduce((sum, e) => sum + Number(e.amount), 0);

      return {
        id: lot.id,
        lotNumber: lot.lotNumber,
        partnerId: lot.partnerId,
        partnerName: cleanPartyDisplayName(lot.partner.name),
        partnerPhone: lot.partner.phone,
        type: lot.type,
        status: lot.status,
        warehouseId: lot.warehouseId,
        warehouseName: lot.warehouse.name,
        totalCapitalCost: Number(lot.totalCapitalCost),
        entityCapitalShare: Number(lot.entityCapitalShare),
        partnerCapitalShare: Number(lot.partnerCapitalShare),
        partnerMarginRatio: Number(lot.partnerMarginRatio),
        initialUnits,
        remainingUnits,
        remainingValuation,
        totalRevenue,
        totalCOGS,
        grossMargin,
        partnerMarginShare,
        totalExpenses,
        itemCount: lot.items.length,
        createdAt: lot.createdAt,
      };
    });
  });
}

const createPartnershipLotSchema = z.object({
  lotNumber: z.string().trim().min(1, "Lot Number is required"),
  partnerId: z.string().min(1, "Partner is required"),
  type: z.enum(["CONSIGNMENT_VMI", "CO_INVESTED_POOL"]).default("CO_INVESTED_POOL"),
  warehouseId: z.string().min(1, "Warehouse Location is required"),
  partnerMarginRatio: z.coerce.number().min(0).max(1).default(0.5),
  entityCapitalShare: z.coerce.number().min(0).optional(),
  partnerCapitalShare: z.coerce.number().min(0).optional(),
  notes: z.string().trim().optional().nullable(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1, "Product is required"),
        initialQuantity: z.coerce.number().gt(0, "Quantity must be greater than 0"),
        unitCostRate: z.coerce.number().min(0, "Unit cost rate must be 0 or greater"),
      })
    )
    .min(1, "At least one item is required"),
});

export async function createPartnershipLotAction(raw: unknown) {
  return runAction("partnerships.lots.create", async () => {
    const session = await requireSession();
    if (
      !canPerformAction(session.user.role, "partnerships", "create", (session.user as any).permissions) &&
      !canPerformAction(session.user.role, "inventory", "create", (session.user as any).permissions)
    ) {
      throw userError("You do not have permission to create a partnership lot.");
    }
    const input = parseInput(createPartnershipLotSchema, raw);

    const partner = await prisma.party.findUnique({
      where: { id: input.partnerId },
      select: { id: true, name: true },
    });
    if (!partner) throw userError("Partner not found.");

    const warehouse = await prisma.location.findUnique({
      where: { id: input.warehouseId },
      select: { id: true, name: true, type: true },
    });
    if (!warehouse) throw userError("Warehouse location not found.");

    // Check duplicate lot number
    const existing = await prisma.partnershipLot.findUnique({
      where: { lotNumber: input.lotNumber.trim() },
    });
    if (existing) {
      throw userError(`A partnership lot with number "${input.lotNumber}" already exists.`);
    }

    const totalCapitalCost = input.items.reduce(
      (sum, it) => sum + it.initialQuantity * it.unitCostRate,
      0
    );

    let partnerCap = 0;
    let entityCap = 0;

    const partnerMarginRatio = input.partnerMarginRatio ?? 0.5;

    if (input.type === "CONSIGNMENT_VMI") {
      // Consignment: Partner purchases 100% of stock.
      // Zero GL trade payable or purchase entry posted to the shop ledger upon intake.
      partnerCap = totalCapitalCost;
      entityCap = 0;
    } else {
      // Co-Invested Pool
      if (input.partnerCapitalShare != null && input.entityCapitalShare != null) {
        partnerCap = input.partnerCapitalShare;
        entityCap = input.entityCapitalShare;
      } else {
        partnerCap = totalCapitalCost * partnerMarginRatio;
        entityCap = totalCapitalCost - partnerCap;
      }
    }

    const res = await prisma.$transaction(async (tx) => {
      const lot = await tx.partnershipLot.create({
        data: {
          lotNumber: input.lotNumber.trim(),
          partnerId: partner.id,
          type: input.type,
          status: LotStatus.ACTIVE,
          totalCapitalCost,
          entityCapitalShare: entityCap,
          partnerCapitalShare: partnerCap,
          partnerMarginRatio,
          warehouseId: warehouse.id,
          items: {
            create: input.items.map((it) => ({
              productId: it.productId,
              initialQuantity: it.initialQuantity,
              remainingQuantity: it.initialQuantity,
              unitCostRate: it.unitCostRate,
            })),
          },
        },
      });

      // Record StockMovements at the warehouse location to track physical intake count under this lot
      for (const it of input.items) {
        await tx.stockMovement.create({
          data: {
            productId: it.productId,
            locationId: warehouse.id,
            partnershipLotId: lot.id,
            type: StockMovementType.PURCHASE_IN,
            quantity: it.initialQuantity,
            referenceType: "PARTNERSHIP_INTAKE",
            referenceId: lot.id,
            createdById: session.user.id,
            notes: `Partnership Intake [${lot.type}] Lot: ${lot.lotNumber} (${cleanPartyDisplayName(partner.name)})${input.notes ? ` — ${input.notes}` : ""}`,
          },
        });
      }

      return lot;
    });

    emitRealtimeEvent(["parties", "inventory", "stock-movements"], "create", "PartnershipLot", {
      lotId: res.id,
      lotNumber: res.lotNumber,
    });

    return { success: true, lotId: res.id, lotNumber: res.lotNumber };
  });
}

export async function getPartnershipLotDetailsAction(lotId: string) {
  return runAction("partnerships.lots.getDetails", async () => {
    const session = await requireSession();
    if (
      !canPerformAction(session.user.role, "partnerships", "view", (session.user as any).permissions) &&
      !canPerformAction(session.user.role, "inventory", "view", (session.user as any).permissions)
    ) {
      throw userError("You do not have permission to view partnership lot details.");
    }

    const lot = await prisma.partnershipLot.findUnique({
      where: { id: lotId },
      include: {
        partner: { select: { id: true, name: true, phone: true, email: true } },
        warehouse: { select: { id: true, name: true, type: true } },
        items: {
          include: {
            product: { select: { id: true, productNo: true, name: true, unit: true, costPrice: true } },
          },
        },
        expenses: {
          orderBy: { createdAt: "desc" },
        },
        allocations: {
          orderBy: { allocatedAt: "desc" },
          include: {
            invoice: { select: { id: true, invoiceNo: true, date: true, walkInName: true, customer: { select: { name: true } } } },
            product: { select: { id: true, productNo: true, name: true, unit: true } },
          },
        },
        reconciliations: {
          orderBy: { periodEnd: "desc" },
        },
      },
    });

    if (!lot) throw userError("Partnership lot not found.");

    // Fetch related stock movements for PO/DO movement audit sheet
    const movements = await prisma.stockMovement.findMany({
      where: {
        OR: [
          { partnershipLotId: lot.id },
          { referenceId: lot.id },
        ],
      },
      include: {
        product: { select: { id: true, productNo: true, name: true, unit: true } },
        location: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    // Payouts made to partner for this partnership or general
    const payments = await prisma.payment.findMany({
      where: {
        partyId: lot.partnerId,
        direction: "OUT",
        OR: [
          { notes: { contains: lot.lotNumber, mode: "insensitive" } },
          { isPartnership: true },
        ],
      },
      select: {
        id: true,
        receiptNo: true,
        date: true,
        amount: true,
        method: true,
        notes: true,
      },
      orderBy: { date: "desc" },
    });

    // Calculate aggregated metrics
    const totalInitialUnits = lot.items.reduce((s, it) => s + Number(it.initialQuantity), 0);
    const totalRemainingUnits = lot.items.reduce((s, it) => s + Number(it.remainingQuantity), 0);
    const totalRemainingValuation = lot.items.reduce(
      (s, it) => s + Number(it.remainingQuantity) * Number(it.unitCostRate),
      0
    );

    const totalGrossRevenue = lot.allocations.reduce(
      (s, a) => s + Number(a.quantity) * Number(a.unitSaleRate),
      0
    );
    const totalCOGS = lot.allocations.reduce(
      (s, a) => s + Number(a.quantity) * Number(a.unitCostRate),
      0
    );
    const totalGrossMargin = lot.allocations.reduce((s, a) => s + Number(a.grossMargin), 0);
    const partnerAccruedMarginShare = lot.allocations.reduce(
      (s, a) => s + Number(a.partnerMarginShare),
      0
    );
    const shopRetainedMargin = totalGrossMargin - partnerAccruedMarginShare;

    // Expenses
    const entityPaidExpenses = lot.expenses
      .filter((e) => e.paidBy === "ENTITY")
      .reduce((s, e) => s + Number(e.amount), 0);
    const partnerPaidExpenses = lot.expenses
      .filter((e) => e.paidBy === "PARTNER")
      .reduce((s, e) => s + Number(e.amount), 0);
    const totalExpenses = entityPaidExpenses + partnerPaidExpenses;

    // Units pulled to shop vs liquidated externally
    const internalSoldUnits = lot.allocations
      .filter((a) => a.salesChannel === "INTERNAL_POS")
      .reduce((s, a) => s + Number(a.quantity), 0);
    const externalSoldUnits = lot.allocations
      .filter((a) => a.salesChannel === "EXTERNAL_PARTNER")
      .reduce((s, a) => s + Number(a.quantity), 0);
    const totalUnitsSold = internalSoldUnits + externalSoldUnits;

    // Consignment-specific pulled value (Accounts Payable - Consignor)
    // Find all DO / inward pulls to shop
    const pullMovements = movements.filter(
      (m) =>
        m.type === StockMovementType.TRANSFER_IN ||
        (m.type === StockMovementType.PURCHASE_IN && m.referenceType === "DELIVERY_ORDER")
    );
    const pulledUnitsTotal = pullMovements.reduce((s, m) => s + Number(m.quantity), 0);
    const pulledValuationTotal = pullMovements.reduce((s, m) => {
      const item = lot.items.find((it) => it.productId === m.productId);
      return s + Number(m.quantity) * Number(item?.unitCostRate ?? 0);
    }, 0);

    const totalPayouts = payments.reduce((s, p) => s + Number(p.amount), 0);

    // Calculate Net Settlement Position:
    // If CONSIGNMENT_VMI:
    // Net Payable to Partner = Accounts Payable – Consignor (for pulled stock) + partnerPaidExpenses - payouts
    // If CO_INVESTED_POOL:
    // Accrued Profit Share Payable + partnerPaidExpenses - entityPaidExpenses - payouts
    let netSettlementAmount = 0;
    let netSettlementDirection: "ENTITY_OWES_PARTNER" | "PARTNER_OWES_ENTITY" = "ENTITY_OWES_PARTNER";

    if (lot.type === "CONSIGNMENT_VMI") {
      netSettlementAmount = pulledValuationTotal + partnerPaidExpenses - totalPayouts;
    } else {
      netSettlementAmount = partnerAccruedMarginShare + partnerPaidExpenses - totalPayouts;
    }

    if (netSettlementAmount < 0) {
      netSettlementDirection = "PARTNER_OWES_ENTITY";
      netSettlementAmount = Math.abs(netSettlementAmount);
    }

    // Breakdown per item
    const itemBreakdown = lot.items.map((it) => {
      const itemAllocations = lot.allocations.filter((a) => a.productId === it.productId);
      const soldInternal = itemAllocations
        .filter((a) => a.salesChannel === "INTERNAL_POS")
        .reduce((s, a) => s + Number(a.quantity), 0);
      const soldExternal = itemAllocations
        .filter((a) => a.salesChannel === "EXTERNAL_PARTNER")
        .reduce((s, a) => s + Number(a.quantity), 0);
      const itemPulled = pullMovements
        .filter((m) => m.productId === it.productId)
        .reduce((s, m) => s + Number(m.quantity), 0);

      return {
        id: it.id,
        productId: it.productId,
        productNo: it.product.productNo,
        productName: it.product.name,
        unit: it.product.unit,
        initialQuantity: Number(it.initialQuantity),
        remainingQuantity: Number(it.remainingQuantity),
        unitCostRate: Number(it.unitCostRate),
        initialCost: Number(it.initialQuantity) * Number(it.unitCostRate),
        remainingValuation: Number(it.remainingQuantity) * Number(it.unitCostRate),
        pulledToShopQty: itemPulled,
        liquidatedByPartnerQty: soldExternal,
        soldInternalQty: soldInternal,
      };
    });

    return {
      lot: {
        id: lot.id,
        lotNumber: lot.lotNumber,
        partnerId: lot.partnerId,
        partnerName: cleanPartyDisplayName(lot.partner.name),
        partnerPhone: lot.partner.phone,
        partnerEmail: lot.partner.email,
        type: lot.type,
        status: lot.status,
        warehouseId: lot.warehouseId,
        warehouseName: lot.warehouse.name,
        totalCapitalCost: Number(lot.totalCapitalCost),
        entityCapitalShare: Number(lot.entityCapitalShare),
        partnerCapitalShare: Number(lot.partnerCapitalShare),
        partnerMarginRatio: Number(lot.partnerMarginRatio),
        createdAt: lot.createdAt,
        updatedAt: lot.updatedAt,
      },
      metrics: {
        // Contributed Capital
        totalCapitalCost: Number(lot.totalCapitalCost),
        entityCapitalShare: Number(lot.entityCapitalShare),
        partnerCapitalShare: Number(lot.partnerCapitalShare),
        partnerMarginRatioPct: Number(lot.partnerMarginRatio) * 100,
        // Lot Inventory
        totalInitialUnits,
        totalRemainingUnits,
        totalRemainingValuation,
        pulledUnitsTotal,
        pulledValuationTotal,
        liquidatedUnitsTotal: externalSoldUnits,
        // Gross Revenue & Margin
        totalGrossRevenue,
        totalCOGS,
        totalGrossMargin,
        partnerAccruedMarginShare,
        shopRetainedMargin,
        // Expenses
        entityPaidExpenses,
        partnerPaidExpenses,
        totalExpenses,
        // Net Settlement Position
        netSettlementAmount,
        netSettlementDirection,
        totalPayouts,
      },
      items: itemBreakdown,
      allocations: lot.allocations.map((a) => ({
        id: a.id,
        invoiceId: a.invoiceId,
        invoiceNo: a.invoice?.invoiceNo || "EXT-LIQ",
        customerName: a.invoice?.customer?.name || a.invoice?.walkInName || (a.salesChannel === "EXTERNAL_PARTNER" ? "External Buyer" : "Customer"),
        productNo: a.product.productNo,
        productName: a.product.name,
        unit: a.product.unit,
        quantity: Number(a.quantity),
        unitCostRate: Number(a.unitCostRate),
        unitSaleRate: Number(a.unitSaleRate),
        grossMargin: Number(a.grossMargin),
        partnerMarginShare: Number(a.partnerMarginShare),
        salesChannel: a.salesChannel,
        allocatedAt: a.allocatedAt,
      })),
      expenses: lot.expenses.map((e) => ({
        id: e.id,
        category: e.category,
        description: e.description,
        amount: Number(e.amount),
        paidBy: e.paidBy,
        createdAt: e.createdAt,
      })),
      movements: movements.map((m) => ({
        id: m.id,
        date: m.createdAt,
        type: m.type,
        referenceType: m.referenceType,
        referenceId: m.referenceId,
        productNo: m.product.productNo,
        productName: m.product.name,
        unit: m.product.unit,
        locationName: m.location.name,
        quantity: Number(m.quantity),
        notes: m.notes,
        createdByName: m.createdBy?.name || "System",
      })),
      payouts: payments.map((p) => ({
        id: p.id,
        receiptNo: p.receiptNo || `PAY-${p.id.slice(0, 6)}`,
        date: p.date,
        amount: Number(p.amount),
        method: p.method,
        notes: p.notes,
      })),
    };
  });
}

// ----------------------------------------------------------------------------
// DO / PI Pull from Partnership Lot to Shop
// ----------------------------------------------------------------------------
const pullPartnershipLotStockSchema = z.object({
  lotId: z.string().min(1, "Lot ID is required"),
  destinationLocationId: z.string().min(1, "Destination Shop Location is required"),
  date: z.coerce.date().default(() => new Date()),
  notes: z.string().trim().optional().nullable(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1, "Product is required"),
        quantity: z.coerce.number().gt(0, "Quantity must be greater than 0"),
      })
    )
    .min(1, "At least one item is required"),
});

export async function pullPartnershipLotStockAction(raw: unknown) {
  return runAction("partnerships.lots.pullToShop", async () => {
    const session = await requireSession();
    if (
      !canPerformAction(session.user.role, "partnerships", "update", (session.user as any).permissions) &&
      !canPerformAction(session.user.role, "inventory", "update", (session.user as any).permissions)
    ) {
      throw userError("You do not have permission to pull partnership stock.");
    }
    const input = parseInput(pullPartnershipLotStockSchema, raw);

    const lot = await prisma.partnershipLot.findUnique({
      where: { id: input.lotId },
      include: {
        partner: true,
        warehouse: true,
        items: { include: { product: true } },
      },
    });
    if (!lot) throw userError("Partnership lot not found.");

    const destinationLocation = await prisma.location.findUnique({
      where: { id: input.destinationLocationId },
      select: { id: true, name: true, type: true },
    });
    if (!destinationLocation) throw userError("Destination location not found.");
    if (destinationLocation.type !== "SHOP") {
      throw userError("Stock pull must be received at a shop location.");
    }

    // Verify stock availability in lot
    for (const reqItem of input.items) {
      const lotItem = lot.items.find((li) => li.productId === reqItem.productId);
      if (!lotItem) {
        throw userError(`Product is not part of lot ${lot.lotNumber}.`);
      }
      if (Number(lotItem.remainingQuantity) < reqItem.quantity) {
        throw userError(
          `Insufficient quantity in lot ${lot.lotNumber} for ${lotItem.product.name}. Available: ${lotItem.remainingQuantity}, Requested: ${reqItem.quantity}`
        );
      }
    }

    const pullDate = input.date ?? new Date();
    const activeYear = await prisma.financialYear.findFirst({
      where: { isActive: true, isClosed: false },
    });

    const res = await prisma.$transaction(async (tx) => {
      const doNo = generateDocumentNumber("DO-PULL");
      let totalPullValuation = 0;

      for (const reqItem of input.items) {
        const lotItem = lot.items.find((li) => li.productId === reqItem.productId)!;
        const lineValuation = reqItem.quantity * Number(lotItem.unitCostRate);
        totalPullValuation += lineValuation;

        // Decrement PartnershipLotItem.remainingQuantity
        await tx.partnershipLotItem.update({
          where: { id: lotItem.id },
          data: {
            remainingQuantity: {
              decrement: reqItem.quantity,
            },
          },
        });

        // Decrement warehouse lot stock
        await tx.stockMovement.create({
          data: {
            productId: reqItem.productId,
            locationId: lot.warehouseId,
            partnershipLotId: lot.id,
            type: StockMovementType.TRANSFER_OUT,
            quantity: reqItem.quantity,
            referenceType: "DELIVERY_ORDER",
            referenceId: doNo,
            createdById: session.user.id,
            createdAt: pullDate,
            notes: `Delivery Order ${doNo}: Pulled to shop floor ${destinationLocation.name} [Lot ${lot.lotNumber}]`,
          },
        });

        // Increment shop regular or JV stock
        await tx.stockMovement.create({
          data: {
            productId: reqItem.productId,
            locationId: destinationLocation.id,
            partnershipLotId: lot.type === "CO_INVESTED_POOL" ? lot.id : null,
            type: StockMovementType.TRANSFER_IN,
            quantity: reqItem.quantity,
            referenceType: "DELIVERY_ORDER",
            referenceId: doNo,
            createdById: session.user.id,
            createdAt: pullDate,
            notes:
              lot.type === "CONSIGNMENT_VMI"
                ? `Consignment inward received at ${destinationLocation.name} (fungible regular stock) [Ref: ${doNo}]`
                : `JV Pool stock received at ${destinationLocation.name} [Lot ${lot.lotNumber}] [Ref: ${doNo}]`,
          },
        });
      }

      // If CONSIGNMENT_VMI: Post Accounts Payable credit
      // Debit: Inventory on Hand (Asset)
      // Credit: Accounts Payable – Consignor (Partner B) at the agreed unit cost rate.
      if (lot.type === "CONSIGNMENT_VMI") {
        const invoiceNo = generateDocumentNumber("PINV-VMI");

        const purchaseInvoice = await tx.purchaseInvoice.create({
          data: {
            invoiceNo,
            financialYearId: activeYear?.id || null,
            supplierId: lot.partnerId,
            locationId: destinationLocation.id,
            date: pullDate,
            status: InvoiceStatus.OPEN,
            paymentStatus: PaymentStatus.UNPAID,
            isPartnership: true,
            partnershipId: lot.partnerId,
            totalAmount: totalPullValuation,
            amountPaid: 0,
            paidAmount: 0,
            balanceAmount: totalPullValuation,
            notes: `[Consignment Stock Pull] From Lot ${lot.lotNumber} into ${destinationLocation.name} via ${doNo}${input.notes ? ` — ${input.notes}` : ""}`,
            createdById: session.user.id,
            items: {
              create: input.items.map((it) => {
                const lotItem = lot.items.find((li) => li.productId === it.productId)!;
                return {
                  productId: it.productId,
                  locationId: destinationLocation.id,
                  quantity: it.quantity,
                  unitCost: lotItem.unitCostRate,
                  lineTotal: it.quantity * Number(lotItem.unitCostRate),
                };
              }),
            },
          },
        });

        // Debit: Inventory on Hand (Asset)
        await tx.ledgerEntry.create({
          data: {
            partyId: null,
            accountType: AccountType.INVENTORY,
            debit: totalPullValuation,
            credit: 0,
            isPartnership: true,
            partnershipId: lot.partnerId,
            referenceType: "PURCHASE_INVOICE",
            referenceId: purchaseInvoice.id,
            date: pullDate,
            description: `Inventory on Hand (Asset) - Consignment Draw [Lot ${lot.lotNumber}] into ${destinationLocation.name}`,
            createdById: session.user.id,
          },
        });

        // Credit: Accounts Payable – Consignor
        await tx.ledgerEntry.create({
          data: {
            partyId: lot.partnerId,
            accountType: AccountType.PAYABLE,
            debit: 0,
            credit: totalPullValuation,
            isPartnership: true,
            partnershipId: lot.partnerId,
            referenceType: "PURCHASE_INVOICE",
            referenceId: purchaseInvoice.id,
            date: pullDate,
            description: `Accounts Payable – Consignor (${cleanPartyDisplayName(lot.partner.name)}): Consignment Draw [Lot ${lot.lotNumber}] (${purchaseInvoice.invoiceNo})`,
            createdById: session.user.id,
          },
        });
      }

      return { doNo, totalPullValuation };
    });

    emitRealtimeEvent(["parties", "inventory", "stock-movements", "ledger"], "create", "StockPull", {
      lotId: lot.id,
      doNo: res.doNo,
    });

    return { success: true, doNo: res.doNo, valuation: res.totalPullValuation };
  });
}

// ----------------------------------------------------------------------------
// External Partner Liquidation (Reconciliation Entry)
// ----------------------------------------------------------------------------
const externalLiquidationSchema = z.object({
  lotId: z.string().min(1, "Lot ID is required"),
  productId: z.string().min(1, "Product is required"),
  quantity: z.coerce.number().gt(0, "Quantity must be greater than 0"),
  realizedRate: z.coerce.number().gt(0, "Realized unit rate must be greater than 0"),
  partnerExpenses: z.coerce.number().min(0).default(0),
  expenseDescription: z.string().trim().optional().nullable(),
  date: z.coerce.date().default(() => new Date()),
  notes: z.string().trim().optional().nullable(),
});

export async function recordExternalPartnerLiquidationAction(raw: unknown) {
  return runAction("partnerships.lots.externalLiquidation", async () => {
    const session = await requireSession();
    if (
      !canPerformAction(session.user.role, "partnerships", "update", (session.user as any).permissions) &&
      !canPerformAction(session.user.role, "sales", "create", (session.user as any).permissions)
    ) {
      throw userError("You do not have permission to record partner liquidation.");
    }
    const input = parseInput(externalLiquidationSchema, raw);

    const lot = await prisma.partnershipLot.findUnique({
      where: { id: input.lotId },
      include: {
        partner: true,
        items: { where: { productId: input.productId }, include: { product: true } },
      },
    });
    if (!lot) throw userError("Partnership lot not found.");

    const lotItem = lot.items[0];
    if (!lotItem) throw userError("Product does not exist in this lot.");
    if (Number(lotItem.remainingQuantity) < input.quantity) {
      throw userError(
        `Insufficient quantity in lot. Available: ${lotItem.remainingQuantity}, Requested: ${input.quantity}`
      );
    }

    const unitCostRate = Number(lotItem.unitCostRate);
    const unitSaleRate = input.realizedRate;
    const grossMargin = (unitSaleRate - unitCostRate) * input.quantity;
    const partnerMarginRatio = Number(lot.partnerMarginRatio);
    const partnerMarginShare = grossMargin * partnerMarginRatio;
    const liqDate = input.date ?? new Date();
    const partnerExpenses = input.partnerExpenses ?? 0;

    const res = await prisma.$transaction(async (tx) => {
      // 1. Decrement lot item remaining quantity
      await tx.partnershipLotItem.update({
        where: { id: lotItem.id },
        data: {
          remainingQuantity: {
            decrement: input.quantity,
          },
        },
      });

      const allocation = await tx.partnershipSaleAllocation.create({
        data: {
          lotId: lot.id,
          productId: input.productId,
          quantity: input.quantity,
          unitCostRate,
          unitSaleRate,
          grossMargin,
          partnerMarginShare,
          salesChannel: "EXTERNAL_PARTNER",
          soldBy: "PARTNER",
          allocatedAt: liqDate,
        },
      });

      await postOutflow(tx, {
        productId: input.productId,
        locationId: lot.warehouseId,
        ownership: { ownershipType: "LOT", partnershipLotId: lot.id },
        quantity: input.quantity,
        movementType: "PARTNER_SALE",
        referenceType: "EXTERNAL_PARTNER_LIQUIDATION",
        referenceId: allocation.id,
      });

      // 3. Record StockMovement
      await tx.stockMovement.create({
        data: {
          productId: input.productId,
          locationId: lot.warehouseId,
          partnershipLotId: lot.id,
          type: StockMovementType.SALE_OUT,
          quantity: input.quantity,
          referenceType: "EXTERNAL_PARTNER_LIQUIDATION",
          referenceId: allocation.id,
          createdById: session.user.id,
          createdAt: liqDate,
          notes: `External partner liquidation: ${input.quantity} ${lotItem.product.unit} @ PKR ${unitSaleRate} [Lot ${lot.lotNumber}]${input.notes ? ` — ${input.notes}` : ""}`,
        },
      });

      // 4. Record partner expense if provided
      if (partnerExpenses > 0) {
        await tx.partnershipExpense.create({
          data: {
            lotId: lot.id,
            category: "Handling & Labor",
            description: input.expenseDescription?.trim() || "External Liquidation Handling & Transport",
            amount: partnerExpenses,
            paidBy: "PARTNER",
            createdAt: liqDate,
          },
        });
      }

      return allocation;
    });

    emitRealtimeEvent(["parties", "inventory", "stock-movements"], "create", "StockMovement", {
      lotId: lot.id,
      allocationId: res.id,
    });

    return {
      success: true,
      allocationId: res.id,
      grossMargin,
      partnerMarginShare,
    };
  });
}

// ----------------------------------------------------------------------------
// Partnership Expense Recording
// ----------------------------------------------------------------------------
const recordPartnershipExpenseSchema = z.object({
  lotId: z.string().min(1, "Lot ID is required"),
  category: z.string().min(1, "Category is required"),
  description: z.string().trim().min(1, "Description is required"),
  amount: z.coerce.number().gt(0, "Amount must be greater than 0"),
  paidBy: z.enum(["ENTITY", "PARTNER"]).default("ENTITY"),
  date: z.coerce.date().default(() => new Date()),
});

export async function recordPartnershipExpenseAction(raw: unknown) {
  return runAction("partnerships.lots.recordExpense", async () => {
    const session = await requireSession();
    if (
      !canPerformAction(session.user.role, "partnerships", "update", (session.user as any).permissions) &&
      !canPerformAction(session.user.role, "expenses", "create", (session.user as any).permissions)
    ) {
      throw userError("You do not have permission to record partnership expenses.");
    }
    const input = parseInput(recordPartnershipExpenseSchema, raw);

    const lot = await prisma.partnershipLot.findUnique({
      where: { id: input.lotId },
      include: { partner: true },
    });
    if (!lot) throw userError("Partnership lot not found.");

    const shareRatio = Number(lot.partnerMarginRatio ?? 0.5);
    const partnerShare = input.amount * shareRatio;
    const entityShare = input.amount - partnerShare;

    const expense = await prisma.$transaction(async (tx) => {
      const row = await tx.partnershipExpense.create({
        data: {
          lotId: lot.id,
          category: input.category,
          description: input.description,
          amount: input.amount,
          paidBy: input.paidBy ?? "ENTITY",
          entityShare,
          partnerShare,
          createdAt: input.date ?? new Date(),
        },
      });

      const lines =
        input.paidBy === "PARTNER"
          ? [
              {
                accountType: AccountType.EXPENSE,
                debit: entityShare,
                credit: 0,
                description: `Entity share of partnership expense: ${input.description}`,
              },
              {
                partyId: lot.partnerId,
                accountType: AccountType.PAYABLE,
                accountSubtype: LedgerAccountSubtype.PARTNER_EXPENSE_DUE,
                debit: 0,
                credit: entityShare,
                description: `Partner paid expense — entity owes share: ${input.description}`,
                partnershipId: lot.id,
                isPartnership: true,
              },
            ]
          : [
              {
                accountType: AccountType.EXPENSE,
                debit: entityShare,
                credit: 0,
                description: `Entity paid partnership expense (entity share): ${input.description}`,
              },
              {
                accountType: AccountType.CASH,
                debit: 0,
                credit: input.amount,
                description: `Cash paid for partnership expense: ${input.description}`,
              },
              {
                partyId: lot.partnerId,
                accountType: AccountType.RECEIVABLE,
                debit: partnerShare,
                credit: 0,
                description: `Partner share due on expense paid by entity: ${input.description}`,
                partnershipId: lot.id,
                isPartnership: true,
              },
            ];

      await postJournal(
        {
          referenceType: "PARTNERSHIP_EXPENSE",
          referenceId: row.id,
          date: input.date ?? new Date(),
          createdById: session.user.id,
          lines,
        },
        tx,
      );

      return row;
    });

    emitRealtimeEvent(["parties", "expenses"], "create", "Expense", {
      lotId: lot.id,
      expenseId: expense.id,
    });

    return { success: true, expenseId: expense.id };
  });
}

// ----------------------------------------------------------------------------
// Record Partner Settlement Payout
// ----------------------------------------------------------------------------
const recordPartnerSettlementPayoutSchema = z.object({
  lotId: z.string().min(1, "Lot ID is required"),
  amount: z.coerce.number().gt(0, "Amount must be greater than 0"),
  method: z.nativeEnum(PaymentMethod).default(PaymentMethod.CASH),
  date: z.coerce.date().default(() => new Date()),
  notes: z.string().trim().optional().nullable(),
});

export async function recordPartnerSettlementPayoutAction(raw: unknown) {
  return runAction("partnerships.lots.recordPayout", async () => {
    const session = await requireSession();
    if (
      !canPerformAction(session.user.role, "partnerships", "update", (session.user as any).permissions) &&
      !canPerformAction(session.user.role, "payments", "create", (session.user as any).permissions)
    ) {
      throw userError("You do not have permission to record settlement payouts.");
    }
    const input = parseInput(recordPartnerSettlementPayoutSchema, raw);

    const lot = await prisma.partnershipLot.findUnique({
      where: { id: input.lotId },
      include: { partner: true },
    });
    if (!lot) throw userError("Partnership lot not found.");

    const activeYear = await prisma.financialYear.findFirst({
      where: { isActive: true, isClosed: false },
    });

    const receiptNo = generateDocumentNumber("PAY-SETTLE");
    const payoutDate = input.date ?? new Date();

    const res = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          receiptNo,
          financialYearId: activeYear?.id || null,
          partyId: lot.partnerId,
          isPartnership: true,
          partnershipId: lot.id,
          amount: input.amount,
          method: input.method ?? PaymentMethod.CASH,
          direction: "OUT",
          date: payoutDate,
          notes: `Settlement Payout [Lot ${lot.lotNumber}] to ${cleanPartyDisplayName(lot.partner.name)}${input.notes ? ` — ${input.notes}` : ""}`,
          createdById: session.user.id,
        },
      });

      await tx.partnershipSettlementAllocation.create({
        data: {
          paymentId: payment.id,
          lotId: lot.id,
          kind: "PROFIT",
          amount: input.amount,
        },
      });

      // Debit: Accounts Payable (Reduces payable to partner)
      await tx.ledgerEntry.create({
        data: {
          partyId: lot.partnerId,
          accountType: AccountType.PAYABLE,
          debit: input.amount,
          credit: 0,
          isPartnership: true,
          partnershipId: lot.id,
          referenceType: "PAYMENT",
          referenceId: payment.id,
          date: payoutDate,
          description: `Settlement Payout [Lot ${lot.lotNumber}] to ${cleanPartyDisplayName(lot.partner.name)} (${receiptNo})`,
          createdById: session.user.id,
        },
      });

      // Credit: Cash / Bank
      await tx.ledgerEntry.create({
        data: {
          partyId: null,
          accountType: AccountType.CASH,
          debit: 0,
          credit: input.amount,
          isPartnership: true,
          partnershipId: lot.partnerId,
          referenceType: "PAYMENT",
          referenceId: payment.id,
          date: payoutDate,
          description: `Payout via ${input.method} for Settlement [Lot ${lot.lotNumber}] (${receiptNo})`,
          createdById: session.user.id,
        },
      });

      return payment;
    });

    emitRealtimeEvent(["parties", "payments", "ledger"], "create", "Payment", {
      paymentId: res.id,
      receiptNo: res.receiptNo,
    });

    return { success: true, paymentId: res.id, receiptNo: res.receiptNo };
  });
}

const reconcilePeriodSchema = z.object({
  lotId: z.string().min(1),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
});

export async function reconcilePartnershipPeriodAction(raw: unknown) {
  return runAction("partnerships.reconcilePeriod", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "partnerships", "update", (session.user as any).permissions)) {
      throw userError("You do not have permission to reconcile partnership periods.");
    }
    const input = parseInput(reconcilePeriodSchema, raw);

    const lot = await prisma.partnershipLot.findUnique({
      where: { id: input.lotId },
      include: { partner: true },
    });
    if (!lot) throw userError("Partnership lot not found.");

    const archetype = partnershipArchetypeFromLot(lot);
    const periodEnd = input.periodEnd;
    periodEnd.setHours(23, 59, 59, 999);

    const allocations = await prisma.partnershipSaleAllocation.findMany({
      where: {
        lotId: lot.id,
        soldBy: "OWNER",
        allocatedAt: { gte: input.periodStart, lte: periodEnd },
      },
    });

    const transferredOut = await prisma.deliveryOrderItem.aggregate({
      where: {
        lotId: lot.id,
        deliveryOrder: { date: { gte: input.periodStart, lte: periodEnd } },
      },
      _sum: { quantity: true },
    });

    const totalUnitsSold = allocations.reduce((s, a) => s + Number(a.quantity), 0);
    const netGrossMargin = allocations.reduce((s, a) => s + Number(a.grossMargin), 0);
    const totalAccruedPayable = allocations.reduce((s, a) => s + Number(a.partnerMarginShare), 0);

    const res = await prisma.$transaction(async (tx) => {
      const reconciliation = await tx.partnershipReconciliation.create({
        data: {
          lotId: lot.id,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          totalUnitsSold,
          netGrossMargin,
          totalAccruedPayable,
          reconciledAt: new Date(),
        },
      });

      if (totalAccruedPayable > 0) {
        const lines =
          archetype === "CONSIGNMENT"
            ? [
                {
                  partyId: lot.partnerId,
                  accountType: AccountType.PAYABLE,
                  debit: 0,
                  credit: totalAccruedPayable,
                  description: `Consignment settlement accrual [${lot.lotNumber}]`,
                  isPartnership: true,
                  partnershipId: lot.id,
                },
                {
                  accountType: AccountType.SALES,
                  debit: totalAccruedPayable,
                  credit: 0,
                  description: `Consignment partner share offset [${lot.lotNumber}]`,
                  isPartnership: true,
                  partnershipId: lot.id,
                },
              ]
            : [
                {
                  accountType: AccountType.EXPENSE,
                  debit: totalAccruedPayable,
                  credit: 0,
                  description: `Co-invested partner profit share [${lot.lotNumber}]`,
                  isPartnership: true,
                  partnershipId: lot.id,
                },
                {
                  partyId: lot.partnerId,
                  accountType: AccountType.PAYABLE,
                  debit: 0,
                  credit: totalAccruedPayable,
                  description: `Accrued co-invested payable [${lot.lotNumber}]`,
                  isPartnership: true,
                  partnershipId: lot.id,
                },
              ];

        await postJournal(
          {
            referenceType: "PARTNERSHIP_RECONCILIATION",
            referenceId: reconciliation.id,
            date: input.periodEnd,
            createdById: session.user.id,
            lines,
          },
          tx,
        );
      }

      return {
        reconciliationId: reconciliation.id,
        totalUnitsSold,
        unitsTransferredOut: Number(transferredOut._sum.quantity ?? 0),
        netGrossMargin,
        totalAccruedPayable,
        archetype,
      };
    });

    emitRealtimeEvent(["parties", "ledger", "dashboard"], "update", "PartnershipReconciliation", {
      lotId: lot.id,
      reconciliationId: res.reconciliationId,
    });

    return res;
  });
}


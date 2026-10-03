"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { runAction, parseInput } from "@/actions/_helpers";
import { requireSession } from "@/lib/auth/session";
import { userError } from "@/lib/errors";
import { getPartyBalance } from "@/lib/ledger";
import { StockMovementType, InvoiceStatus, AccountType } from "@prisma/client";
import { getStockOnHand } from "@/lib/stock";
import { generateDocumentNumber } from "@/lib/concurrency";
import { emitRealtimeEvent } from "@/lib/realtime";
import { canPerformAction } from "@/lib/auth/permissions";
import { createPaymentAction } from "@/actions/payments";

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
      select: { id: true, name: true },
    });
    if (!location) throw userError("Location not found.");

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
          direction: it.direction,
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

    await prisma.$transaction(async (tx) => {
      for (const item of itemsToProcess) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
          select: { id: true, name: true, unit: true },
        });
        if (!product) throw userError(`Product with ID ${item.productId} not found.`);

        let lotRecord = null;
        if (item.warehouseLotId) {
          lotRecord = await tx.warehouseLot.findUnique({
            where: { id: item.warehouseLotId },
            select: { id: true, lotNumber: true, locationId: true },
          });
        }

        // Check available stock if decremented
        if (item.direction === "OUT") {
          const current = await getStockOnHand(item.productId, input.locationId, undefined, item.warehouseLotId || undefined);
          if (current < item.quantity) {
            const lotDesc = lotRecord ? ` (Lot ${lotRecord.lotNumber})` : "";
            throw userError(
              `Insufficient stock for ${product.name}${lotDesc} at ${location.name}. Available: ${current} ${product.unit}, Requested: ${item.quantity}`
            );
          }
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
    });

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
    supplierId: z.string().min(1, "External Supplier is required"),
    destinationLocationId: z.string().min(1, "Destination Location is required"),
    lotNumber: z.string().trim().min(1, "Lot Number / Reference is required"),
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

    const supplier = await prisma.party.findUnique({
      where: { id: input.supplierId },
      select: { id: true, name: true },
    });
    if (!supplier) throw userError("External supplier / vendor not found.");

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
      // 1. Create or update the WarehouseLot in Shared Warehouse
      let lot = await tx.warehouseLot.findFirst({
        where: {
          locationId: destinationLocation.id,
          lotNumber: input.lotNumber.trim(),
        },
      });

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
      const invoice = await tx.purchaseInvoice.create({
        data: {
          invoiceNo,
          financialYearId: activeYear?.id || null,
          supplierId: supplier.id,
          locationId: destinationLocation.id,
          date: intakeDate,
          status: InvoiceStatus.OPEN,
          isPartnership: true,
          partnershipId: partner.id,
          partnerSharePct,
          clientSharePct,
          totalAmount,
          amountPaid: 0,
          notes: `Partnership Intake directly to ${destinationLocation.name} [Partner: ${partner.name}] (Equity: ${partnerSharePct}% Partner / ${clientSharePct}% Client). Lot: ${lot.lotNumber}${input.notes ? ` — ${input.notes}` : ""}`,
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

      // 5. Create general ledger entries for external supplier purchase
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

      // External vendor payable credit
      await tx.ledgerEntry.create({
        data: {
          partyId: supplier.id,
          accountType: AccountType.PAYABLE,
          debit: 0,
          credit: totalAmount,
          isPartnership: false,
          partnershipId: null,
          referenceType: "PURCHASE_INVOICE",
          referenceId: invoice.id,
          date: intakeDate,
          description: `Payable to vendor ${supplier.name} for Partnership Intake ${invoice.invoiceNo}`,
          createdById: session.user.id,
        },
      });

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
      destinationLocation =
        (await prisma.location.findFirst({
          where: { isActive: true, deletedAt: null, type: "SHOP" },
          select: { id: true, name: true, type: true },
        })) ||
        (await prisma.location.findFirst({
          where: { isActive: true, deletedAt: null },
          select: { id: true, name: true, type: true },
        }));
    }
    if (!destinationLocation) throw userError("Destination Shop location not found.");

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

      const sourceLocationId = input.sourceLocationId || sourceLot.locationId;
      const sourceLocation = await prisma.location.findUnique({
        where: { id: sourceLocationId },
        select: { id: true, name: true, type: true },
      });
      if (!sourceLocation) throw userError(`Source Warehouse location (${sourceLocationId}) not found.`);

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

    const res = await prisma.$transaction(async (tx) => {
      const invoiceNo = generateDocumentNumber("PINV-PULL");

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
    });

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
            OR: [
              { name: { contains: "Partner", mode: "insensitive" } },
              { name: { contains: "Shared", mode: "insensitive" } },
              { type: "WAREHOUSE" },
            ],
          },
          select: { id: true, name: true, type: true },
        })) || null;
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
          sharedWhLotQtyMap.set(lotKey, (sharedWhLotQtyMap.get(lotKey) ?? 0) + qty);
          if (m.type === "PURCHASE_IN") {
            lotReceivedQtyMap.set(compositeKey, (lotReceivedQtyMap.get(compositeKey) ?? 0) + qty);
            lotReceivedQtyMap.set(lotKey, (lotReceivedQtyMap.get(lotKey) ?? 0) + qty);
          }
        } else if (m.type === "SALE_OUT" || m.type === "TRANSFER_OUT" || m.type === "DELIVERY_OUT" || m.type === "PURCHASE_RETURN" || (m.type === "ADJUSTMENT" && qty < 0)) {
          const absQty = Math.abs(qty);
          sharedWhLotQtyMap.set(compositeKey, (sharedWhLotQtyMap.get(compositeKey) ?? 0) - absQty);
          sharedWhLotQtyMap.set(lotKey, (sharedWhLotQtyMap.get(lotKey) ?? 0) - absQty);
          if (m.type === "TRANSFER_OUT" || m.referenceType === "PARTNERSHIP_PULL") {
            lotPulledQtyMap.set(compositeKey, (lotPulledQtyMap.get(compositeKey) ?? 0) + absQty);
            lotPulledQtyMap.set(lotKey, (lotPulledQtyMap.get(lotKey) ?? 0) + absQty);
          } else if (m.type === "SALE_OUT" || m.type === "ADJUSTMENT") {
            lotSoldDirectQtyMap.set(compositeKey, (lotSoldDirectQtyMap.get(compositeKey) ?? 0) + absQty);
            lotSoldDirectQtyMap.set(lotKey, (lotSoldDirectQtyMap.get(lotKey) ?? 0) + absQty);
          }
        }
      }

      if (isShop) {
        if (m.type === "PURCHASE_IN" || m.type === "TRANSFER_IN" || m.type === "SALE_RETURN" || (m.type === "ADJUSTMENT" && qty > 0)) {
          shopLotQtyMap.set(compositeKey, (shopLotQtyMap.get(compositeKey) ?? 0) + qty);
          shopLotQtyMap.set(lotKey, (shopLotQtyMap.get(lotKey) ?? 0) + qty);
        } else if (m.type === "SALE_OUT" || m.type === "TRANSFER_OUT" || m.type === "DELIVERY_OUT" || m.type === "PURCHASE_RETURN" || (m.type === "ADJUSTMENT" && qty < 0)) {
          const absQty = Math.abs(qty);
          shopLotQtyMap.set(compositeKey, (shopLotQtyMap.get(compositeKey) ?? 0) - absQty);
          shopLotQtyMap.set(lotKey, (shopLotQtyMap.get(lotKey) ?? 0) - absQty);
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
      (inv) => inv.supplierId === partner.id
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

    const saleItemsFromPartnerLots = await prisma.saleInvoiceItem.findMany({
      where: {
        warehouseLotId: filters?.lotId ? filters.lotId : { in: partnerLotIds },
        invoice: {
          status: { not: InvoiceStatus.CANCELLED },
          ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
        },
      },
      include: {
        invoice: {
          select: { id: true, invoiceNo: true, date: true, customer: { select: { name: true } }, walkInName: true },
        },
        product: {
          select: { id: true, productNo: true, name: true, unit: true, costPrice: true },
        },
        warehouseLot: {
          select: { id: true, lotNumber: true, unitCost: true, partnerSharePct: true, clientSharePct: true },
        },
      },
      orderBy: { invoice: { date: "desc" } },
    });

    const settlementLog = saleItemsFromPartnerLots.map((item) => {
      const quantity = Number(item.quantity);
      const unitSellingPrice = Number(item.unitPrice);
      const unitLotCost =
        item.unitCost != null
          ? Number(item.unitCost)
          : item.warehouseLot?.unitCost != null
          ? Number(item.warehouseLot.unitCost)
          : Number(item.product.costPrice);

      const totalSale = quantity * unitSellingPrice;
      const totalCost = quantity * unitLotCost;
      const netMargin = totalSale - totalCost;

      const partnerSharePct = item.warehouseLot?.partnerSharePct != null
        ? Number(item.warehouseLot.partnerSharePct)
        : 100;
      const partnerProfitShare = netMargin * (partnerSharePct / 100);

      return {
        id: item.id,
        date: item.invoice.date,
        invoiceId: item.invoice.id,
        invoiceNo: item.invoice.invoiceNo,
        customerName: item.invoice.customer?.name || item.invoice.walkInName || "Customer",
        productId: item.productId,
        productName: item.product.name,
        productNo: item.product.productNo,
        lotNumber: item.warehouseLot?.lotNumber || "N/A",
        partnerSharePct,
        quantity,
        unit: item.product.unit,
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

      if (targetPids.length === 0 && allRelevantProducts.length > 0) {
        targetPids.push(allRelevantProducts[0].id);
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
        const received = lotReceivedQtyMap.get(compositeKey) ?? (targetPids.length === 1 ? (lotReceivedQtyMap.get(lot.id) ?? 0) : 0);
        const pulled = lotPulledQtyMap.get(compositeKey) ?? (targetPids.length === 1 ? (lotPulledQtyMap.get(lot.id) ?? 0) : 0);
        const soldDirect = lotSoldDirectQtyMap.get(compositeKey) ?? (targetPids.length === 1 ? (lotSoldDirectQtyMap.get(lot.id) ?? 0) : 0);
        const remainingWh = Math.max(0, sharedWhLotQtyMap.get(compositeKey) ?? (targetPids.length === 1 ? (sharedWhLotQtyMap.get(lot.id) ?? 0) : 0));
        const remainingShop = Math.max(0, shopLotQtyMap.get(compositeKey) ?? (targetPids.length === 1 ? (shopLotQtyMap.get(lot.id) ?? 0) : 0));

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
        where: { deletedAt: null },
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
        name: partner.name,
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

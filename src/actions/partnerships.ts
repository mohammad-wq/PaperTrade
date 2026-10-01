"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { runAction, parseInput } from "@/actions/_helpers";
import { requireSession } from "@/lib/auth/session";
import { userError } from "@/lib/errors";
import { getPartyBalance } from "@/lib/ledger";
import { StockMovementType, InvoiceStatus } from "@prisma/client";
import { getStockOnHand } from "@/lib/stock";
import { generateDocumentNumber } from "@/lib/concurrency";
import { emitRealtimeEvent } from "@/lib/realtime";

export async function listPartnersAction() {
  return runAction("partnerships.list", async () => {
    await requireSession();
    // Return all parties marked as beneficiary or suppliers
    const partners = await prisma.party.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        OR: [
          { isBeneficiary: true },
          { type: "SUPPLIER" },
        ],
      },
      orderBy: [
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

const adjustSharedWarehouseStockSchema = z.object({
  partnerId: z.string().min(1, "Partner ID is required"),
  locationId: z.string().min(1, "Warehouse location is required"),
  productId: z.string().min(1, "Product is required"),
  quantity: z.coerce.number().gt(0, "Quantity must be greater than 0"),
  direction: z.enum(["OUT", "IN"]).default("OUT"),
  reason: z.string().trim().min(1, "Reason is required"),
  notes: z.string().trim().optional().nullable(),
  date: z.coerce.date().default(() => new Date()),
});

export async function adjustSharedWarehouseStockAction(raw: unknown) {
  return runAction("partnerships.adjustSharedStock", async () => {
    const session = await requireSession();
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

    const product = await txProduct(input.productId);
    if (!product) throw userError("Product not found.");

    // Check available stock if decremented
    if (input.direction === "OUT") {
      const current = await getStockOnHand(input.productId, input.locationId);
      if (current < input.quantity) {
        throw userError(
          `Insufficient stock at ${location.name}. Available: ${current} ${product.unit}, Requested: ${input.quantity}`
        );
      }
    }

    const refNo = generateDocumentNumber("ADJ-SH");
    const delta = input.direction === "IN" ? input.quantity : -input.quantity;
    const desc = `Direct adjustment at ${location.name} (${input.direction}): ${input.reason}${input.notes ? ` — ${input.notes}` : ""} [Beneficiary: ${partner.name}]`;

    const movement = await prisma.stockMovement.create({
      data: {
        productId: input.productId,
        locationId: input.locationId,
        type: StockMovementType.ADJUSTMENT,
        quantity: delta,
        referenceType: "PARTNER_ADJUSTMENT",
        referenceId: refNo,
        createdById: session.user.id,
        notes: desc,
        createdAt: input.date,
      },
    });

    emitRealtimeEvent(["inventory", "stock-movements", "dashboard"], "create", "StockMovement", {
      id: movement.id,
    });

    return {
      success: true,
      movementId: movement.id,
      availableStock: await getStockOnHand(input.productId, input.locationId),
    };
  });
}

async function txProduct(productId: string) {
  return prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true, productNo: true, unit: true, costPrice: true },
  });
}

export async function getPartnershipHubDataAction(partnerId: string, filters?: { startDate?: string; endDate?: string }) {
  return runAction("partnerships.hubData", async () => {
    await requireSession();

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
      // Find a warehouse with "partner" or "shared" in name or first warehouse
      sharedWarehouse = (await prisma.location.findFirst({
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
    const shopLocation = (await prisma.location.findFirst({
      where: {
        isActive: true,
        deletedAt: null,
        type: "SHOP",
      },
      select: { id: true, name: true, type: true },
    })) || (await prisma.location.findFirst({
      where: { isActive: true, deletedAt: null },
      select: { id: true, name: true, type: true },
    }));

    // 1. Current ledger balance payable to Person B
    const balancePayableToB = await getPartyBalance(partner.id);

    // 2. All purchase invoices from Person B
    const purchaseInvoicesFromB = await prisma.purchaseInvoice.findMany({
      where: {
        supplierId: partner.id,
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

    const totalPurchasedFromB = purchaseInvoicesFromB.reduce(
      (sum, inv) => sum + Number(inv.totalAmount || 0),
      0
    );

    // Collect all lots belonging to Person B (or referenced in invoices from B)
    const partnerLots = await prisma.warehouseLot.findMany({
      where: {
        OR: [
          { partnerId: partner.id },
          { id: { in: purchaseInvoicesFromB.flatMap((inv) => inv.items.map((i) => i.warehouseLotId).filter(Boolean) as string[]) } },
        ],
      },
      include: {
        location: { select: { id: true, name: true, type: true } },
      },
    });

    const partnerLotIds = Array.from(new Set(partnerLots.map((l) => l.id)));

    // 3. Stock Movements for partner lots and shared warehouse
    const lotStockMovements = await prisma.stockMovement.findMany({
      where: {
        warehouseLotId: { in: partnerLotIds },
      },
      include: {
        product: { select: { id: true, productNo: true, name: true, unit: true, costPrice: true } },
      },
    });

    // Calculate remaining quantity of partner lots held in Shop
    let shopPartnerLotValuation = 0;
    const shopLotQtyMap = new Map<string, number>(); // lotId -> quantity in shop

    if (shopLocation) {
      for (const m of lotStockMovements) {
        if (m.locationId === shopLocation.id && m.warehouseLotId) {
          const qty = Number(m.quantity);
          const current = shopLotQtyMap.get(m.warehouseLotId) ?? 0;
          if (m.type === "PURCHASE_IN" || m.type === "TRANSFER_IN" || m.type === "SALE_RETURN" || m.type === "ADJUSTMENT") {
            shopLotQtyMap.set(m.warehouseLotId, current + qty);
          } else if (m.type === "SALE_OUT" || m.type === "TRANSFER_OUT" || m.type === "DELIVERY_OUT" || m.type === "PURCHASE_RETURN") {
            shopLotQtyMap.set(m.warehouseLotId, current - qty);
          }
        }
      }

      for (const lot of partnerLots) {
        const qtyInShop = Math.max(0, shopLotQtyMap.get(lot.id) ?? 0);
        const lotCost = lot.unitCost != null ? Number(lot.unitCost) : 0;
        shopPartnerLotValuation += qtyInShop * lotCost;
      }
    }

    // 4. Current stock valuation in Shared Warehouse
    let sharedWarehouseValuation = 0;
    const sharedWarehouseQtyMap = new Map<string, number>(); // productId -> quantity in shared warehouse

    if (sharedWarehouse) {
      const sharedMovements = await prisma.stockMovement.findMany({
        where: { locationId: sharedWarehouse.id },
        include: {
          product: { select: { id: true, costPrice: true } },
        },
      });

      for (const m of sharedMovements) {
        const qty = Number(m.quantity);
        const cur = sharedWarehouseQtyMap.get(m.productId) ?? 0;
        if (m.type === "PURCHASE_IN" || m.type === "TRANSFER_IN" || m.type === "SALE_RETURN" || m.type === "ADJUSTMENT") {
          sharedWarehouseQtyMap.set(m.productId, cur + qty);
        } else if (m.type === "SALE_OUT" || m.type === "TRANSFER_OUT" || m.type === "DELIVERY_OUT" || m.type === "PURCHASE_RETURN") {
          sharedWarehouseQtyMap.set(m.productId, cur - qty);
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
            sharedWarehouseValuation += qty * (costMap.get(pId) ?? 0);
          }
        }
      }
    }

    // 5. Sales & Settlement Log
    // Every sale item originating from a partner lot
    const dateFilter: any = {};
    if (filters?.startDate) {
      dateFilter.gte = new Date(filters.startDate);
    }
    if (filters?.endDate) {
      dateFilter.lte = new Date(filters.endDate);
    }

    const saleItemsFromPartnerLots = await prisma.saleInvoiceItem.findMany({
      where: {
        warehouseLotId: { in: partnerLotIds },
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
          select: { id: true, lotNumber: true, unitCost: true },
        },
      },
      orderBy: { invoice: { date: "desc" } },
    });

    const settlementLog = saleItemsFromPartnerLots.map((item) => {
      const quantity = Number(item.quantity);
      const unitSellingPrice = Number(item.unitPrice);
      // Persisted unitCost on item, fallback to lot unitCost, fallback to product costPrice
      const unitLotCost = item.unitCost != null
        ? Number(item.unitCost)
        : item.warehouseLot?.unitCost != null
        ? Number(item.warehouseLot.unitCost)
        : Number(item.product.costPrice);

      const totalSale = quantity * unitSellingPrice;
      const totalCost = quantity * unitLotCost;
      const netMargin = totalSale - totalCost;

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
        quantity,
        unit: item.product.unit,
        unitSellingPrice,
        unitLotCost,
        totalSale,
        totalCost,
        netMargin,
      };
    });

    const totalSalesRevenue = settlementLog.reduce((sum, item) => sum + item.totalSale, 0);
    const totalCOGS = settlementLog.reduce((sum, item) => sum + item.totalCost, 0);
    const netGrossMargin = totalSalesRevenue - totalCOGS;

    // 6. Product Breakdown Table
    // Aggregate by product: Total Qty Purchased from B, Batch Purchase Cost, Total Qty Sold, Remaining Qty in Shop, Remaining Qty in Shared Warehouse, Total Sales Revenue, Total Cost, Gross Margin
    const productAggregationMap = new Map<string, {
      product: { id: string; productNo: string; name: string; unit: string; costPrice: number };
      totalQtyPurchased: number;
      batchPurchaseCost: number; // weighted or average unit cost
      totalPurchaseCost: number;
      totalQtySold: number;
      totalSalesRevenue: number;
      totalCostOfSold: number;
      grossMargin: number;
      remainingInShop: number;
      remainingInSharedWarehouse: number;
      lots: Array<{
        id: string;
        lotNumber: string;
        inwardDate: Date;
        inwardPrice: number;
        qtyReceived: number;
        qtySold: number;
        qtyRemaining: number;
      }>;
    }>();

    // Loop through all purchase invoices from B to populate purchased quantities and lot inwards
    for (const inv of purchaseInvoicesFromB) {
      for (const item of inv.items) {
        const p = item.product;
        if (!productAggregationMap.has(p.id)) {
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
            remainingInShop: 0,
            remainingInSharedWarehouse: 0,
            lots: [],
          });
        }

        const entry = productAggregationMap.get(p.id)!;
        const qty = Number(item.quantity);
        const cost = Number(item.unitCost);
        entry.totalQtyPurchased += qty;
        entry.totalPurchaseCost += qty * cost;

        // Lot tracking
        if (item.warehouseLot) {
          const existingLot = entry.lots.find((l) => l.id === item.warehouseLot!.id);
          if (!existingLot) {
            entry.lots.push({
              id: item.warehouseLot.id,
              lotNumber: item.warehouseLot.lotNumber,
              inwardDate: inv.date,
              inwardPrice: item.warehouseLot.unitCost != null ? Number(item.warehouseLot.unitCost) : cost,
              qtyReceived: qty,
              qtySold: 0,
              qtyRemaining: 0,
            });
          } else {
            existingLot.qtyReceived += qty;
          }
        }
      }
    }

    // Now factor in sales from settlementLog
    for (const sale of settlementLog) {
      const entry = productAggregationMap.get(sale.productId);
      if (entry) {
        entry.totalQtySold += sale.quantity;
        entry.totalSalesRevenue += sale.totalSale;
        entry.totalCostOfSold += sale.totalCost;
        entry.grossMargin = entry.totalSalesRevenue - entry.totalCostOfSold;

        // Update lot sold
        const lotItem = entry.lots.find((l) => l.lotNumber === sale.lotNumber);
        if (lotItem) {
          lotItem.qtySold += sale.quantity;
        }
      }
    }

    // Calculate average batch purchase cost and remaining balances
    for (const [pId, entry] of productAggregationMap.entries()) {
      if (entry.totalQtyPurchased > 0) {
        entry.batchPurchaseCost = entry.totalPurchaseCost / entry.totalQtyPurchased;
      } else {
        entry.batchPurchaseCost = entry.product.costPrice;
      }

      entry.remainingInSharedWarehouse = Math.max(0, sharedWarehouseQtyMap.get(pId) ?? 0);

      // Remaining in shop across this product's partner lots
      let prodShopRemaining = 0;
      for (const lot of entry.lots) {
        const inShop = Math.max(0, shopLotQtyMap.get(lot.id) ?? 0);
        lot.qtyRemaining = inShop;
        prodShopRemaining += inShop;
      }
      entry.remainingInShop = prodShopRemaining;
    }

    const productBreakdown = Array.from(productAggregationMap.values()).sort(
      (a, b) => a.product.name.localeCompare(b.product.name)
    );

    return {
      partner: {
        id: partner.id,
        name: partner.name,
        phone: partner.phone,
        email: partner.email,
        isBeneficiary: partner.isBeneficiary,
        sharedWarehouse: sharedWarehouse
          ? { id: sharedWarehouse.id, name: sharedWarehouse.name }
          : null,
      },
      metrics: {
        currentStockValuationSharedWarehouse: sharedWarehouseValuation,
        currentStockValuationShopPartnerLots: shopPartnerLotValuation,
        totalPurchasedFromB,
        totalSalesRevenue,
        totalCOGS,
        netGrossMargin,
        currentPayableToB: balancePayableToB,
      },
      productBreakdown,
      settlementLog,
      locations: {
        sharedWarehouse: sharedWarehouse ? { id: sharedWarehouse.id, name: sharedWarehouse.name } : null,
        shop: shopLocation ? { id: shopLocation.id, name: shopLocation.name } : null,
      },
    };
  });
}

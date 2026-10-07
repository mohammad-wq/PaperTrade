"use server";

import { parseInput, runAction } from "@/actions/_helpers";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { userError } from "@/lib/errors";
import { assertStockDeductionsAvailable, assertStockAvailableForDeduction, getStockOnHand } from "@/lib/stock";
import { getPartyBalance, postJournal } from "@/lib/ledger";
import { allocateInwardFreightToLines, buildOwnedPurchaseJournalLines } from "@/lib/invoice-accounting";
import { withResourceQueue, generateDocumentNumber } from "@/lib/concurrency";
import { emitRealtimeEvent } from "@/lib/realtime";
import { saleInvoiceSchema, updateSaleInvoiceSchema } from "@/schemas/sale-invoice";
import { purchaseInvoiceSchema, updatePurchaseInvoiceSchema } from "@/schemas/purchase-invoice";
import { AccountType, InvoiceStatus, LedgerAccountSubtype, PaymentStatus, PartyType, PaymentMethod, Prisma, PurchaseOrderStatus, StockMovementType } from "@prisma/client";
import { canPerformAction } from "@/lib/auth/permissions";
import { getActiveFinancialYear, getNextAtomicSequence, updateInvoiceSettlementStatus } from "@/lib/financial-year";
import { consumeAdvanceCreditsForInvoice, reversePaymentAllocations } from "@/lib/payment-allocation";
import { cleanPartyDisplayName } from "@/lib/party-display";
import { revalidateWarehouseLots } from "@/lib/cached-lookups";
import {
  postInflow,
  postOutflow,
  reverseMovement,
  reverseMovementsByReferencePrefix,
  resolveOwnershipKey,
  resolvePurchaseOwnership,
  getProductCostState,
  partnershipArchetypeFromLot,
} from "@/lib/inventoryCost.service";
import { getPaymentDestination } from "@/lib/payment-destinations";
import { z } from "zod";

type SaleStockLine = {
  productId: string;
  locationId?: string | null;
  warehouseLotId?: string | null;
  lotId?: string | null;
  ownershipKey?: string | null;
  ownershipType?: string | null;
  stockSource?: "AUTO_SPLIT" | "REGULAR_ONLY" | "PARTNER_ONLY";
  quantity: number;
};

type SaleStockAllocation = {
  productId: string;
  locationId: string;
  warehouseLotId: string | null;
  quantity: number;
};

async function resolveSaleStockAllocations(
  items: SaleStockLine[],
  fallbackLocationId: string,
  tx: Prisma.TransactionClient,
): Promise<SaleStockAllocation[]> {
  const locationCache = new Map<string, { id: string; name: string; type: string }>();
  const partnerLotsByLocation = new Map<
    string,
    Array<{ id: string; lotNumber: string; partnerId: string | null }>
  >();
  const remainingByStockKey = new Map<string, number>();
  const allocations: SaleStockAllocation[] = [];

  const getLocation = async (locationId: string) => {
    let location = locationCache.get(locationId);
    if (!location) {
      const found = await tx.location.findUnique({
        where: { id: locationId },
        select: { id: true, name: true, type: true },
      });
      if (!found) throw userError("Stock location not found.");
      location = found;
      locationCache.set(locationId, location);
    }
    return location;
  };

  const getRemaining = async (
    productId: string,
    locationId: string,
    warehouseLotId: string | null,
  ) => {
    const key = `${productId}:${locationId}:${warehouseLotId ?? ""}`;
    if (!remainingByStockKey.has(key)) {
      remainingByStockKey.set(
        key,
        await getStockOnHand(productId, locationId, tx, warehouseLotId),
      );
    }
    return { key, quantity: remainingByStockKey.get(key)! };
  };

  const allocate = async (
    productId: string,
    locationId: string,
    warehouseLotId: string | null,
    requested: number,
  ) => {
    if (requested <= 0) return 0;
    const stock = await getRemaining(productId, locationId, warehouseLotId);
    const allocated = Math.min(Math.max(0, stock.quantity), requested);
    if (allocated > 0) {
      remainingByStockKey.set(stock.key, stock.quantity - allocated);
      allocations.push({ productId, locationId, warehouseLotId, quantity: allocated });
    }
    return requested - allocated;
  };

  for (const item of items) {
    const locationId = item.locationId || fallbackLocationId;
    const location = await getLocation(locationId);

    if (location.type === "WAREHOUSE") {
      if (!item.warehouseLotId) {
        throw userError(`Select a lot before selling stock from ${location.name}.`);
      }
      await assertStockAvailableForDeduction(
        item.productId,
        locationId,
        item.quantity,
        tx,
        item.warehouseLotId,
      );
      const stock = await getRemaining(item.productId, locationId, item.warehouseLotId);
      if (stock.quantity < item.quantity) {
        throw userError(`Insufficient stock in the selected lot at ${location.name}.`);
      }
      remainingByStockKey.set(stock.key, stock.quantity - item.quantity);
      allocations.push({
        productId: item.productId,
        locationId,
        warehouseLotId: item.warehouseLotId,
        quantity: item.quantity,
      });
      continue;
    }

    if (location.type !== "SHOP") {
      await assertStockAvailableForDeduction(
        item.productId,
        locationId,
        item.quantity,
        tx,
        item.warehouseLotId,
      );
      const stock = await getRemaining(item.productId, locationId, item.warehouseLotId || null);
      if (stock.quantity < item.quantity) {
        throw userError(`Insufficient stock at ${location.name}.`);
      }
      remainingByStockKey.set(stock.key, stock.quantity - item.quantity);
      allocations.push({
        productId: item.productId,
        locationId,
        warehouseLotId: item.warehouseLotId || null,
        quantity: item.quantity,
      });
      continue;
    }

    if (item.warehouseLotId) {
      const selectedLot = await tx.warehouseLot.findFirst({
        where: { id: item.warehouseLotId, locationId, isActive: true, deletedAt: null },
      });
      if (!selectedLot) {
        throw userError(`Selected lot does not exist or is inactive at ${location.name}.`);
      }
      const remaining = await allocate(item.productId, locationId, item.warehouseLotId, item.quantity);
      if (remaining > 0) {
        const available = item.quantity - remaining;
        throw userError(
          `Insufficient stock in lot ${selectedLot.lotNumber} at ${location.name}. Available: ${available}, requested: ${item.quantity}.`,
        );
      }
      continue;
    }

    const explicitLotId =
      item.lotId ||
      (typeof item.ownershipKey === "string" && item.ownershipKey.startsWith("LOT:")
        ? item.ownershipKey.slice(4)
        : null);
    const explicitOwn =
      item.ownershipKey === "OWN" || (item.ownershipType || "").toUpperCase() === "OWN";

    if (location.type === "SHOP" && explicitLotId) {
      const plot = await tx.partnershipLot.findUnique({
        where: { id: explicitLotId },
        select: { warehouseLotId: true, partnerId: true, lotNumber: true },
      });
      let whLotId = plot?.warehouseLotId ?? null;
      if (whLotId) {
        const belongs = await tx.warehouseLot.findFirst({
          where: { id: whLotId, locationId, isActive: true, deletedAt: null },
          select: { id: true },
        });
        if (!belongs) whLotId = null;
      }
      if (!whLotId && plot) {
        const match = await tx.warehouseLot.findFirst({
          where: {
            locationId,
            isActive: true,
            deletedAt: null,
            lotNumber: plot.lotNumber,
            ...(plot.partnerId ? { partnerId: plot.partnerId } : {}),
          },
          select: { id: true },
        });
        whLotId = match?.id ?? null;
      }
      if (!whLotId) {
        const candidates = await tx.warehouseLot.findMany({
          where: {
            locationId,
            isActive: true,
            deletedAt: null,
            OR: [{ partnerId: { not: null } }, { lotNumber: { endsWith: "-SHOP" } }],
          },
          select: { id: true },
        });
        for (const candidate of candidates) {
          const ownership = await resolvePurchaseOwnership(tx, { warehouseLotId: candidate.id });
          if (ownership.partnershipLotId === explicitLotId) {
            whLotId = candidate.id;
            break;
          }
        }
      }
      if (!whLotId) {
        throw userError(
          `Could not find shop stock for partnership lot ${plot?.lotNumber || explicitLotId}.`,
        );
      }
      const left = await allocate(item.productId, locationId, whLotId, item.quantity);
      if (left > 0) {
        const available = item.quantity - left;
        throw userError(
          `Insufficient stock in the selected partnership lot. Available: ${available}, requested: ${item.quantity}.`,
        );
      }
      continue;
    }

    if (location.type === "SHOP" && explicitOwn) {
      const left = await allocate(item.productId, locationId, null, item.quantity);
      if (left > 0) {
        const available = item.quantity - left;
        throw userError(
          `Insufficient entity-owned shop stock. Available: ${available}, requested: ${item.quantity}.`,
        );
      }
      continue;
    }

    const stockSource = item.stockSource || "AUTO_SPLIT";
    if (stockSource !== "AUTO_SPLIT" && stockSource !== "REGULAR_ONLY" && stockSource !== "PARTNER_ONLY") {
      throw userError("Select a valid shop stock source.");
    }
    let partnerLots = partnerLotsByLocation.get(locationId);
    if (!partnerLots) {
      partnerLots = await tx.warehouseLot.findMany({
        where: {
          locationId,
          isActive: true,
          deletedAt: null,
          OR: [
            { partnerId: { not: null } },
            { partner: { isBeneficiary: true } },
            { lotNumber: { endsWith: "-SHOP" } },
          ],
        },
        select: { id: true, lotNumber: true, partnerId: true },
        orderBy: { lotNumber: "asc" },
      });
      partnerLotsByLocation.set(locationId, partnerLots);
    }

    let remaining = item.quantity;
    if (stockSource !== "PARTNER_ONLY") {
      remaining = await allocate(item.productId, locationId, null, remaining);
    }
    if (remaining > 0 && stockSource !== "REGULAR_ONLY") {
      for (const lot of partnerLots) {
        remaining = await allocate(item.productId, locationId, lot.id, remaining);
        if (remaining <= 0) break;
      }
    }
    if (remaining > 0) {
      const available = item.quantity - remaining;
      const sourceLabel =
        stockSource === "REGULAR_ONLY"
          ? "regular shop stock"
          : stockSource === "PARTNER_ONLY"
            ? "partner shop stock"
            : "shop stock";
      throw userError(
        `Insufficient ${sourceLabel} for this product. Available: ${available}, requested: ${item.quantity}.`,
      );
    }
  }

  return allocations;
}

type SaleCostSlice = {
  quantity: number;
  warehouseLotId: string | null;
  ownership: { ownershipType: "OWN" | "LOT"; partnershipLotId?: string | null };
  ownershipKey: string;
  unitCost: number;
};

function takeSaleSlices(
  remaining: SaleStockAllocation[],
  productId: string,
  locationId: string,
  quantity: number,
): SaleStockAllocation[] {
  const taken: SaleStockAllocation[] = [];
  let needed = quantity;
  for (const allocation of remaining) {
    if (allocation.productId !== productId || allocation.locationId !== locationId || allocation.quantity <= 0.0001) {
      continue;
    }
    const take = Math.min(allocation.quantity, needed);
    taken.push({ ...allocation, quantity: take });
    allocation.quantity -= take;
    needed -= take;
    if (needed <= 0.0001) break;
  }
  return taken;
}

async function costSlicesForAllocations(
  tx: Prisma.TransactionClient,
  productId: string,
  locationId: string,
  slices: SaleStockAllocation[],
  forcedLotId?: string | null,
): Promise<SaleCostSlice[]> {
  const priced: SaleCostSlice[] = [];
  for (const slice of slices) {
    const resolved = forcedLotId
      ? { ownershipType: "LOT" as const, partnershipLotId: forcedLotId }
      : await resolvePurchaseOwnership(tx, { warehouseLotId: slice.warehouseLotId });
    const ownership = {
      ownershipType: resolved.ownershipType === "LOT" ? ("LOT" as const) : ("OWN" as const),
      partnershipLotId: resolved.partnershipLotId ?? null,
    };
    const ownershipKey = resolveOwnershipKey(ownership);
    const preview = await getProductCostState(tx, productId, locationId, ownershipKey);
    priced.push({
      quantity: slice.quantity,
      warehouseLotId: slice.warehouseLotId,
      ownership,
      ownershipKey,
      unitCost: preview.avgCost,
    });
  }
  return priced;
}

async function resolveSalePartnership(
  allocations: SaleStockAllocation[],
  isPartnership: boolean,
  partnershipId: string | null,
  tx: Prisma.TransactionClient,
) {
  const lotIds = Array.from(
    new Set(
      allocations
        .map((allocation) => allocation.warehouseLotId)
        .filter((lotId): lotId is string => Boolean(lotId)),
    ),
  );
  const partnerLots = lotIds.length
    ? await tx.warehouseLot.findMany({
        where: { id: { in: lotIds }, partnerId: { not: null } },
        select: { partnerId: true },
      })
    : [];
  const partnerIds = Array.from(new Set(partnerLots.map((lot) => lot.partnerId).filter(Boolean))) as string[];
  if (partnerIds.length > 1) {
    throw userError("A sale invoice cannot consume partnership stock belonging to multiple partners.");
  }
  if (partnershipId && partnerIds.length && partnershipId !== partnerIds[0]) {
    throw userError("Selected partnership does not own the partner stock being sold.");
  }
  if (partnerIds.length) {
    return { isPartnership: true, partnershipId: partnerIds[0] };
  }
  return { isPartnership, partnershipId };
}

export async function listSaleInvoicesAction() {
  return runAction("sales.list", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "sales", "view", (session.user as any).permissions)) {
      throw userError("You do not have permission to view sales invoices.");
    }
    const invoices = await prisma.saleInvoice.findMany({
      orderBy: { date: "desc" },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        location: { select: { id: true, name: true } },
        deliveryOrder: { select: { id: true, doNo: true } },
        financialYear: { select: { id: true, label: true, isActive: true } },
        items: {
          include: {
            product: { select: { id: true, productNo: true, name: true, unit: true } },
            location: { select: { id: true, name: true, type: true } },
            warehouseLot: { select: { id: true, lotNumber: true, partnerId: true, unitCost: true } },
          },
        },
      },
    });

    return invoices.map((inv) => {
      const totalAmount = Number(inv.totalAmount);
      const paidAmount = Number(inv.paidAmount ?? inv.amountPaid ?? 0);
      const balanceDue = inv.balanceAmount != null && Number(inv.balanceAmount) >= 0 ? Number(inv.balanceAmount) : Math.max(0, totalAmount - paidAmount);
      const paymentStatus = inv.paymentStatus || (balanceDue <= 0.001 ? "PAID" : paidAmount > 0.001 ? "PARTIAL" : "UNPAID");
      return {
        ...inv,
        customer: {
          ...inv.customer,
          name: cleanPartyDisplayName(inv.customer.name),
        },
        totalAmount,
        amountPaid: paidAmount,
        paidAmount,
        balanceDue,
        paymentStatus,
        freightCharges: Number(inv.freightCharges ?? 0),
        items: inv.items.map((item) => ({
          ...item,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          unitCost: item.unitCost != null ? Number(item.unitCost) : 0,
          lineTotal: Number(item.lineTotal),
          warehouseLot: item.warehouseLot
            ? {
                ...item.warehouseLot,
                unitCost: item.warehouseLot.unitCost != null ? Number(item.warehouseLot.unitCost) : null,
              }
            : null,
        })),
      };
    });
  });
}

export async function createSaleInvoiceAction(raw: unknown) {
  return runAction("sales.create", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "sales", "create", (session.user as any).permissions)) {
      throw userError("You do not have permission to create sales invoices.");
    }
    const input = parseInput(saleInvoiceSchema, raw);

    const stockKeys = input.items.map((i) => `stock:${i.productId}:${i.locationId || input.locationId}`);
    const partyKey = input.customerId ? `party:${input.customerId}` : "party:walkin";
    const docKey = "doc:sale_invoice";
    const doKey = input.deliveryOrderId ? `order:do:${input.deliveryOrderId}` : null;
    const lockKeys = [...stockKeys, partyKey, docKey, ...(doKey ? [doKey] : [])];

    const res = await withResourceQueue(lockKeys, async (tx) => {
      // 1. Resolve Customer (Walk-in vs Registered Party)
      let targetCustomerId: string;
      let customerName = "";
      let customerCreditLimit: number | null = null;
      let customerBalance = 0;

      if (input.customerType === "WALK_IN") {
        const rawName = input.walkInName?.trim();
        const isGeneric =
          !rawName ||
          rawName.toLowerCase() === "walk-in customer" ||
          rawName.toLowerCase() === "walk in" ||
          rawName.toLowerCase() === "cash customer";
        const finalName = isGeneric ? "Walk-in Customer" : rawName;

        let walkInParty = await tx.party.findFirst({
          where: { name: "Walk-in Customer" },
        });
        if (!walkInParty) {
          walkInParty = await tx.party.create({
            data: {
              name: "Walk-in Customer",
              type: PartyType.CUSTOMER,
              email: "walkin@internal.local",
              isActive: true,
            },
          });
        }
        targetCustomerId = walkInParty.id;
        customerName =
          isGeneric || !rawName ? "Walk-in Customer" : `${rawName} (Walk-in Customer)`;
        customerCreditLimit = null;
        customerBalance = 0;
      } else {
        // Long-term registered party
        if (!input.customerId) {
          throw userError("Please select a registered customer.");
        }
        const customer = await tx.party.findUnique({
          where: { id: input.customerId },
          select: { id: true, name: true, creditLimit: true, email: true },
        });
        if (!customer) {
          throw userError("Customer not found.");
        }
        targetCustomerId = customer.id;
        customerName = customer.name;
        customerCreditLimit = customer.creditLimit !== null ? Number(customer.creditLimit) : null;
        customerBalance = await getPartyBalance(customer.id, tx);
      }

      // Fallback location resolution
      const fallbackLocationId =
        input.locationId ||
        input.items.find((it) => it.locationId)?.locationId ||
        (await tx.location.findFirst({ select: { id: true } }))?.id;

      if (!fallbackLocationId) {
        throw userError("No stock location is configured in the system.");
      }

      // Calculate total amount with freight charges
      const freight = typeof input.freightCharges === "number" ? Math.max(0, input.freightCharges) : 0;
      const subtotal = input.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
      const totalAmount = subtotal + freight;

      // Check customer balance and credit limit warning
      let creditWarning: string | null = null;
      if (customerCreditLimit !== null) {
        const projectedBalance = customerBalance + totalAmount;
        if (projectedBalance > customerCreditLimit) {
          creditWarning = `Warning: This invoice exceeds the customer's credit limit of PKR ${customerCreditLimit.toLocaleString()} (projected balance: PKR ${projectedBalance.toLocaleString()}).`;
        }
      }

      const stockAllocations = await resolveSaleStockAllocations(
        input.items,
        fallbackLocationId,
        tx,
      );

      // Resolve payment amount (for walk-in or immediate cash settlement)
      const rawPaid = typeof input.amountPaid === "number" ? input.amountPaid : 0;
      if (rawPaid > totalAmount + 0.01) {
        throw userError(`Payment amount (PKR ${rawPaid}) cannot exceed the total invoice amount (PKR ${totalAmount}).`);
      }
      const paidAmount = input.paidImmediately
        ? Math.min(totalAmount, rawPaid > 0 ? rawPaid : totalAmount)
        : Math.min(totalAmount, Math.max(0, rawPaid));

      // Walk-in Customer cash-only enforcement
      const isWalkIn = input.customerType === "WALK_IN" || customerName?.toLowerCase().includes("walk-in");
      if (isWalkIn && paidAmount < totalAmount - 0.001) {
        throw userError("Walk-in Customer sales cannot be made on credit. Amount paid must equal the total invoice amount.");
      }

      // 3. Multi-table transaction with atomic financial year sequence
      const activeYear = await getActiveFinancialYear(tx);
      const { sequenceNo, formattedNumber } = await getNextAtomicSequence(tx, activeYear.id, "SALE_INVOICE");

      const walkInContactDetails =
        input.customerType === "WALK_IN" && (input.walkInPhone || input.walkInAddress)
          ? `Walk-in: ${[input.walkInName || "Walk-in Customer", input.walkInPhone, input.walkInAddress].filter(Boolean).join(" | ")}`
          : null;
      const finalNotes = [input.notes?.trim(), walkInContactDetails].filter(Boolean).join(" — ");

      const isSettled = paidAmount >= totalAmount - 0.001;

      const remainingAllocations = stockAllocations.map((a) => ({ ...a }));

      const resolvedItems = await Promise.all(
        input.items.map(async (item) => {
          const itemLocId = item.locationId || fallbackLocationId;
          const slices = takeSaleSlices(remainingAllocations, item.productId, itemLocId, item.quantity);
          if (slices.length === 0) {
            throw userError("No stock allocation was found for this sale line.");
          }
          const forcedLotId =
            item.lotId ||
            (typeof item.ownershipKey === "string" && item.ownershipKey.startsWith("LOT:")
              ? item.ownershipKey.slice(4)
              : null);
          const costSlices = await costSlicesForAllocations(
            tx,
            item.productId,
            itemLocId,
            slices,
            forcedLotId,
          );
          const cogsAmount = costSlices.reduce((sum, slice) => sum + slice.quantity * slice.unitCost, 0);
          const keys = [...new Set(costSlices.map((slice) => slice.ownershipKey))];
          const saleOwnership = costSlices[0].ownership;
          const ownershipKey = keys.length === 1 ? keys[0] : null;
          const partnershipIds = [
            ...new Set(
              costSlices
                .map((slice) => (slice.ownership.ownershipType === "LOT" ? slice.ownership.partnershipLotId : null))
                .filter((id): id is string => Boolean(id)),
            ),
          ];
          const warehouseLotIds = [
            ...new Set(costSlices.map((slice) => slice.warehouseLotId).filter((id): id is string => Boolean(id))),
          ];

          return {
            ...item,
            lotId: partnershipIds.length === 1 ? partnershipIds[0] : item.lotId || null,
            resolvedLotId: warehouseLotIds.length === 1 ? warehouseLotIds[0] : item.warehouseLotId || null,
            resolvedUnitCost: item.quantity > 0 ? cogsAmount / Number(item.quantity) : 0,
            cogsAmount,
            saleOwnership,
            ownershipKey,
            costSlices,
          };
        }),
      );

      const { isPartnership: isPartnershipTx, partnershipId } =
        await resolveSalePartnership(
          stockAllocations,
          Boolean(input.isPartnership || input.partnershipId),
          input.partnershipId || null,
          tx,
        );

      const invoice = await tx.saleInvoice.create({
        data: {
          invoiceNo: formattedNumber,
          financialYearId: activeYear.id,
          sequenceNo,
          customerId: targetCustomerId,
          locationId: fallbackLocationId,
          deliveryOrderId: input.deliveryOrderId || null,
          date: input.date,
          status: isSettled ? InvoiceStatus.SETTLED : InvoiceStatus.OPEN,
          isPartnership: isPartnershipTx,
          partnershipId,
          totalAmount,
          amountPaid: paidAmount,
          freightCharges: freight,
          walkInName: input.walkInName?.trim() || null,
          notes: finalNotes || null,
          createdById: session.user.id,
          items: {
            create: resolvedItems.map((item) => ({
              productId: item.productId,
              locationId: item.locationId || fallbackLocationId,
              warehouseLotId: item.warehouseLotId || item.resolvedLotId || null,
              lotId: item.lotId || null,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              unitCost: item.resolvedUnitCost,
              lineTotal: item.quantity * item.unitPrice,
              cogsAmount: item.cogsAmount,
              ownershipType: item.saleOwnership?.ownershipType ?? null,
              ownershipKey: item.ownershipKey,
            })),
          },
        },
        include: { items: true },
      });

      for (let index = 0; index < invoice.items.length; index++) {
        const line = invoice.items[index];
        const resolved = resolvedItems[index];
        const slices = resolved?.costSlices ?? [];
        let totalCost = 0;
        let unitCost = 0;
        let ownership = slices[0]?.ownership ?? { ownershipType: "OWN" as const };
        for (let sliceIndex = 0; sliceIndex < slices.length; sliceIndex++) {
          const slice = slices[sliceIndex];
          ownership = slice.ownership;
          const posted = await postOutflow(tx, {
            productId: line.productId,
            locationId: line.locationId || fallbackLocationId,
            ownership: slice.ownership,
            quantity: slice.quantity,
            movementType: slice.ownership.ownershipType === "LOT" ? "PARTNER_SALE" : "SALE",
            referenceType: "SALE_INVOICE",
            referenceId: `${invoice.id}:${line.id}:${sliceIndex}`,
          });
          totalCost += posted.totalCost;
          unitCost = posted.unitCost;
        }
        const sliceKeys = [...new Set(slices.map((slice) => slice.ownershipKey))];
        await tx.saleInvoiceItem.update({
          where: { id: line.id },
          data: {
            cogsAmount: totalCost,
            unitCost,
            ownershipType: sliceKeys.length === 1 ? ownership.ownershipType : line.ownershipType,
            ownershipKey: sliceKeys.length === 1 ? sliceKeys[0] : line.ownershipKey,
          },
        });
        if (resolved) {
          resolved.cogsAmount = totalCost;
          resolved.resolvedUnitCost = unitCost;
        }
      }

      // Check if linked DO already deducted stock
      let alreadyDeductedByDO = false;
      if (input.deliveryOrderId) {
        const linkedDO = await tx.deliveryOrder.findUnique({
          where: { id: input.deliveryOrderId },
          select: { status: true },
        });
        if (linkedDO && (linkedDO.status === "DISPATCHED" || linkedDO.status === "DELIVERED")) {
          alreadyDeductedByDO = true;
        }
      }

      // Create stock movements (SALE_OUT) at each item's specific location only if not already deducted
      if (!alreadyDeductedByDO) {
        for (const allocation of stockAllocations) {
          const ownership = await resolvePurchaseOwnership(tx, { warehouseLotId: allocation.warehouseLotId });
          await tx.stockMovement.create({
            data: {
              productId: allocation.productId,
              locationId: allocation.locationId,
              warehouseLotId: allocation.warehouseLotId,
              partnershipLotId: ownership.ownershipType === "LOT" ? ownership.partnershipLotId : null,
              ownershipType: ownership.ownershipType,
              ownershipKey: resolveOwnershipKey(ownership),
              type: StockMovementType.SALE_OUT,
              quantity: allocation.quantity,
              referenceType: "SALE_INVOICE",
              referenceId: invoice.id,
              createdById: session.user.id,
              notes: `Estimate ${invoice.invoiceNo} (${customerName})`,
            },
          });
        }
      }

      // Fetch products for line item descriptions
      const saleProductIds = input.items.map((i) => i.productId);
      const saleProducts = await tx.product.findMany({
        where: { id: { in: saleProductIds } },
        select: { id: true, productNo: true, name: true, unit: true },
      });
      const saleProdMap = new Map(saleProducts.map((p) => [p.id, p]));

      // -------------------------------------------------------------
      // CPA-GRADE SINGLE-TRANSACTION POSTING (Fix duplicate entries)
      // Total Debits (Cash/Bank + Accounts Receivable) == Total Credits (Gross Revenue + Freight Outward)
      // -------------------------------------------------------------

      const splitsToRecord: Array<{ method: PaymentMethod; amount: number; reference: string | null }> =
        input.paymentSplits && input.paymentSplits.length > 0
          ? input.paymentSplits.map((s) => ({
              method: (s.method ?? PaymentMethod.CASH) as PaymentMethod,
              amount: s.amount,
              reference: s.reference || null,
            }))
          : [{ method: (input.paymentMethod ?? PaymentMethod.CASH) as PaymentMethod, amount: paidAmount, reference: null }];

      // 1. Debits: Cash / Bank inflow for immediately settled portion
      if (paidAmount > 0) {
        for (const split of splitsToRecord) {
          if (split.amount <= 0) continue;
          const dest = getPaymentDestination(split.method);
          const refDesc = split.reference ? ` [Ref: ${split.reference}]` : "";
          await tx.ledgerEntry.create({
            data: {
              partyId: null,
              accountType: dest.accountType,
              debit: split.amount,
              credit: 0,
              isPartnership: isPartnershipTx,
              partnershipId,
              referenceType: "SALE_INVOICE",
              referenceId: invoice.id,
              date: input.date,
              description: `Cash / Bank received: Estimate ${invoice.invoiceNo} (${dest.accountName})${refDesc}`,
              createdById: session.user.id,
            },
          });
        }
      }

      // 2. Debits: Accounts Receivable (Trade Debtors) ONLY if an unpaid balance remains
      const unpaidBalance = Math.max(0, totalAmount - paidAmount);
      if (unpaidBalance > 0.001) {
        await tx.ledgerEntry.create({
          data: {
            partyId: targetCustomerId,
            accountType: AccountType.RECEIVABLE,
            debit: unpaidBalance,
            credit: 0,
            isPartnership: isPartnershipTx,
            partnershipId,
            referenceType: "SALE_INVOICE",
            referenceId: invoice.id,
            date: input.date,
            description: `Accounts Receivable (Trade Debtors): Estimate ${invoice.invoiceNo} remaining balance`,
            createdById: session.user.id,
          },
        });
      }

      // 3. Credits: Gross Revenue itemized per product
      for (const item of input.items) {
        const p = saleProdMap.get(item.productId);
        const lineTotal = item.quantity * item.unitPrice;
        const itemDesc = `${p?.productNo ? `[${p.productNo}] ` : ""}${p?.name || "Product"} (Qty: ${item.quantity} ${p?.unit || "pkts"} @ PKR ${item.unitPrice})`;

        await tx.ledgerEntry.create({
          data: {
            partyId: null,
            accountType: AccountType.SALES,
            accountSubtype: LedgerAccountSubtype.PRODUCT_SALES,
            debit: 0,
            credit: lineTotal,
            isPartnership: isPartnershipTx,
            partnershipId,
            referenceType: "SALE_INVOICE",
            referenceId: invoice.id,
            date: input.date,
            description: `Gross Revenue (${invoice.invoiceNo}): ${itemDesc}`,
            createdById: session.user.id,
          },
        });
      }

      // 4. Credits: Transparent Freight Accounting
      if (freight > 0) {
        await tx.ledgerEntry.create({
          data: {
            partyId: null,
            accountType: AccountType.SALES,
            accountSubtype: LedgerAccountSubtype.FREIGHT_REVENUE,
            debit: 0,
            credit: freight,
            isPartnership: isPartnershipTx,
            partnershipId,
            referenceType: "SALE_INVOICE",
            referenceId: invoice.id,
            date: input.date,
            description: `Freight Outward (Transport Charges) on Estimate ${invoice.invoiceNo}`,
            createdById: session.user.id,
          },
        });
      }

      // 5. Balanced Double-Entry for COGS and Inventory Asset Reduction (IFRS/GAAP)
      // Dr Cost of Goods Sold (COGS) [EXPENSE]
      // Cr Inventory on Hand [INVENTORY]
      for (const item of resolvedItems) {
        if (!item.cogsAmount || item.cogsAmount <= 0) continue;
        if (item.lotId) {
          const lot = await tx.partnershipLot.findUnique({
            where: { id: item.lotId },
            select: { archetype: true, type: true },
          });
          if (lot && partnershipArchetypeFromLot(lot) === "CONSIGNMENT") {
            continue;
          }
        }
        const p = saleProdMap.get(item.productId);
        const prodName = p?.productNo ? `[${p.productNo}] ${p.name}` : p?.name || "Product";

        // Debit COGS
        await tx.ledgerEntry.create({
          data: {
            partyId: null,
            accountType: AccountType.COGS,
            debit: item.cogsAmount,
            credit: 0,
            isPartnership: isPartnershipTx,
            partnershipId,
            referenceType: "SALE_INVOICE",
            referenceId: invoice.id,
            date: input.date,
            description: `Cost of Goods Sold (COGS): ${prodName} (Qty: ${item.quantity} ${p?.unit || "pkts"}) on Estimate ${invoice.invoiceNo}`,
            createdById: session.user.id,
          },
        });

        // Credit Inventory Asset
        await tx.ledgerEntry.create({
          data: {
            partyId: null,
            accountType: AccountType.INVENTORY,
            debit: 0,
            credit: item.cogsAmount,
            isPartnership: isPartnershipTx,
            partnershipId,
            referenceType: "SALE_INVOICE",
            referenceId: invoice.id,
            date: input.date,
            description: `Inventory Asset Reduction: ${prodName} (Qty: ${item.quantity} ${p?.unit || "pkts"}) on Estimate ${invoice.invoiceNo}`,
            createdById: session.user.id,
          },
        });
      }

      // Payment row + allocation for settlement status (cash journal stays on the invoice; no duplicate PAYMENT ledger).
      if (paidAmount > 0.001) {
        const { sequenceNo: paymentSeq, formattedNumber: paymentFormatted } = await getNextAtomicSequence(
          tx,
          activeYear.id,
          "PAYMENT_RECEIPT"
        );
        const receiptNo = `RCT-${paymentFormatted}`;
        const primaryMethod = splitsToRecord[0].method;

        const payment = await tx.payment.create({
          data: {
            receiptNo,
            financialYearId: activeYear.id,
            sequenceNo: paymentSeq,
            partyId: targetCustomerId,
            saleInvoiceId: invoice.id,
            isPartnership: isPartnershipTx,
            partnershipId,
            amount: paidAmount,
            method: primaryMethod,
            direction: "IN",
            date: input.date,
            notes: `Settlement for Estimate ${invoice.invoiceNo} (${input.customerType === "WALK_IN" ? "Walk-in Sale" : "Registered Customer"})`,
            createdById: session.user.id,
            splits: {
              create: splitsToRecord.map((s) => ({
                method: s.method,
                amount: s.amount,
                reference: s.reference || null,
              })),
            },
          },
        });

        await tx.invoicePaymentAllocation.create({
          data: {
            paymentId: payment.id,
            saleInvoiceId: invoice.id,
            amount: paidAmount,
          },
        });
      }

      // -------------------------------------------------------------
      // Co-Invested Shared Stock Pool (CO_INVESTED_POOL) Allocations
      // -------------------------------------------------------------
      for (const item of input.items) {
        if (!item.lotId) continue;
        const pLot = await tx.partnershipLot.findUnique({
          where: { id: item.lotId },
          include: { partner: true, items: true },
        });

        if (pLot && pLot.type === "CO_INVESTED_POOL") {
          const lotItem = pLot.items.find((li) => li.productId === item.productId);
          const unitCost = Number(item.unitCost ?? lotItem?.unitCostRate ?? 0);
          const unitSale = Number(item.unitPrice);
          const grossMargin = Math.max(0, (unitSale - unitCost) * Number(item.quantity));
          const marginRatio = Number(pLot.partnerMarginRatio);
          const partnerMarginShare = grossMargin * marginRatio;

          await tx.partnershipSaleAllocation.create({
            data: {
              lotId: pLot.id,
              invoiceId: invoice.id,
              productId: item.productId,
              quantity: item.quantity,
              unitCostRate: unitCost,
              unitSaleRate: unitSale,
              grossMargin,
              partnerMarginShare,
              salesChannel: "INTERNAL_POS",
              soldBy: "OWNER",
            },
          });

          // Balanced double-entry for Partner Margin Share:
          // Debit: Partner Margin Share / Profit Allocation (EXPENSE)
          // Credit: Accrued Profit Share Payable (PAYABLE to Partner)
          if (partnerMarginShare > 0) {
            await tx.ledgerEntry.create({
              data: {
                partyId: null,
                accountType: AccountType.EXPENSE,
                debit: partnerMarginShare,
                credit: 0,
                isPartnership: true,
                partnershipId: pLot.id,
                referenceType: "SALE_INVOICE",
                referenceId: invoice.id,
                date: input.date,
                description: `Partner Profit Allocation: Lot #${pLot.lotNumber} (${pLot.partner.name}) on Estimate ${invoice.invoiceNo}`,
                createdById: session.user.id,
              },
            });

            await tx.ledgerEntry.create({
              data: {
                partyId: pLot.partnerId,
                accountType: AccountType.PAYABLE,
                debit: 0,
                credit: partnerMarginShare,
                isPartnership: true,
                partnershipId: pLot.id,
                referenceType: "SALE_INVOICE",
                referenceId: invoice.id,
                date: input.date,
                description: `Accrued Profit Share Payable: Lot #${pLot.lotNumber} on Estimate ${invoice.invoiceNo}`,
                createdById: session.user.id,
              },
            });
          }
        }
      }


      // Consume any existing unallocated advance credits for this customer
      const advanceResult = await consumeAdvanceCreditsForInvoice(tx, {
        invoiceId: invoice.id,
        partyId: targetCustomerId,
        direction: "IN",
        totalAmount,
        initialPaid: paidAmount,
      });

      await tx.saleInvoice.update({
        where: { id: invoice.id },
        data: {
          paidAmount: advanceResult.paidAmount,
          amountPaid: advanceResult.paidAmount,
          balanceAmount: advanceResult.balanceDue,
          paymentStatus: advanceResult.paymentStatus,
          status: advanceResult.paymentStatus === "PAID" ? InvoiceStatus.SETTLED : InvoiceStatus.OPEN,
        },
      });

      return {
        invoiceId: invoice.id,
        invoiceNo: invoice.invoiceNo,
        totalAmount,
        amountPaid: advanceResult.paidAmount,
        balanceDue: advanceResult.balanceDue,
        creditWarning,
      };
    });

    emitRealtimeEvent(["sales", "inventory", "parties", "ledger", "dashboard"], "create", "SaleInvoice", {
      invoiceId: res.invoiceId,
      invoiceNo: res.invoiceNo,
    });

    return res;
  });
}

export async function updateSaleInvoiceAction(raw: unknown) {
  return runAction("sales.update", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "sales", "update", (session.user as any).permissions)) {
      throw userError("You do not have permission to edit sales invoices.");
    }
    const input = parseInput(updateSaleInvoiceSchema, raw);

    const stockKeys = input.items.map((i) => `stock:${i.productId}:${i.locationId || input.locationId}`);
    const partyKey = input.customerId ? `party:${input.customerId}` : "party:walkin";
    const docKey = "doc:sale_invoice";
    const invoiceKey = `invoice:${input.id}`;
    const lockKeys = [invoiceKey, ...stockKeys, partyKey, docKey];

    const res = await withResourceQueue(lockKeys, async (tx) => {
      // 1. Fetch existing invoice
      const existing = await tx.saleInvoice.findUnique({
        where: { id: input.id },
        include: { items: true, deliveryOrder: true },
      });
      if (!existing) {
        throw userError("Sale invoice not found.");
      }

      if (existing.status === InvoiceStatus.CANCELLED) {
        throw userError(`Cancelled invoices cannot be edited.`);
      }

      // 2. Resolve Customer (Walk-in vs Registered Party)
      let targetCustomerId: string;
      let customerName = "";
      let customerCreditLimit: number | null = null;
      let customerBalance = 0;

      if (input.customerType === "WALK_IN") {
        const rawName = input.walkInName?.trim();
        const isGeneric =
          !rawName ||
          rawName.toLowerCase() === "walk-in customer" ||
          rawName.toLowerCase() === "walk in" ||
          rawName.toLowerCase() === "cash customer";
        const finalName = isGeneric ? "Walk-in Customer" : rawName;

        if (isGeneric) {
          let walkInParty = await tx.party.findFirst({
            where: { name: "Walk-in Customer", type: PartyType.CUSTOMER },
          });
          if (!walkInParty) {
            walkInParty = await tx.party.create({
              data: {
                name: "Walk-in Customer",
                type: PartyType.CUSTOMER,
                email: "walkin@internal.local",
                phone: input.walkInPhone?.trim() || null,
                address: input.walkInAddress?.trim() || null,
                isActive: true,
              },
            });
          }
          targetCustomerId = walkInParty.id;
          const named = input.walkInName?.trim();
          customerName =
            named && named.toLowerCase() !== "walk-in customer"
              ? `${named} (Walk-in Customer)`
              : "Walk-in Customer";
        } else {
          let existingParty = await tx.party.findFirst({
            where: {
              name: { equals: finalName, mode: "insensitive" },
              type: PartyType.CUSTOMER,
            },
          });
          if (existingParty) {
            targetCustomerId = existingParty.id;
            customerName = existingParty.name;
            customerCreditLimit = existingParty.creditLimit ? Number(existingParty.creditLimit) : null;
            customerBalance = await getPartyBalance(existingParty.id, tx);
          } else {
            const newParty = await tx.party.create({
              data: {
                name: finalName,
                type: PartyType.CUSTOMER,
                phone: input.walkInPhone?.trim() || null,
                address: input.walkInAddress?.trim() || null,
                isActive: true,
              },
            });
            targetCustomerId = newParty.id;
            customerName = newParty.name;
          }
        }
      } else {
        if (!input.customerId) {
          throw userError("Please select a registered customer.");
        }
        const customer = await tx.party.findUnique({
          where: { id: input.customerId },
          select: { id: true, name: true, creditLimit: true, email: true },
        });
        if (!customer) {
          throw userError("Customer not found.");
        }
        targetCustomerId = customer.id;
        customerName = customer.name;
        customerCreditLimit = customer.creditLimit !== null ? Number(customer.creditLimit) : null;
        customerBalance = await getPartyBalance(customer.id, tx);
      }

      // Fallback location resolution
      const fallbackLocationId =
        input.locationId ||
        input.items.find((it) => it.locationId)?.locationId ||
        existing.locationId ||
        (await tx.location.findFirst({ select: { id: true } }))?.id;

      if (!fallbackLocationId) {
        throw userError("No stock location is configured in the system.");
      }

      // Calculate total amount with freight charges
      const freight = typeof input.freightCharges === "number" ? Math.max(0, input.freightCharges) : 0;
      const subtotal = input.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
      const totalAmount = subtotal + freight;

      // Revert previous side effects safely before re-checking stock and re-posting
      await reverseMovementsByReferencePrefix(tx, "SALE_INVOICE", `${existing.id}:`);
      await tx.partnershipSaleAllocation.deleteMany({ where: { invoiceId: existing.id } });

      // A. Delete old stock movements generated by this invoice
      await tx.stockMovement.deleteMany({
        where: {
          referenceType: "SALE_INVOICE",
          referenceId: existing.id,
        },
      });

      // B. Delete old ledger entries generated directly by this invoice
      await tx.ledgerEntry.deleteMany({
        where: {
          referenceType: "SALE_INVOICE",
          referenceId: existing.id,
        },
      });

      // C. Remove invoice-linked payment rows (recreated from the edit form; cash stays on the invoice journal)
      const oldLinkedPayments = await tx.payment.findMany({
        where: { saleInvoiceId: existing.id },
        select: { id: true },
      });
      for (const op of oldLinkedPayments) {
        await tx.invoicePaymentAllocation.deleteMany({ where: { paymentId: op.id } });
        await tx.ledgerEntry.deleteMany({
          where: { referenceType: "PAYMENT", referenceId: op.id },
        });
        await tx.paymentSplit.deleteMany({ where: { paymentId: op.id } });
        await tx.payment.delete({ where: { id: op.id } });
      }

      const stockAllocations = await resolveSaleStockAllocations(
        input.items,
        fallbackLocationId,
        tx,
      );

      // Resolve payment amount
      const rawPaid = typeof input.amountPaid === "number" ? input.amountPaid : 0;
      const paidAmount = input.paidImmediately
        ? Math.min(totalAmount, rawPaid > 0 ? rawPaid : totalAmount)
        : Math.min(totalAmount, Math.max(0, rawPaid));

      // Walk-in Customer cash-only enforcement
      const isWalkIn = input.customerType === "WALK_IN" || customerName?.toLowerCase().includes("walk-in");
      if (isWalkIn && paidAmount < totalAmount - 0.001) {
        throw userError("Walk-in Customer sales cannot be made on credit. Amount paid must equal the total invoice amount.");
      }

      const walkInContactDetails =
        input.customerType === "WALK_IN" && (input.walkInPhone || input.walkInAddress)
          ? `Walk-in: ${[input.walkInName || "Walk-in Customer", input.walkInPhone, input.walkInAddress].filter(Boolean).join(" | ")}`
          : null;
      const finalNotes = [input.notes?.trim(), walkInContactDetails].filter(Boolean).join(" — ");
      const isSettled = paidAmount >= totalAmount - 0.001;

      const { isPartnership: isPartnershipTx, partnershipId } =
        await resolveSalePartnership(
          stockAllocations,
          input.isPartnership !== undefined ? input.isPartnership : existing.isPartnership,
          input.partnershipId !== undefined ? input.partnershipId : existing.partnershipId,
          tx,
        );

      // Update invoice record
      const updatedInvoice = await tx.saleInvoice.update({
        where: { id: existing.id },
        data: {
          customerId: targetCustomerId,
          locationId: fallbackLocationId,
          date: input.date,
          status: isSettled ? InvoiceStatus.SETTLED : InvoiceStatus.OPEN,
          isPartnership: isPartnershipTx,
          partnershipId,
          totalAmount,
          amountPaid: paidAmount,
          freightCharges: freight,
          walkInName: input.walkInName?.trim() || null,
          notes: finalNotes || null,
        },
      });

      const remainingAllocations = stockAllocations.map((a) => ({ ...a }));

      const resolvedUpdateItems = await Promise.all(
        input.items.map(async (item) => {
          const itemLocId = item.locationId || fallbackLocationId;
          const slices = takeSaleSlices(remainingAllocations, item.productId, itemLocId, item.quantity);
          if (slices.length === 0) {
            throw userError("No stock allocation was found for this sale line.");
          }
          const forcedLotId =
            item.lotId ||
            (typeof item.ownershipKey === "string" && item.ownershipKey.startsWith("LOT:")
              ? item.ownershipKey.slice(4)
              : null);
          const costSlices = await costSlicesForAllocations(
            tx,
            item.productId,
            itemLocId,
            slices,
            forcedLotId,
          );
          const cogsAmount = costSlices.reduce((sum, slice) => sum + slice.quantity * slice.unitCost, 0);
          const keys = [...new Set(costSlices.map((slice) => slice.ownershipKey))];
          const saleOwnership = costSlices[0].ownership;
          const ownershipKey = keys.length === 1 ? keys[0] : null;
          const partnershipIds = [
            ...new Set(
              costSlices
                .map((slice) => (slice.ownership.ownershipType === "LOT" ? slice.ownership.partnershipLotId : null))
                .filter((id): id is string => Boolean(id)),
            ),
          ];
          const warehouseLotIds = [
            ...new Set(costSlices.map((slice) => slice.warehouseLotId).filter((id): id is string => Boolean(id))),
          ];

          return {
            ...item,
            lotId: partnershipIds.length === 1 ? partnershipIds[0] : item.lotId || null,
            resolvedLotId: warehouseLotIds.length === 1 ? warehouseLotIds[0] : item.warehouseLotId || null,
            resolvedUnitCost: item.quantity > 0 ? cogsAmount / Number(item.quantity) : 0,
            cogsAmount,
            saleOwnership,
            ownershipKey,
            costSlices,
          };
        }),
      );

      await tx.saleInvoiceItem.deleteMany({
        where: { invoiceId: existing.id },
      });
      await tx.saleInvoiceItem.createMany({
        data: resolvedUpdateItems.map((item) => ({
          invoiceId: existing.id,
          productId: item.productId,
          locationId: item.locationId || fallbackLocationId,
          warehouseLotId: item.warehouseLotId || item.resolvedLotId || null,
          lotId: item.lotId || null,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          unitCost: item.resolvedUnitCost,
          lineTotal: item.quantity * item.unitPrice,
          cogsAmount: item.cogsAmount,
          ownershipType: item.saleOwnership?.ownershipType ?? null,
          ownershipKey: item.ownershipKey,
        })),
      });

      const updatedLines = await tx.saleInvoiceItem.findMany({ where: { invoiceId: existing.id } });
      const unusedUpdateItems = resolvedUpdateItems.map((item) => ({ item, used: false }));
      for (const line of updatedLines) {
        const match = unusedUpdateItems.find(
          (entry) =>
            !entry.used &&
            entry.item.productId === line.productId &&
            Number(entry.item.quantity) === Number(line.quantity),
        );
        if (match) match.used = true;
        const resolved = match?.item;
        const slices = resolved?.costSlices ?? [];
        let totalCost = 0;
        let unitCost = 0;
        let ownership = slices[0]?.ownership ?? { ownershipType: "OWN" as const };
        for (let sliceIndex = 0; sliceIndex < slices.length; sliceIndex++) {
          const slice = slices[sliceIndex];
          ownership = slice.ownership;
          const posted = await postOutflow(tx, {
            productId: line.productId,
            locationId: line.locationId || fallbackLocationId,
            ownership: slice.ownership,
            quantity: slice.quantity,
            movementType: slice.ownership.ownershipType === "LOT" ? "PARTNER_SALE" : "SALE",
            referenceType: "SALE_INVOICE",
            referenceId: `${existing.id}:${line.id}:${sliceIndex}`,
          });
          totalCost += posted.totalCost;
          unitCost = posted.unitCost;
        }
        const sliceKeys = [...new Set(slices.map((slice) => slice.ownershipKey))];
        await tx.saleInvoiceItem.update({
          where: { id: line.id },
          data: {
            cogsAmount: totalCost,
            unitCost,
            ownershipType: sliceKeys.length === 1 ? ownership.ownershipType : line.ownershipType,
            ownershipKey: sliceKeys.length === 1 ? sliceKeys[0] : line.ownershipKey,
          },
        });
        if (resolved) {
          resolved.cogsAmount = totalCost;
          resolved.resolvedUnitCost = unitCost;
        }
      }

      // Re-create stock movements (unless DO already deducted)
      let alreadyDeductedByDO = false;
      if (existing.deliveryOrderId) {
        const linkedDO = await tx.deliveryOrder.findUnique({
          where: { id: existing.deliveryOrderId },
          select: { status: true },
        });
        if (linkedDO && (linkedDO.status === "DISPATCHED" || linkedDO.status === "DELIVERED")) {
          alreadyDeductedByDO = true;
        }
      }

      if (!alreadyDeductedByDO) {
        for (const allocation of stockAllocations) {
          const ownership = await resolvePurchaseOwnership(tx, { warehouseLotId: allocation.warehouseLotId });
          await tx.stockMovement.create({
            data: {
              productId: allocation.productId,
              locationId: allocation.locationId,
              warehouseLotId: allocation.warehouseLotId,
              partnershipLotId: ownership.ownershipType === "LOT" ? ownership.partnershipLotId : null,
              ownershipType: ownership.ownershipType,
              ownershipKey: resolveOwnershipKey(ownership),
              type: StockMovementType.SALE_OUT,
              quantity: allocation.quantity,
              referenceType: "SALE_INVOICE",
              referenceId: existing.id,
              createdById: session.user.id,
              notes: `Estimate ${existing.invoiceNo} (${customerName}) [Edited]`,
            },
          });
        }
      }

      // Fetch products for line item descriptions
      const editProductIds = input.items.map((i) => i.productId);
      const editProducts = await tx.product.findMany({
        where: { id: { in: editProductIds } },
        select: { id: true, productNo: true, name: true, unit: true },
      });
      const editProdMap = new Map(editProducts.map((p) => [p.id, p]));

      // -------------------------------------------------------------
      // CPA-GRADE SINGLE-TRANSACTION POSTING (Fix duplicate entries)
      // -------------------------------------------------------------
      const splitsToRecord =
        input.paymentSplits && input.paymentSplits.length > 0
          ? input.paymentSplits
          : [{ method: input.paymentMethod || PaymentMethod.CASH, amount: paidAmount, reference: null }];

      // 1. Debits: Cash / Bank inflow for immediately settled portion
      if (paidAmount > 0) {
        for (const split of splitsToRecord) {
          if (split.amount <= 0) continue;
          const refDesc = split.reference ? ` [Ref: ${split.reference}]` : "";
          await tx.ledgerEntry.create({
            data: {
              partyId: null,
              accountType: AccountType.CASH,
              debit: split.amount,
              credit: 0,
              isPartnership: isPartnershipTx,
              partnershipId,
              referenceType: "SALE_INVOICE",
              referenceId: existing.id,
              date: input.date,
              description: `Cash / Bank received: Estimate ${existing.invoiceNo} (${split.method})${refDesc}`,
              createdById: session.user.id,
            },
          });
        }
      }

      // 2. Debits: Accounts Receivable (Trade Debtors) ONLY if an unpaid balance remains
      const unpaidBalance = Math.max(0, totalAmount - paidAmount);
      if (unpaidBalance > 0.001) {
        await tx.ledgerEntry.create({
          data: {
            partyId: targetCustomerId,
            accountType: AccountType.RECEIVABLE,
            debit: unpaidBalance,
            credit: 0,
            isPartnership: isPartnershipTx,
            partnershipId,
            referenceType: "SALE_INVOICE",
            referenceId: existing.id,
            date: input.date,
            description: `Accounts Receivable (Trade Debtors): Estimate ${existing.invoiceNo} remaining balance`,
            createdById: session.user.id,
          },
        });
      }

      // 3. Credits: Gross Revenue itemized per product
      for (const item of input.items) {
        const p = editProdMap.get(item.productId);
        const lineTotal = item.quantity * item.unitPrice;
        const itemDesc = `${p?.productNo ? `[${p.productNo}] ` : ""}${p?.name || "Product"} (Qty: ${item.quantity} ${p?.unit || "pkts"} @ PKR ${item.unitPrice})`;

        await tx.ledgerEntry.create({
          data: {
            partyId: null,
            accountType: AccountType.SALES,
            debit: 0,
            credit: lineTotal,
            isPartnership: isPartnershipTx,
            partnershipId,
            referenceType: "SALE_INVOICE",
            referenceId: existing.id,
            date: input.date,
            description: `Gross Revenue (${existing.invoiceNo}): ${itemDesc}`,
            createdById: session.user.id,
          },
        });
      }

      // 4. Credits: Transparent Freight Accounting
      if (freight > 0) {
        await tx.ledgerEntry.create({
          data: {
            partyId: null,
            accountType: AccountType.SALES,
            debit: 0,
            credit: freight,
            isPartnership: isPartnershipTx,
            partnershipId,
            referenceType: "SALE_INVOICE",
            referenceId: existing.id,
            date: input.date,
            description: `Freight Outward (Transport Charges) on Estimate ${existing.invoiceNo}`,
            createdById: session.user.id,
          },
        });
      }

      // 5. Balanced Double-Entry for COGS and Inventory Asset Reduction (IFRS/GAAP)
      // Dr Cost of Goods Sold (COGS) [EXPENSE]
      // Cr Inventory on Hand [INVENTORY]
      for (const item of resolvedUpdateItems) {
        if (!item.cogsAmount || item.cogsAmount <= 0) continue;
        if (item.lotId) {
          const lot = await tx.partnershipLot.findUnique({
            where: { id: item.lotId },
            select: { archetype: true, type: true },
          });
          if (lot && partnershipArchetypeFromLot(lot) === "CONSIGNMENT") {
            continue;
          }
        }
        const p = editProdMap.get(item.productId);
        const prodName = p?.productNo ? `[${p.productNo}] ${p.name}` : p?.name || "Product";

        await tx.ledgerEntry.create({
          data: {
            partyId: null,
            accountType: AccountType.COGS,
            debit: item.cogsAmount,
            credit: 0,
            isPartnership: isPartnershipTx,
            partnershipId,
            referenceType: "SALE_INVOICE",
            referenceId: existing.id,
            date: input.date,
            description: `Cost of Goods Sold (COGS): ${prodName} (Qty: ${item.quantity} ${p?.unit || "pkts"}) on Estimate ${existing.invoiceNo}`,
            createdById: session.user.id,
          },
        });

        await tx.ledgerEntry.create({
          data: {
            partyId: null,
            accountType: AccountType.INVENTORY,
            debit: 0,
            credit: item.cogsAmount,
            isPartnership: isPartnershipTx,
            partnershipId,
            referenceType: "SALE_INVOICE",
            referenceId: existing.id,
            date: input.date,
            description: `Inventory Asset Reduction: ${prodName} (Qty: ${item.quantity} ${p?.unit || "pkts"}) on Estimate ${existing.invoiceNo}`,
            createdById: session.user.id,
          },
        });
      }

      if (paidAmount > 0.001) {
        const activeYear = existing.financialYearId ? { id: existing.financialYearId } : await getActiveFinancialYear(tx);
        const { sequenceNo: paymentSeq, formattedNumber: paymentFormatted } = await getNextAtomicSequence(
          tx,
          activeYear.id,
          "PAYMENT_RECEIPT"
        );
        const receiptNo = `RCT-${paymentFormatted}`;
        const primaryMethod = splitsToRecord[0].method;

        const payment = await tx.payment.create({
          data: {
            receiptNo,
            financialYearId: activeYear.id,
            sequenceNo: paymentSeq,
            partyId: targetCustomerId,
            saleInvoiceId: existing.id,
            isPartnership: isPartnershipTx,
            partnershipId,
            amount: paidAmount,
            method: primaryMethod,
            direction: "IN",
            date: input.date,
            notes: `Settlement for Estimate ${existing.invoiceNo} (${input.customerType === "WALK_IN" ? "Walk-in Sale" : "Registered Customer"})`,
            createdById: session.user.id,
            splits: {
              create: splitsToRecord.map((s) => ({
                method: s.method,
                amount: s.amount,
                reference: s.reference || null,
              })),
            },
          },
        });

        await tx.invoicePaymentAllocation.create({
          data: {
            paymentId: payment.id,
            saleInvoiceId: existing.id,
            amount: paidAmount,
          },
        });
      }

      // Co-Invested Shared Stock Pool (CO_INVESTED_POOL) Allocations
      for (const item of input.items) {
        if (!item.lotId) continue;
        const pLot = await tx.partnershipLot.findUnique({
          where: { id: item.lotId },
          include: { partner: true, items: true },
        });

        if (pLot && pLot.type === "CO_INVESTED_POOL") {
          const lotItem = pLot.items.find((li) => li.productId === item.productId);
          const unitCost = Number(item.unitCost ?? lotItem?.unitCostRate ?? 0);
          const unitSale = Number(item.unitPrice);
          const grossMargin = Math.max(0, (unitSale - unitCost) * Number(item.quantity));
          const marginRatio = Number(pLot.partnerMarginRatio);
          const partnerMarginShare = grossMargin * marginRatio;

          await tx.partnershipSaleAllocation.create({
            data: {
              lotId: pLot.id,
              invoiceId: existing.id,
              productId: item.productId,
              quantity: item.quantity,
              unitCostRate: unitCost,
              unitSaleRate: unitSale,
              grossMargin,
              partnerMarginShare,
              salesChannel: "INTERNAL_POS",
            },
          });

          if (partnerMarginShare > 0) {
            await tx.ledgerEntry.create({
              data: {
                partyId: null,
                accountType: AccountType.EXPENSE,
                debit: partnerMarginShare,
                credit: 0,
                isPartnership: true,
                partnershipId: pLot.id,
                referenceType: "SALE_INVOICE",
                referenceId: existing.id,
                date: input.date,
                description: `Partner Profit Allocation: Lot #${pLot.lotNumber} (${pLot.partner.name}) on Estimate ${existing.invoiceNo}`,
                createdById: session.user.id,
              },
            });

            await tx.ledgerEntry.create({
              data: {
                partyId: pLot.partnerId,
                accountType: AccountType.PAYABLE,
                debit: 0,
                credit: partnerMarginShare,
                isPartnership: true,
                partnershipId: pLot.id,
                referenceType: "SALE_INVOICE",
                referenceId: existing.id,
                date: input.date,
                description: `Accrued Profit Share Payable: Lot #${pLot.lotNumber} on Estimate ${existing.invoiceNo}`,
                createdById: session.user.id,
              },
            });
          }
        }
      }


      // Recalculate settlement & payment status considering all payments & allocations
      await updateInvoiceSettlementStatus(tx, existing.id, "SALE");

      const refreshed = await tx.saleInvoice.findUnique({
        where: { id: existing.id },
        select: { paidAmount: true, balanceAmount: true, paymentStatus: true, status: true },
      });

      return {
        invoiceId: existing.id,
        invoiceNo: existing.invoiceNo,
        totalAmount,
        amountPaid: Number(refreshed?.paidAmount ?? paidAmount),
        balanceDue: Number(refreshed?.balanceAmount ?? (totalAmount - paidAmount)),
      };
    });

    emitRealtimeEvent(["sales", "inventory", "parties", "ledger", "dashboard"], "update", "SaleInvoice", {
      invoiceId: res.invoiceId,
      invoiceNo: res.invoiceNo,
    });

    return res;
  });
}

export async function listPurchaseInvoicesAction() {
  return runAction("purchases.list", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "purchases", "view", (session.user as any).permissions)) {
      throw userError("You do not have permission to view purchase invoices.");
    }
    const invoices = await prisma.purchaseInvoice.findMany({
      orderBy: { date: "desc" },
      include: {
        supplier: { select: { id: true, name: true, phone: true } },
        location: { select: { id: true, name: true } },
        purchaseOrder: { select: { id: true, orderNo: true } },
        financialYear: { select: { id: true, label: true, isActive: true } },
        items: {
          include: {
            product: { select: { id: true, productNo: true, name: true, unit: true } },
            warehouseLot: { select: { id: true, lotNumber: true } },
          },
        },
      },
    });

    return invoices.map((inv) => {
      const totalAmount = Number(inv.totalAmount);
      const paidAmount = Number(inv.paidAmount ?? inv.amountPaid ?? 0);
      const balanceDue = inv.balanceAmount != null && Number(inv.balanceAmount) >= 0 ? Number(inv.balanceAmount) : Math.max(0, totalAmount - paidAmount);
      const paymentStatus = inv.paymentStatus || (balanceDue <= 0.001 ? "PAID" : paidAmount > 0.001 ? "PARTIAL" : "UNPAID");
      return {
        ...inv,
        totalAmount,
        amountPaid: paidAmount,
        paidAmount,
        balanceDue,
        paymentStatus,
        freightCharges: Number(inv.freightCharges || 0),
        partnerSharePct: inv.partnerSharePct != null ? Number(inv.partnerSharePct) : null,
        clientSharePct: inv.clientSharePct != null ? Number(inv.clientSharePct) : null,
        items: inv.items.map((item) => ({
          ...item,
          quantity: Number(item.quantity),
          unitCost: Number(item.unitCost),
          lineTotal: Number(item.lineTotal),
        })),
      };
    });
  });
}

export async function createPurchaseInvoiceAction(raw: unknown) {
  return runAction("purchases.create", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "purchases", "create", (session.user as any).permissions)) {
      throw userError("You do not have permission to create purchase invoices.");
    }
    const input = parseInput(purchaseInvoiceSchema, raw);

    const sourceLotIds = Array.from(new Set([
      ...input.items.map((item) =>
        item.sourceWarehouseLotId ||
        input.sourceWarehouseLotId ||
        item.warehouseLotId ||
        input.warehouseLotId,
      ),
    ].filter((lotId): lotId is string => Boolean(lotId))));
    const sourceLots = sourceLotIds.length > 0
      ? await prisma.warehouseLot.findMany({
          where: { id: { in: sourceLotIds } },
          select: { id: true, locationId: true },
        })
      : [];
    const sourceLocationByLotId = new Map(sourceLots.map((lot) => [lot.id, lot.locationId]));
    const stockKeys = input.items.flatMap((item) => {
      const destinationLocationId = item.locationId || input.locationId;
      const sourceLotId =
        item.sourceWarehouseLotId ||
        input.sourceWarehouseLotId ||
        item.warehouseLotId ||
        input.warehouseLotId;
      const sourceLocationId = sourceLotId ? sourceLocationByLotId.get(sourceLotId) : undefined;
      return [
        ...(destinationLocationId ? [`stock:${item.productId}:${destinationLocationId}`] : []),
        ...(sourceLocationId ? [`stock:${item.productId}:${sourceLocationId}`] : []),
      ];
    });
    const partyKey = input.supplierId ? `party:${input.supplierId}` : "party:one-time";
    const docKey = "doc:purchase_invoice";
    const poKey = input.purchaseOrderId ? `order:po:${input.purchaseOrderId}` : null;
    const lockKeys = [...stockKeys, partyKey, docKey, ...(poKey ? [poKey] : [])];

    const res = await withResourceQueue(lockKeys, async (tx) => {
      let targetSupplierId = input.supplierId;
      let supplierName = "";

      if (input.supplierType === "ONE_TIME") {
        const rawName = input.oneTimeSupplierName?.trim();
        const isGeneric =
          !rawName ||
          rawName.toLowerCase() === "market vendor" ||
          rawName.toLowerCase() === "cash vendor" ||
          rawName.toLowerCase() === "cash supplier";
        const finalName = isGeneric ? "Market Vendor" : rawName;

        let genericParty = await tx.party.findFirst({
          where: { name: "Market Vendor" },
        });
        if (!genericParty) {
          genericParty = await tx.party.create({
            data: {
              name: "Market Vendor",
              type: PartyType.SUPPLIER,
              email: "vendor@internal.local",
              isActive: true,
            },
          });
        }
        targetSupplierId = genericParty.id;
        supplierName = finalName;
      } else {
        if (!input.supplierId) {
          throw userError("Please select a supplier.");
        }
        const supp = await tx.party.findUnique({
          where: { id: input.supplierId },
          select: { id: true, name: true, isBeneficiary: true },
        });
        if (!supp) throw userError("Supplier not found.");
        targetSupplierId = supp.id;
        supplierName = supp.name;
      }

      const linkedPurchaseOrder = input.purchaseOrderId
        ? await tx.purchaseOrder.findUnique({
            where: { id: input.purchaseOrderId },
            select: {
              id: true,
              status: true,
              isPartnership: true,
              partnershipId: true,
              supplier: { select: { isPartner: true, isBeneficiary: true } },
            },
          })
        : null;
      if (input.purchaseOrderId && !linkedPurchaseOrder) {
        throw userError("Purchase order not found.");
      }
      const isPartnershipPO = Boolean(
        linkedPurchaseOrder?.isPartnership ||
        linkedPurchaseOrder?.supplier.isPartner ||
        linkedPurchaseOrder?.supplier.isBeneficiary,
      );

      let fallbackLocationId =
        input.locationId ||
        input.items.find((it: any) => it.locationId)?.locationId ||
        (await tx.location.findFirst({ select: { id: true } }))?.id;

      if (!fallbackLocationId) {
        throw userError("No stock location is configured in the system.");
      }
      if (isPartnershipPO) {
        const shopLocation =
          (await tx.location.findFirst({
            where: {
              name: { equals: "Main Retail Shop", mode: "insensitive" },
              type: "SHOP",
              isActive: true,
              deletedAt: null,
            },
            select: { id: true },
          })) ||
          (await tx.location.findFirst({
            where: { type: "SHOP", isActive: true, deletedAt: null },
            select: { id: true },
          }));
        if (!shopLocation) {
          throw userError("A Main Retail Shop location must be configured before converting this partnership PO.");
        }
        fallbackLocationId = shopLocation.id;
      }

      const freight = typeof input.freightCharges === "number" ? Math.max(0, input.freightCharges) : 0;
      const subtotal = input.items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
      const totalAmount = subtotal + freight;

      const rawPaid = typeof input.amountPaid === "number" ? input.amountPaid : 0;
      if (rawPaid > totalAmount + 0.01) {
        throw userError(`Payment amount (PKR ${rawPaid}) cannot exceed the total invoice amount (PKR ${totalAmount}).`);
      }
      const paidAmount = Math.min(totalAmount, Math.max(0, rawPaid));
      const isSettled = paidAmount >= totalAmount - 0.001;
      
      const activeYear = await getActiveFinancialYear(tx);
      const { sequenceNo, formattedNumber } = await getNextAtomicSequence(tx, activeYear.id, "PURCHASE_INVOICE");

      const supplierParty = targetSupplierId
        ? await tx.party.findUnique({
            where: { id: targetSupplierId },
            select: { id: true, name: true, isPartner: true, isBeneficiary: true, partnerWarehouseId: true },
          })
        : null;

      const isSupplierBeneficiary = Boolean(supplierParty?.isPartner || supplierParty?.isBeneficiary);
      const isPartnershipTx = Boolean(
        input.isPartnership ||
        input.partnershipId ||
        isPartnershipPO ||
        isSupplierBeneficiary
      );
      const partnershipId =
        input.partnershipId ||
        linkedPurchaseOrder?.partnershipId ||
        (isPartnershipTx && targetSupplierId ? targetSupplierId : null);

      // Fetch any referenced warehouse lots to determine equity splits
      const referencedLotIds = Array.from(new Set([
        ...input.items.flatMap((item) => [item.warehouseLotId, item.sourceWarehouseLotId]),
        input.warehouseLotId,
        input.sourceWarehouseLotId,
      ].filter((lotId): lotId is string => Boolean(lotId))));
      const referencedLots = referencedLotIds.length > 0
        ? await tx.warehouseLot.findMany({
            where: { id: { in: referencedLotIds } },
            include: { location: { select: { id: true, name: true, type: true } } },
          })
        : [];
      const lotMap = new Map(referencedLots.map((l) => [l.id, l]));
      for (const lotId of referencedLotIds) {
        if (!lotMap.has(lotId)) {
          throw userError(`Selected source lot ${lotId} does not exist.`);
        }
      }

      // Check primary lot equity split
      const primaryLot = referencedLots[0];
      const defaultPartnerSharePct = primaryLot?.partnerSharePct != null
        ? Number(primaryLot.partnerSharePct)
        : input.partnerSharePct != null
        ? Number(input.partnerSharePct)
        : (isPartnershipTx ? 100 : 100);
      const defaultClientSharePct = primaryLot?.clientSharePct != null
        ? Number(primaryLot.clientSharePct)
        : input.clientSharePct != null
        ? Number(input.clientSharePct)
        : (100 - defaultPartnerSharePct);

      // Resolve receiving partner lot at destination location for each item
      const resolvedItems: Array<{
        productId: string;
        locationId: string;
        warehouseLotId: string | null;
        srcLot: any | null;
        quantity: number;
        unitCost: number;
        lineTotal: number;
      }> = [];

      for (const item of input.items) {
        const itemLoc = isPartnershipPO
          ? fallbackLocationId
          : (item as any).locationId || fallbackLocationId;
        const srcLotId =
          item.sourceWarehouseLotId ||
          input.sourceWarehouseLotId ||
          item.warehouseLotId ||
          input.warehouseLotId;
        const srcLot = srcLotId ? lotMap.get(srcLotId) : null;
        const partnerIdForLot = partnershipId || srcLot?.partnerId || (isSupplierBeneficiary ? targetSupplierId : null);

        let finalLotId = item.warehouseLotId || input.warehouseLotId || null;

        if (
          isPartnershipTx &&
          srcLot &&
          srcLot.locationId !== itemLoc &&
          !partnerIdForLot
        ) {
          throw userError(`Select the partner that owns source lot ${srcLot.lotNumber}.`);
        }

        if (isPartnershipTx && partnerIdForLot) {
          if (srcLot) {
            if (srcLot.partnerId && srcLot.partnerId !== partnerIdForLot) {
              throw userError(`Source lot ${srcLot.lotNumber} belongs to a different partner.`);
            }
            if (srcLot.locationId === itemLoc) {
              finalLotId = srcLot.id;
              if (!srcLot.partnerId) {
                await tx.warehouseLot.update({
                  where: { id: srcLot.id },
                  data: { partnerId: partnerIdForLot, unitCost: item.unitCost },
                });
              } else if (srcLot.partnerId !== partnerIdForLot) {
                throw userError(`Lot ${srcLot.lotNumber} belongs to a different partner.`);
              }
            } else {
              if (srcLot.location.type !== "WAREHOUSE") {
                throw userError(`Source lot ${srcLot.lotNumber} must be in a warehouse to pull stock.`);
              }
              const receivingLocation = await tx.location.findUnique({
                where: { id: itemLoc },
                select: { type: true },
              });
              if (receivingLocation?.type !== "SHOP") {
                throw userError("Partnership warehouse stock can only be pulled into a shop location.");
              }
              if (!srcLot.partnerId) {
                await tx.warehouseLot.update({
                  where: { id: srcLot.id },
                  data: { partnerId: partnerIdForLot },
                });
              }
              // Ensure receiving Shop location has a corresponding partner lot with the same lot number
              let receivingLot = await tx.warehouseLot.findFirst({
                where: {
                  locationId: itemLoc,
                  lotNumber: srcLot.lotNumber,
                },
              });
              if (!receivingLot) {
                receivingLot = await tx.warehouseLot.create({
                  data: {
                    locationId: itemLoc,
                    partnerId: partnerIdForLot,
                    lotNumber: srcLot.lotNumber,
                    description: `Partner lot from ${srcLot.location?.name || "Warehouse"} [Lot ${srcLot.lotNumber}]`,
                    unitCost: item.unitCost,
                    partnerSharePct: srcLot.partnerSharePct ?? defaultPartnerSharePct,
                    clientSharePct: srcLot.clientSharePct ?? defaultClientSharePct,
                  },
                });
              } else if (!receivingLot.partnerId) {
                receivingLot = await tx.warehouseLot.update({
                  where: { id: receivingLot.id },
                  data: { partnerId: partnerIdForLot, unitCost: item.unitCost },
                });
              } else if (receivingLot.partnerId !== partnerIdForLot) {
                throw userError(`Shop lot ${receivingLot.lotNumber} belongs to a different partner.`);
              }
              finalLotId = receivingLot.id;
            }
          } else if (finalLotId) {
            const givenLot = await tx.warehouseLot.findUnique({ where: { id: finalLotId } });
            if (givenLot) {
              if (givenLot.locationId === itemLoc) {
                if (!givenLot.partnerId) {
                  await tx.warehouseLot.update({
                    where: { id: givenLot.id },
                    data: { partnerId: partnerIdForLot, unitCost: item.unitCost },
                  });
                } else if (givenLot.partnerId !== partnerIdForLot) {
                  throw userError(`Lot ${givenLot.lotNumber} belongs to a different partner.`);
                }
              } else {
                let receivingLot = await tx.warehouseLot.findFirst({
                  where: { locationId: itemLoc, lotNumber: givenLot.lotNumber },
                });
                if (!receivingLot) {
                  receivingLot = await tx.warehouseLot.create({
                    data: {
                      locationId: itemLoc,
                      partnerId: partnerIdForLot,
                      lotNumber: givenLot.lotNumber,
                      description: `Partner lot [Lot ${givenLot.lotNumber}]`,
                      unitCost: item.unitCost,
                      partnerSharePct: defaultPartnerSharePct,
                      clientSharePct: defaultClientSharePct,
                    },
                  });
                } else if (!receivingLot.partnerId) {
                  receivingLot = await tx.warehouseLot.update({
                    where: { id: receivingLot.id },
                    data: { partnerId: partnerIdForLot, unitCost: item.unitCost },
                  });
                } else if (receivingLot.partnerId !== partnerIdForLot) {
                  throw userError(`Shop lot ${receivingLot.lotNumber} belongs to a different partner.`);
                }
                finalLotId = receivingLot.id;
              }
            }
          } else {
            // Auto-assign or create a partner lot at the receiving location
            const defaultLotNum = `${supplierParty?.name?.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase() || "PARTNER"}-SHOP`;
            let receivingLot = await tx.warehouseLot.findFirst({
              where: { locationId: itemLoc, lotNumber: defaultLotNum },
            });
            if (!receivingLot) {
              receivingLot = await tx.warehouseLot.create({
                data: {
                  locationId: itemLoc,
                  partnerId: partnerIdForLot,
                  lotNumber: defaultLotNum,
                  description: `Partner inventory for ${supplierParty?.name || "Partner"} at ${itemLoc}`,
                  unitCost: item.unitCost,
                  partnerSharePct: defaultPartnerSharePct,
                  clientSharePct: defaultClientSharePct,
                },
              });
              revalidateWarehouseLots();
            } else if (!receivingLot.partnerId) {
              receivingLot = await tx.warehouseLot.update({
                where: { id: receivingLot.id },
                data: { partnerId: partnerIdForLot, unitCost: item.unitCost },
              });
              revalidateWarehouseLots();
            } else if (receivingLot.partnerId !== partnerIdForLot) {
              throw userError(`Shop lot ${receivingLot.lotNumber} belongs to a different partner.`);
            }
            finalLotId = receivingLot.id;
          }
        }

        const receivingLocationForLot = await tx.location.findUnique({
          where: { id: itemLoc },
          select: {
            name: true,
            type: true,
            warehouseLots: { where: { isActive: true, deletedAt: null }, select: { id: true }, take: 1 },
          },
        });
        if (
          receivingLocationForLot?.type === "WAREHOUSE" &&
          receivingLocationForLot.warehouseLots.length > 0 &&
          !finalLotId
        ) {
          throw userError(
            `Select a lot before receiving stock at ${receivingLocationForLot.name}. Warehouses with lots cannot hold unassigned stock.`,
          );
        }

        resolvedItems.push({
          productId: item.productId,
          locationId: itemLoc,
          warehouseLotId: finalLotId,
          srcLot,
          quantity: item.quantity,
          unitCost: item.unitCost,
          lineTotal: item.quantity * item.unitCost,
        });
        if (srcLot && srcLot.locationId !== itemLoc && !finalLotId) {
          throw userError(`Could not resolve a partner lot at the receiving location for ${srcLot.lotNumber}.`);
        }
      }

      const layerUnitCosts = allocateInwardFreightToLines(
        resolvedItems.map((i) => ({ quantity: i.quantity, unitCost: i.unitCost })),
        freight,
      );

      const invoice = await tx.purchaseInvoice.create({
        data: {
          invoiceNo: formattedNumber,
          financialYearId: activeYear.id,
          sequenceNo,
          supplierId: targetSupplierId!,
          locationId: fallbackLocationId,
          purchaseOrderId: input.purchaseOrderId || null,
          date: input.date,
          status: isSettled ? InvoiceStatus.SETTLED : InvoiceStatus.OPEN,
          isPartnership: isPartnershipTx,
          partnershipId,
          partnerSharePct: isPartnershipTx ? defaultPartnerSharePct : null,
          clientSharePct: isPartnershipTx ? defaultClientSharePct : null,
          totalAmount,
          amountPaid: paidAmount,
          freightCharges: freight,
          notes: input.notes || null,
          createdById: session.user.id,
          items: {
            create: resolvedItems.map((item, idx) => ({
              productId: item.productId,
              locationId: item.locationId,
              warehouseLotId: item.warehouseLotId,
              quantity: item.quantity,
              unitCost: item.unitCost,
              landedUnitCost: layerUnitCosts[idx] ?? item.unitCost,
              lineTotal: item.lineTotal,
            })),
          },
        },
      });

      // Update PO status if linked and check if stock was already fulfilled
      let alreadyFulfilledByPO = false;
      if (linkedPurchaseOrder?.status === PurchaseOrderStatus.FULFILLED) {
        alreadyFulfilledByPO = true;
      } else if (input.purchaseOrderId) {
        await tx.purchaseOrder.update({
          where: { id: input.purchaseOrderId },
          data: { status: PurchaseOrderStatus.FULFILLED },
        });
      }

      // Create stock movements at receiving location only if not already fulfilled
      if (!alreadyFulfilledByPO) {
        await assertStockDeductionsAvailable(
          resolvedItems
            .filter((item) => item.srcLot && item.srcLot.locationId !== item.locationId)
            .map((item) => ({
              productId: item.productId,
              locationId: item.srcLot!.locationId,
              warehouseLotId: item.srcLot!.id,
              quantity: item.quantity,
            })),
          tx,
        );

        for (const item of resolvedItems) {
          // If stock was pulled from Shared Warehouse into Shop (different location):
          // Decrement the available quantity in the Shared Warehouse location
          if (item.srcLot && item.srcLot.locationId !== item.locationId) {
            await tx.stockMovement.create({
              data: {
                productId: item.productId,
                locationId: item.srcLot.locationId,
                warehouseLotId: item.srcLot.id,
                type: StockMovementType.TRANSFER_OUT,
                quantity: item.quantity,
                referenceType: "PARTNERSHIP_PULL",
                referenceId: invoice.invoiceNo,
                createdById: session.user.id,
                createdAt: input.date,
                notes: `Stock pull to ${item.locationId} via ${invoice.invoiceNo}`,
              },
            });
          }

          // Ingest inventory under the designated partner shop lot
          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              locationId: item.locationId,
              warehouseLotId: item.warehouseLotId,
              type: StockMovementType.PURCHASE_IN,
              quantity: item.quantity,
              referenceType: "PURCHASE_INVOICE",
              referenceId: invoice.id,
              createdById: session.user.id,
              createdAt: input.date,
              notes: `Purchase Invoice ${invoice.invoiceNo}${item.warehouseLotId ? " (Partner Lot)" : ""}`,
            },
          });
        }
      }

      const purchaseProductIds = input.items.map((i) => i.productId);
      const purchaseProducts = await tx.product.findMany({
        where: { id: { in: purchaseProductIds } },
        select: { id: true, productNo: true, name: true, unit: true },
      });
      const purchaseProdMap = new Map(purchaseProducts.map((p) => [p.id, p]));

      if (!alreadyFulfilledByPO) {
        for (let idx = 0; idx < resolvedItems.length; idx++) {
          const item = resolvedItems[idx];
          const layerUnit = layerUnitCosts[idx] ?? item.unitCost;
          const ownership = await resolvePurchaseOwnership(tx, {
            warehouseLotId: item.warehouseLotId,
          });
          await postInflow(tx, {
            productId: item.productId,
            locationId: item.locationId,
            ownership,
            quantity: item.quantity,
            unitCost: layerUnit,
            movementType: "PURCHASE",
            referenceType: "PURCHASE_INVOICE",
            referenceId: invoice.id,
          });
        }
      }

      const splitsToRecord: Array<{ method: PaymentMethod; amount: number; reference: string | null }> =
        input.paymentSplits && input.paymentSplits.length > 0
          ? input.paymentSplits.map((s) => ({
              method: (s.method ?? PaymentMethod.CASH) as PaymentMethod,
              amount: s.amount,
              reference: s.reference || null,
            }))
          : [{ method: (input.paymentMethod ?? PaymentMethod.CASH) as PaymentMethod, amount: paidAmount, reference: null }];

      const unpaidBalance = Math.max(0, totalAmount - paidAmount);
      const isPartnerCapitalInjection = Boolean(
        (input as any).paymentMode === "PARTNER_CAPITAL" ||
        input.notes?.includes("PARTNER_CAPITAL") ||
        input.notes?.includes("Partnership Intake")
      );

      const purchaseJournalLines = buildOwnedPurchaseJournalLines({
        items: input.items.map((item, idx) => {
          const p = purchaseProdMap.get(item.productId);
          const itemDesc = `${p?.productNo ? `[${p.productNo}] ` : ""}${p?.name || "Product"} (Qty: ${item.quantity} ${p?.unit || "pkts"})`;
          return {
            productId: item.productId,
            quantity: item.quantity,
            unitCost: item.unitCost,
            description: itemDesc,
          };
        }),
        freight,
        layerUnitCosts,
        paidAmount,
        splits: splitsToRecord,
        supplierId: targetSupplierId!,
        partnershipId,
        isPartnership: isPartnershipTx,
        unpaidBalance,
        isPartnerCapitalInjection,
        invoiceNo: invoice.invoiceNo,
      });

      await postJournal(
        {
          referenceType: "PURCHASE_INVOICE",
          referenceId: invoice.id,
          date: input.date,
          createdById: session.user.id,
          lines: purchaseJournalLines,
        },
        tx,
      );

      // Record Payment record for receipt numbering and payment history (NO duplicate ledger entries)
      if (paidAmount > 0) {
        const { sequenceNo: paymentSeq, formattedNumber: paymentFormatted } = await getNextAtomicSequence(
          tx,
          activeYear.id,
          "PAYMENT_RECEIPT"
        );
        const receiptNo = `PAY-${paymentFormatted}`;
        const primaryMethod = splitsToRecord[0].method;

        const payment = await tx.payment.create({
          data: {
            receiptNo,
            financialYearId: activeYear.id,
            sequenceNo: paymentSeq,
            partyId: targetSupplierId!,
            purchaseInvoiceId: invoice.id,
            amount: paidAmount,
            method: primaryMethod,
            direction: "OUT",
            date: input.date,
            notes: `Payment for Purchase Invoice ${invoice.invoiceNo} (${supplierName})`,
            createdById: session.user.id,
            splits: {
              create: splitsToRecord.map((s) => ({
                method: s.method,
                amount: s.amount,
                reference: s.reference || null,
              })),
            },
          },
        });

        await tx.invoicePaymentAllocation.create({
          data: {
            paymentId: payment.id,
            purchaseInvoiceId: invoice.id,
            amount: paidAmount,
          },
        });
      }

      if (isPartnerCapitalInjection) {
        await tx.purchaseInvoice.update({
          where: { id: invoice.id },
          data: {
            paidAmount: totalAmount,
            amountPaid: totalAmount,
            balanceAmount: 0,
            paymentStatus: PaymentStatus.PAID,
            status: InvoiceStatus.SETTLED,
          },
        });

        return {
          invoiceId: invoice.id,
          invoiceNo: invoice.invoiceNo,
          totalAmount,
          amountPaid: totalAmount,
          balanceDue: 0,
        };
      }

      // Consume any existing unallocated advance credits for this supplier
      const advanceResult = await consumeAdvanceCreditsForInvoice(tx, {
        invoiceId: invoice.id,
        partyId: targetSupplierId!,
        direction: "OUT",
        totalAmount,
        initialPaid: paidAmount,
      });

      await tx.purchaseInvoice.update({
        where: { id: invoice.id },
        data: {
          paidAmount: advanceResult.paidAmount,
          amountPaid: advanceResult.paidAmount,
          balanceAmount: advanceResult.balanceDue,
          paymentStatus: advanceResult.paymentStatus,
          status: advanceResult.paymentStatus === "PAID" ? InvoiceStatus.SETTLED : InvoiceStatus.OPEN,
        },
      });

      return {
        invoiceId: invoice.id,
        invoiceNo: invoice.invoiceNo,
        totalAmount,
        amountPaid: advanceResult.paidAmount,
        balanceDue: advanceResult.balanceDue,
      };
    });

    emitRealtimeEvent(["purchases", "inventory", "parties", "ledger", "dashboard"], "create", "PurchaseInvoice", {
      invoiceId: res.invoiceId,
      invoiceNo: res.invoiceNo,
    });

    return res;
  });
}

export async function deletePurchaseInvoiceAction(raw: unknown) {
  return runAction("purchases.delete", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "purchases", "delete", (session.user as any).permissions)) {
      throw userError("You do not have permission to delete purchase invoices.");
    }
    const schema = z.object({ id: z.string().min(1, "Purchase invoice ID is required") });
    const { id } = parseInput(schema, raw);

    const res = await withResourceQueue([`invoice:pi:${id}`], async (tx) => {
      const existing = await tx.purchaseInvoice.findUnique({
        where: { id },
        include: { items: true, payments: true },
      });
      if (!existing) throw userError("Purchase invoice not found.");

      for (const payment of existing.payments) {
        await tx.ledgerEntry.deleteMany({ where: { referenceType: "PAYMENT", referenceId: payment.id } });
        await tx.paymentSplit.deleteMany({ where: { paymentId: payment.id } });
      }
      await tx.payment.deleteMany({ where: { purchaseInvoiceId: id } });
      await tx.ledgerEntry.deleteMany({ where: { referenceType: "PURCHASE_INVOICE", referenceId: id } });
      await reverseMovement(tx, "PURCHASE_INVOICE", id);
      await tx.stockMovement.deleteMany({ where: { referenceType: "PURCHASE_INVOICE", referenceId: id } });
      await tx.invoicePaymentAllocation.deleteMany({ where: { purchaseInvoiceId: id } });
      await tx.purchaseInvoiceItem.deleteMany({ where: { invoiceId: id } });
      await tx.purchaseInvoice.delete({ where: { id } });
      return { id, invoiceNo: existing.invoiceNo };
    });

    emitRealtimeEvent(["purchases", "inventory", "parties", "ledger", "dashboard"], "delete", "PurchaseInvoice", {
      invoiceId: res.id,
      invoiceNo: res.invoiceNo,
    });

    return res;
  });
}

export async function updatePurchaseInvoiceAction(raw: unknown) {
  return runAction("purchases.update", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "purchases", "update", (session.user as any).permissions)) {
      throw userError("You do not have permission to update purchase invoices.");
    }
    const input = parseInput(updatePurchaseInvoiceSchema, raw);

    const stockKeys = input.items.map((i) => `stock:${i.productId}:${i.locationId || input.locationId}`);
    const partyKey = input.supplierId ? `party:${input.supplierId}` : "party:supplier";
    const docKey = "doc:purchase_invoice";
    const invoiceKey = `invoice:pi:${input.id}`;
    const lockKeys = [invoiceKey, ...stockKeys, partyKey, docKey];

    const res = await withResourceQueue(lockKeys, async (tx) => {
      const existing = await tx.purchaseInvoice.findUnique({
        where: { id: input.id },
        include: { items: true, purchaseOrder: true },
      });
      if (!existing) {
        throw userError("Purchase invoice not found.");
      }

      if (existing.status === InvoiceStatus.CANCELLED) {
        throw userError(`Cancelled purchase invoices cannot be edited.`);
      }

      let targetSupplierId = input.supplierId;
      let supplierName = "";

      if (input.supplierType === "ONE_TIME") {
        const rawName = input.oneTimeSupplierName?.trim();
        const isGeneric =
          !rawName ||
          rawName.toLowerCase() === "market vendor" ||
          rawName.toLowerCase() === "cash vendor" ||
          rawName.toLowerCase() === "cash supplier";
        const finalName = isGeneric ? "Market Vendor" : rawName;

        if (isGeneric) {
          let genericParty = await tx.party.findFirst({
            where: { name: "Market Vendor", type: PartyType.SUPPLIER },
          });
          if (!genericParty) {
            genericParty = await tx.party.create({
              data: {
                name: "Market Vendor",
                type: PartyType.SUPPLIER,
                email: "vendor@internal.local",
                phone: input.oneTimeSupplierPhone?.trim() || null,
                isActive: true,
              },
            });
          }
          targetSupplierId = genericParty.id;
          supplierName = genericParty.name;
        } else {
          let existingParty = await tx.party.findFirst({
            where: {
              name: { equals: finalName, mode: "insensitive" },
              type: PartyType.SUPPLIER,
            },
          });
          if (existingParty) {
            targetSupplierId = existingParty.id;
            supplierName = existingParty.name;
          } else {
            const newParty = await tx.party.create({
              data: {
                name: finalName,
                type: PartyType.SUPPLIER,
                phone: input.oneTimeSupplierPhone?.trim() || null,
                isActive: true,
              },
            });
            targetSupplierId = newParty.id;
            supplierName = newParty.name;
          }
        }
      } else {
        if (!input.supplierId) {
          throw userError("Please select a supplier.");
        }
        const supp = await tx.party.findUnique({
          where: { id: input.supplierId },
          select: { id: true, name: true },
        });
        if (!supp) throw userError("Supplier not found.");
        targetSupplierId = supp.id;
        supplierName = supp.name;
      }

      const fallbackLocationId =
        input.locationId ||
        input.items.find((it: any) => it.locationId)?.locationId ||
        existing.locationId ||
        (await tx.location.findFirst({ select: { id: true } }))?.id;

      if (!fallbackLocationId) {
        throw userError("No stock location is configured in the system.");
      }

      const freight = typeof input.freightCharges === "number" ? Math.max(0, input.freightCharges) : 0;
      const subtotal = input.items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
      const totalAmount = subtotal + freight;

      const rawPaid = typeof input.amountPaid === "number" ? input.amountPaid : 0;
      const paidAmount = Math.min(totalAmount, Math.max(0, rawPaid));
      const isSettled = paidAmount >= totalAmount - 0.001;

      // 1. Revert old stock movements
      await tx.stockMovement.deleteMany({
        where: {
          referenceType: "PURCHASE_INVOICE",
          referenceId: existing.id,
        },
      });

      // 2. Revert old ledger entries
      await tx.ledgerEntry.deleteMany({
        where: {
          referenceType: "PURCHASE_INVOICE",
          referenceId: existing.id,
        },
      });
      await reverseMovement(tx, "PURCHASE_INVOICE", existing.id);

      // 3. Revert old auto payments if any
      const oldLinkedPurchasePayments = await tx.payment.findMany({
        where: { purchaseInvoiceId: existing.id },
        select: { id: true },
      });
      for (const p of oldLinkedPurchasePayments) {
        await tx.invoicePaymentAllocation.deleteMany({ where: { paymentId: p.id } });
        await tx.ledgerEntry.deleteMany({
          where: { referenceType: "PAYMENT", referenceId: p.id },
        });
        await tx.paymentSplit.deleteMany({
          where: { paymentId: p.id },
        });
        await tx.payment.delete({
          where: { id: p.id },
        });
      }

      const isPartnershipTx = input.isPartnership !== undefined ? input.isPartnership : existing.isPartnership;
      const partnershipId = input.partnershipId !== undefined ? input.partnershipId : existing.partnershipId;

      // 4. Update purchase invoice
      const updatedInvoice = await tx.purchaseInvoice.update({
        where: { id: existing.id },
        data: {
          supplierId: targetSupplierId!,
          locationId: fallbackLocationId,
          date: input.date,
          status: isSettled ? InvoiceStatus.SETTLED : InvoiceStatus.OPEN,
          isPartnership: isPartnershipTx,
          partnershipId,
          totalAmount,
          amountPaid: paidAmount,
          freightCharges: freight,
          notes: input.notes || null,
        },
      });

      // 5. Recreate items
      await tx.purchaseInvoiceItem.deleteMany({
        where: { invoiceId: existing.id },
      });

      for (const item of input.items) {
        const itemLoc = item.locationId || fallbackLocationId;
        const lotId = item.warehouseLotId || input.warehouseLotId || null;
        const receivingLocationForLot = await tx.location.findUnique({
          where: { id: itemLoc },
          select: {
            name: true,
            type: true,
            warehouseLots: { where: { isActive: true, deletedAt: null }, select: { id: true }, take: 1 },
          },
        });
        if (
          receivingLocationForLot?.type === "WAREHOUSE" &&
          receivingLocationForLot.warehouseLots.length > 0 &&
          !lotId
        ) {
          throw userError(
            `Select a lot before receiving stock at ${receivingLocationForLot.name}. Warehouses with lots cannot hold unassigned stock.`,
          );
        }
      }
      const editLayerUnitCosts = allocateInwardFreightToLines(
        input.items.map((i) => ({ quantity: i.quantity, unitCost: i.unitCost })),
        freight,
      );

      await tx.purchaseInvoiceItem.createMany({
        data: input.items.map((item, idx) => ({
          invoiceId: existing.id,
          productId: item.productId,
          locationId: (item as any).locationId || fallbackLocationId,
          warehouseLotId: item.warehouseLotId || input.warehouseLotId || null,
          quantity: item.quantity,
          unitCost: item.unitCost,
          landedUnitCost: editLayerUnitCosts[idx] ?? item.unitCost,
          lineTotal: item.quantity * item.unitCost,
        })),
      });

      // 6. Check if PO already fulfilled stock
      let alreadyFulfilledByPO = false;
      if (existing.purchaseOrderId) {
        const linkedPO = await tx.purchaseOrder.findUnique({
          where: { id: existing.purchaseOrderId },
          select: { status: true },
        });
        if (linkedPO?.status === PurchaseOrderStatus.FULFILLED) {
          alreadyFulfilledByPO = true;
        }
      }

      // Recreate stock movements
      if (!alreadyFulfilledByPO) {
        for (const item of input.items) {
          const itemLoc = (item as any).locationId || fallbackLocationId;
          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              locationId: itemLoc,
              warehouseLotId: item.warehouseLotId || input.warehouseLotId || null,
              type: StockMovementType.PURCHASE_IN,
              quantity: item.quantity,
              referenceType: "PURCHASE_INVOICE",
              referenceId: existing.id,
              createdById: session.user.id,
              notes: `Purchase Invoice ${existing.invoiceNo} [Edited]`,
            },
          });
        }
      }

      const editPurchaseProductIds = input.items.map((i) => i.productId);
      const editPurchaseProducts = await tx.product.findMany({
        where: { id: { in: editPurchaseProductIds } },
        select: { id: true, productNo: true, name: true, unit: true },
      });
      const editPurchaseProdMap = new Map(editPurchaseProducts.map((p) => [p.id, p]));

      if (!alreadyFulfilledByPO) {
        for (let idx = 0; idx < input.items.length; idx++) {
          const item = input.items[idx];
          const itemLoc = (item as any).locationId || fallbackLocationId;
          const layerUnit = editLayerUnitCosts[idx] ?? item.unitCost;
          const ownership = await resolvePurchaseOwnership(tx, {
            warehouseLotId: item.warehouseLotId || input.warehouseLotId || null,
          });
          await postInflow(tx, {
            productId: item.productId,
            locationId: itemLoc,
            ownership,
            quantity: item.quantity,
            unitCost: layerUnit,
            movementType: "PURCHASE",
            referenceType: "PURCHASE_INVOICE",
            referenceId: existing.id,
          });
        }
      }

      const splitsToRecord: Array<{ method: PaymentMethod; amount: number; reference: string | null }> =
        input.paymentSplits && input.paymentSplits.length > 0
          ? input.paymentSplits.map((s) => ({
              method: (s.method ?? PaymentMethod.CASH) as PaymentMethod,
              amount: s.amount,
              reference: s.reference || null,
            }))
          : [{ method: (input.paymentMethod ?? PaymentMethod.CASH) as PaymentMethod, amount: paidAmount, reference: null }];

      const unpaidBalance = Math.max(0, totalAmount - paidAmount);
      const isPartnerCapitalInjectionEdit = Boolean(
        (input as any).paymentMode === "PARTNER_CAPITAL" ||
        input.notes?.includes("PARTNER_CAPITAL") ||
        input.notes?.includes("Partnership Intake") ||
        existing.notes?.includes("PARTNER_CAPITAL") ||
        existing.notes?.includes("Partnership Intake")
      );

      await postJournal(
        {
          referenceType: "PURCHASE_INVOICE",
          referenceId: existing.id,
          date: input.date,
          createdById: session.user.id,
          lines: buildOwnedPurchaseJournalLines({
            items: input.items.map((item) => {
              const p = editPurchaseProdMap.get(item.productId);
              const itemDesc = `${p?.productNo ? `[${p.productNo}] ` : ""}${p?.name || "Product"} (Qty: ${item.quantity} ${p?.unit || "pkts"})`;
              return {
                productId: item.productId,
                quantity: item.quantity,
                unitCost: item.unitCost,
                description: itemDesc,
              };
            }),
            freight,
            layerUnitCosts: editLayerUnitCosts,
            paidAmount,
            splits: splitsToRecord,
            supplierId: targetSupplierId!,
            partnershipId,
            isPartnership: isPartnershipTx,
            unpaidBalance,
            isPartnerCapitalInjection: isPartnerCapitalInjectionEdit,
            invoiceNo: existing.invoiceNo,
          }),
        },
        tx,
      );

      // 8. Auto Payment record for sequence and allocation (WITHOUT duplicate ledger entries)
      if (paidAmount > 0) {
        const activeYear = existing.financialYearId ? { id: existing.financialYearId } : await getActiveFinancialYear(tx);
        const { sequenceNo: paymentSeq, formattedNumber: paymentFormatted } = await getNextAtomicSequence(
          tx,
          activeYear.id,
          "PAYMENT_RECEIPT"
        );
        const receiptNo = `PAY-${paymentFormatted}`;
        const primaryMethod = splitsToRecord[0].method;

        const payment = await tx.payment.create({
          data: {
            receiptNo,
            financialYearId: activeYear.id,
            sequenceNo: paymentSeq,
            partyId: targetSupplierId!,
            purchaseInvoiceId: existing.id,
            isPartnership: isPartnershipTx,
            partnershipId,
            amount: paidAmount,
            method: primaryMethod,
            direction: "OUT",
            date: input.date,
            notes: `Payment for Purchase Invoice ${existing.invoiceNo} (${supplierName}) [Edited]`,
            createdById: session.user.id,
            ...(splitsToRecord.length > 1 || (input.paymentSplits && input.paymentSplits.length > 0)
              ? {
                  splits: {
                    create: splitsToRecord.map((s) => ({
                      method: s.method,
                      amount: s.amount,
                      reference: s.reference || null,
                    })),
                  },
                }
              : {}),
          },
        });

        await tx.invoicePaymentAllocation.create({
          data: {
            paymentId: payment.id,
            purchaseInvoiceId: existing.id,
            amount: paidAmount,
          },
        });
      }

      // Update PurchaseInvoice fields
      await tx.purchaseInvoice.update({
        where: { id: existing.id },
        data: {
          supplierId: targetSupplierId!,
          locationId: fallbackLocationId,
          date: input.date,
          totalAmount,
          freightCharges: freight,
          notes: input.notes || null,
          isPartnership: isPartnershipTx,
          partnershipId,
        },
      });

      // 9. Update settlement status
      await updateInvoiceSettlementStatus(tx, existing.id, "PURCHASE");

      const isPartnerCapitalInjection = Boolean(
        (input as any).paymentMode === "PARTNER_CAPITAL" ||
        input.notes?.includes("PARTNER_CAPITAL") ||
        input.notes?.includes("Partnership Intake") ||
        existing.notes?.includes("PARTNER_CAPITAL") ||
        existing.notes?.includes("Partnership Intake")
      );

      if (isPartnerCapitalInjection) {
        await tx.purchaseInvoice.update({
          where: { id: existing.id },
          data: {
            paidAmount: totalAmount,
            amountPaid: totalAmount,
            balanceAmount: 0,
            paymentStatus: PaymentStatus.PAID,
            status: InvoiceStatus.SETTLED,
          },
        });
      }

      const refreshed = await tx.purchaseInvoice.findUnique({
        where: { id: existing.id },
        select: { paidAmount: true, balanceAmount: true, paymentStatus: true, status: true },
      });

      return {
        invoiceId: existing.id,
        invoiceNo: existing.invoiceNo,
        totalAmount,
        amountPaid: Number(refreshed?.paidAmount ?? paidAmount),
        balanceDue: Number(refreshed?.balanceAmount ?? (totalAmount - paidAmount)),
      };
    });

    emitRealtimeEvent(["purchases", "inventory", "parties", "ledger", "dashboard"], "update", "PurchaseInvoice", {
      invoiceId: res.invoiceId,
      invoiceNo: res.invoiceNo,
    });

    return res;
  });
}

export async function deleteSaleInvoiceAction(raw: unknown) {
  return runAction("sales.delete", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "sales", "delete", (session.user as any).permissions)) {
      throw userError("You do not have permission to delete sale invoices.");
    }
    const schema = z.object({ id: z.string().min(1, "Sale invoice ID is required") });
    const { id } = parseInput(schema, raw);

    const res = await withResourceQueue([`invoice:si:${id}`], async (tx) => {
      const existing = await tx.saleInvoice.findUnique({
        where: { id },
        include: { items: true, payments: true },
      });
      if (!existing) throw userError("Sale invoice not found.");

      // 1. Reverse all linked payments and their ledger entries
      for (const payment of existing.payments) {
        await reversePaymentAllocations(tx, payment.id);
        await tx.ledgerEntry.deleteMany({ where: { referenceType: "PAYMENT", referenceId: payment.id } });
        await tx.paymentSplit.deleteMany({ where: { paymentId: payment.id } });
      }
      await tx.payment.deleteMany({ where: { saleInvoiceId: id } });

      // 2. Remove all ledger entries tied to this invoice
      await tx.ledgerEntry.deleteMany({ where: { referenceType: "SALE_INVOICE", referenceId: id } });

      // 3. Reverse SALE_OUT stock movements (restores inventory)
      await reverseMovementsByReferencePrefix(tx, "SALE_INVOICE", `${id}:`);
      await tx.partnershipSaleAllocation.deleteMany({ where: { invoiceId: id } });
      await tx.stockMovement.deleteMany({ where: { referenceType: "SALE_INVOICE", referenceId: id } });

      // 4. Delete allocations, items, then the invoice itself
      await tx.invoicePaymentAllocation.deleteMany({ where: { saleInvoiceId: id } });
      await tx.saleInvoiceItem.deleteMany({ where: { invoiceId: id } });
      await tx.saleInvoice.delete({ where: { id } });

      return { id, invoiceNo: existing.invoiceNo };
    });

    emitRealtimeEvent(["sales", "inventory", "parties", "ledger", "dashboard"], "delete", "SaleInvoice", {
      invoiceId: res.id,
      invoiceNo: res.invoiceNo,
    });

    return res;
  });
}

const recordActualFreightCostSchema = z.object({
  saleInvoiceId: z.string().min(1),
  actualFreightCost: z.coerce.number().min(0),
  paymentMethod: z.nativeEnum(PaymentMethod).default(PaymentMethod.CASH),
  date: z.coerce.date().optional(),
});

/** Record actual outbound freight/packing cost (separate from customer-billed freight). */
export async function recordActualFreightCostAction(raw: unknown) {
  return runAction("sales.recordActualFreight", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "sales", "update", (session.user as any).permissions)) {
      throw userError("You do not have permission to update sale invoices.");
    }
    const input = parseInput(recordActualFreightCostSchema, raw);

    await withResourceQueue([`invoice:si:${input.saleInvoiceId}`], async (tx) => {
      const invoice = await tx.saleInvoice.findUnique({ where: { id: input.saleInvoiceId } });
      if (!invoice) throw userError("Sale invoice not found.");

      await tx.saleInvoice.update({
        where: { id: invoice.id },
        data: { actualFreightCost: input.actualFreightCost },
      });

      if (input.actualFreightCost <= 0) return;

      await postJournal(
        {
          referenceType: "SALE_FREIGHT_COST",
          referenceId: invoice.id,
          date: input.date ?? new Date(),
          createdById: session.user.id,
          lines: [
            {
              accountType: AccountType.DIRECT_COST,
              debit: input.actualFreightCost,
              credit: 0,
              description: `Actual freight/packing cost for ${invoice.invoiceNo}`,
            },
            {
              accountType: AccountType.CASH,
              debit: 0,
              credit: input.actualFreightCost,
              description: `Cash paid for freight on ${invoice.invoiceNo}`,
            },
          ],
        },
        tx,
      );
    });

    return { success: true };
  });
}

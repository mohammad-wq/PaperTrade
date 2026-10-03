"use server";

import { parseInput, runAction } from "@/actions/_helpers";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { userError } from "@/lib/errors";
import { assertStockDeductionsAvailable, assertStockAvailableForDeduction, getStockOnHand } from "@/lib/stock";
import { getPartyBalance } from "@/lib/ledger";
import { withResourceQueue, generateDocumentNumber } from "@/lib/concurrency";
import { emitRealtimeEvent } from "@/lib/realtime";
import { saleInvoiceSchema, updateSaleInvoiceSchema } from "@/schemas/sale-invoice";
import { purchaseInvoiceSchema, updatePurchaseInvoiceSchema } from "@/schemas/purchase-invoice";
import { AccountType, InvoiceStatus, PartyType, PaymentMethod, Prisma, PurchaseOrderStatus, StockMovementType } from "@prisma/client";
import { canPerformAction } from "@/lib/auth/permissions";
import { getActiveFinancialYear, getNextAtomicSequence, updateInvoiceSettlementStatus } from "@/lib/financial-year";
import { consumeAdvanceCreditsForInvoice } from "@/lib/payment-allocation";
import { cleanPartyDisplayName } from "@/lib/party-display";
import { revalidateWarehouseLots } from "@/lib/cached-lookups";
import { z } from "zod";

type SaleStockLine = {
  productId: string;
  locationId?: string | null;
  warehouseLotId?: string | null;
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
        customerName = finalName;
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

      // Resolve unitCost for each sold line item (from lot or product cost price)
      const resolvedItems = await Promise.all(
        input.items.map(async (item) => {
          let unitCost = (item as any).unitCost != null ? Number((item as any).unitCost) : null;
          const matchingAllocations = stockAllocations.filter(
            (a) => a.productId === item.productId && (a.locationId === (item.locationId || fallbackLocationId)),
          );
          const allocatedLotId = item.warehouseLotId || matchingAllocations.find((a) => Boolean(a.warehouseLotId))?.warehouseLotId || null;
          if (unitCost === null && allocatedLotId) {
            const lot = await tx.warehouseLot.findUnique({
              where: { id: allocatedLotId },
              select: { unitCost: true },
            });
            if (lot?.unitCost != null) {
              unitCost = Number(lot.unitCost);
            }
          }
          if (unitCost === null) {
            const prod = await tx.product.findUnique({
              where: { id: item.productId },
              select: { costPrice: true },
            });
            if (prod?.costPrice != null) {
              unitCost = Number(prod.costPrice);
            }
          }
          return {
            ...item,
            resolvedLotId: allocatedLotId,
            resolvedUnitCost: unitCost,
          };
        })
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
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              unitCost: item.resolvedUnitCost,
              lineTotal: item.quantity * item.unitPrice,
            })),
          },
        },
      });

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
          await tx.stockMovement.create({
            data: {
              productId: allocation.productId,
              locationId: allocation.locationId,
              warehouseLotId: allocation.warehouseLotId,
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

      // Create ledger entries: multiple entries for each sold product so quantities/rates are recorded (Issue 15)
      const saleProductIds = input.items.map((i) => i.productId);
      const saleProducts = await tx.product.findMany({
        where: { id: { in: saleProductIds } },
        select: { id: true, productNo: true, name: true, unit: true },
      });
      const saleProdMap = new Map(saleProducts.map((p) => [p.id, p]));

      for (const item of input.items) {
        const p = saleProdMap.get(item.productId);
        const lineTotal = item.quantity * item.unitPrice;
        const itemDesc = `${p?.productNo ? `[${p.productNo}] ` : ""}${p?.name || "Product"} (Qty: ${item.quantity} ${p?.unit || "pkts"} @ PKR ${item.unitPrice})`;

        // Customer Receivable (Debit per product)
        await tx.ledgerEntry.create({
          data: {
            partyId: targetCustomerId,
            accountType: AccountType.RECEIVABLE,
            debit: lineTotal,
            credit: 0,
            isPartnership: isPartnershipTx,
            partnershipId,
            referenceType: "SALE_INVOICE",
            referenceId: invoice.id,
            date: input.date,
            description: `Estimate ${invoice.invoiceNo}: ${itemDesc}`,
            createdById: session.user.id,
          },
        });

        // Sales Revenue (Credit per product)
        await tx.ledgerEntry.create({
          data: {
            partyId: null,
            accountType: AccountType.SALES,
            debit: 0,
            credit: lineTotal,
            isPartnership: isPartnershipTx,
            partnershipId,
            referenceType: "SALE_INVOICE",
            referenceId: invoice.id,
            date: input.date,
            description: `Sales Revenue (${invoice.invoiceNo}): ${itemDesc}`,
            createdById: session.user.id,
          },
        });
      }

      // If freight charges were added
      if (freight > 0) {
        await tx.ledgerEntry.create({
          data: {
            partyId: targetCustomerId,
            accountType: AccountType.RECEIVABLE,
            debit: freight,
            credit: 0,
            isPartnership: isPartnershipTx,
            partnershipId,
            referenceType: "SALE_INVOICE",
            referenceId: invoice.id,
            date: input.date,
            description: `Freight charges on Estimate ${invoice.invoiceNo}`,
            createdById: session.user.id,
          },
        });

        await tx.ledgerEntry.create({
          data: {
            partyId: null,
            accountType: AccountType.SALES,
            debit: 0,
            credit: freight,
            isPartnership: isPartnershipTx,
            partnershipId,
            referenceType: "SALE_INVOICE",
            referenceId: invoice.id,
            date: input.date,
            description: `Freight charges on Estimate ${invoice.invoiceNo}`,
            createdById: session.user.id,
          },
        });
      }

      // If immediate or on-the-spot payment was made
      if (paidAmount > 0) {
        const { sequenceNo: paymentSeq, formattedNumber: paymentFormatted } = await getNextAtomicSequence(
          tx,
          activeYear.id,
          "PAYMENT_RECEIPT"
        );
        const receiptNo = `RCT-${paymentFormatted}`;
        const splitsToRecord =
          input.paymentSplits && input.paymentSplits.length > 0
            ? input.paymentSplits
            : [{ method: input.paymentMethod || PaymentMethod.CASH, amount: paidAmount, reference: null }];

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

        // Cash/Bank inflow (Debit per payment method/split)
        for (const split of splitsToRecord) {
          const refDesc = split.reference ? ` [Ref: ${split.reference}]` : "";
          await tx.ledgerEntry.create({
            data: {
              partyId: null,
              accountType: AccountType.CASH,
              debit: split.amount,
              credit: 0,
              isPartnership: isPartnershipTx,
              partnershipId,
              referenceType: "PAYMENT",
              referenceId: payment.id,
              date: input.date,
              description: `Payment received for ${invoice.invoiceNo} (${split.method})${refDesc}`,
              createdById: session.user.id,
            },
          });
        }

        // Customer Receivable reduction (Credit)
        await tx.ledgerEntry.create({
          data: {
            partyId: targetCustomerId,
            accountType: AccountType.RECEIVABLE,
            debit: 0,
            credit: paidAmount,
            isPartnership: isPartnershipTx,
            partnershipId,
            referenceType: "PAYMENT",
            referenceId: payment.id,
            date: input.date,
            description: `Payment cleared for ${invoice.invoiceNo}`,
            createdById: session.user.id,
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
          customerName = walkInParty.name;
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

      // C. Delete old auto-created payment & its ledger entries if created at invoice time
      const oldAutoPayments = await tx.payment.findMany({
        where: {
          saleInvoiceId: existing.id,
          notes: { contains: "Settlement for" },
        },
        select: { id: true },
      });
      for (const op of oldAutoPayments) {
        await tx.ledgerEntry.deleteMany({
          where: { referenceType: "PAYMENT", referenceId: op.id },
        });
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

      // Resolve unitCost for each sold line item (from lot or product cost price)
      const resolvedUpdateItems = await Promise.all(
        input.items.map(async (item) => {
          let unitCost = (item as any).unitCost != null ? Number((item as any).unitCost) : null;
          const matchingAllocations = stockAllocations.filter(
            (a) => a.productId === item.productId && (a.locationId === (item.locationId || fallbackLocationId)),
          );
          const allocatedLotId = item.warehouseLotId || matchingAllocations.find((a) => Boolean(a.warehouseLotId))?.warehouseLotId || null;
          if (unitCost === null && allocatedLotId) {
            const lot = await tx.warehouseLot.findUnique({
              where: { id: allocatedLotId },
              select: { unitCost: true },
            });
            if (lot?.unitCost != null) {
              unitCost = Number(lot.unitCost);
            }
          }
          if (unitCost === null) {
            const prod = await tx.product.findUnique({
              where: { id: item.productId },
              select: { costPrice: true },
            });
            if (prod?.costPrice != null) {
              unitCost = Number(prod.costPrice);
            }
          }
          return {
            ...item,
            resolvedLotId: allocatedLotId,
            resolvedUnitCost: unitCost,
          };
        })
      );

      // Re-create items
      await tx.saleInvoiceItem.deleteMany({
        where: { invoiceId: existing.id },
      });
      await tx.saleInvoiceItem.createMany({
        data: resolvedUpdateItems.map((item) => ({
          invoiceId: existing.id,
          productId: item.productId,
          locationId: item.locationId || fallbackLocationId,
          warehouseLotId: item.warehouseLotId || item.resolvedLotId || null,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          unitCost: item.resolvedUnitCost,
          lineTotal: item.quantity * item.unitPrice,
        })),
      });

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
          await tx.stockMovement.create({
            data: {
              productId: allocation.productId,
              locationId: allocation.locationId,
              warehouseLotId: allocation.warehouseLotId,
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

      // Re-create ledger entries: multiple entries for each sold product (Issue 15)
      const editProductIds = input.items.map((i) => i.productId);
      const editProducts = await tx.product.findMany({
        where: { id: { in: editProductIds } },
        select: { id: true, productNo: true, name: true, unit: true },
      });
      const editProdMap = new Map(editProducts.map((p) => [p.id, p]));

      for (const item of input.items) {
        const p = editProdMap.get(item.productId);
        const lineTotal = item.quantity * item.unitPrice;
        const itemDesc = `${p?.productNo ? `[${p.productNo}] ` : ""}${p?.name || "Product"} (Qty: ${item.quantity} ${p?.unit || "pkts"} @ PKR ${item.unitPrice})`;

        // Customer Receivable (Debit per product)
        await tx.ledgerEntry.create({
          data: {
            partyId: targetCustomerId,
            accountType: AccountType.RECEIVABLE,
            debit: lineTotal,
            credit: 0,
            isPartnership: isPartnershipTx,
            partnershipId,
            referenceType: "SALE_INVOICE",
            referenceId: existing.id,
            date: input.date,
            description: `Estimate ${existing.invoiceNo}: ${itemDesc}`,
            createdById: session.user.id,
          },
        });

        // Sales Revenue (Credit per product)
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
            description: `Sales Revenue (${existing.invoiceNo}): ${itemDesc}`,
            createdById: session.user.id,
          },
        });
      }

      // If freight was added
      if (freight > 0) {
        await tx.ledgerEntry.create({
          data: {
            partyId: targetCustomerId,
            accountType: AccountType.RECEIVABLE,
            debit: freight,
            credit: 0,
            isPartnership: isPartnershipTx,
            partnershipId,
            referenceType: "SALE_INVOICE",
            referenceId: existing.id,
            date: input.date,
            description: `Freight charges on Estimate ${existing.invoiceNo}`,
            createdById: session.user.id,
          },
        });

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
            description: `Freight charges on Estimate ${existing.invoiceNo}`,
            createdById: session.user.id,
          },
        });
      }

      // If immediate payment
      if (paidAmount > 0) {
        const activeYear = existing.financialYearId ? { id: existing.financialYearId } : await getActiveFinancialYear(tx);
        const { sequenceNo: paymentSeq, formattedNumber: paymentFormatted } = await getNextAtomicSequence(
          tx,
          activeYear.id,
          "PAYMENT_RECEIPT"
        );
        const receiptNo = `RCT-${paymentFormatted}`;

        const splitsToRecord =
          input.paymentSplits && input.paymentSplits.length > 0
            ? input.paymentSplits
            : [{ method: input.paymentMethod || PaymentMethod.CASH, amount: paidAmount, reference: null }];

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

        for (const split of splitsToRecord) {
          const refDesc = split.reference ? ` [Ref: ${split.reference}]` : "";
          await tx.ledgerEntry.create({
            data: {
              partyId: null,
              accountType: AccountType.CASH,
              debit: split.amount,
              credit: 0,
              isPartnership: isPartnershipTx,
              partnershipId,
              referenceType: "PAYMENT",
              referenceId: payment.id,
              date: input.date,
              description: `Payment received for ${existing.invoiceNo} (${split.method})${refDesc}`,
              createdById: session.user.id,
            },
          });
        }

        await tx.ledgerEntry.create({
          data: {
            partyId: targetCustomerId,
            accountType: AccountType.RECEIVABLE,
            debit: 0,
            credit: paidAmount,
            isPartnership: isPartnershipTx,
            partnershipId,
            referenceType: "PAYMENT",
            referenceId: payment.id,
            date: input.date,
            description: `Payment cleared for ${existing.invoiceNo}`,
            createdById: session.user.id,
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

      // Update the SaleInvoice row itself
      await tx.saleInvoice.update({
        where: { id: existing.id },
        data: {
          customerId: targetCustomerId,
          locationId: fallbackLocationId,
          date: input.date,
          totalAmount,
          freightCharges: freight,
          walkInName: input.walkInName?.trim() || null,
          notes: finalNotes || null,
          isPartnership: isPartnershipTx,
          partnershipId,
        },
      });

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
            create: resolvedItems.map((item) => ({
              productId: item.productId,
              locationId: item.locationId,
              warehouseLotId: item.warehouseLotId,
              quantity: item.quantity,
              unitCost: item.unitCost,
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

      // Create ledger entries: multiple entries for each purchased product (Issue 15)
      const purchaseProductIds = input.items.map((i) => i.productId);
      const purchaseProducts = await tx.product.findMany({
        where: { id: { in: purchaseProductIds } },
        select: { id: true, productNo: true, name: true, unit: true },
      });
      const purchaseProdMap = new Map(purchaseProducts.map((p) => [p.id, p]));

      for (const item of input.items) {
        const p = purchaseProdMap.get(item.productId);
        const lineTotal = item.quantity * item.unitCost;
        const itemDesc = `${p?.productNo ? `[${p.productNo}] ` : ""}${p?.name || "Product"} (Qty: ${item.quantity} ${p?.unit || "pkts"} @ PKR ${item.unitCost})`;

        const itemLotId = item.warehouseLotId || (item as any).sourceWarehouseLotId || input.warehouseLotId;
        const itemLot = itemLotId ? lotMap.get(itemLotId) : null;
        const partnerShare = itemLot?.partnerSharePct != null
          ? Number(itemLot.partnerSharePct)
          : defaultPartnerSharePct;

        // Dynamic Purchase Calculation: Person A's payable liability to Person B reflects only Person B's ownership portion
        const payableCredit = isPartnershipTx ? lineTotal * (partnerShare / 100) : lineTotal;

        // Purchases Expense (Debit per product at full shop valuation)
        await tx.ledgerEntry.create({
          data: {
            partyId: null,
            accountType: AccountType.PURCHASES,
            debit: lineTotal,
            credit: 0,
            isPartnership: isPartnershipTx,
            partnershipId,
            referenceType: "PURCHASE_INVOICE",
            referenceId: invoice.id,
            date: input.date,
            description: `Purchase Invoice ${invoice.invoiceNo}: ${itemDesc}`,
            createdById: session.user.id,
          },
        });

        const isPartnerCapitalInjection = Boolean(
          (input as any).paymentMode === "PARTNER_CAPITAL" ||
          input.notes?.includes("PARTNER_CAPITAL") ||
          input.notes?.includes("Partnership Intake")
        );

        // Supplier Payable (Credit reflecting partner ownership portion)
        // If funded via partner capital injection, credit partner's capital account directly (NOT the external mill!)
        await tx.ledgerEntry.create({
          data: {
            partyId: isPartnerCapitalInjection && partnershipId ? partnershipId : targetSupplierId!,
            accountType: AccountType.PAYABLE,
            debit: 0,
            credit: payableCredit,
            isPartnership: isPartnershipTx,
            partnershipId,
            referenceType: "PURCHASE_INVOICE",
            referenceId: invoice.id,
            date: input.date,
            description: isPartnerCapitalInjection
              ? `Partner Capital Contribution: ${invoice.invoiceNo} - ${itemDesc}`
              : (isPartnershipTx && partnerShare < 100
                ? `Payable for ${invoice.invoiceNo}: ${itemDesc} (${partnerShare}% equity share)`
                : `Payable for ${invoice.invoiceNo}: ${itemDesc}`),
            createdById: session.user.id,
          },
        });
      }

      // If freight charges were added
      if (freight > 0) {
        await tx.ledgerEntry.create({
          data: {
            partyId: null,
            accountType: AccountType.PURCHASES,
            debit: freight,
            credit: 0,
            referenceType: "PURCHASE_INVOICE",
            referenceId: invoice.id,
            date: input.date,
            description: `Freight charges on Purchase Invoice ${invoice.invoiceNo}`,
            createdById: session.user.id,
          },
        });

        await tx.ledgerEntry.create({
          data: {
            partyId: targetSupplierId!,
            accountType: AccountType.PAYABLE,
            debit: 0,
            credit: freight,
            referenceType: "PURCHASE_INVOICE",
            referenceId: invoice.id,
            date: input.date,
            description: `Freight payable for ${invoice.invoiceNo}`,
            createdById: session.user.id,
          },
        });
      }

      // If immediate payment was made
      if (paidAmount > 0) {
        const { sequenceNo: paymentSeq, formattedNumber: paymentFormatted } = await getNextAtomicSequence(
          tx,
          activeYear.id,
          "PAYMENT_RECEIPT"
        );
        const receiptNo = `PAY-${paymentFormatted}`;

        const splitsToRecord =
          input.paymentSplits && input.paymentSplits.length > 0
            ? input.paymentSplits
            : [{ method: input.paymentMethod || PaymentMethod.CASH, amount: paidAmount, reference: null }];

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

        // Supplier Payable reduced (Debit)
        await tx.ledgerEntry.create({
          data: {
            partyId: targetSupplierId!,
            accountType: AccountType.PAYABLE,
            debit: paidAmount,
            credit: 0,
            referenceType: "PAYMENT",
            referenceId: payment.id,
            date: input.date,
            description: `Payment for ${invoice.invoiceNo}`,
            createdById: session.user.id,
          },
        });

        // Cash/Bank outflow (Credit per payment split)
        for (const split of splitsToRecord) {
          const refDesc = split.reference ? ` [Ref: ${split.reference}]` : "";
          await tx.ledgerEntry.create({
            data: {
              partyId: null,
              accountType: AccountType.CASH,
              debit: 0,
              credit: split.amount,
              referenceType: "PAYMENT",
              referenceId: payment.id,
              date: input.date,
              description: `Payment for ${invoice.invoiceNo} (${split.method})${refDesc}`,
              createdById: session.user.id,
            },
          });
        }

        await tx.invoicePaymentAllocation.create({
          data: {
            paymentId: payment.id,
            purchaseInvoiceId: invoice.id,
            amount: paidAmount,
          },
        });
      }

      const isPartnerCapitalInjection = Boolean(
        (input as any).paymentMode === "PARTNER_CAPITAL" ||
        input.notes?.includes("PARTNER_CAPITAL") ||
        input.notes?.includes("Partnership Intake")
      );

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

      // 3. Revert old auto payments if any
      const oldAutoPayments = await tx.payment.findMany({
        where: {
          purchaseInvoiceId: existing.id,
          notes: { contains: "Payment for Purchase Invoice" },
        },
      });
      for (const p of oldAutoPayments) {
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
      await tx.purchaseInvoiceItem.createMany({
        data: input.items.map((item) => ({
          invoiceId: existing.id,
          productId: item.productId,
          locationId: (item as any).locationId || fallbackLocationId,
          warehouseLotId: item.warehouseLotId || input.warehouseLotId || null,
          quantity: item.quantity,
          unitCost: item.unitCost,
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

      // 7. Recreate ledger entries: multiple entries for each purchased product (Issue 15)
      const editPurchaseProductIds = input.items.map((i) => i.productId);
      const editPurchaseProducts = await tx.product.findMany({
        where: { id: { in: editPurchaseProductIds } },
        select: { id: true, productNo: true, name: true, unit: true },
      });
      const editPurchaseProdMap = new Map(editPurchaseProducts.map((p) => [p.id, p]));

      for (const item of input.items) {
        const p = editPurchaseProdMap.get(item.productId);
        const lineTotal = item.quantity * item.unitCost;
        const itemDesc = `${p?.productNo ? `[${p.productNo}] ` : ""}${p?.name || "Product"} (Qty: ${item.quantity} ${p?.unit || "pkts"} @ PKR ${item.unitCost})`;

        const partnerShare = existing.partnerSharePct != null ? Number(existing.partnerSharePct) : 100;
        const payableCredit = isPartnershipTx ? lineTotal * (partnerShare / 100) : lineTotal;

        // Purchases Expense (Debit per product)
        await tx.ledgerEntry.create({
          data: {
            partyId: null,
            accountType: AccountType.PURCHASES,
            debit: lineTotal,
            credit: 0,
            isPartnership: isPartnershipTx,
            partnershipId,
            referenceType: "PURCHASE_INVOICE",
            referenceId: existing.id,
            date: input.date,
            description: `Purchase Invoice ${existing.invoiceNo}: ${itemDesc}`,
            createdById: session.user.id,
          },
        });

        const isPartnerCapitalInjection = Boolean(
          (input as any).paymentMode === "PARTNER_CAPITAL" ||
          input.notes?.includes("PARTNER_CAPITAL") ||
          input.notes?.includes("Partnership Intake") ||
          existing.notes?.includes("PARTNER_CAPITAL") ||
          existing.notes?.includes("Partnership Intake")
        );

        // Supplier Payable (Credit per product)
        await tx.ledgerEntry.create({
          data: {
            partyId: isPartnerCapitalInjection && partnershipId ? partnershipId : targetSupplierId!,
            accountType: AccountType.PAYABLE,
            debit: 0,
            credit: payableCredit,
            isPartnership: isPartnershipTx,
            partnershipId,
            referenceType: "PURCHASE_INVOICE",
            referenceId: existing.id,
            date: input.date,
            description: isPartnerCapitalInjection
              ? `Partner Capital Contribution: ${existing.invoiceNo} - ${itemDesc}`
              : `Payable for ${existing.invoiceNo}: ${itemDesc}`,
            createdById: session.user.id,
          },
        });
      }

      // If freight charges were added
      if (freight > 0) {
        await tx.ledgerEntry.create({
          data: {
            partyId: null,
            accountType: AccountType.PURCHASES,
            debit: freight,
            credit: 0,
            isPartnership: isPartnershipTx,
            partnershipId,
            referenceType: "PURCHASE_INVOICE",
            referenceId: existing.id,
            date: input.date,
            description: `Freight charges on Purchase Invoice ${existing.invoiceNo}`,
            createdById: session.user.id,
          },
        });

        await tx.ledgerEntry.create({
          data: {
            partyId: targetSupplierId!,
            accountType: AccountType.PAYABLE,
            debit: 0,
            credit: freight,
            isPartnership: isPartnershipTx,
            partnershipId,
            referenceType: "PURCHASE_INVOICE",
            referenceId: existing.id,
            date: input.date,
            description: `Freight payable for ${existing.invoiceNo}`,
            createdById: session.user.id,
          },
        });
      }

      // 8. Auto Payment if paidAmount > 0
      if (paidAmount > 0) {
        const activeYear = existing.financialYearId ? { id: existing.financialYearId } : await getActiveFinancialYear(tx);
        const { sequenceNo: paymentSeq, formattedNumber: paymentFormatted } = await getNextAtomicSequence(
          tx,
          activeYear.id,
          "PAYMENT_RECEIPT"
        );
        const receiptNo = `PAY-${paymentFormatted}`;

        const splitsToRecord =
          input.paymentSplits && input.paymentSplits.length > 0
            ? input.paymentSplits
            : [{ method: input.paymentMethod || PaymentMethod.CASH, amount: paidAmount, reference: null }];

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

        await tx.ledgerEntry.create({
          data: {
            partyId: targetSupplierId!,
            accountType: AccountType.PAYABLE,
            debit: paidAmount,
            credit: 0,
            isPartnership: isPartnershipTx,
            partnershipId,
            referenceType: "PAYMENT",
            referenceId: payment.id,
            date: input.date,
            description: `Payment for ${existing.invoiceNo}`,
            createdById: session.user.id,
          },
        });

        for (const split of splitsToRecord) {
          const refDesc = split.reference ? ` [Ref: ${split.reference}]` : "";
          await tx.ledgerEntry.create({
            data: {
              partyId: null,
              accountType: AccountType.CASH,
              debit: 0,
              credit: split.amount,
              isPartnership: isPartnershipTx,
              partnershipId,
              referenceType: "PAYMENT",
              referenceId: payment.id,
              date: input.date,
              description: `Payment for ${existing.invoiceNo} (${split.method})${refDesc}`,
              createdById: session.user.id,
            },
          });
        }

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
        await tx.ledgerEntry.deleteMany({ where: { referenceType: "PAYMENT", referenceId: payment.id } });
        await tx.paymentSplit.deleteMany({ where: { paymentId: payment.id } });
      }
      await tx.payment.deleteMany({ where: { saleInvoiceId: id } });

      // 2. Remove all ledger entries tied to this invoice
      await tx.ledgerEntry.deleteMany({ where: { referenceType: "SALE_INVOICE", referenceId: id } });

      // 3. Reverse SALE_OUT stock movements (restores inventory)
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

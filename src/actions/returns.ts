"use server";

import { parseInput, runAction } from "@/actions/_helpers";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { userError } from "@/lib/errors";
import { canPerformAction } from "@/lib/auth/permissions";
import { withResourceQueue, generateDocumentNumber } from "@/lib/concurrency";
import { emitRealtimeEvent } from "@/lib/realtime";
import { saleReturnSchema, purchaseReturnSchema } from "@/schemas/return";
import { getStockOnHand } from "@/lib/stock";
import { AccountType, StockMovementType } from "@prisma/client";
import { getActiveFinancialYear, getNextAtomicSequence, updateInvoiceSettlementStatus } from "@/lib/financial-year";

export async function listReturnsAction() {
  return runAction("returns.list", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "returns", "view", (session.user as any).permissions)) {
      throw userError("You do not have permission to view returns.");
    }
    const [saleReturns, purchaseReturns] = await Promise.all([
      prisma.saleReturn.findMany({
        orderBy: { date: "desc" },
        include: {
          financialYear: { select: { id: true, label: true, isActive: true } },
          customer: { select: { id: true, name: true } },
          location: { select: { id: true, name: true } },
          saleInvoice: { select: { id: true, invoiceNo: true } },
          items: {
            include: {
              product: { select: { id: true, productNo: true, name: true, unit: true } },
            },
          },
        },
      }),
      prisma.purchaseReturn.findMany({
        orderBy: { date: "desc" },
        include: {
          financialYear: { select: { id: true, label: true, isActive: true } },
          supplier: { select: { id: true, name: true } },
          location: { select: { id: true, name: true } },
          purchaseInvoice: { select: { id: true, invoiceNo: true } },
          items: {
            include: {
              product: { select: { id: true, productNo: true, name: true, unit: true } },
            },
          },
        },
      }),
    ]);

    return {
      saleReturns: saleReturns.map((r) => ({
        ...r,
        totalAmount: Number(r.totalAmount),
        items: r.items.map((i) => ({
          ...i,
          quantity: Number(i.quantity),
          unitPrice: Number(i.unitPrice),
          lineTotal: Number(i.lineTotal),
        })),
      })),
      purchaseReturns: purchaseReturns.map((r) => ({
        ...r,
        totalAmount: Number(r.totalAmount),
        items: r.items.map((i) => ({
          ...i,
          quantity: Number(i.quantity),
          unitCost: Number(i.unitCost),
          lineTotal: Number(i.lineTotal),
        })),
      })),
    };
  });
}

export async function createSaleReturnAction(raw: unknown) {
  return runAction("returns.sale.create", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "returns", "create", (session.user as any).permissions)) {
      throw userError("You do not have permission to record returns.");
    }
    const input = parseInput(saleReturnSchema, raw);

    const stockKeys = input.items.map((item) => `stock:${item.productId}`);
    const lockKeys = [`invoice:sale:${input.saleInvoiceId}`, ...stockKeys, "doc:sale_return"];

    const res = await withResourceQueue(lockKeys, async (tx) => {
      const invoice = await tx.saleInvoice.findUnique({
        where: { id: input.saleInvoiceId },
        include: {
          items: true,
          returns: { include: { items: true } },
        },
      });

      if (!invoice) {
        throw userError("Sale invoice not found.");
      }

      // Validate quantities against original invoice
      for (const returnItem of input.items) {
        const origItem = invoice.items.find((i) => i.productId === returnItem.productId);
        if (!origItem) {
          throw userError(`Product does not exist on invoice ${invoice.invoiceNo}.`);
        }

        // Sum previously returned for this product
        const previouslyReturned = invoice.returns.reduce((sum, ret) => {
          const item = ret.items.find((i) => i.productId === returnItem.productId);
          return sum + (item ? Number(item.quantity) : 0);
        }, 0);

        const maxReturnable = Number(origItem.quantity) - previouslyReturned;
        if (returnItem.quantity > maxReturnable) {
          throw userError(
            `Return quantity (${returnItem.quantity}) exceeds maximum returnable quantity (${maxReturnable}) for this item.`,
          );
        }
      }

      const totalAmount = input.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
      const activeFy = await getActiveFinancialYear(tx);
      const { sequenceNo, formattedNumber: returnNo } = await getNextAtomicSequence(
        tx,
        activeFy.id,
        "SALE_RETURN"
      );

      const saleReturn = await tx.saleReturn.create({
        data: {
          returnNo,
          financialYearId: activeFy.id,
          sequenceNo,
          saleInvoiceId: invoice.id,
          customerId: invoice.customerId,
          locationId: invoice.locationId,
          date: input.date,
          reason: input.reason,
          totalAmount,
          createdById: session.user.id,
          items: {
            create: input.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              lineTotal: item.quantity * item.unitPrice,
            })),
          },
        },
      });

      // Stock movements: SALE_RETURN (Inbound stock return)
      for (const item of input.items) {
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            locationId: invoice.locationId,
            type: StockMovementType.SALE_RETURN,
            quantity: item.quantity,
            referenceType: "SALE_RETURN",
            referenceId: saleReturn.id,
            createdById: session.user.id,
            notes: `Return against ${invoice.invoiceNo}: ${input.reason}`,
          },
        });
      }

      // Reversing Ledger Entries
      // Credit customer receivable
      await tx.ledgerEntry.create({
        data: {
          partyId: invoice.customerId,
          accountType: AccountType.RECEIVABLE,
          debit: 0,
          credit: totalAmount,
          isPartnership: invoice.isPartnership,
          partnershipId: invoice.partnershipId,
          referenceType: "SALE_RETURN",
          referenceId: saleReturn.id,
          date: input.date,
          description: `Credit Note / Sale Return ${saleReturn.returnNo}`,
          createdById: session.user.id,
        },
      });

      // Debit sales revenue
      await tx.ledgerEntry.create({
        data: {
          partyId: null,
          accountType: AccountType.SALES,
          debit: totalAmount,
          credit: 0,
          isPartnership: invoice.isPartnership,
          partnershipId: invoice.partnershipId,
          referenceType: "SALE_RETURN",
          referenceId: saleReturn.id,
          date: input.date,
          description: `Sale Return adjustment for ${invoice.invoiceNo}`,
          createdById: session.user.id,
        },
      });

      // Recalculate and update settlement status of original invoice
      await updateInvoiceSettlementStatus(tx, invoice.id, "SALE");

      return { id: saleReturn.id, returnNo: saleReturn.returnNo, totalAmount };
    });

    emitRealtimeEvent(["returns", "sales", "inventory", "parties", "ledger", "dashboard"], "create", "SaleReturn", {
      id: res.id,
      returnNo: res.returnNo,
      totalAmount: res.totalAmount,
    });

    return res;
  });
}

export async function createPurchaseReturnAction(raw: unknown) {
  return runAction("returns.purchase.create", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "returns", "create", (session.user as any).permissions)) {
      throw userError("You do not have permission to record returns.");
    }
    const input = parseInput(purchaseReturnSchema, raw);

    const stockKeys = input.items.map((item) => `stock:${item.productId}`);
    const lockKeys = [`invoice:purchase:${input.purchaseInvoiceId}`, ...stockKeys, "doc:purchase_return"];

    const res = await withResourceQueue(lockKeys, async (tx) => {
      const invoice = await tx.purchaseInvoice.findUnique({
        where: { id: input.purchaseInvoiceId },
        include: {
          location: { select: { id: true, name: true } },
          items: true,
          returns: { include: { items: true } },
        },
      });

      if (!invoice) {
        throw userError("Purchase invoice not found.");
      }

      // Validate quantities against original invoice and available stock on hand
      for (const returnItem of input.items) {
        const origItem = invoice.items.find((i) => i.productId === returnItem.productId);
        if (!origItem) {
          throw userError(`Product does not exist on purchase invoice ${invoice.invoiceNo}.`);
        }

        const previouslyReturned = invoice.returns.reduce((sum, ret) => {
          const item = ret.items.find((i) => i.productId === returnItem.productId);
          return sum + (item ? Number(item.quantity) : 0);
        }, 0);

        const maxReturnable = Number(origItem.quantity) - previouslyReturned;
        if (returnItem.quantity > maxReturnable) {
          throw userError(
            `Return quantity (${returnItem.quantity}) exceeds maximum returnable quantity (${maxReturnable}) for this purchase item.`,
          );
        }

        const available = await getStockOnHand(returnItem.productId, invoice.locationId, tx);
        if (available < returnItem.quantity) {
          throw userError(
            `Insufficient stock on hand at ${invoice.location.name} to process purchase return. Available: ${available}, Requested: ${returnItem.quantity}.`,
          );
        }
      }

      const totalAmount = input.items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
      const activeFy = await getActiveFinancialYear(tx);
      const { sequenceNo, formattedNumber: returnNo } = await getNextAtomicSequence(
        tx,
        activeFy.id,
        "PURCHASE_RETURN"
      );

      const purchaseReturn = await tx.purchaseReturn.create({
        data: {
          returnNo,
          financialYearId: activeFy.id,
          sequenceNo,
          purchaseInvoiceId: invoice.id,
          supplierId: invoice.supplierId,
          locationId: invoice.locationId,
          date: input.date,
          reason: input.reason,
          totalAmount,
          createdById: session.user.id,
          items: {
            create: input.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              unitCost: item.unitCost,
              lineTotal: item.quantity * item.unitCost,
            })),
          },
        },
      });

      // Stock movements: PURCHASE_RETURN (Outbound stock returned to supplier)
      for (const item of input.items) {
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            locationId: invoice.locationId,
            type: StockMovementType.PURCHASE_RETURN,
            quantity: item.quantity,
            referenceType: "PURCHASE_RETURN",
            referenceId: purchaseReturn.id,
            createdById: session.user.id,
            notes: `Purchase Return to supplier: ${input.reason}`,
          },
        });
      }

      // Reversing Ledger Entries
      // Debit supplier payable (reduces debt to supplier)
      await tx.ledgerEntry.create({
        data: {
          partyId: invoice.supplierId,
          accountType: AccountType.PAYABLE,
          debit: totalAmount,
          credit: 0,
          isPartnership: invoice.isPartnership,
          partnershipId: invoice.partnershipId,
          referenceType: "PURCHASE_RETURN",
          referenceId: purchaseReturn.id,
          date: input.date,
          description: `Debit Note / Purchase Return ${purchaseReturn.returnNo}`,
          createdById: session.user.id,
        },
      });

      // Credit purchases expense (reverses expense)
      await tx.ledgerEntry.create({
        data: {
          partyId: null,
          accountType: AccountType.PURCHASES,
          debit: 0,
          credit: totalAmount,
          isPartnership: invoice.isPartnership,
          partnershipId: invoice.partnershipId,
          referenceType: "PURCHASE_RETURN",
          referenceId: purchaseReturn.id,
          date: input.date,
          description: `Purchase Return adjustment for ${invoice.invoiceNo}`,
          createdById: session.user.id,
        },
      });

      // Recalculate and update settlement status of original invoice
      await updateInvoiceSettlementStatus(tx, invoice.id, "PURCHASE");

      return { id: purchaseReturn.id, returnNo: purchaseReturn.returnNo, totalAmount };
    });

    emitRealtimeEvent(["returns", "purchases", "inventory", "parties", "ledger", "dashboard"], "create", "PurchaseReturn", {
      id: res.id,
      returnNo: res.returnNo,
      totalAmount: res.totalAmount,
    });

    return res;
  });
}

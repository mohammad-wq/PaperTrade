"use server";

import { parseInput, runAction } from "@/actions/_helpers";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { userError } from "@/lib/errors";
import { canPerformAction } from "@/lib/auth/permissions";
import { withResourceQueue, generateDocumentNumber } from "@/lib/concurrency";
import { emitRealtimeEvent } from "@/lib/realtime";
import { saleReturnSchema, purchaseReturnSchema } from "@/schemas/return";
import { assertStockDeductionsAvailable } from "@/lib/stock";
import { AccountType, LedgerAccountSubtype, StockMovementType } from "@prisma/client";
import {
  postInflow,
  postOutflow,
  resolvePurchaseOwnership,
  ownershipTypeFromKey,
} from "@/lib/inventoryCost.service";
import { postJournal, JournalLineInput } from "@/lib/ledger";
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

      const returnItemsWithCost = input.items.map((item) => {
        const orig = invoice.items.find((i) => i.productId === item.productId);
        const origQty = orig ? Number(orig.quantity) : item.quantity;
        const origCogs = orig ? Number(orig.cogsAmount ?? 0) : 0;
        const unitCogs = origQty > 0 ? origCogs / origQty : 0;
        const costRestoredAmount = unitCogs * item.quantity;
        return { ...item, costRestoredAmount, unitCogs };
      });

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
            create: returnItemsWithCost.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              lineTotal: item.quantity * item.unitPrice,
              costRestoredAmount: item.costRestoredAmount,
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

      const totalCogsRestored = returnItemsWithCost.reduce((s, i) => s + i.costRestoredAmount, 0);

      for (const item of returnItemsWithCost) {
        if (item.costRestoredAmount <= 0 || item.unitCogs <= 0) continue;
        const orig = invoice.items.find((i) => i.productId === item.productId);
        const ownership = orig?.ownershipKey
          ? ownershipTypeFromKey(orig.ownershipKey)
          : orig?.lotId
            ? { ownershipType: "LOT", partnershipLotId: orig.lotId }
            : await resolvePurchaseOwnership(tx, { warehouseLotId: orig?.warehouseLotId });
        await postInflow(tx, {
          productId: item.productId,
          locationId: invoice.locationId,
          ownership,
          quantity: item.quantity,
          unitCost: item.unitCogs,
          movementType: "RETURN_IN",
          referenceType: "SALE_RETURN",
          referenceId: `${saleReturn.id}:${item.productId}`,
        });
      }

      const journalLines: JournalLineInput[] = [
        {
          partyId: invoice.customerId,
          accountType: AccountType.RECEIVABLE,
          debit: 0,
          credit: totalAmount,
          description: `Credit Note / Sale Return ${saleReturn.returnNo}`,
        },
        {
          accountType: AccountType.SALES,
          accountSubtype: LedgerAccountSubtype.PRODUCT_SALES,
          debit: totalAmount,
          credit: 0,
          description: `Sale Return adjustment for ${invoice.invoiceNo}`,
        },
      ];
      if (totalCogsRestored > 0) {
        journalLines.push(
          {
            accountType: AccountType.INVENTORY,
            debit: totalCogsRestored,
            credit: 0,
            description: `Inventory restored on return ${saleReturn.returnNo}`,
          },
          {
            accountType: AccountType.COGS,
            debit: 0,
            credit: totalCogsRestored,
            description: `COGS reversal on return ${saleReturn.returnNo}`,
          },
        );
      }

      await postJournal(
        {
          referenceType: "SALE_RETURN",
          referenceId: saleReturn.id,
          date: input.date,
          createdById: session.user.id,
          lines: journalLines,
        },
        tx,
      );

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

      // Validate quantities against original invoice and exact lot balances.
      const sourceItems = input.items.map((returnItem) => {
        const originalItem = invoice.items.find((item) => item.productId === returnItem.productId);
        if (!originalItem) {
          throw userError(`Product does not exist on purchase invoice ${invoice.invoiceNo}.`);
        }
        return {
          returnItem,
          originalItem,
          locationId: originalItem.locationId || invoice.locationId,
        };
      });

      await assertStockDeductionsAvailable(
        sourceItems.map(({ returnItem, originalItem, locationId }) => ({
          productId: returnItem.productId,
          locationId,
          warehouseLotId: originalItem.warehouseLotId,
          quantity: returnItem.quantity,
        })),
        tx,
      );

      for (const returnItem of input.items) {
        const origItem = invoice.items.find((i) => i.productId === returnItem.productId);
        if (!origItem) throw userError(`Product does not exist on purchase invoice ${invoice.invoiceNo}.`);

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
      for (const { returnItem: item, originalItem, locationId } of sourceItems) {
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            locationId,
            warehouseLotId: originalItem.warehouseLotId,
            type: StockMovementType.PURCHASE_RETURN,
            quantity: item.quantity,
            referenceType: "PURCHASE_RETURN",
            referenceId: purchaseReturn.id,
            createdById: session.user.id,
            notes: `Purchase Return to supplier: ${input.reason}`,
          },
        });
      }

      let inventoryCredit = 0;
      for (const { returnItem: item, originalItem, locationId } of sourceItems) {
        const ownership = await resolvePurchaseOwnership(tx, {
          warehouseLotId: originalItem.warehouseLotId,
        });
        const { totalCost } = await postOutflow(tx, {
          productId: item.productId,
          locationId,
          ownership,
          quantity: item.quantity,
          movementType: "RETURN_OUT",
          referenceType: "PURCHASE_RETURN",
          referenceId: `${purchaseReturn.id}:${item.productId}`,
        });
        inventoryCredit += totalCost;
      }

      await postJournal(
        {
          referenceType: "PURCHASE_RETURN",
          referenceId: purchaseReturn.id,
          date: input.date,
          createdById: session.user.id,
          lines: [
            {
              partyId: invoice.supplierId,
              accountType: AccountType.PAYABLE,
              debit: totalAmount,
              credit: 0,
              description: `Debit Note / Purchase Return ${purchaseReturn.returnNo}`,
            },
            {
              accountType: AccountType.INVENTORY,
              debit: 0,
              credit: inventoryCredit > 0 ? inventoryCredit : totalAmount,
              description: `Inventory reduction on purchase return ${purchaseReturn.returnNo}`,
            },
          ],
        },
        tx,
      );

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

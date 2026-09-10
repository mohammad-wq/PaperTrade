"use server";

import { parseInput, runAction } from "@/actions/_helpers";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { userError } from "@/lib/errors";
import { canPerformAction } from "@/lib/auth/permissions";
import { saleReturnSchema, purchaseReturnSchema } from "@/schemas/return";
import { AccountType, StockMovementType } from "@prisma/client";

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

    const invoice = await prisma.saleInvoice.findUnique({
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
    const returnNo = `SRET-${Date.now().toString().slice(-6)}`;

    const result = await prisma.$transaction(async (tx) => {
      const saleReturn = await tx.saleReturn.create({
        data: {
          returnNo,
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
          referenceType: "SALE_RETURN",
          referenceId: saleReturn.id,
          date: input.date,
          description: `Sale Return adjustment for ${invoice.invoiceNo}`,
          createdById: session.user.id,
        },
      });

      return saleReturn;
    });

    return { id: result.id, returnNo: result.returnNo, totalAmount };
  });
}

export async function createPurchaseReturnAction(raw: unknown) {
  return runAction("returns.purchase.create", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "returns", "create", (session.user as any).permissions)) {
      throw userError("You do not have permission to record returns.");
    }
    const input = parseInput(purchaseReturnSchema, raw);

    const invoice = await prisma.purchaseInvoice.findUnique({
      where: { id: input.purchaseInvoiceId },
      include: {
        items: true,
        returns: { include: { items: true } },
      },
    });

    if (!invoice) {
      throw userError("Purchase invoice not found.");
    }

    // Validate quantities against original invoice
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
    }

    const totalAmount = input.items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
    const returnNo = `PRET-${Date.now().toString().slice(-6)}`;

    const result = await prisma.$transaction(async (tx) => {
      const purchaseReturn = await tx.purchaseReturn.create({
        data: {
          returnNo,
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
          referenceType: "PURCHASE_RETURN",
          referenceId: purchaseReturn.id,
          date: input.date,
          description: `Purchase Return adjustment for ${invoice.invoiceNo}`,
          createdById: session.user.id,
        },
      });

      return purchaseReturn;
    });

    return { id: result.id, returnNo: result.returnNo, totalAmount };
  });
}

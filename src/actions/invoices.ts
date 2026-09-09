"use server";

import { parseInput, runAction } from "@/actions/_helpers";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { userError } from "@/lib/errors";
import { getStockOnHand } from "@/lib/stock";
import { getPartyBalance } from "@/lib/ledger";
import { saleInvoiceSchema } from "@/schemas/sale-invoice";
import { purchaseInvoiceSchema } from "@/schemas/purchase-invoice";
import { AccountType, InvoiceStatus, PartyType, PaymentMethod, PurchaseOrderStatus, StockMovementType } from "@prisma/client";

export async function listSaleInvoicesAction() {
  return runAction("sales.list", async () => {
    await requireSession();
    const invoices = await prisma.saleInvoice.findMany({
      orderBy: { date: "desc" },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        location: { select: { id: true, name: true } },
        deliveryOrder: { select: { id: true, doNo: true } },
        items: {
          include: {
            product: { select: { id: true, productNo: true, name: true, unit: true } },
          },
        },
      },
    });

    return invoices.map((inv) => ({
      ...inv,
      totalAmount: Number(inv.totalAmount),
      amountPaid: Number(inv.amountPaid),
      balanceDue: Number(inv.totalAmount) - Number(inv.amountPaid),
      items: inv.items.map((item) => ({
        ...item,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        lineTotal: Number(item.lineTotal),
      })),
    }));
  });
}

export async function createSaleInvoiceAction(raw: unknown) {
  return runAction("sales.create", async () => {
    const session = await requireSession();
    const input = parseInput(saleInvoiceSchema, raw);

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

      if (isGeneric) {
        let walkInParty = await prisma.party.findFirst({
          where: { name: "Walk-in Customer", type: PartyType.CUSTOMER },
        });
        if (!walkInParty) {
          walkInParty = await prisma.party.create({
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
        // Named Walk-in / New Customer (e.g. "Bilal Printers")
        let existingParty = await prisma.party.findFirst({
          where: {
            name: { equals: finalName, mode: "insensitive" },
            type: PartyType.CUSTOMER,
          },
        });

        if (existingParty) {
          targetCustomerId = existingParty.id;
          customerName = existingParty.name;
          customerCreditLimit = existingParty.creditLimit ? Number(existingParty.creditLimit) : null;
          customerBalance = await getPartyBalance(existingParty.id);
        } else {
          const newParty = await prisma.party.create({
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
      // Long-term registered party
      if (!input.customerId) {
        throw userError("Please select a registered customer.");
      }
      const customer = await prisma.party.findUnique({
        where: { id: input.customerId },
        select: { id: true, name: true, creditLimit: true, email: true },
      });
      if (!customer) {
        throw userError("Customer not found.");
      }
      targetCustomerId = customer.id;
      customerName = customer.name;
      customerCreditLimit = customer.creditLimit !== null ? Number(customer.creditLimit) : null;
      customerBalance = await getPartyBalance(customer.id);
    }

    // Calculate total amount
    const totalAmount = input.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

    // Check customer balance and credit limit warning
    let creditWarning: string | null = null;
    if (customerCreditLimit !== null) {
      const projectedBalance = customerBalance + totalAmount;
      if (projectedBalance > customerCreditLimit) {
        creditWarning = `Warning: This invoice exceeds the customer's credit limit of PKR ${customerCreditLimit.toLocaleString()} (projected balance: PKR ${projectedBalance.toLocaleString()}).`;
      }
    }

    // 2. Verify stock availability for each product at location
    for (const item of input.items) {
      const available = await getStockOnHand(item.productId, input.locationId);
      if (available < item.quantity) {
        const product = await prisma.product.findUnique({
          where: { id: item.productId },
          select: { name: true, productNo: true, unit: true },
        });
        throw userError(
          `Insufficient stock for "${product?.productNo} - ${product?.name}". Available: ${available} ${product?.unit || "Packets"}, Requested: ${item.quantity}.`,
        );
      }
    }

    // Resolve payment amount (for walk-in or immediate cash settlement)
    const rawPaid = typeof input.amountPaid === "number" ? input.amountPaid : 0;
    const paidAmount = input.paidImmediately
      ? Math.min(totalAmount, rawPaid > 0 ? rawPaid : totalAmount)
      : Math.min(totalAmount, Math.max(0, rawPaid));

    // 3. Multi-table transaction
    const invoiceNumber = `INV-${Date.now().toString().slice(-6)}`;
    const walkInContactDetails =
      input.customerType === "WALK_IN" && (input.walkInPhone || input.walkInAddress)
        ? `Walk-in: ${[input.walkInName || "Walk-in Customer", input.walkInPhone, input.walkInAddress].filter(Boolean).join(" | ")}`
        : null;
    const finalNotes = [input.notes?.trim(), walkInContactDetails].filter(Boolean).join(" — ");

    const result = await prisma.$transaction(async (tx) => {
      const invoice = await tx.saleInvoice.create({
        data: {
          invoiceNo: invoiceNumber,
          customerId: targetCustomerId,
          locationId: input.locationId,
          deliveryOrderId: input.deliveryOrderId || null,
          date: input.date,
          status: InvoiceStatus.POSTED,
          totalAmount,
          amountPaid: paidAmount,
          notes: finalNotes || null,
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

      // Create stock movements (SALE_OUT)
      for (const item of input.items) {
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            locationId: input.locationId,
            type: StockMovementType.SALE_OUT,
            quantity: item.quantity,
            referenceType: "SALE_INVOICE",
            referenceId: invoice.id,
            createdById: session.user.id,
            notes: `Sale Invoice ${invoice.invoiceNo} (${customerName})`,
          },
        });
      }

      // Create ledger entries
      // Customer Receivable (Debit)
      await tx.ledgerEntry.create({
        data: {
          partyId: targetCustomerId,
          accountType: AccountType.RECEIVABLE,
          debit: totalAmount,
          credit: 0,
          referenceType: "SALE_INVOICE",
          referenceId: invoice.id,
          date: input.date,
          description: `Sale Invoice ${invoice.invoiceNo} (${customerName})`,
          createdById: session.user.id,
        },
      });

      // Sales Revenue (Credit)
      await tx.ledgerEntry.create({
        data: {
          partyId: null,
          accountType: AccountType.SALES,
          debit: 0,
          credit: totalAmount,
          referenceType: "SALE_INVOICE",
          referenceId: invoice.id,
          date: input.date,
          description: `Sale Revenue from ${invoice.invoiceNo}`,
          createdById: session.user.id,
        },
      });

      // If immediate or on-the-spot payment was made
      if (paidAmount > 0) {
        const payment = await tx.payment.create({
          data: {
            partyId: targetCustomerId,
            saleInvoiceId: invoice.id,
            amount: paidAmount,
            method: input.paymentMethod || PaymentMethod.CASH,
            date: input.date,
            notes: `Settlement for invoice ${invoice.invoiceNo} (${input.customerType === "WALK_IN" ? "Walk-in Sale" : "Registered Customer"})`,
            createdById: session.user.id,
          },
        });

        // Cash/Bank inflow (Debit)
        await tx.ledgerEntry.create({
          data: {
            partyId: null,
            accountType: AccountType.CASH,
            debit: paidAmount,
            credit: 0,
            referenceType: "PAYMENT",
            referenceId: payment.id,
            date: input.date,
            description: `Payment received for ${invoice.invoiceNo} (${input.paymentMethod || PaymentMethod.CASH})`,
            createdById: session.user.id,
          },
        });

        // Customer Receivable reduction (Credit)
        await tx.ledgerEntry.create({
          data: {
            partyId: targetCustomerId,
            accountType: AccountType.RECEIVABLE,
            debit: 0,
            credit: paidAmount,
            referenceType: "PAYMENT",
            referenceId: payment.id,
            date: input.date,
            description: `Payment cleared for ${invoice.invoiceNo}`,
            createdById: session.user.id,
          },
        });
      }

      return invoice;
    });

    return {
      invoiceId: result.id,
      invoiceNo: result.invoiceNo,
      totalAmount,
      amountPaid: paidAmount,
      balanceDue: totalAmount - paidAmount,
      creditWarning,
    };
  });
}

export async function listPurchaseInvoicesAction() {
  return runAction("purchases.list", async () => {
    await requireSession();
    const invoices = await prisma.purchaseInvoice.findMany({
      orderBy: { date: "desc" },
      include: {
        supplier: { select: { id: true, name: true, phone: true } },
        location: { select: { id: true, name: true } },
        purchaseOrder: { select: { id: true, orderNo: true } },
        items: {
          include: {
            product: { select: { id: true, productNo: true, name: true, unit: true } },
          },
        },
      },
    });

    return invoices.map((inv) => ({
      ...inv,
      totalAmount: Number(inv.totalAmount),
      items: inv.items.map((item) => ({
        ...item,
        quantity: Number(item.quantity),
        unitCost: Number(item.unitCost),
        lineTotal: Number(item.lineTotal),
      })),
    }));
  });
}

export async function createPurchaseInvoiceAction(raw: unknown) {
  return runAction("purchases.create", async () => {
    const session = await requireSession();
    const input = parseInput(purchaseInvoiceSchema, raw);

    const totalAmount = input.items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
    const invoiceNumber = `PINV-${Date.now().toString().slice(-6)}`;

    const result = await prisma.$transaction(async (tx) => {
      const invoice = await tx.purchaseInvoice.create({
        data: {
          invoiceNo: invoiceNumber,
          supplierId: input.supplierId,
          locationId: input.locationId,
          purchaseOrderId: input.purchaseOrderId || null,
          date: input.date,
          status: InvoiceStatus.POSTED,
          totalAmount,
          notes: input.notes || null,
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

      // Update PO status if linked
      if (input.purchaseOrderId) {
        await tx.purchaseOrder.update({
          where: { id: input.purchaseOrderId },
          data: { status: PurchaseOrderStatus.FULFILLED },
        });
      }

      // Create stock movements (PURCHASE_IN)
      for (const item of input.items) {
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            locationId: input.locationId,
            type: StockMovementType.PURCHASE_IN,
            quantity: item.quantity,
            referenceType: "PURCHASE_INVOICE",
            referenceId: invoice.id,
            createdById: session.user.id,
            notes: `Purchase Invoice ${invoice.invoiceNo}`,
          },
        });
      }

      // Create ledger entries
      // Purchases Expense (Debit)
      await tx.ledgerEntry.create({
        data: {
          partyId: null,
          accountType: AccountType.PURCHASES,
          debit: totalAmount,
          credit: 0,
          referenceType: "PURCHASE_INVOICE",
          referenceId: invoice.id,
          date: input.date,
          description: `Purchase Invoice ${invoice.invoiceNo}`,
          createdById: session.user.id,
        },
      });

      // Supplier Payable (Credit)
      await tx.ledgerEntry.create({
        data: {
          partyId: input.supplierId,
          accountType: AccountType.PAYABLE,
          debit: 0,
          credit: totalAmount,
          referenceType: "PURCHASE_INVOICE",
          referenceId: invoice.id,
          date: input.date,
          description: `Payable for ${invoice.invoiceNo}`,
          createdById: session.user.id,
        },
      });

      return invoice;
    });

    return {
      invoiceId: result.id,
      invoiceNo: result.invoiceNo,
      totalAmount,
    };
  });
}

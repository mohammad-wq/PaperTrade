"use server";

import { parseInput, runAction } from "@/actions/_helpers";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { userError } from "@/lib/errors";
import { getStockOnHand } from "@/lib/stock";
import { getPartyBalance } from "@/lib/ledger";
import { withResourceQueue, generateDocumentNumber } from "@/lib/concurrency";
import { emitRealtimeEvent } from "@/lib/realtime";
import { saleInvoiceSchema } from "@/schemas/sale-invoice";
import { purchaseInvoiceSchema } from "@/schemas/purchase-invoice";
import { AccountType, InvoiceStatus, PartyType, PaymentMethod, PurchaseOrderStatus, StockMovementType } from "@prisma/client";
import { canPerformAction } from "@/lib/auth/permissions";
import { getActiveFinancialYear, getNextAtomicSequence, updateInvoiceSettlementStatus } from "@/lib/financial-year";

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
    if (!canPerformAction(session.user.role, "sales", "create", (session.user as any).permissions)) {
      throw userError("You do not have permission to create sales invoices.");
    }
    const input = parseInput(saleInvoiceSchema, raw);

    const stockKeys = input.items.map((i) => `stock:${i.productId}:${input.locationId}`);
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
          // Named Walk-in / New Customer (e.g. "Bilal Printers")
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

      // 2. Verify stock availability for each product at location inside locked transaction
      for (const item of input.items) {
        const available = await getStockOnHand(item.productId, input.locationId, tx);
        if (available < item.quantity) {
          const product = await tx.product.findUnique({
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

      // 3. Multi-table transaction with atomic financial year sequence
      const activeYear = await getActiveFinancialYear(tx);
      const { sequenceNo, formattedNumber } = await getNextAtomicSequence(tx, activeYear.id, "SALE_INVOICE");

      const walkInContactDetails =
        input.customerType === "WALK_IN" && (input.walkInPhone || input.walkInAddress)
          ? `Walk-in: ${[input.walkInName || "Walk-in Customer", input.walkInPhone, input.walkInAddress].filter(Boolean).join(" | ")}`
          : null;
      const finalNotes = [input.notes?.trim(), walkInContactDetails].filter(Boolean).join(" — ");

      const isSettled = paidAmount >= totalAmount;

      const invoice = await tx.saleInvoice.create({
        data: {
          invoiceNo: formattedNumber,
          financialYearId: activeYear.id,
          sequenceNo,
          customerId: targetCustomerId,
          locationId: input.locationId,
          deliveryOrderId: input.deliveryOrderId || null,
          date: input.date,
          status: isSettled ? InvoiceStatus.SETTLED : InvoiceStatus.OPEN,
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

      // Create stock movements (SALE_OUT) at dispatch location only if not already deducted
      if (!alreadyDeductedByDO) {
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

      return {
        invoiceId: invoice.id,
        invoiceNo: invoice.invoiceNo,
        totalAmount,
        amountPaid: paidAmount,
        balanceDue: totalAmount - paidAmount,
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
    if (!canPerformAction(session.user.role, "purchases", "create", (session.user as any).permissions)) {
      throw userError("You do not have permission to create purchase invoices.");
    }
    const input = parseInput(purchaseInvoiceSchema, raw);

    const stockKeys = input.items.map((i) => `stock:${i.productId}:${input.locationId}`);
    const partyKey = `party:${input.supplierId}`;
    const docKey = "doc:purchase_invoice";
    const poKey = input.purchaseOrderId ? `order:po:${input.purchaseOrderId}` : null;
    const lockKeys = [...stockKeys, partyKey, docKey, ...(poKey ? [poKey] : [])];

    const res = await withResourceQueue(lockKeys, async (tx) => {
      const totalAmount = input.items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
      
      const activeYear = await getActiveFinancialYear(tx);
      const { sequenceNo, formattedNumber } = await getNextAtomicSequence(tx, activeYear.id, "PURCHASE_INVOICE");

      const invoice = await tx.purchaseInvoice.create({
        data: {
          invoiceNo: formattedNumber,
          financialYearId: activeYear.id,
          sequenceNo,
          supplierId: input.supplierId,
          locationId: input.locationId,
          purchaseOrderId: input.purchaseOrderId || null,
          date: input.date,
          status: InvoiceStatus.OPEN,
          totalAmount,
          notes: input.notes || null,
          createdById: session.user.id,
          items: {
            create: input.items.map((item) => ({
              productId: item.productId,
              warehouseLotId: item.warehouseLotId || input.warehouseLotId || null,
              quantity: item.quantity,
              unitCost: item.unitCost,
              lineTotal: item.quantity * item.unitCost,
            })),
          },
        },
      });

      // Update PO status if linked and check if stock was already fulfilled
      let alreadyFulfilledByPO = false;
      if (input.purchaseOrderId) {
        const linkedPO = await tx.purchaseOrder.findUnique({
          where: { id: input.purchaseOrderId },
          select: { status: true },
        });
        if (linkedPO?.status === PurchaseOrderStatus.FULFILLED) {
          alreadyFulfilledByPO = true;
        } else {
          await tx.purchaseOrder.update({
            where: { id: input.purchaseOrderId },
            data: { status: PurchaseOrderStatus.FULFILLED },
          });
        }
      }

      // Create stock movements (PURCHASE_IN) at receiving location only if not already fulfilled
      if (!alreadyFulfilledByPO) {
        for (const item of input.items) {
          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              locationId: input.locationId,
              warehouseLotId: item.warehouseLotId || input.warehouseLotId || null,
              type: StockMovementType.PURCHASE_IN,
              quantity: item.quantity,
              referenceType: "PURCHASE_INVOICE",
              referenceId: invoice.id,
              createdById: session.user.id,
              notes: `Purchase Invoice ${invoice.invoiceNo}`,
            },
          });
        }
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

      return {
        invoiceId: invoice.id,
        invoiceNo: invoice.invoiceNo,
        totalAmount,
      };
    });

    emitRealtimeEvent(["purchases", "inventory", "parties", "ledger", "dashboard"], "create", "PurchaseInvoice", {
      invoiceId: res.invoiceId,
      invoiceNo: res.invoiceNo,
    });

    return res;
  });
}

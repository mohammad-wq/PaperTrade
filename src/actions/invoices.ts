"use server";

import { parseInput, runAction } from "@/actions/_helpers";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { userError } from "@/lib/errors";
import { getStockOnHand } from "@/lib/stock";
import { getPartyBalance } from "@/lib/ledger";
import { withResourceQueue, generateDocumentNumber } from "@/lib/concurrency";
import { emitRealtimeEvent } from "@/lib/realtime";
import { saleInvoiceSchema, updateSaleInvoiceSchema } from "@/schemas/sale-invoice";
import { purchaseInvoiceSchema, updatePurchaseInvoiceSchema } from "@/schemas/purchase-invoice";
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
            location: { select: { id: true, name: true, type: true } },
            warehouseLot: { select: { id: true, lotNumber: true } },
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

      // 2. Verify stock availability for each product at its specified location
      for (const item of input.items) {
        const itemLocId = item.locationId || fallbackLocationId;
        const available = await getStockOnHand(item.productId, itemLocId, tx);
        if (available < item.quantity) {
          const product = await tx.product.findUnique({
            where: { id: item.productId },
            select: { name: true, productNo: true, unit: true },
          });
          const loc = await tx.location.findUnique({
            where: { id: itemLocId },
            select: { name: true },
          });
          throw userError(
            `Insufficient stock for "${product?.productNo} - ${product?.name}" at ${loc?.name || "location"}. Available: ${available} ${product?.unit || "Packets"}, Requested: ${item.quantity}.`,
          );
        }
      }

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
          totalAmount,
          amountPaid: paidAmount,
          freightCharges: freight,
          walkInName: input.walkInName?.trim() || null,
          notes: finalNotes || null,
          createdById: session.user.id,
          items: {
            create: input.items.map((item) => ({
              productId: item.productId,
              locationId: item.locationId || fallbackLocationId,
              warehouseLotId: item.warehouseLotId || null,
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

      // Create stock movements (SALE_OUT) at each item's specific location only if not already deducted
      if (!alreadyDeductedByDO) {
        for (const item of input.items) {
          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              locationId: item.locationId || fallbackLocationId,
              warehouseLotId: item.warehouseLotId || null,
              type: StockMovementType.SALE_OUT,
              quantity: item.quantity,
              referenceType: "SALE_INVOICE",
              referenceId: invoice.id,
              createdById: session.user.id,
              notes: `Estimate ${invoice.invoiceNo} (${customerName})`,
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
          description: `Estimate ${invoice.invoiceNo} (${customerName})`,
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
          description: `Sales Revenue from ${invoice.invoiceNo}`,
          createdById: session.user.id,
        },
      });

      // If immediate or on-the-spot payment was made
      if (paidAmount > 0) {
        const { sequenceNo: paymentSeq, formattedNumber: paymentFormatted } = await getNextAtomicSequence(
          tx,
          activeYear.id,
          "PAYMENT_RECEIPT"
        );
        const receiptNo = `RCT-${paymentFormatted}`;

        const payment = await tx.payment.create({
          data: {
            receiptNo,
            financialYearId: activeYear.id,
            sequenceNo: paymentSeq,
            partyId: targetCustomerId,
            saleInvoiceId: invoice.id,
            amount: paidAmount,
            method: input.paymentMethod || PaymentMethod.CASH,
            direction: "IN",
            date: input.date,
            notes: `Settlement for Estimate ${invoice.invoiceNo} (${input.customerType === "WALK_IN" ? "Walk-in Sale" : "Registered Customer"})`,
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

      if (existing.status !== InvoiceStatus.OPEN) {
        throw userError(`Only OPEN invoices can be edited. This invoice is currently ${existing.status}.`);
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

      // 3. Verify stock availability for each item at its specified location (now that old stock movements are cleared)
      for (const item of input.items) {
        const itemLocId = item.locationId || fallbackLocationId;
        const available = await getStockOnHand(item.productId, itemLocId, tx);
        if (available < item.quantity) {
          const product = await tx.product.findUnique({
            where: { id: item.productId },
            select: { name: true, productNo: true, unit: true },
          });
          const loc = await tx.location.findUnique({
            where: { id: itemLocId },
            select: { name: true },
          });
          throw userError(
            `Insufficient stock for "${product?.productNo} - ${product?.name}" at ${loc?.name || "location"}. Available: ${available} ${product?.unit || "Packets"}, Requested: ${item.quantity}.`,
          );
        }
      }

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

      // Update invoice record
      const updatedInvoice = await tx.saleInvoice.update({
        where: { id: existing.id },
        data: {
          customerId: targetCustomerId,
          locationId: fallbackLocationId,
          date: input.date,
          status: isSettled ? InvoiceStatus.SETTLED : InvoiceStatus.OPEN,
          totalAmount,
          amountPaid: paidAmount,
          freightCharges: freight,
          walkInName: input.walkInName?.trim() || null,
          notes: finalNotes || null,
        },
      });

      // Re-create items
      await tx.saleInvoiceItem.deleteMany({
        where: { invoiceId: existing.id },
      });
      await tx.saleInvoiceItem.createMany({
        data: input.items.map((item) => ({
          invoiceId: existing.id,
          productId: item.productId,
          locationId: item.locationId || fallbackLocationId,
          warehouseLotId: item.warehouseLotId || null,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
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
        for (const item of input.items) {
          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              locationId: item.locationId || fallbackLocationId,
              warehouseLotId: item.warehouseLotId || null,
              type: StockMovementType.SALE_OUT,
              quantity: item.quantity,
              referenceType: "SALE_INVOICE",
              referenceId: existing.id,
              createdById: session.user.id,
              notes: `Estimate ${existing.invoiceNo} (${customerName}) [Edited]`,
            },
          });
        }
      }

      // Re-create ledger entries
      // Customer Receivable (Debit)
      await tx.ledgerEntry.create({
        data: {
          partyId: targetCustomerId,
          accountType: AccountType.RECEIVABLE,
          debit: totalAmount,
          credit: 0,
          referenceType: "SALE_INVOICE",
          referenceId: existing.id,
          date: input.date,
          description: `Estimate ${existing.invoiceNo} (${customerName})`,
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
          referenceId: existing.id,
          date: input.date,
          description: `Sales Revenue from ${existing.invoiceNo}`,
          createdById: session.user.id,
        },
      });

      // If immediate payment
      if (paidAmount > 0) {
        const activeYear = existing.financialYearId ? { id: existing.financialYearId } : await getActiveFinancialYear(tx);
        const { sequenceNo: paymentSeq, formattedNumber: paymentFormatted } = await getNextAtomicSequence(
          tx,
          activeYear.id,
          "PAYMENT_RECEIPT"
        );
        const receiptNo = `RCT-${paymentFormatted}`;

        const payment = await tx.payment.create({
          data: {
            receiptNo,
            financialYearId: activeYear.id,
            sequenceNo: paymentSeq,
            partyId: targetCustomerId,
            saleInvoiceId: existing.id,
            amount: paidAmount,
            method: input.paymentMethod || PaymentMethod.CASH,
            direction: "IN",
            date: input.date,
            notes: `Settlement for Estimate ${existing.invoiceNo} (${input.customerType === "WALK_IN" ? "Walk-in Sale" : "Registered Customer"})`,
            createdById: session.user.id,
          },
        });

        await tx.ledgerEntry.create({
          data: {
            partyId: null,
            accountType: AccountType.CASH,
            debit: paidAmount,
            credit: 0,
            referenceType: "PAYMENT",
            referenceId: payment.id,
            date: input.date,
            description: `Payment received for ${existing.invoiceNo} (${input.paymentMethod || PaymentMethod.CASH})`,
            createdById: session.user.id,
          },
        });

        await tx.ledgerEntry.create({
          data: {
            partyId: targetCustomerId,
            accountType: AccountType.RECEIVABLE,
            debit: 0,
            credit: paidAmount,
            referenceType: "PAYMENT",
            referenceId: payment.id,
            date: input.date,
            description: `Payment cleared for ${existing.invoiceNo}`,
            createdById: session.user.id,
          },
        });
      }

      return {
        invoiceId: existing.id,
        invoiceNo: existing.invoiceNo,
        totalAmount,
        amountPaid: paidAmount,
        balanceDue: totalAmount - paidAmount,
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

    return invoices.map((inv) => ({
      ...inv,
      totalAmount: Number(inv.totalAmount),
      amountPaid: Number(inv.amountPaid || 0),
      balanceDue: Math.max(0, Number(inv.totalAmount) - Number(inv.amountPaid || 0)),
      freightCharges: Number(inv.freightCharges || 0),
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
      
      const activeYear = await getActiveFinancialYear(tx);
      const { sequenceNo, formattedNumber } = await getNextAtomicSequence(tx, activeYear.id, "PURCHASE_INVOICE");

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
          totalAmount,
          amountPaid: paidAmount,
          freightCharges: freight,
          notes: input.notes || null,
          createdById: session.user.id,
          items: {
            create: input.items.map((item) => ({
              productId: item.productId,
              locationId: (item as any).locationId || fallbackLocationId,
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
          const itemLoc = (item as any).locationId || fallbackLocationId;
          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              locationId: itemLoc,
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
          partyId: targetSupplierId!,
          accountType: AccountType.PAYABLE,
          debit: 0,
          credit: totalAmount,
          referenceType: "PURCHASE_INVOICE",
          referenceId: invoice.id,
          date: input.date,
          description: `Payable for ${invoice.invoiceNo} (${supplierName})`,
          createdById: session.user.id,
        },
      });

      // If immediate payment was made
      if (paidAmount > 0) {
        const { sequenceNo: paymentSeq, formattedNumber: paymentFormatted } = await getNextAtomicSequence(
          tx,
          activeYear.id,
          "PAYMENT_RECEIPT"
        );
        const receiptNo = `PAY-${paymentFormatted}`;

        const payment = await tx.payment.create({
          data: {
            receiptNo,
            financialYearId: activeYear.id,
            sequenceNo: paymentSeq,
            partyId: targetSupplierId!,
            purchaseInvoiceId: invoice.id,
            amount: paidAmount,
            method: PaymentMethod.CASH,
            direction: "OUT",
            date: input.date,
            notes: `Payment for Purchase Invoice ${invoice.invoiceNo} (${supplierName})`,
            createdById: session.user.id,
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

        // Cash outflow (Credit)
        await tx.ledgerEntry.create({
          data: {
            partyId: null,
            accountType: AccountType.CASH,
            debit: 0,
            credit: paidAmount,
            referenceType: "PAYMENT",
            referenceId: payment.id,
            date: input.date,
            description: `Cash payment for ${invoice.invoiceNo}`,
            createdById: session.user.id,
          },
        });
      }

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

      if (existing.status !== InvoiceStatus.OPEN) {
        throw userError(`Only OPEN purchase invoices can be edited. This invoice is currently ${existing.status}.`);
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

      // 4. Update purchase invoice
      const updatedInvoice = await tx.purchaseInvoice.update({
        where: { id: existing.id },
        data: {
          supplierId: targetSupplierId!,
          locationId: fallbackLocationId,
          date: input.date,
          status: isSettled ? InvoiceStatus.SETTLED : InvoiceStatus.OPEN,
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

      // 7. Recreate ledger entries
      // Purchases Expense (Debit)
      await tx.ledgerEntry.create({
        data: {
          partyId: null,
          accountType: AccountType.PURCHASES,
          debit: totalAmount,
          credit: 0,
          referenceType: "PURCHASE_INVOICE",
          referenceId: existing.id,
          date: input.date,
          description: `Purchase Invoice ${existing.invoiceNo}`,
          createdById: session.user.id,
        },
      });

      // Supplier Payable (Credit)
      await tx.ledgerEntry.create({
        data: {
          partyId: targetSupplierId!,
          accountType: AccountType.PAYABLE,
          debit: 0,
          credit: totalAmount,
          referenceType: "PURCHASE_INVOICE",
          referenceId: existing.id,
          date: input.date,
          description: `Purchase Invoice ${existing.invoiceNo}`,
          createdById: session.user.id,
        },
      });

      // 8. Auto Payment if paidAmount > 0
      if (paidAmount > 0) {
        const activeYear = existing.financialYearId ? { id: existing.financialYearId } : await getActiveFinancialYear(tx);
        const { sequenceNo: paymentSeq, formattedNumber: paymentFormatted } = await getNextAtomicSequence(
          tx,
          activeYear.id,
          "PAYMENT_RECEIPT"
        );
        const receiptNo = `PAY-${paymentFormatted}`;

        const payment = await tx.payment.create({
          data: {
            receiptNo,
            financialYearId: activeYear.id,
            sequenceNo: paymentSeq,
            partyId: targetSupplierId!,
            purchaseInvoiceId: existing.id,
            amount: paidAmount,
            method: PaymentMethod.CASH,
            direction: "OUT",
            date: input.date,
            notes: `Payment for Purchase Invoice ${existing.invoiceNo} (${supplierName}) [Edited]`,
            createdById: session.user.id,
          },
        });

        await tx.ledgerEntry.create({
          data: {
            partyId: targetSupplierId!,
            accountType: AccountType.PAYABLE,
            debit: paidAmount,
            credit: 0,
            referenceType: "PAYMENT",
            referenceId: payment.id,
            date: input.date,
            description: `Payment for ${existing.invoiceNo}`,
            createdById: session.user.id,
          },
        });

        await tx.ledgerEntry.create({
          data: {
            partyId: null,
            accountType: AccountType.CASH,
            debit: 0,
            credit: paidAmount,
            referenceType: "PAYMENT",
            referenceId: payment.id,
            date: input.date,
            description: `Cash payment for ${existing.invoiceNo}`,
            createdById: session.user.id,
          },
        });
      }

      // 9. Update settlement status
      await updateInvoiceSettlementStatus(tx, existing.id, "PURCHASE");

      return {
        invoiceId: existing.id,
        invoiceNo: existing.invoiceNo,
        totalAmount,
      };
    });

    emitRealtimeEvent(["purchases", "inventory", "parties", "ledger", "dashboard"], "update", "PurchaseInvoice", {
      invoiceId: res.invoiceId,
      invoiceNo: res.invoiceNo,
    });

    return res;
  });
}

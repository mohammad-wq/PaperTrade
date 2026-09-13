"use server";

import { runAction } from "@/actions/_helpers";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { startOfDay, endOfDay } from "date-fns";
import { StockMovementType } from "@prisma/client";

export async function getDashboardMetricsAction() {
  return runAction("dashboard.metrics", async () => {
    await requireSession();
    const todayStart = startOfDay(new Date());
    const todayEnd = endOfDay(new Date());

    const [
      todaySales,
      todayPurchases,
      activeProducts,
      locations,
      parties,
      recentSales,
      recentPurchases,
      ledgerSums,
    ] = await Promise.all([
      prisma.saleInvoice.aggregate({
        where: { date: { gte: todayStart, lte: todayEnd } },
        _sum: { totalAmount: true },
        _count: true,
      }),
      prisma.purchaseInvoice.aggregate({
        where: { date: { gte: todayStart, lte: todayEnd } },
        _sum: { totalAmount: true },
        _count: true,
      }),
      prisma.product.findMany({
        where: { isActive: true, deletedAt: null, reorderLevel: { not: null, gt: 0 } },
        select: { id: true, productNo: true, name: true, unit: true, reorderLevel: true },
      }),
      prisma.location.findMany({ select: { id: true, name: true } }),
      prisma.party.findMany({
        where: { isActive: true, deletedAt: null },
        select: { id: true, name: true, type: true, creditLimit: true },
      }),
      prisma.saleInvoice.findMany({
        take: 5,
        orderBy: { date: "desc" },
        include: { customer: { select: { name: true } }, location: { select: { name: true } } },
      }),
      prisma.purchaseInvoice.findMany({
        take: 5,
        orderBy: { date: "desc" },
        include: { supplier: { select: { name: true } }, location: { select: { name: true } } },
      }),
      prisma.ledgerEntry.groupBy({
        by: ["accountType"],
        _sum: { debit: true, credit: true },
      }),
    ]);

    // Calculate low stock alerts
    // Batch query stock movements for all active products across locations (replaces N+1 query loop)
    const productIds = activeProducts.map((p) => p.id);
    const stockMovements = productIds.length > 0
      ? await prisma.stockMovement.groupBy({
          by: ["productId", "locationId", "type"],
          where: { productId: { in: productIds } },
          _sum: { quantity: true },
        })
      : [];

    const INBOUND_SET = new Set<StockMovementType>([
      StockMovementType.PURCHASE_IN,
      StockMovementType.TRANSFER_IN,
      StockMovementType.SALE_RETURN,
    ]);
    const OUTBOUND_SET = new Set<StockMovementType>([
      StockMovementType.SALE_OUT,
      StockMovementType.TRANSFER_OUT,
      StockMovementType.DELIVERY_OUT,
      StockMovementType.PURCHASE_RETURN,
    ]);

    const stockMap = new Map<string, number>();
    for (const row of stockMovements) {
      const key = `${row.productId}:${row.locationId}`;
      const qty = Number(row._sum.quantity ?? 0);
      let diff = 0;
      if (row.type === StockMovementType.ADJUSTMENT || INBOUND_SET.has(row.type)) {
        diff = qty;
      } else if (OUTBOUND_SET.has(row.type)) {
        diff = -qty;
      }
      stockMap.set(key, (stockMap.get(key) ?? 0) + diff);
    }

    // Calculate low stock alerts in-memory
    const lowStockAlerts: Array<{
      productId: string;
      productNo: string;
      name: string;
      locationName: string;
      available: number;
      reorderLevel: number;
      unit: string;
    }> = [];

    for (const product of activeProducts) {
      for (const loc of locations) {
        const available = stockMap.get(`${product.id}:${loc.id}`) ?? 0;
        const availableInPackets =
          product.unit === "REAM" ? available * 5 : product.unit === "SHEET" ? available / 100 : available;
        const reorder = Number(product.reorderLevel);
        if (availableInPackets <= reorder) {
          lowStockAlerts.push({
            productId: product.id,
            productNo: product.productNo,
            name: product.name,
            locationName: loc.name,
            available,
            reorderLevel: reorder,
            unit: product.unit,
          });
        }
      }
    }

    let totalReceivables = 0;
    let totalPayables = 0;

    for (const row of ledgerSums) {
      const debit = Number(row._sum.debit ?? 0);
      const credit = Number(row._sum.credit ?? 0);
      if (row.accountType === "RECEIVABLE") {
        totalReceivables = debit - credit;
      } else if (row.accountType === "PAYABLE") {
        totalPayables = credit - debit;
      }
    }

    return {
      todaySalesTotal: Number(todaySales._sum.totalAmount ?? 0),
      todaySalesCount: todaySales._count,
      todayPurchasesTotal: Number(todayPurchases._sum.totalAmount ?? 0),
      todayPurchasesCount: todayPurchases._count,
      totalReceivables: Math.max(0, totalReceivables),
      totalPayables: Math.max(0, totalPayables),
      lowStockCount: lowStockAlerts.length,
      lowStockAlerts: lowStockAlerts.slice(0, 8),
      recentSales: recentSales.map((s) => ({
        id: s.id,
        invoiceNo: s.invoiceNo,
        customerName: s.customer.name,
        locationName: s.location.name,
        date: s.date,
        totalAmount: Number(s.totalAmount),
        status: s.status,
      })),
      recentPurchases: recentPurchases.map((p) => ({
        id: p.id,
        invoiceNo: p.invoiceNo,
        supplierName: p.supplier.name,
        locationName: p.location.name,
        date: p.date,
        totalAmount: Number(p.totalAmount),
        status: p.status,
      })),
    };
  });
}

export async function getReceivablesPayablesBreakdownAction() {
  return runAction("dashboard.receivablesPayablesBreakdown", async () => {
    await requireSession();

    // 1. Fetch all non-deleted parties
    const parties = await prisma.party.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        type: true,
        phone: true,
        email: true,
        address: true,
        creditLimit: true,
        isActive: true,
      },
      orderBy: { name: "asc" },
    });

    // 2. Batch query ledger entries grouped by partyId
    const ledgerByParty = await prisma.ledgerEntry.groupBy({
      by: ["partyId"],
      _sum: { debit: true, credit: true },
      where: { partyId: { not: null } },
    });

    const partyBalanceMap = new Map<string, number>();
    for (const row of ledgerByParty) {
      if (!row.partyId) continue;
      const debit = Number(row._sum.debit ?? 0);
      const credit = Number(row._sum.credit ?? 0);
      // In ledger convention: debit - credit > 0 means party owes us (Receivable)
      // debit - credit < 0 means we owe party (Payable)
      partyBalanceMap.set(row.partyId, debit - credit);
    }

    const receivables: Array<{
      id: string;
      name: string;
      type: string;
      phone: string | null;
      email: string | null;
      address: string | null;
      creditLimit: number | null;
      balance: number;
      isOverCreditLimit: boolean;
      creditLimitUsagePercent: number | null;
      isActive: boolean;
    }> = [];

    const payables: Array<{
      id: string;
      name: string;
      type: string;
      phone: string | null;
      email: string | null;
      address: string | null;
      creditLimit: number | null;
      balanceDue: number;
      rawBalance: number;
      isActive: boolean;
    }> = [];

    let totalReceivables = 0;
    let totalPayables = 0;
    let totalOverCreditLimitCount = 0;

    for (const party of parties) {
      const balance = partyBalanceMap.get(party.id) ?? 0;
      const creditLimit = party.creditLimit ? Number(party.creditLimit) : null;

      // Positive balance: party owes client (Customer Receivable)
      if (balance > 0.001) {
        totalReceivables += balance;
        const isOver = creditLimit !== null && creditLimit > 0 && balance > creditLimit;
        if (isOver) totalOverCreditLimitCount++;

        const creditLimitUsagePercent =
          creditLimit !== null && creditLimit > 0
            ? Math.round((balance / creditLimit) * 100)
            : null;

        receivables.push({
          id: party.id,
          name: party.name,
          type: party.type,
          phone: party.phone,
          email: party.email,
          address: party.address,
          creditLimit,
          balance,
          isOverCreditLimit: isOver,
          creditLimitUsagePercent,
          isActive: party.isActive,
        });
      } else if (balance < -0.001) {
        // Negative balance: client owes party (Supplier Payable)
        const balanceDue = Math.abs(balance);
        totalPayables += balanceDue;

        payables.push({
          id: party.id,
          name: party.name,
          type: party.type,
          phone: party.phone,
          email: party.email,
          address: party.address,
          creditLimit,
          balanceDue,
          rawBalance: balance,
          isActive: party.isActive,
        });
      }
    }

    // Sort descending by highest amount
    receivables.sort((a, b) => b.balance - a.balance);
    payables.sort((a, b) => b.balanceDue - a.balanceDue);

    return {
      totalReceivables,
      totalPayables,
      receivablesCount: receivables.length,
      payablesCount: payables.length,
      totalOverCreditLimitCount,
      receivables,
      payables,
    };
  });
}


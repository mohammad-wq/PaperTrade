"use server";

import { runAction } from "@/actions/_helpers";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getStockOnHand } from "@/lib/stock";
import { startOfDay, endOfDay } from "date-fns";
import { PartyType } from "@prisma/client";

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
        where: { isActive: true, reorderLevel: { not: null, gt: 0 } },
        select: { id: true, productNo: true, name: true, unit: true, reorderLevel: true },
      }),
      prisma.location.findMany({ select: { id: true, name: true } }),
      prisma.party.findMany({
        where: { isActive: true },
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
    ]);

    // Calculate low stock alerts
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
        const available = await getStockOnHand(product.id, loc.id);
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

    // Calculate receivables and payables from LedgerEntry
    const ledgerSums = await prisma.ledgerEntry.groupBy({
      by: ["accountType"],
      _sum: { debit: true, credit: true },
    });

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

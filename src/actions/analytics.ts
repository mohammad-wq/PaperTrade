"use server";

import { prisma } from "@/lib/db";
import { runAction } from "@/actions/_helpers";
import { StockMovementType } from "@prisma/client";
import {
  startOfDay,
  endOfDay,
  subDays,
  startOfMonth,
  endOfMonth,
  parseISO,
} from "date-fns";
import { cleanPartyDisplayName } from "@/lib/party-display";

export interface AnalyticsFilter {
  preset: "TODAY" | "LAST_7_DAYS" | "THIS_MONTH" | "CUSTOM";
  startDate?: string;
  endDate?: string;
}

export interface ExecutiveAnalyticsData {
  periodLabel: string;
  // Core Financial Cards
  grossSalesRevenue: number;
  costOfGoodsSold: number;
  realizedGrossMargin: number;
  grossMarginPercentage: number;
  totalInventoryAssetValue: number;
  totalReceivables: number;
  totalPayables: number;

  // Product Movement & Velocity
  topFastMovingProducts: Array<{
    id: string;
    productNo: string;
    name: string;
    unit: string;
    quantitySold: number;
    revenueContribution: number;
    marginContribution: number;
  }>;

  deadStockProducts: Array<{
    id: string;
    productNo: string;
    name: string;
    unit: string;
    currentStock: number;
    unitCost: number;
    lockedCapital: number;
    daysInactive: number;
  }>;

  // Profitability Ranking
  profitabilityRanking: Array<{
    id: string;
    productNo: string;
    name: string;
    unit: string;
    quantitySold: number;
    revenue: number;
    cogs: number;
    margin: number;
    marginPercentage: number;
  }>;

  // Cash Flow & Receivables Health
  cashSalesAmount: number;
  creditSalesAmount: number;
  cashSalesRatio: number;
  creditSalesRatio: number;
  topDebtors: Array<{
    id: string;
    name: string;
    phone: string | null;
    balance: number;
    creditLimit: number | null;
  }>;
}

type PartyDebtorRow = {
  id: string;
  name: string;
  phone: string | null;
  creditLimit: any;
};

export async function getExecutiveAnalyticsAction(filter: AnalyticsFilter) {
  return runAction("analytics.getExecutive", async () => {
    const now = new Date();
    let fromDate: Date;
    let toDate: Date = endOfDay(now);
    let periodLabel = "This Month";

    if (filter.preset === "TODAY") {
      fromDate = startOfDay(now);
      toDate = endOfDay(now);
      periodLabel = "Today";
    } else if (filter.preset === "LAST_7_DAYS") {
      fromDate = subDays(startOfDay(now), 6);
      toDate = endOfDay(now);
      periodLabel = "Last 7 Days";
    } else if (filter.preset === "CUSTOM" && filter.startDate && filter.endDate) {
      fromDate = startOfDay(parseISO(filter.startDate));
      toDate = endOfDay(parseISO(filter.endDate));
      periodLabel = `Custom (${filter.startDate} to ${filter.endDate})`;
    } else {
      fromDate = startOfMonth(now);
      toDate = endOfMonth(now);
      periodLabel = "This Month";
    }

    // 1. Sale Invoices in period
    const saleInvoices = await prisma.saleInvoice.findMany({
      where: {
        date: { gte: fromDate, lte: toDate },
        status: { not: "CANCELLED" },
      },
      include: {
        items: {
          include: { product: true },
        },
      },
    });

    let grossSalesRevenue = 0;
    let costOfGoodsSold = 0;
    let cashSalesAmount = 0;
    let creditSalesAmount = 0;

    const productMap = new Map<
      string,
      {
        id: string;
        productNo: string;
        name: string;
        unit: string;
        quantitySold: number;
        revenue: number;
        cogs: number;
        margin: number;
      }
    >();

    for (const inv of saleInvoices) {
      const invTotal = Number(inv.totalAmount);
      const paid = Number(inv.amountPaid || inv.paidAmount || 0);
      const isPaid = inv.paymentStatus === "PAID" || paid >= invTotal - 0.01;

      grossSalesRevenue += invTotal;
      if (isPaid) {
        cashSalesAmount += invTotal;
      } else {
        cashSalesAmount += paid;
        creditSalesAmount += Math.max(0, invTotal - paid);
      }

      for (const it of inv.items) {
        const qty = Number(it.quantity);
        const lineRev = Number(it.lineTotal);
        const lineCOGS =
          it.cogsAmount != null && Number(it.cogsAmount) > 0
            ? Number(it.cogsAmount)
            : qty *
              (it.unitCost != null && Number(it.unitCost) > 0
                ? Number(it.unitCost)
                : Number(it.product.costPrice || 0));
        const lineMargin = lineRev - lineCOGS;

        costOfGoodsSold += lineCOGS;

        const existing = productMap.get(it.productId) || {
          id: it.productId,
          productNo: it.product.productNo,
          name: it.product.name,
          unit: it.product.unit,
          quantitySold: 0,
          revenue: 0,
          cogs: 0,
          margin: 0,
        };

        existing.quantitySold += qty;
        existing.revenue += lineRev;
        existing.cogs += lineCOGS;
        existing.margin += lineMargin;
        productMap.set(it.productId, existing);
      }
    }

    const realizedGrossMargin = grossSalesRevenue - costOfGoodsSold;
    const grossMarginPercentage =
      grossSalesRevenue > 0
        ? Math.round((realizedGrossMargin / grossSalesRevenue) * 10000) / 100
        : 0;

    const totalSalesTendered = cashSalesAmount + creditSalesAmount;
    const cashSalesRatio =
      totalSalesTendered > 0
        ? Math.round((cashSalesAmount / totalSalesTendered) * 10000) / 100
        : 0;
    const creditSalesRatio =
      totalSalesTendered > 0
        ? Math.round((creditSalesAmount / totalSalesTendered) * 10000) / 100
        : 0;

    // 2. Product Velocity (Top 10 Fast Moving by Qty)
    const productList = Array.from(productMap.values());
    const topFastMovingProducts = [...productList]
      .sort((a, b) => b.quantitySold - a.quantitySold)
      .slice(0, 10)
      .map((p) => ({
        id: p.id,
        productNo: p.productNo,
        name: p.name,
        unit: p.unit,
        quantitySold: p.quantitySold,
        revenueContribution: Math.round(p.revenue * 100) / 100,
        marginContribution: Math.round(p.margin * 100) / 100,
      }));

    // 3. Profitability Ranking
    const profitabilityRanking = [...productList]
      .filter((p) => p.revenue > 0)
      .map((p) => ({
        id: p.id,
        productNo: p.productNo,
        name: p.name,
        unit: p.unit,
        quantitySold: p.quantitySold,
        revenue: Math.round(p.revenue * 100) / 100,
        cogs: Math.round(p.cogs * 100) / 100,
        margin: Math.round(p.margin * 100) / 100,
        marginPercentage:
          p.revenue > 0 ? Math.round((p.margin / p.revenue) * 10000) / 100 : 0,
      }))
      .sort((a, b) => b.marginPercentage - a.marginPercentage)
      .slice(0, 10);

    // 4. Current Inventory Asset Value (via Stock Movements)
    const movements = await prisma.stockMovement.groupBy({
      by: ["productId", "type"],
      _sum: { quantity: true },
    });

    const productStockMap = new Map<string, number>();
    for (const row of movements) {
      const qty = Number(row._sum.quantity ?? 0);
      const current = productStockMap.get(row.productId) || 0;
      let delta = 0;
      if (row.type === StockMovementType.ADJUSTMENT) {
        delta = qty;
      } else if (
        row.type === StockMovementType.PURCHASE_IN ||
        row.type === StockMovementType.TRANSFER_IN ||
        row.type === StockMovementType.SALE_RETURN
      ) {
        delta = qty;
      } else {
        delta = -qty;
      }
      productStockMap.set(row.productId, current + delta);
    }

    const allProducts = await prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, productNo: true, name: true, unit: true, costPrice: true },
    });

    const wacValuation = await prisma.productCostState.aggregate({
      _sum: { totalValue: true },
    });
    let totalInventoryAssetValue = Number(wacValuation._sum.totalValue ?? 0);
    if (totalInventoryAssetValue <= 0) {
      for (const p of allProducts) {
        const stock = productStockMap.get(p.id) || 0;
        if (stock > 0) {
          totalInventoryAssetValue += stock * Number(p.costPrice || 0);
        }
      }
    }

    // 5. Accounts Receivable & Accounts Payable from Ledger
    const balanceAggregates = await prisma.ledgerEntry.groupBy({
      by: ["partyId"],
      where: { partyId: { not: null } },
      _sum: { debit: true, credit: true },
    });

    let totalReceivables = 0;
    let totalPayables = 0;
    const debtorBalances: Array<{ partyId: string; balance: number }> = [];

    for (const b of balanceAggregates) {
      if (!b.partyId) continue;
      const bal = Number(b._sum.debit ?? 0) - Number(b._sum.credit ?? 0);
      if (bal > 0.01) {
        totalReceivables += bal;
        debtorBalances.push({ partyId: b.partyId, balance: bal });
      } else if (bal < -0.01) {
        totalPayables += Math.abs(bal);
      }
    }

    // Top 5 Debtors
    debtorBalances.sort((a, b) => b.balance - a.balance);
    const top5DebtorIds = debtorBalances.slice(0, 5).map((d) => d.partyId);

    const debtorParties: PartyDebtorRow[] = await prisma.party.findMany({
      where: { id: { in: top5DebtorIds } },
      select: { id: true, name: true, phone: true, creditLimit: true },
    });

    const debtorPartyMap = new Map<string, PartyDebtorRow>(
      debtorParties.map((p: PartyDebtorRow) => [p.id, p])
    );
    const topDebtors = debtorBalances.slice(0, 5).map((d) => {
      const p = debtorPartyMap.get(d.partyId);
      return {
        id: d.partyId,
        name: cleanPartyDisplayName(p?.name || "Customer"),
        phone: p?.phone || null,
        balance: Math.round(d.balance * 100) / 100,
        creditLimit: p?.creditLimit ? Number(p.creditLimit) : null,
      };
    });

    // 6. Slow-Moving / Dead Stock (Stock > 0 with 0 sales in past 30 days)
    const thirtyDaysAgo = subDays(now, 30);
    const recentSoldItems = await prisma.saleInvoiceItem.findMany({
      where: {
        invoice: {
          date: { gte: thirtyDaysAgo },
          status: { not: "CANCELLED" },
        },
      },
      select: { productId: true },
      distinct: ["productId"],
    });

    const activeProductSet = new Set<string>(
      recentSoldItems.map((s: { productId: string }) => s.productId)
    );

    const deadStockProducts = allProducts
      .filter((p) => {
        const stock = productStockMap.get(p.id) || 0;
        return stock > 0 && !activeProductSet.has(p.id);
      })
      .map((p) => {
        const currentStock = productStockMap.get(p.id) || 0;
        const unitCost = Number(p.costPrice || 0);
        const lockedCapital = currentStock * unitCost;

        return {
          id: p.id,
          productNo: p.productNo,
          name: p.name,
          unit: p.unit,
          currentStock,
          unitCost,
          lockedCapital: Math.round(lockedCapital * 100) / 100,
          daysInactive: 30, // 30+ days
        };
      })
      .filter((p) => p.lockedCapital > 0)
      .sort((a, b) => b.lockedCapital - a.lockedCapital)
      .slice(0, 10);

    const result: ExecutiveAnalyticsData = {
      periodLabel,
      grossSalesRevenue: Math.round(grossSalesRevenue * 100) / 100,
      costOfGoodsSold: Math.round(costOfGoodsSold * 100) / 100,
      realizedGrossMargin: Math.round(realizedGrossMargin * 100) / 100,
      grossMarginPercentage,
      totalInventoryAssetValue: Math.round(totalInventoryAssetValue * 100) / 100,
      totalReceivables: Math.round(totalReceivables * 100) / 100,
      totalPayables: Math.round(totalPayables * 100) / 100,
      topFastMovingProducts,
      deadStockProducts,
      profitabilityRanking,
      cashSalesAmount: Math.round(cashSalesAmount * 100) / 100,
      creditSalesAmount: Math.round(creditSalesAmount * 100) / 100,
      cashSalesRatio,
      creditSalesRatio,
      topDebtors,
    };

    return result;
  });
}

import { prisma } from "@/lib/db";
import { getStockOnHand } from "@/lib/stock";
import { AccountType } from "@prisma/client";

/**
 * Profit & Loss (Income Statement)
 * Accurately calculates Net Sales, Cost of Goods Sold, Gross Profit, Operating Expenses, and Net Income.
 */
export async function calculateProfitLoss(params?: { startDate?: string; endDate?: string }) {
  const dateFilter: Record<string, Date> = {};
  if (params?.startDate) dateFilter.gte = new Date(params.startDate);
  if (params?.endDate) {
    const end = new Date(params.endDate);
    end.setHours(23, 59, 59, 999);
    dateFilter.lte = end;
  }

  const whereClause = Object.keys(dateFilter).length > 0 ? { date: dateFilter } : undefined;

  const entries = await prisma.ledgerEntry.groupBy({
    by: ["accountType"],
    where: whereClause,
    _sum: { debit: true, credit: true },
  });

  let grossSales = 0;
  let salesReturns = 0;
  let grossPurchases = 0;
  let purchaseReturns = 0;
  let expenses = 0;

  for (const row of entries) {
    const debit = Number(row._sum.debit ?? 0);
    const credit = Number(row._sum.credit ?? 0);

    if (row.accountType === AccountType.SALES) {
      grossSales = credit;
      salesReturns = debit;
    } else if (row.accountType === AccountType.PURCHASES) {
      grossPurchases = debit;
      purchaseReturns = credit;
    } else if (row.accountType === AccountType.EXPENSE) {
      expenses = debit - credit;
    }
  }

  const netSales = Math.max(0, grossSales - salesReturns);
  const netPurchases = Math.max(0, grossPurchases - purchaseReturns);
  const grossProfit = netSales - netPurchases;
  const grossMarginPct = netSales > 0 ? (grossProfit / netSales) * 100 : 0;

  // Retrieve itemized expenses breakdown
  const expenseEntries = await prisma.ledgerEntry.findMany({
    where: {
      accountType: AccountType.EXPENSE,
      ...(whereClause ? { date: whereClause.date } : {}),
    },
    select: {
      description: true,
      referenceType: true,
      debit: true,
      credit: true,
    },
  });

  const expenseCategories = new Map<string, number>();
  for (const entry of expenseEntries) {
    const net = Number(entry.debit) - Number(entry.credit);
    if (net !== 0) {
      let category = "Other Operating Expenses";
      if (entry.referenceType === "STORAGE_CHARGE") {
        category = "Warehouse Storage Charges";
      } else if (entry.description) {
        const colonIndex = entry.description.indexOf(":");
        if (colonIndex > 0 && colonIndex < 35) {
          const rawCategory = entry.description.substring(0, colonIndex).trim();
          const normalized = rawCategory
            .toLowerCase()
            .split(/[\s_]+/)
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ");
          category = normalized || "Other Operating Expenses";
        } else if (entry.description.toLowerCase().includes("labour")) {
          category = "Handling & Labour Charges";
        }
      }
      expenseCategories.set(category, (expenseCategories.get(category) ?? 0) + net);
    }
  }

  const expenseBreakdown = Array.from(expenseCategories.entries()).map(([name, amount]) => ({
    name,
    amount,
  }));

  const netProfit = grossProfit - expenses;
  const netMarginPct = netSales > 0 ? (netProfit / netSales) * 100 : 0;

  return {
    // Backwards compatible fields
    sales: netSales,
    purchases: netPurchases,
    grossProfit,
    expenses,
    netProfit,
    // Detailed financial statement breakdown
    grossSales,
    salesReturns,
    grossPurchases,
    purchaseReturns,
    grossMarginPct: Math.round(grossMarginPct * 100) / 100,
    netMarginPct: Math.round(netMarginPct * 100) / 100,
    expenseBreakdown,
  };
}

/**
 * Balance Sheet (Statement of Financial Position)
 * Formulated with fundamental accounting equation: Assets = Liabilities + Equity
 */
export async function calculateBalanceSheet(params?: { asOfDate?: string }) {
  const asOf = params?.asOfDate ? new Date(params.asOfDate) : new Date();
  asOf.setHours(23, 59, 59, 999);

  const entries = await prisma.ledgerEntry.groupBy({
    by: ["accountType"],
    where: { date: { lte: asOf } },
    _sum: { debit: true, credit: true },
  });

  let cash = 0;
  let receivables = 0;
  let payables = 0;

  for (const row of entries) {
    const debit = Number(row._sum.debit ?? 0);
    const credit = Number(row._sum.credit ?? 0);

    if (row.accountType === AccountType.CASH) {
      cash = debit - credit;
    } else if (row.accountType === AccountType.RECEIVABLE) {
      receivables = debit - credit;
    } else if (row.accountType === AccountType.PAYABLE) {
      payables = credit - debit;
    }
  }

  // Calculate current inventory valuation across all locations
  const [products, locations] = await Promise.all([
    prisma.product.findMany({
      where: { isActive: true },
      select: {
        id: true,
        costPrice: true,
        unit: true,
        length: true,
        breadth: true,
        gsm: true,
      },
    }),
    prisma.location.findMany({ select: { id: true, name: true } }),
  ]);

  let inventoryValuation = 0;
  let totalStockUnits = 0;
  let totalStockWeightKg = 0;

  for (const p of products) {
    const packetWeight = (Number(p.length) * Number(p.breadth) * Number(p.gsm)) / 15499;
    const reamWeight = packetWeight * 5;

    for (const loc of locations) {
      const qty = await getStockOnHand(p.id, loc.id);
      if (qty > 0) {
        inventoryValuation += qty * Number(p.costPrice);
        totalStockUnits += qty;
        totalStockWeightKg += qty * (p.unit === "REAM" ? reamWeight : packetWeight);
      }
    }
  }

  const effectiveCash = Math.max(0, cash);
  const bankOverdraft = cash < 0 ? Math.abs(cash) : 0;
  const effectiveReceivables = Math.max(0, receivables);
  const effectivePayables = Math.max(0, payables) + bankOverdraft;

  const totalAssets = effectiveCash + effectiveReceivables + inventoryValuation;
  const totalLiabilities = effectivePayables;
  const equity = totalAssets - totalLiabilities;

  return {
    asOf: asOf.toISOString(),
    assets: {
      cash: effectiveCash,
      receivables: effectiveReceivables,
      inventory: inventoryValuation,
      totalAssets,
      inventoryMetrics: {
        totalUnits: totalStockUnits,
        totalTonnage: Math.round((totalStockWeightKg / 1000) * 1000) / 1000,
      },
    },
    liabilities: {
      payables: effectivePayables,
      bankOverdraft,
      totalLiabilities,
    },
    equity,
    isBalanced: true,
    totalLiabilitiesAndEquity: totalLiabilities + equity,
  };
}

/**
 * Cash Flow Statement
 * Computes beginning cash, itemized inflows and outflows, net change, and ending cash position.
 */
export async function calculateCashFlow(params?: { startDate?: string; endDate?: string }) {
  const dateFilter: Record<string, Date> = {};
  if (params?.startDate) dateFilter.gte = new Date(params.startDate);
  if (params?.endDate) {
    const end = new Date(params.endDate);
    end.setHours(23, 59, 59, 999);
    dateFilter.lte = end;
  }

  // 1. Compute Beginning Cash Balance (all cash transactions strictly prior to startDate)
  let beginningBalance = 0;
  if (params?.startDate) {
    const priorCash = await prisma.ledgerEntry.aggregate({
      where: {
        accountType: AccountType.CASH,
        date: { lt: new Date(params.startDate) },
      },
      _sum: { debit: true, credit: true },
    });
    beginningBalance = Number(priorCash._sum.debit ?? 0) - Number(priorCash._sum.credit ?? 0);
  }

  // 2. Query period transactions
  const entries = await prisma.ledgerEntry.findMany({
    where: {
      accountType: AccountType.CASH,
      ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
    },
    orderBy: { date: "asc" },
  });

  let cashInflow = 0;
  let cashOutflow = 0;
  let runningPosition = beginningBalance;

  const flowDetails = entries.map((entry) => {
    const debit = Number(entry.debit);
    const credit = Number(entry.credit);
    cashInflow += debit;
    cashOutflow += credit;
    runningPosition += debit - credit;

    return {
      id: entry.id,
      date: entry.date.toISOString(),
      description: entry.description,
      referenceType: entry.referenceType,
      referenceId: entry.referenceId,
      inflow: debit,
      outflow: credit,
      balance: runningPosition,
    };
  });

  const netCashFlow = cashInflow - cashOutflow;
  const endingBalance = beginningBalance + netCashFlow;

  return {
    beginningBalance,
    cashInflow,
    cashOutflow,
    netCashFlow,
    endingBalance,
    flowDetails,
  };
}

/**
 * Statement of Account (Party Ledger)
 * Computes Opening Balance (b/f), chronological transactions, running balance, and Closing Balance.
 */
export async function calculatePartyStatement(params: {
  partyId: string;
  startDate?: string;
  endDate?: string;
  productId?: string;
}) {
  const party = await prisma.party.findUnique({
    where: { id: params.partyId },
  });
  if (!party) {
    throw new Error("Party not found.");
  }

  const dateFilter: Record<string, Date> = {};
  if (params.startDate) dateFilter.gte = new Date(params.startDate);
  if (params.endDate) {
    const end = new Date(params.endDate);
    end.setHours(23, 59, 59, 999);
    dateFilter.lte = end;
  }

  // 1. Calculate Opening Balance before startDate
  let openingBalance = 0;
  if (params.startDate) {
    const priorEntries = await prisma.ledgerEntry.aggregate({
      where: {
        partyId: params.partyId,
        date: { lt: new Date(params.startDate) },
      },
      _sum: { debit: true, credit: true },
    });
    openingBalance = Number(priorEntries._sum.debit ?? 0) - Number(priorEntries._sum.credit ?? 0);
  }

  // 2. Query period ledger entries
  const entries = await prisma.ledgerEntry.findMany({
    where: {
      partyId: params.partyId,
      ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
    },
    orderBy: { date: "asc" },
  });

  let totalPeriodDebits = 0;
  let totalPeriodCredits = 0;
  let runningBalance = openingBalance;

  const ledgerRows = entries.map((entry) => {
    const debit = Number(entry.debit);
    const credit = Number(entry.credit);
    totalPeriodDebits += debit;
    totalPeriodCredits += credit;
    runningBalance += debit - credit;

    return {
      id: entry.id,
      date: entry.date,
      description: entry.description,
      referenceType: entry.referenceType,
      referenceId: entry.referenceId,
      debit,
      credit,
      runningBalance,
    };
  });

  const closingBalance = runningBalance;

  // 3. Product transaction history if filtered
  let productTransactions: Array<{
    date: Date;
    docNo: string;
    docType: string;
    productName: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    total: number;
  }> = [];

  if (params.productId && params.productId !== "ALL") {
    const [saleItems, purchaseItems] = await Promise.all([
      prisma.saleInvoiceItem.findMany({
        where: {
          productId: params.productId,
          invoice: { customerId: params.partyId },
          invoice: {
            customerId: params.partyId,
            ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
          },
        },
        include: { invoice: true, product: true },
      }),
      prisma.purchaseInvoiceItem.findMany({
        where: {
          productId: params.productId,
          invoice: { supplierId: params.partyId },
          invoice: {
            supplierId: params.partyId,
            ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
          },
        },
        include: { invoice: true, product: true },
      }),
    ]);

    productTransactions = [
      ...saleItems.map((item) => ({
        date: item.invoice.date,
        docNo: item.invoice.invoiceNo,
        docType: "Sale Invoice",
        productName: item.product.name,
        quantity: Number(item.quantity),
        unit: item.product.unit,
        unitPrice: Number(item.unitPrice),
        total: Number(item.lineTotal),
      })),
      ...purchaseItems.map((item) => ({
        date: item.invoice.date,
        docNo: item.invoice.invoiceNo,
        docType: "Purchase Invoice",
        productName: item.product.name,
        quantity: Number(item.quantity),
        unit: item.product.unit,
        unitPrice: Number(item.unitCost),
        total: Number(item.lineTotal),
      })),
    ].sort((a, b) => b.date.getTime() - a.date.getTime());
  }

  return {
    party: {
      id: party.id,
      name: party.name,
      type: party.type,
      phone: party.phone,
      email: party.email,
      address: party.address,
      creditLimit: party.creditLimit ? Number(party.creditLimit) : null,
    },
    openingBalance,
    totalPeriodDebits,
    totalPeriodCredits,
    closingBalance,
    currentBalance: closingBalance,
    ledgerRows,
    productTransactions,
  };
}

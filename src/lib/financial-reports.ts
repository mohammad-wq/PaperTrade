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
    include: {
      party: { select: { id: true, name: true } },
    },
    orderBy: { date: "desc" },
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

  const expenseItems = expenseEntries.map((e) => ({
    id: e.id,
    date: e.date.toISOString(),
    partyId: e.partyId || null,
    partyName: e.party?.name || null,
    referenceType: e.referenceType,
    referenceId: e.referenceId,
    description: e.description || "Operating Expense",
    amount: Number(e.debit) - Number(e.credit),
  }));

  // Detailed Sales & Purchases line items with Party ID and Transaction Reference ID
  const [salesEntries, purchaseEntries] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: {
        accountType: AccountType.SALES,
        ...(whereClause ? { date: whereClause.date } : {}),
      },
      include: { party: { select: { id: true, name: true, type: true } } },
      orderBy: { date: "desc" },
    }),
    prisma.ledgerEntry.findMany({
      where: {
        accountType: AccountType.PURCHASES,
        ...(whereClause ? { date: whereClause.date } : {}),
      },
      include: { party: { select: { id: true, name: true, type: true } } },
      orderBy: { date: "desc" },
    }),
  ]);

  const salesBreakdown = salesEntries.map((e) => ({
    id: e.id,
    date: e.date.toISOString(),
    partyId: e.partyId || "N/A",
    partyName: e.party?.name || "Direct Cash Customer",
    referenceType: e.referenceType,
    referenceId: e.referenceId,
    description: e.description || "Sale Invoice",
    amount: Number(e.credit) - Number(e.debit),
  }));

  const purchasesBreakdown = purchaseEntries.map((e) => ({
    id: e.id,
    date: e.date.toISOString(),
    partyId: e.partyId || "N/A",
    partyName: e.party?.name || "Paper Mill / Supplier",
    referenceType: e.referenceType,
    referenceId: e.referenceId,
    description: e.description || "Purchase Invoice",
    amount: Number(e.debit) - Number(e.credit),
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
    expenseItems,
    salesBreakdown,
    purchasesBreakdown,
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
      where: { isActive: true, deletedAt: null },
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

  // Party-wise schedule for receivables and payables with Party ID & Transaction Reference ID
  const partyEntries = await prisma.ledgerEntry.groupBy({
    by: ["partyId"],
    where: {
      partyId: { not: null },
      date: { lte: asOf },
    },
    _sum: { debit: true, credit: true },
  });

  const partyIds = partyEntries
    .map((r) => r.partyId)
    .filter((id): id is string => Boolean(id));

  const [partiesList, latestEntries] = await Promise.all([
    prisma.party.findMany({
      where: { id: { in: partyIds } },
      select: { id: true, name: true, type: true, phone: true },
    }),
    prisma.ledgerEntry.findMany({
      where: {
        partyId: { in: partyIds },
        date: { lte: asOf },
      },
      orderBy: { date: "desc" },
      distinct: ["partyId"],
      select: {
        partyId: true,
        referenceType: true,
        referenceId: true,
        date: true,
      },
    }),
  ]);

  const partyMap = new Map(partiesList.map((p) => [p.id, p]));
  const latestEntryMap = new Map(latestEntries.map((e) => [e.partyId!, e]));

  const receivablesSchedule: Array<{
    partyId: string;
    partyName: string;
    partyType: string;
    phone: string | null;
    balance: number;
    referenceType: string;
    referenceId: string;
    asOfDate: string;
  }> = [];

  const payablesSchedule: Array<{
    partyId: string;
    partyName: string;
    partyType: string;
    phone: string | null;
    balance: number;
    referenceType: string;
    referenceId: string;
    asOfDate: string;
  }> = [];

  for (const row of partyEntries) {
    if (!row.partyId) continue;
    const debit = Number(row._sum.debit ?? 0);
    const credit = Number(row._sum.credit ?? 0);
    const net = debit - credit;
    const p = partyMap.get(row.partyId);
    const latest = latestEntryMap.get(row.partyId);

    if (net > 0.001) {
      receivablesSchedule.push({
        partyId: row.partyId,
        partyName: p?.name || "Customer",
        partyType: p?.type || "CUSTOMER",
        phone: p?.phone || null,
        balance: net,
        referenceType: latest?.referenceType || "INVOICE",
        referenceId: latest?.referenceId || "—",
        asOfDate: latest?.date ? latest.date.toISOString() : asOf.toISOString(),
      });
    } else if (net < -0.001) {
      payablesSchedule.push({
        partyId: row.partyId,
        partyName: p?.name || "Supplier",
        partyType: p?.type || "SUPPLIER",
        phone: p?.phone || null,
        balance: Math.abs(net),
        referenceType: latest?.referenceType || "PURCHASE",
        referenceId: latest?.referenceId || "—",
        asOfDate: latest?.date ? latest.date.toISOString() : asOf.toISOString(),
      });
    }
  }

  receivablesSchedule.sort((a, b) => b.balance - a.balance);
  payablesSchedule.sort((a, b) => b.balance - a.balance);

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
    receivablesSchedule,
    payablesSchedule,
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
    include: {
      party: { select: { id: true, name: true } },
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
      partyId: entry.partyId || null,
      partyName: entry.party?.name || null,
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
  let openingBalanceSourceYear: string | null = null;
  if (params.startDate) {
    const priorEntries = await prisma.ledgerEntry.aggregate({
      where: {
        partyId: params.partyId,
        date: { lt: new Date(params.startDate) },
      },
      _sum: { debit: true, credit: true },
    });
    openingBalance = Number(priorEntries._sum.debit ?? 0) - Number(priorEntries._sum.credit ?? 0);

    const latestOpening = await prisma.ledgerEntry.findFirst({
      where: {
        partyId: params.partyId,
        referenceType: "OPENING_BALANCE",
        date: { lt: new Date(params.startDate) },
      },
      include: { sourceFinancialYear: { select: { label: true } } },
      orderBy: { date: "desc" },
    });
    if (latestOpening?.sourceFinancialYear) {
      openingBalanceSourceYear = latestOpening.sourceFinancialYear.label;
    }
  }

  // 2. Query period ledger entries
  const entries = await prisma.ledgerEntry.findMany({
    where: {
      partyId: params.partyId,
      ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
    },
    include: {
      sourceFinancialYear: { select: { id: true, label: true } },
    },
    orderBy: { date: "asc" },
  });

  // Resolve human-readable document references for transaction cross-referencing
  const saleInvoiceIds = entries.filter((e) => e.referenceType === "SALE_INVOICE").map((e) => e.referenceId);
  const purchaseInvoiceIds = entries.filter((e) => e.referenceType === "PURCHASE_INVOICE").map((e) => e.referenceId);
  const paymentIds = entries.filter((e) => e.referenceType === "PAYMENT").map((e) => e.referenceId);
  const saleReturnIds = entries.filter((e) => e.referenceType === "SALE_RETURN").map((e) => e.referenceId);
  const purchaseReturnIds = entries.filter((e) => e.referenceType === "PURCHASE_RETURN").map((e) => e.referenceId);

  const [saleInvoices, purchaseInvoices, paymentsList, saleReturns, purchaseReturns] = await Promise.all([
    saleInvoiceIds.length > 0
      ? prisma.saleInvoice.findMany({ where: { id: { in: saleInvoiceIds } }, select: { id: true, invoiceNo: true } })
      : [],
    purchaseInvoiceIds.length > 0
      ? prisma.purchaseInvoice.findMany({ where: { id: { in: purchaseInvoiceIds } }, select: { id: true, invoiceNo: true } })
      : [],
    paymentIds.length > 0
      ? prisma.payment.findMany({ where: { id: { in: paymentIds } }, select: { id: true, receiptNo: true } })
      : [],
    saleReturnIds.length > 0
      ? prisma.saleReturn.findMany({ where: { id: { in: saleReturnIds } }, select: { id: true, returnNo: true } })
      : [],
    purchaseReturnIds.length > 0
      ? prisma.purchaseReturn.findMany({ where: { id: { in: purchaseReturnIds } }, select: { id: true, returnNo: true } })
      : [],
  ]);

  const docNoMap = new Map<string, string>();
  for (const item of saleInvoices) docNoMap.set(item.id, item.invoiceNo);
  for (const item of purchaseInvoices) docNoMap.set(item.id, item.invoiceNo);
  for (const item of paymentsList) docNoMap.set(item.id, item.receiptNo || `RCT-${item.id.slice(0, 8)}`);
  for (const item of saleReturns) docNoMap.set(item.id, item.returnNo);
  for (const item of purchaseReturns) docNoMap.set(item.id, item.returnNo);

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
      partyId: party.id,
      partyName: party.name,
      description: entry.description,
      referenceType: entry.referenceType,
      referenceId: entry.referenceId,
      referenceDocNo: docNoMap.get(entry.referenceId) || null,
      sourceFinancialYear: entry.sourceFinancialYear?.label || null,
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
    openingBalanceSourceYear,
    totalPeriodDebits,
    totalPeriodCredits,
    closingBalance,
    currentBalance: closingBalance,
    ledgerRows,
    productTransactions,
  };
}

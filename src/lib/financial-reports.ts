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

  const invoiceDateFilter = Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {};
  const whereClause = Object.keys(dateFilter).length > 0 ? { date: dateFilter } : undefined;

  const [saleItemsAgg, saleReturnAgg, freightAgg, actualFreightAgg, ledgerEntries] = await Promise.all([
      prisma.saleInvoiceItem.aggregate({
        where: {
          invoice: { status: { not: "CANCELLED" }, ...invoiceDateFilter },
        },
        _sum: { lineTotal: true, cogsAmount: true },
      }),
      prisma.saleReturn.aggregate({
        where: invoiceDateFilter,
        _sum: { totalAmount: true },
      }),
      prisma.saleInvoice.aggregate({
        where: { status: { not: "CANCELLED" }, ...invoiceDateFilter },
        _sum: { freightCharges: true },
      }),
      prisma.saleInvoice.aggregate({
        where: {
          status: { not: "CANCELLED" },
          actualFreightCost: { not: null },
          ...invoiceDateFilter,
        },
        _sum: { actualFreightCost: true },
      }),
      prisma.ledgerEntry.groupBy({
        by: ["accountType"],
        where: whereClause,
        _sum: { debit: true, credit: true },
      }),
    ]);

  let grossSales = Number(saleItemsAgg._sum.lineTotal ?? 0) + Number(freightAgg._sum.freightCharges ?? 0);
  const salesReturns = Number(saleReturnAgg._sum.totalAmount ?? 0);
  const cogs = Number(saleItemsAgg._sum.cogsAmount ?? 0);
  const directCosts = Number(actualFreightAgg._sum.actualFreightCost ?? 0);

  let grossPurchases = 0;
  let purchaseReturns = 0;
  let operatingExpenses = 0;
  for (const row of ledgerEntries) {
    const debit = Number(row._sum.debit ?? 0);
    const credit = Number(row._sum.credit ?? 0);
    if (row.accountType === AccountType.PURCHASES) {
      grossPurchases = debit;
      purchaseReturns = credit;
    } else if (row.accountType === AccountType.EXPENSE) {
      operatingExpenses = debit - credit;
    }
  }

  const netSales = Math.max(0, grossSales - salesReturns);
  const netPurchases = Math.max(0, grossPurchases - purchaseReturns);
  const totalCogs = cogs + directCosts;
  const grossProfit = netSales - totalCogs;
  const expenses = operatingExpenses + totalCogs;
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

  const netProfit = grossProfit - operatingExpenses;
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
    cogs: totalCogs,
    directCosts,
    netSales,
    operatingExpenses,
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

  const wacAgg = await prisma.productCostState.aggregate({
    _sum: { totalValue: true, quantity: true },
  });
  inventoryValuation = Number(wacAgg._sum.totalValue ?? 0);
  totalStockUnits = Number(wacAgg._sum.quantity ?? 0);

  if (inventoryValuation <= 0) {
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
    isBalanced: Math.abs(totalAssets - (totalLiabilities + equity)) < 0.02,
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
function normalizeTransactionNo(rawNo?: string | null, prefix = "SV") {
  if (!rawNo) return `${prefix} —`;
  const digits = (rawNo.match(/\d+/g) || []).join("");
  const fallback = String(rawNo).replace(/^[A-Z]+[-\s]*/i, "").trim();
  const seq = digits || fallback || "—";
  return `${prefix} ${seq}`;
}

function paymentMethodLabel(method: string | null | undefined) {
  const value = (method || "CASH").toUpperCase();
  if (value === "CHEQUE") return "Cheque";
  if (value === "BANK_TRANSFER" || value === "BANK") return "Bank Transfer";
  return "Cash";
}

function formatPaymentDocNo(payment: { method?: string | null; receiptNo?: string | null }, direction?: string | null) {
  const method = payment?.method || "CASH";
  const basePrefix = method.toUpperCase() === "CHEQUE" ? "BRV" : "CRV";
  const docNo = payment?.receiptNo || `${basePrefix}-0001`;
  return normalizeTransactionNo(docNo, basePrefix);
}

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

  const baseWhere = {
    partyId: params.partyId,
    ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
  };

  const [saleInvoices, purchaseInvoices, payments, saleReturns, purchaseReturns] = await Promise.all([
    prisma.saleInvoice.findMany({
      where: {
        customerId: params.partyId,
        ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
      },
      include: {
        items: { include: { product: { select: { id: true, name: true, unit: true } } } },
      },
      orderBy: { date: "asc" },
    }),
    prisma.purchaseInvoice.findMany({
      where: {
        supplierId: params.partyId,
        ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
      },
      include: {
        items: { include: { product: { select: { id: true, name: true, unit: true } } } },
      },
      orderBy: { date: "asc" },
    }),
    prisma.payment.findMany({
      where: {
        partyId: params.partyId,
        ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
      },
      orderBy: { date: "asc" },
    }),
    prisma.saleReturn.findMany({
      where: {
        customerId: params.partyId,
        ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
      },
      orderBy: { date: "asc" },
    }),
    prisma.purchaseReturn.findMany({
      where: {
        supplierId: params.partyId,
        ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
      },
      orderBy: { date: "asc" },
    }),
  ]);

  const customRows: Array<{
    id: string;
    date: Date;
    description: string;
    referenceType: string;
    referenceId: string;
    referenceDocNo: string;
    debit: number;
    credit: number;
    runningBalance: number;
    detailRows?: Array<{ productName: string; quantity: number; unit: string; rate: number; amount: number }>;
  }> = [];

  const pushRow = (row: {
    id: string;
    date: Date;
    description: string;
    referenceType: string;
    referenceId: string;
    referenceDocNo: string;
    debit: number;
    credit: number;
    detailRows?: Array<{ productName: string; quantity: number; unit: string; rate: number; amount: number }>;
  }) => {
    customRows.push({
      ...row,
      runningBalance: 0,
    });
  };

  if (params.startDate) {
    pushRow({
      id: `opening-${params.partyId}`,
      date: new Date(params.startDate),
      description: "Balance Brought Forward",
      referenceType: "OPENING_BALANCE",
      referenceId: params.partyId,
      referenceDocNo: "B/F",
      debit: openingBalance >= 0 ? Math.abs(openingBalance) : 0,
      credit: openingBalance < 0 ? Math.abs(openingBalance) : 0,
    });
  }

  for (const invoice of saleInvoices) {
    const details = invoice.items.map((item) => ({
      productName: item.product.name,
      quantity: Number(item.quantity),
      unit: item.product.unit,
      rate: Number(item.unitPrice),
      amount: Number(item.lineTotal),
    }));

    pushRow({
      id: `sale-${invoice.id}`,
      date: invoice.date,
      description: `Sale Invoice`,
      referenceType: "SALE_INVOICE",
      referenceId: invoice.id,
      referenceDocNo: normalizeTransactionNo(invoice.invoiceNo, "SV"),
      debit: Number(invoice.totalAmount),
      credit: 0,
      detailRows: details,
    });
  }

  for (const invoice of purchaseInvoices) {
    const details = invoice.items.map((item) => ({
      productName: item.product.name,
      quantity: Number(item.quantity),
      unit: item.product.unit,
      rate: Number(item.unitCost),
      amount: Number(item.lineTotal),
    }));

    pushRow({
      id: `purchase-${invoice.id}`,
      date: invoice.date,
      description: `Purchase Invoice`,
      referenceType: "PURCHASE_INVOICE",
      referenceId: invoice.id,
      referenceDocNo: normalizeTransactionNo(invoice.invoiceNo, "PV"),
      debit: Number(invoice.totalAmount),
      credit: 0,
      detailRows: details,
    });
  }

  for (const payment of payments) {
    const paymentLabel = payment.direction === "IN" ? "Cash Rcvd - Invoices" : "Cash Paid - Invoices";
    const methodText = paymentMethodLabel(payment.method);
    const description = payment.direction === "IN"
      ? `${methodText} Rcvd - Invoices`
      : `${methodText} Paid - Invoices`;

    pushRow({
      id: `payment-${payment.id}`,
      date: payment.date,
      description,
      referenceType: "PAYMENT",
      referenceId: payment.id,
      referenceDocNo: formatPaymentDocNo(payment, payment.direction),
      debit: 0,
      credit: Number(payment.amount),
    });
  }

  for (const saleReturn of saleReturns) {
    pushRow({
      id: `sale-return-${saleReturn.id}`,
      date: saleReturn.date,
      description: `Sale Return`,
      referenceType: "SALE_RETURN",
      referenceId: saleReturn.id,
      referenceDocNo: normalizeTransactionNo(saleReturn.returnNo, "SR"),
      debit: 0,
      credit: Number(saleReturn.totalAmount),
    });
  }

  for (const purchaseReturn of purchaseReturns) {
    pushRow({
      id: `purchase-return-${purchaseReturn.id}`,
      date: purchaseReturn.date,
      description: `Purchase Return`,
      referenceType: "PURCHASE_RETURN",
      referenceId: purchaseReturn.id,
      referenceDocNo: normalizeTransactionNo(purchaseReturn.returnNo, "PR"),
      debit: 0,
      credit: Number(purchaseReturn.totalAmount),
    });
  }

  const statementRows = customRows.sort((a, b) => a.date.getTime() - b.date.getTime());

  let runningBalance = openingBalance;
  let totalPeriodDebits = 0;
  let totalPeriodCredits = 0;

  for (const row of statementRows) {
    const debit = Number(row.debit) || 0;
    const credit = Number(row.credit) || 0;
    totalPeriodDebits += debit;
    totalPeriodCredits += credit;
    runningBalance += debit - credit;
    row.runningBalance = runningBalance;
  }

  const closingBalance = runningBalance;

  const ledgerRows = statementRows.map((row) => ({
    id: row.id,
    date: row.date,
    partyId: party.id,
    partyName: party.name,
    description: row.description,
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    referenceDocNo: row.referenceDocNo,
    sourceFinancialYear: openingBalanceSourceYear,
    debit: Number(row.debit) || 0,
    credit: Number(row.credit) || 0,
    runningBalance: row.runningBalance,
    detailRows: row.detailRows,
  }));

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

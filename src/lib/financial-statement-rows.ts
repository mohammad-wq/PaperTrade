type StatementRow = {
  label: string;
  amount: number;
  indent?: number;
  bold?: boolean;
  ruleAbove?: boolean;
  doubleRuleAbove?: boolean;
};

export type ProfitLossStatementInput = {
  sales: number;
  grossSales?: number;
  salesReturns?: number;
  purchases: number;
  grossPurchases?: number;
  purchaseReturns?: number;
  cogs?: number;
  grossProfit: number;
  expenses: number;
  expenseBreakdown?: Array<{ name: string; amount: number }>;
  netProfit: number;
};

export type CashFlowStatementInput = {
  beginningBalance?: number;
  cashInflow: number;
  cashOutflow: number;
  netCashFlow: number;
  endingBalance: number;
};

export type BalanceSheetStatementInput = {
  assets: {
    cash: number;
    receivables: number;
    inventory: number;
    totalAssets: number;
  };
  liabilities: {
    payables: number;
    bankOverdraft?: number;
    totalLiabilities: number;
  };
  equity: number;
  totalLiabilitiesAndEquity?: number;
};

export function buildProfitLossStatementRows(data: ProfitLossStatementInput): StatementRow[] {
  const rows: StatementRow[] = [];

  if (data.grossSales !== undefined && data.salesReturns !== undefined && data.salesReturns > 0) {
    rows.push({ label: "Gross sales", amount: data.grossSales, indent: 1 });
    rows.push({ label: "Less: sales returns", amount: -data.salesReturns, indent: 2 });
  }
  rows.push({ label: "Net sales revenue", amount: data.sales, bold: true, ruleAbove: rows.length > 0 });

  if (data.cogs !== undefined && data.cogs > 0) {
    rows.push({ label: "Cost of goods sold", amount: -data.cogs, indent: 1, ruleAbove: true });
  }
  if (data.grossPurchases !== undefined && data.purchaseReturns !== undefined && data.purchaseReturns > 0) {
    rows.push({ label: "Gross purchases", amount: -data.grossPurchases, indent: 1 });
    rows.push({ label: "Less: purchase returns", amount: data.purchaseReturns, indent: 2 });
  } else if (data.purchases > 0) {
    rows.push({ label: "Purchases (net)", amount: -data.purchases, indent: 1 });
  }

  rows.push({
    label: "Gross profit",
    amount: data.grossProfit,
    bold: true,
    ruleAbove: true,
  });

  if (data.expenseBreakdown && data.expenseBreakdown.length > 0) {
    for (const exp of data.expenseBreakdown) {
      rows.push({ label: exp.name, amount: -exp.amount, indent: 1 });
    }
  } else if (data.expenses > 0) {
    rows.push({ label: "Operating & storage expenses", amount: -data.expenses, indent: 1 });
  }

  rows.push({
    label: data.netProfit >= 0 ? "Net income" : "Net loss",
    amount: data.netProfit,
    bold: true,
    doubleRuleAbove: true,
  });

  return rows;
}

export function buildCashFlowStatementRows(data: CashFlowStatementInput): StatementRow[] {
  const rows: StatementRow[] = [];

  if (data.beginningBalance !== undefined) {
    rows.push({ label: "Cash and bank — beginning of period", amount: data.beginningBalance, indent: 0 });
  }

  rows.push({ label: "Cash receipts (inflow)", amount: data.cashInflow, indent: 1, ruleAbove: true });
  rows.push({ label: "Cash payments (outflow)", amount: -data.cashOutflow, indent: 1 });

  rows.push({
    label: "Net change in cash",
    amount: data.netCashFlow,
    bold: true,
    ruleAbove: true,
  });

  rows.push({
    label: "Cash and bank — end of period",
    amount: data.endingBalance,
    bold: true,
    doubleRuleAbove: true,
  });

  return rows;
}

export function buildBalanceSheetStatementRows(data: BalanceSheetStatementInput): StatementRow[] {
  const rows: StatementRow[] = [];
  const totalLe =
    data.totalLiabilitiesAndEquity ?? data.liabilities.totalLiabilities + data.equity;

  rows.push({ label: "ASSETS", amount: 0, bold: true });
  rows.push({ label: "Cash and bank", amount: data.assets.cash, indent: 1 });
  rows.push({ label: "Accounts receivable", amount: data.assets.receivables, indent: 1 });
  rows.push({ label: "Inventory", amount: data.assets.inventory, indent: 1 });
  rows.push({
    label: "Total assets",
    amount: data.assets.totalAssets,
    bold: true,
    ruleAbove: true,
  });

  rows.push({ label: "LIABILITIES", amount: 0, bold: true, ruleAbove: true });
  rows.push({ label: "Accounts payable", amount: data.liabilities.payables, indent: 1 });
  if (data.liabilities.bankOverdraft && data.liabilities.bankOverdraft > 0) {
    rows.push({ label: "Bank overdraft", amount: data.liabilities.bankOverdraft, indent: 1 });
  }
  rows.push({
    label: "Total liabilities",
    amount: data.liabilities.totalLiabilities,
    bold: true,
    ruleAbove: true,
  });

  rows.push({ label: "EQUITY", amount: 0, bold: true, ruleAbove: true });
  rows.push({ label: "Owner's equity & retained earnings", amount: data.equity, indent: 1 });
  rows.push({
    label: "Total liabilities and equity",
    amount: totalLe,
    bold: true,
    doubleRuleAbove: true,
  });

  return rows;
}

export type { StatementRow };

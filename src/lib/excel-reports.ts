import ExcelJS from "exceljs";
import { formatDate, formatDateTime } from "@/lib/utils";

// Standard styling constants
const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF0F172A" }, // Slate 900
};

const SECTION_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF1F5F9" }, // Slate 100
};

const TOTAL_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFECFDF5" }, // Emerald 50
};

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFE2E8F0" } },
  bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
  left: { style: "thin", color: { argb: "FFE2E8F0" } },
  right: { style: "thin", color: { argb: "FFE2E8F0" } },
};

const DOUBLE_BOTTOM_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FF94A3B8" } },
  bottom: { style: "double", color: { argb: "FF0F172A" } },
  left: { style: "thin", color: { argb: "FFE2E8F0" } },
  right: { style: "thin", color: { argb: "FFE2E8F0" } },
};

function autoFitColumns(worksheet: ExcelJS.Worksheet, minWidths: Record<number, number> = {}) {
  worksheet.columns.forEach((col, colIdx) => {
    let maxLen = 10;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const val = cell.value ? cell.value.toString() : "";
      if (val.length > maxLen) maxLen = Math.min(val.length + 3, 50);
    });
    const colNum = colIdx + 1;
    col.width = Math.max(maxLen, minWidths[colNum] || 12);
  });
}

/**
 * 1. Profit & Loss Statement Excel Generator
 */
export async function buildProfitLossExcel(
  data: Awaited<ReturnType<typeof import("@/lib/financial-reports").calculateProfitLoss>>,
  params?: { startDate?: string; endDate?: string }
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "PaperTrade ERP";
  wb.created = new Date();

  const ws = wb.addWorksheet("Profit & Loss", {
    views: [{ showGridLines: true }],
  });

  const periodText =
    params?.startDate && params?.endDate
      ? `${formatDate(params.startDate)} to ${formatDate(params.endDate)}`
      : params?.startDate
      ? `From ${formatDate(params.startDate)}`
      : params?.endDate
      ? `Up to ${formatDate(params.endDate)}`
      : "All Time";

  // Title Block
  ws.mergeCells("A1:B1");
  const titleCell = ws.getCell("A1");
  titleCell.value = "PaperTrade - Profit & Loss Statement";
  titleCell.font = { name: "Calibri", size: 16, bold: true, color: { argb: "FF0F172A" } };
  titleCell.alignment = { vertical: "middle" };

  ws.mergeCells("A2:B2");
  const periodCell = ws.getCell("A2");
  periodCell.value = `Period: ${periodText}`;
  periodCell.font = { name: "Calibri", size: 11, italic: true, color: { argb: "FF475569" } };

  ws.mergeCells("A3:B3");
  const genCell = ws.getCell("A3");
  genCell.value = `Generated: ${formatDateTime(new Date())}`;
  genCell.font = { name: "Calibri", size: 9, color: { argb: "FF94A3B8" } };

  ws.addRow([]); // Blank row

  // Table Headers
  const headerRow = ws.addRow(["Particulars / Category", "Amount (PKR)"]);
  headerRow.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = HEADER_FILL;
  headerRow.getCell(1).alignment = { horizontal: "left" };
  headerRow.getCell(2).alignment = { horizontal: "right" };

  const addDataRow = (
    label: string,
    amount: number | string,
    options?: { isSection?: boolean; isTotal?: boolean; isGrandTotal?: boolean; indent?: boolean }
  ) => {
    const row = ws.addRow([
      options?.indent ? `    ${label}` : label,
      typeof amount === "number" ? amount : amount,
    ]);

    if (typeof amount === "number") {
      row.getCell(2).numFmt = "#,##0.00";
    }

    row.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
    row.getCell(2).alignment = { horizontal: "right", vertical: "middle" };

    if (options?.isSection) {
      row.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FF0F172A" } };
      row.fill = SECTION_FILL;
      row.eachCell((c) => (c.border = THIN_BORDER));
    } else if (options?.isGrandTotal) {
      row.font = { name: "Calibri", size: 12, bold: true, color: { argb: "FF064E3B" } };
      row.fill = TOTAL_FILL;
      row.eachCell((c) => (c.border = DOUBLE_BOTTOM_BORDER));
    } else if (options?.isTotal) {
      row.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FF0F172A" } };
      row.eachCell((c) => (c.border = THIN_BORDER));
    } else {
      row.font = { name: "Calibri", size: 10, color: { argb: "FF334155" } };
      row.eachCell((c) => (c.border = THIN_BORDER));
    }
    return row;
  };

  // 1. Revenue
  addDataRow("1. Operating Revenue", "", { isSection: true });
  addDataRow("Gross Sales", data.grossSales ?? data.sales, { indent: true });
  if (data.salesReturns && data.salesReturns > 0) {
    addDataRow("Less: Sales Returns & Credit Notes", -data.salesReturns, { indent: true });
  }
  addDataRow("Net Operating Sales", data.sales, { isTotal: true });

  ws.addRow([]);

  // 2. Cost of Goods Sold
  addDataRow("2. Cost of Goods Sold (Purchases)", "", { isSection: true });
  addDataRow("Gross Inventory Purchases", data.grossPurchases ?? data.purchases, { indent: true });
  if (data.purchaseReturns && data.purchaseReturns > 0) {
    addDataRow("Less: Purchase Returns & Debit Notes", -data.purchaseReturns, { indent: true });
  }
  addDataRow("Net Purchases (COGS)", data.purchases, { isTotal: true });

  ws.addRow([]);

  // 3. Gross Profit
  addDataRow("GROSS PROFIT", data.grossProfit, { isGrandTotal: true });
  if (data.grossMarginPct !== undefined) {
    const marginRow = ws.addRow(["Gross Margin %", `${data.grossMarginPct.toFixed(2)}%`]);
    marginRow.font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF64748B" } };
    marginRow.getCell(2).alignment = { horizontal: "right" };
    marginRow.eachCell((c) => (c.border = THIN_BORDER));
  }

  ws.addRow([]);

  // 4. Operating Expenses
  addDataRow("3. Operating Expenses", "", { isSection: true });
  if (data.expenseBreakdown && data.expenseBreakdown.length > 0) {
    for (const exp of data.expenseBreakdown) {
      addDataRow(exp.name, exp.amount, { indent: true });
    }
  } else {
    addDataRow("General Operating Expenses", data.expenses, { indent: true });
  }
  addDataRow("Total Operating Expenses", data.expenses, { isTotal: true });

  ws.addRow([]);

  // 5. Net Profit
  addDataRow(
    data.netProfit >= 0 ? "NET PROFIT (Income)" : "NET LOSS",
    data.netProfit,
    { isGrandTotal: true }
  );
  if (data.netMarginPct !== undefined) {
    const netMarginRow = ws.addRow(["Net Profit Margin %", `${data.netMarginPct.toFixed(2)}%`]);
    netMarginRow.font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF64748B" } };
    netMarginRow.getCell(2).alignment = { horizontal: "right" };
    netMarginRow.eachCell((c) => (c.border = THIN_BORDER));
  }

  autoFitColumns(ws, { 1: 40, 2: 24 });
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * 2. Balance Sheet Excel Generator
 */
export async function buildBalanceSheetExcel(
  data: Awaited<ReturnType<typeof import("@/lib/financial-reports").calculateBalanceSheet>>,
  params?: { asOfDate?: string }
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "PaperTrade ERP";
  wb.created = new Date();

  const ws = wb.addWorksheet("Balance Sheet", {
    views: [{ showGridLines: true }],
  });

  const asOfText = params?.asOfDate ? formatDate(params.asOfDate) : formatDate(data.asOf);

  // Title Block
  ws.mergeCells("A1:B1");
  const titleCell = ws.getCell("A1");
  titleCell.value = "PaperTrade - Balance Sheet (Statement of Financial Position)";
  titleCell.font = { name: "Calibri", size: 16, bold: true, color: { argb: "FF0F172A" } };
  titleCell.alignment = { vertical: "middle" };

  ws.mergeCells("A2:B2");
  const periodCell = ws.getCell("A2");
  periodCell.value = `As of Date: ${asOfText}`;
  periodCell.font = { name: "Calibri", size: 11, italic: true, color: { argb: "FF475569" } };

  ws.mergeCells("A3:B3");
  const genCell = ws.getCell("A3");
  genCell.value = `Generated: ${formatDateTime(new Date())}`;
  genCell.font = { name: "Calibri", size: 9, color: { argb: "FF94A3B8" } };

  ws.addRow([]);

  // Headers
  const headerRow = ws.addRow(["Account / Component", "Amount (PKR)"]);
  headerRow.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = HEADER_FILL;
  headerRow.getCell(1).alignment = { horizontal: "left" };
  headerRow.getCell(2).alignment = { horizontal: "right" };

  const addDataRow = (
    label: string,
    amount: number | string,
    options?: { isSection?: boolean; isTotal?: boolean; isGrandTotal?: boolean; indent?: boolean }
  ) => {
    const row = ws.addRow([
      options?.indent ? `    ${label}` : label,
      typeof amount === "number" ? amount : amount,
    ]);

    if (typeof amount === "number") {
      row.getCell(2).numFmt = "#,##0.00";
    }

    row.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
    row.getCell(2).alignment = { horizontal: "right", vertical: "middle" };

    if (options?.isSection) {
      row.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FF0F172A" } };
      row.fill = SECTION_FILL;
      row.eachCell((c) => (c.border = THIN_BORDER));
    } else if (options?.isGrandTotal) {
      row.font = { name: "Calibri", size: 12, bold: true, color: { argb: "FF064E3B" } };
      row.fill = TOTAL_FILL;
      row.eachCell((c) => (c.border = DOUBLE_BOTTOM_BORDER));
    } else if (options?.isTotal) {
      row.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FF0F172A" } };
      row.eachCell((c) => (c.border = THIN_BORDER));
    } else {
      row.font = { name: "Calibri", size: 10, color: { argb: "FF334155" } };
      row.eachCell((c) => (c.border = THIN_BORDER));
    }
    return row;
  };

  // ASSETS
  addDataRow("CURRENT ASSETS", "", { isSection: true });
  addDataRow("Cash & Bank Balances (Liquid)", data.assets.cash, { indent: true });
  addDataRow("Accounts Receivable (Customers)", data.assets.receivables, { indent: true });
  addDataRow("Physical Paper Inventory (At Cost)", data.assets.inventory, { indent: true });
  addDataRow("TOTAL CURRENT ASSETS", data.assets.totalAssets, { isGrandTotal: true });

  ws.addRow([]);

  // LIABILITIES
  addDataRow("CURRENT LIABILITIES", "", { isSection: true });
  addDataRow("Accounts Payable (Suppliers)", data.liabilities.payables, { indent: true });
  if (data.liabilities.bankOverdraft && data.liabilities.bankOverdraft > 0) {
    addDataRow("Bank Overdraft Facilities", data.liabilities.bankOverdraft, { indent: true });
  }
  addDataRow("TOTAL CURRENT LIABILITIES", data.liabilities.totalLiabilities, { isTotal: true });

  ws.addRow([]);

  // EQUITY
  addDataRow("EQUITY", "", { isSection: true });
  addDataRow("Owner's Equity / Retained Earnings", data.equity, { indent: true });
  addDataRow(
    "TOTAL LIABILITIES & EQUITY",
    data.totalLiabilitiesAndEquity ?? data.liabilities.totalLiabilities + data.equity,
    { isGrandTotal: true }
  );

  // Inventory Metrics
  if (data.assets.inventoryMetrics) {
    ws.addRow([]);
    addDataRow("PHYSICAL INVENTORY METRICS", "", { isSection: true });
    addDataRow("Total Physical Units (Packets/Reams/Rolls)", data.assets.inventoryMetrics.totalUnits, {
      indent: true,
    });
    addDataRow("Total Weight in Tonnes", `${data.assets.inventoryMetrics.totalTonnage} Tonnes`, {
      indent: true,
    });
  }

  autoFitColumns(ws, { 1: 44, 2: 24 });
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * 3. Cash Flow Statement Excel Generator
 */
export async function buildCashFlowExcel(
  data: Awaited<ReturnType<typeof import("@/lib/financial-reports").calculateCashFlow>>,
  params?: { startDate?: string; endDate?: string }
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "PaperTrade ERP";
  wb.created = new Date();

  const ws = wb.addWorksheet("Cash Flow Audit", {
    views: [{ showGridLines: true }],
  });

  const periodText =
    params?.startDate && params?.endDate
      ? `${formatDate(params.startDate)} to ${formatDate(params.endDate)}`
      : params?.startDate
      ? `From ${formatDate(params.startDate)}`
      : params?.endDate
      ? `Up to ${formatDate(params.endDate)}`
      : "All Time";

  // Title Block
  ws.mergeCells("A1:F1");
  const titleCell = ws.getCell("A1");
  titleCell.value = "PaperTrade - Cash Flow Statement";
  titleCell.font = { name: "Calibri", size: 16, bold: true, color: { argb: "FF0F172A" } };

  ws.mergeCells("A2:F2");
  const periodCell = ws.getCell("A2");
  periodCell.value = `Period: ${periodText}`;
  periodCell.font = { name: "Calibri", size: 11, italic: true, color: { argb: "FF475569" } };

  ws.mergeCells("A3:F3");
  const genCell = ws.getCell("A3");
  genCell.value = `Generated: ${formatDateTime(new Date())}`;
  genCell.font = { name: "Calibri", size: 9, color: { argb: "FF94A3B8" } };

  ws.addRow([]);

  // Summary KPI Cards in rows
  const summaryHeaders = ws.addRow([
    "Beginning Cash Balance",
    "Total Cash Inflow",
    "Total Cash Outflow",
    "Net Cash Flow",
    "Ending Cash Balance",
  ]);
  summaryHeaders.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
  summaryHeaders.fill = HEADER_FILL;
  summaryHeaders.eachCell((c) => {
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.border = THIN_BORDER;
  });

  const summaryValues = ws.addRow([
    data.beginningBalance ?? 0,
    data.cashInflow,
    data.cashOutflow,
    data.netCashFlow,
    data.endingBalance,
  ]);
  summaryValues.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FF0F172A" } };
  summaryValues.fill = TOTAL_FILL;
  summaryValues.eachCell((c) => {
    c.numFmt = "#,##0.00";
    c.alignment = { horizontal: "right", vertical: "middle" };
    c.border = THIN_BORDER;
  });

  ws.addRow([]);
  ws.addRow([]);

  // Table Headers
  const tableHeaders = ws.addRow([
    "Date (dd/mm/yyyy)",
    "Ref Type",
    "Description",
    "Inflow (PKR)",
    "Outflow (PKR)",
    "Running Balance (PKR)",
  ]);
  tableHeaders.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
  tableHeaders.fill = HEADER_FILL;
  tableHeaders.getCell(1).alignment = { horizontal: "center" };
  tableHeaders.getCell(2).alignment = { horizontal: "center" };
  tableHeaders.getCell(3).alignment = { horizontal: "left" };
  tableHeaders.getCell(4).alignment = { horizontal: "right" };
  tableHeaders.getCell(5).alignment = { horizontal: "right" };
  tableHeaders.getCell(6).alignment = { horizontal: "right" };
  tableHeaders.eachCell((c) => (c.border = THIN_BORDER));

  // Beginning balance opening row
  if (data.beginningBalance !== undefined && params?.startDate) {
    const obRow = ws.addRow([
      formatDate(params.startDate),
      "OPENING",
      "Beginning Cash Balance (Brought Forward)",
      "",
      "",
      data.beginningBalance,
    ]);
    obRow.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF475569" } };
    obRow.fill = SECTION_FILL;
    obRow.getCell(1).alignment = { horizontal: "center" };
    obRow.getCell(2).alignment = { horizontal: "center" };
    obRow.getCell(6).numFmt = "#,##0.00";
    obRow.getCell(6).alignment = { horizontal: "right" };
    obRow.eachCell((c) => (c.border = THIN_BORDER));
  }

  // Detail rows
  for (const item of data.flowDetails) {
    const row = ws.addRow([
      formatDate(item.date),
      item.referenceType,
      item.description,
      item.inflow > 0 ? item.inflow : "",
      item.outflow > 0 ? item.outflow : "",
      item.balance,
    ]);

    row.font = { name: "Calibri", size: 10, color: { argb: "FF334155" } };
    row.getCell(1).alignment = { horizontal: "center" };
    row.getCell(2).alignment = { horizontal: "center" };
    row.getCell(3).alignment = { horizontal: "left" };

    if (item.inflow > 0) {
      row.getCell(4).numFmt = "#,##0.00";
      row.getCell(4).font = { name: "Calibri", size: 10, color: { argb: "FF047857" }, bold: true };
    }
    if (item.outflow > 0) {
      row.getCell(5).numFmt = "#,##0.00";
      row.getCell(5).font = { name: "Calibri", size: 10, color: { argb: "FFB45309" } };
    }

    row.getCell(4).alignment = { horizontal: "right" };
    row.getCell(5).alignment = { horizontal: "right" };
    row.getCell(6).numFmt = "#,##0.00";
    row.getCell(6).alignment = { horizontal: "right" };
    row.eachCell((c) => (c.border = THIN_BORDER));
  }

  // Total summary closing row
  const totalRow = ws.addRow([
    "TOTAL",
    "",
    "Period Summary",
    data.cashInflow,
    data.cashOutflow,
    data.endingBalance,
  ]);
  totalRow.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FF0F172A" } };
  totalRow.fill = TOTAL_FILL;
  totalRow.getCell(1).alignment = { horizontal: "center" };
  totalRow.getCell(4).numFmt = "#,##0.00";
  totalRow.getCell(5).numFmt = "#,##0.00";
  totalRow.getCell(6).numFmt = "#,##0.00";
  totalRow.eachCell((c) => (c.border = DOUBLE_BOTTOM_BORDER));

  autoFitColumns(ws, { 1: 16, 2: 16, 3: 40, 4: 20, 5: 20, 6: 22 });
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * 4. Party Statement (Account Ledger) Excel Generator
 */
export async function buildPartyStatementExcel(
  data: Awaited<ReturnType<typeof import("@/lib/financial-reports").calculatePartyStatement>>,
  params?: { startDate?: string; endDate?: string; productId?: string }
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "PaperTrade ERP";
  wb.created = new Date();

  // Sheet 1: Ledger Statement
  const ws = wb.addWorksheet("Ledger Statement", {
    views: [{ showGridLines: true }],
  });

  const periodText =
    params?.startDate && params?.endDate
      ? `${formatDate(params.startDate)} to ${formatDate(params.endDate)}`
      : params?.startDate
      ? `From ${formatDate(params.startDate)}`
      : params?.endDate
      ? `Up to ${formatDate(params.endDate)}`
      : "All Time";

  // Title Block
  ws.mergeCells("A1:F1");
  const titleCell = ws.getCell("A1");
  titleCell.value = `PaperTrade - Statement of Account (${data.party.type})`;
  titleCell.font = { name: "Calibri", size: 16, bold: true, color: { argb: "FF0F172A" } };

  ws.mergeCells("A2:F2");
  const partyCell = ws.getCell("A2");
  partyCell.value = `Party: ${data.party.name}  |  Phone: ${data.party.phone || "—"}  |  Address: ${data.party.address || "—"}`;
  partyCell.font = { name: "Calibri", size: 11, color: { argb: "FF334155" } };

  ws.mergeCells("A3:F3");
  const periodCell = ws.getCell("A3");
  periodCell.value = `Statement Period: ${periodText}  |  Generated: ${formatDateTime(new Date())}`;
  periodCell.font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF64748B" } };

  ws.addRow([]);

  // Summary KPI Cards in row
  const summaryHeaders = ws.addRow([
    "Opening Balance (b/f)",
    "Total Period Debits",
    "Total Period Credits",
    "Closing Net Balance",
    "Balance Position",
  ]);
  summaryHeaders.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
  summaryHeaders.fill = HEADER_FILL;
  summaryHeaders.eachCell((c) => {
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.border = THIN_BORDER;
  });

  const positionLabel =
    data.closingBalance > 0
      ? "Dr (Receivable from Party)"
      : data.closingBalance < 0
      ? "Cr (Payable to Party)"
      : "Settled (Nil)";

  const summaryValues = ws.addRow([
    data.openingBalance,
    data.totalPeriodDebits,
    data.totalPeriodCredits,
    Math.abs(data.closingBalance),
    positionLabel,
  ]);
  summaryValues.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FF0F172A" } };
  summaryValues.fill = TOTAL_FILL;
  summaryValues.getCell(1).numFmt = "#,##0.00";
  summaryValues.getCell(2).numFmt = "#,##0.00";
  summaryValues.getCell(3).numFmt = "#,##0.00";
  summaryValues.getCell(4).numFmt = "#,##0.00";
  summaryValues.eachCell((c) => {
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.border = THIN_BORDER;
  });

  ws.addRow([]);
  ws.addRow([]);

  // Ledger Table Headers
  const tableHeaders = ws.addRow([
    "Date (dd/mm/yyyy)",
    "Ref Type",
    "Description / Particulars",
    "Debit (PKR)",
    "Credit (PKR)",
    "Running Balance (PKR)",
  ]);
  tableHeaders.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
  tableHeaders.fill = HEADER_FILL;
  tableHeaders.getCell(1).alignment = { horizontal: "center" };
  tableHeaders.getCell(2).alignment = { horizontal: "center" };
  tableHeaders.getCell(3).alignment = { horizontal: "left" };
  tableHeaders.getCell(4).alignment = { horizontal: "right" };
  tableHeaders.getCell(5).alignment = { horizontal: "right" };
  tableHeaders.getCell(6).alignment = { horizontal: "right" };
  tableHeaders.eachCell((c) => (c.border = THIN_BORDER));

  // Opening Balance Row
  const obRow = ws.addRow([
    params?.startDate ? formatDate(params.startDate) : "—",
    "OPENING",
    "Opening Balance Brought Forward",
    data.openingBalance > 0 ? data.openingBalance : "",
    data.openingBalance < 0 ? Math.abs(data.openingBalance) : "",
    data.openingBalance,
  ]);
  obRow.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF475569" } };
  obRow.fill = SECTION_FILL;
  obRow.getCell(1).alignment = { horizontal: "center" };
  obRow.getCell(2).alignment = { horizontal: "center" };
  if (data.openingBalance > 0) obRow.getCell(4).numFmt = "#,##0.00";
  if (data.openingBalance < 0) obRow.getCell(5).numFmt = "#,##0.00";
  obRow.getCell(6).numFmt = "#,##0.00";
  obRow.eachCell((c) => (c.border = THIN_BORDER));

  // Detail Ledger Rows
  for (const row of data.ledgerRows) {
    const tableRow = ws.addRow([
      formatDate(row.date),
      row.referenceType,
      row.description,
      row.debit > 0 ? row.debit : "",
      row.credit > 0 ? row.credit : "",
      row.runningBalance,
    ]);

    tableRow.font = { name: "Calibri", size: 10, color: { argb: "FF334155" } };
    tableRow.getCell(1).alignment = { horizontal: "center" };
    tableRow.getCell(2).alignment = { horizontal: "center" };
    tableRow.getCell(3).alignment = { horizontal: "left" };

    if (row.debit > 0) {
      tableRow.getCell(4).numFmt = "#,##0.00";
      tableRow.getCell(4).font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF047857" } };
    }
    if (row.credit > 0) {
      tableRow.getCell(5).numFmt = "#,##0.00";
      tableRow.getCell(5).font = { name: "Calibri", size: 10, color: { argb: "FFB45309" } };
    }

    tableRow.getCell(4).alignment = { horizontal: "right" };
    tableRow.getCell(5).alignment = { horizontal: "right" };
    tableRow.getCell(6).numFmt = "#,##0.00";
    tableRow.getCell(6).alignment = { horizontal: "right" };
    tableRow.eachCell((c) => (c.border = THIN_BORDER));
  }

  // Closing Total Row
  const totalRow = ws.addRow([
    "CLOSING",
    "",
    "Period Totals & Closing Balance",
    data.totalPeriodDebits,
    data.totalPeriodCredits,
    data.closingBalance,
  ]);
  totalRow.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FF0F172A" } };
  totalRow.fill = TOTAL_FILL;
  totalRow.getCell(1).alignment = { horizontal: "center" };
  totalRow.getCell(4).numFmt = "#,##0.00";
  totalRow.getCell(5).numFmt = "#,##0.00";
  totalRow.getCell(6).numFmt = "#,##0.00";
  totalRow.eachCell((c) => (c.border = DOUBLE_BOTTOM_BORDER));

  autoFitColumns(ws, { 1: 16, 2: 16, 3: 42, 4: 20, 5: 20, 6: 22 });

  // Optional Sheet 2: Item-wise transactions (if available)
  if (data.productTransactions && data.productTransactions.length > 0) {
    const wsItems = wb.addWorksheet("Item History", {
      views: [{ showGridLines: true }],
    });

    wsItems.mergeCells("A1:H1");
    const tCell = wsItems.getCell("A1");
    tCell.value = `Item Transactions - ${data.party.name}`;
    tCell.font = { name: "Calibri", size: 14, bold: true, color: { argb: "FF0F172A" } };

    wsItems.addRow([]);

    const itemHeaders = wsItems.addRow([
      "Date (dd/mm/yyyy)",
      "Document No",
      "Document Type",
      "Product Name",
      "Quantity",
      "Unit",
      "Unit Price (PKR)",
      "Line Total (PKR)",
    ]);
    itemHeaders.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    itemHeaders.fill = HEADER_FILL;
    itemHeaders.getCell(1).alignment = { horizontal: "center" };
    itemHeaders.getCell(2).alignment = { horizontal: "center" };
    itemHeaders.getCell(3).alignment = { horizontal: "center" };
    itemHeaders.getCell(4).alignment = { horizontal: "left" };
    itemHeaders.getCell(5).alignment = { horizontal: "right" };
    itemHeaders.getCell(6).alignment = { horizontal: "center" };
    itemHeaders.getCell(7).alignment = { horizontal: "right" };
    itemHeaders.getCell(8).alignment = { horizontal: "right" };
    itemHeaders.eachCell((c) => (c.border = THIN_BORDER));

    for (const tx of data.productTransactions) {
      const row = wsItems.addRow([
        formatDate(tx.date),
        tx.docNo,
        tx.docType,
        tx.productName,
        tx.quantity,
        tx.unit,
        tx.unitPrice,
        tx.total,
      ]);
      row.font = { name: "Calibri", size: 10, color: { argb: "FF334155" } };
      row.getCell(1).alignment = { horizontal: "center" };
      row.getCell(2).alignment = { horizontal: "center" };
      row.getCell(3).alignment = { horizontal: "center" };
      row.getCell(4).alignment = { horizontal: "left" };
      row.getCell(5).alignment = { horizontal: "right" };
      row.getCell(6).alignment = { horizontal: "center" };
      row.getCell(7).numFmt = "#,##0.00";
      row.getCell(8).numFmt = "#,##0.00";
      row.getCell(7).alignment = { horizontal: "right" };
      row.getCell(8).alignment = { horizontal: "right" };
      row.eachCell((c) => (c.border = THIN_BORDER));
    }

    autoFitColumns(wsItems, { 1: 16, 2: 18, 3: 18, 4: 35, 5: 14, 6: 10, 7: 18, 8: 20 });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}


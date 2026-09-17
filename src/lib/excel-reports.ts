import ExcelJS from "exceljs";
import { formatDate, formatDateTime } from "@/lib/utils";

// Standard monochrome styling constants
const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1E293B" }, // Slate 800 (classic dark charcoal)
};

const SECTION_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF8FAFC" }, // Slate 50 (neutral subtle light grey)
};

const TOTAL_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF1F5F9" }, // Slate 100 (neutral formal grey, zero playful greens)
};

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFCBD5E1" } },
  bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
  left: { style: "thin", color: { argb: "FFCBD5E1" } },
  right: { style: "thin", color: { argb: "FFCBD5E1" } },
};

const DOUBLE_BOTTOM_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FF334155" } },
  bottom: { style: "double", color: { argb: "FF000000" } },
  left: { style: "thin", color: { argb: "FFCBD5E1" } },
  right: { style: "thin", color: { argb: "FFCBD5E1" } },
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
 * Produces Summary statement, plus Sales Register, Purchase Register, and Operating Expenses worksheets.
 */
export async function buildProfitLossExcel(
  data: Awaited<ReturnType<typeof import("@/lib/financial-reports").calculateProfitLoss>>,
  params?: { startDate?: string; endDate?: string }
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "PaperTrade ERP";
  wb.created = new Date();

  // Sheet 1: Profit & Loss Statement Summary
  const ws = wb.addWorksheet("Profit & Loss Summary", {
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
  titleCell.font = { name: "Calibri", size: 15, bold: true, color: { argb: "FF0F172A" } };
  titleCell.alignment = { vertical: "middle" };

  ws.mergeCells("A2:B2");
  const periodCell = ws.getCell("A2");
  periodCell.value = `Period: ${periodText}`;
  periodCell.font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF475569" } };

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
      row.font = { name: "Calibri", size: 11.5, bold: true, color: { argb: "FF0F172A" } };
      row.fill = TOTAL_FILL;
      row.eachCell((c) => (c.border = DOUBLE_BOTTOM_BORDER));
    } else if (options?.isTotal) {
      row.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FF0F172A" } };
      row.fill = SECTION_FILL;
      row.eachCell((c) => (c.border = THIN_BORDER));
    } else {
      row.font = { name: "Calibri", size: 10, color: { argb: "FF334155" } };
      row.eachCell((c) => (c.border = THIN_BORDER));
    }
    return row;
  };

  // 1. Revenue
  addDataRow("1. Trading Revenue", "", { isSection: true });
  addDataRow("Gross Trading Sales", data.grossSales ?? data.sales, { indent: true });
  if (data.salesReturns && data.salesReturns > 0) {
    addDataRow("Less: Sales Returns & Allowances", -data.salesReturns, { indent: true });
  }
  addDataRow("Net Operating Sales", data.sales, { isTotal: true });

  ws.addRow([]);

  // 2. Cost of Goods Sold
  addDataRow("2. Cost of Goods Sold (Purchases)", "", { isSection: true });
  addDataRow("Gross Stock Purchases", data.grossPurchases ?? data.purchases, { indent: true });
  if (data.purchaseReturns && data.purchaseReturns > 0) {
    addDataRow("Less: Purchase Returns & Debit Notes", -data.purchaseReturns, { indent: true });
  }
  addDataRow("Net Cost of Goods Sold (COGS)", data.purchases, { isTotal: true });

  ws.addRow([]);

  // 3. Gross Profit
  addDataRow("GROSS TRADING PROFIT", data.grossProfit, { isGrandTotal: true });
  if (data.grossMarginPct !== undefined) {
    const marginRow = ws.addRow(["Gross Profit Margin %", `${data.grossMarginPct.toFixed(2)}%`]);
    marginRow.font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF475569" } };
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
    data.netProfit >= 0 ? "NET OPERATING PROFIT" : "NET OPERATING LOSS",
    data.netProfit,
    { isGrandTotal: true }
  );
  if (data.netMarginPct !== undefined) {
    const netMarginRow = ws.addRow(["Net Profit Margin %", `${data.netMarginPct.toFixed(2)}%`]);
    netMarginRow.font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF475569" } };
    netMarginRow.getCell(2).alignment = { horizontal: "right" };
    netMarginRow.eachCell((c) => (c.border = THIN_BORDER));
  }

  autoFitColumns(ws, { 1: 44, 2: 24 });

  // Sheet 2: Sales Register (with Party ID and Reference ID)
  if (data.salesBreakdown && data.salesBreakdown.length > 0) {
    const wsSales = wb.addWorksheet("Sales Register", { views: [{ showGridLines: true }] });
    wsSales.mergeCells("A1:G1");
    const sTitle = wsSales.getCell("A1");
    sTitle.value = "PaperTrade - Sales Audit Register (with Party ID & Reference ID)";
    sTitle.font = { name: "Calibri", size: 14, bold: true, color: { argb: "FF0F172A" } };

    wsSales.addRow([]);
    const sHeaders = wsSales.addRow([
      "Date (dd/mm/yyyy)",
      "Party ID",
      "Customer Name",
      "Reference Type",
      "Reference ID",
      "Particulars / Description",
      "Amount (PKR)",
    ]);
    sHeaders.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    sHeaders.fill = HEADER_FILL;
    sHeaders.eachCell((c) => (c.border = THIN_BORDER));

    let totalSales = 0;
    for (const item of data.salesBreakdown) {
      totalSales += item.amount;
      const row = wsSales.addRow([
        formatDate(item.date),
        item.partyId,
        item.partyName,
        item.referenceType,
        item.referenceId,
        item.description,
        item.amount,
      ]);
      row.font = { name: "Calibri", size: 10, color: { argb: "FF334155" } };
      row.getCell(1).alignment = { horizontal: "center" };
      row.getCell(2).alignment = { horizontal: "center" };
      row.getCell(7).numFmt = "#,##0.00";
      row.getCell(7).alignment = { horizontal: "right" };
      row.eachCell((c) => (c.border = THIN_BORDER));
    }

    const sTotal = wsSales.addRow(["TOTAL", "", "", "", "", "Total Period Sales", totalSales]);
    sTotal.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FF0F172A" } };
    sTotal.fill = TOTAL_FILL;
    sTotal.getCell(7).numFmt = "#,##0.00";
    sTotal.eachCell((c) => (c.border = DOUBLE_BOTTOM_BORDER));

    autoFitColumns(wsSales, { 1: 16, 2: 18, 3: 32, 4: 18, 5: 22, 6: 35, 7: 20 });
  }

  // Sheet 3: Purchase Register (with Party ID and Reference ID)
  if (data.purchasesBreakdown && data.purchasesBreakdown.length > 0) {
    const wsPurchases = wb.addWorksheet("Purchase Register", { views: [{ showGridLines: true }] });
    wsPurchases.mergeCells("A1:G1");
    const pTitle = wsPurchases.getCell("A1");
    pTitle.value = "PaperTrade - Purchase Audit Register (with Party ID & Reference ID)";
    pTitle.font = { name: "Calibri", size: 14, bold: true, color: { argb: "FF0F172A" } };

    wsPurchases.addRow([]);
    const pHeaders = wsPurchases.addRow([
      "Date (dd/mm/yyyy)",
      "Party ID",
      "Supplier Name",
      "Reference Type",
      "Reference ID",
      "Particulars / Description",
      "Amount (PKR)",
    ]);
    pHeaders.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    pHeaders.fill = HEADER_FILL;
    pHeaders.eachCell((c) => (c.border = THIN_BORDER));

    let totalPurchases = 0;
    for (const item of data.purchasesBreakdown) {
      totalPurchases += item.amount;
      const row = wsPurchases.addRow([
        formatDate(item.date),
        item.partyId,
        item.partyName,
        item.referenceType,
        item.referenceId,
        item.description,
        item.amount,
      ]);
      row.font = { name: "Calibri", size: 10, color: { argb: "FF334155" } };
      row.getCell(1).alignment = { horizontal: "center" };
      row.getCell(2).alignment = { horizontal: "center" };
      row.getCell(7).numFmt = "#,##0.00";
      row.getCell(7).alignment = { horizontal: "right" };
      row.eachCell((c) => (c.border = THIN_BORDER));
    }

    const pTotal = wsPurchases.addRow(["TOTAL", "", "", "", "", "Total Period Purchases", totalPurchases]);
    pTotal.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FF0F172A" } };
    pTotal.fill = TOTAL_FILL;
    pTotal.getCell(7).numFmt = "#,##0.00";
    pTotal.eachCell((c) => (c.border = DOUBLE_BOTTOM_BORDER));

    autoFitColumns(wsPurchases, { 1: 16, 2: 18, 3: 32, 4: 18, 5: 22, 6: 35, 7: 20 });
  }

  // Sheet 4: Expense Register
  if (data.expenseItems && data.expenseItems.length > 0) {
    const wsExpenses = wb.addWorksheet("Expense Register", { views: [{ showGridLines: true }] });
    wsExpenses.mergeCells("A1:G1");
    const eTitle = wsExpenses.getCell("A1");
    eTitle.value = "PaperTrade - Operating Expenses Audit Register";
    eTitle.font = { name: "Calibri", size: 14, bold: true, color: { argb: "FF0F172A" } };

    wsExpenses.addRow([]);
    const eHeaders = wsExpenses.addRow([
      "Date (dd/mm/yyyy)",
      "Party ID",
      "Payee / Party",
      "Reference Type",
      "Reference ID",
      "Description",
      "Amount (PKR)",
    ]);
    eHeaders.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    eHeaders.fill = HEADER_FILL;
    eHeaders.eachCell((c) => (c.border = THIN_BORDER));

    let totalExp = 0;
    for (const item of data.expenseItems) {
      totalExp += item.amount;
      const row = wsExpenses.addRow([
        formatDate(item.date),
        item.partyId || "—",
        item.partyName || "Internal Expense",
        item.referenceType,
        item.referenceId,
        item.description,
        item.amount,
      ]);
      row.font = { name: "Calibri", size: 10, color: { argb: "FF334155" } };
      row.getCell(1).alignment = { horizontal: "center" };
      row.getCell(2).alignment = { horizontal: "center" };
      row.getCell(7).numFmt = "#,##0.00";
      row.getCell(7).alignment = { horizontal: "right" };
      row.eachCell((c) => (c.border = THIN_BORDER));
    }

    const eTotal = wsExpenses.addRow(["TOTAL", "", "", "", "", "Total Operating Expenses", totalExp]);
    eTotal.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FF0F172A" } };
    eTotal.fill = TOTAL_FILL;
    eTotal.getCell(7).numFmt = "#,##0.00";
    eTotal.eachCell((c) => (c.border = DOUBLE_BOTTOM_BORDER));

    autoFitColumns(wsExpenses, { 1: 16, 2: 18, 3: 32, 4: 18, 5: 22, 6: 35, 7: 20 });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * 2. Balance Sheet Excel Generator
 * Produces Summary statement, plus Receivables Schedule and Payables Schedule worksheets.
 */
export async function buildBalanceSheetExcel(
  data: Awaited<ReturnType<typeof import("@/lib/financial-reports").calculateBalanceSheet>>,
  params?: { asOfDate?: string }
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "PaperTrade ERP";
  wb.created = new Date();

  // Sheet 1: Summary Balance Sheet
  const ws = wb.addWorksheet("Balance Sheet Summary", {
    views: [{ showGridLines: true }],
  });

  const asOfText = params?.asOfDate ? formatDate(params.asOfDate) : formatDate(data.asOf);

  // Title Block
  ws.mergeCells("A1:B1");
  const titleCell = ws.getCell("A1");
  titleCell.value = "PaperTrade - Balance Sheet (Statement of Financial Position)";
  titleCell.font = { name: "Calibri", size: 15, bold: true, color: { argb: "FF0F172A" } };
  titleCell.alignment = { vertical: "middle" };

  ws.mergeCells("A2:B2");
  const periodCell = ws.getCell("A2");
  periodCell.value = `As of Date: ${asOfText}`;
  periodCell.font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF475569" } };

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
      row.font = { name: "Calibri", size: 11.5, bold: true, color: { argb: "FF0F172A" } };
      row.fill = TOTAL_FILL;
      row.eachCell((c) => (c.border = DOUBLE_BOTTOM_BORDER));
    } else if (options?.isTotal) {
      row.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FF0F172A" } };
      row.fill = SECTION_FILL;
      row.eachCell((c) => (c.border = THIN_BORDER));
    } else {
      row.font = { name: "Calibri", size: 10, color: { argb: "FF334155" } };
      row.eachCell((c) => (c.border = THIN_BORDER));
    }
    return row;
  };

  // ASSETS
  addDataRow("1. CURRENT ASSETS", "", { isSection: true });
  addDataRow("Cash & Bank Balances (Liquid)", data.assets.cash, { indent: true });
  addDataRow("Accounts Receivable (Customers)", data.assets.receivables, { indent: true });
  addDataRow("Physical Paper Inventory (At Cost)", data.assets.inventory, { indent: true });
  addDataRow("TOTAL CURRENT ASSETS", data.assets.totalAssets, { isGrandTotal: true });

  ws.addRow([]);

  // LIABILITIES
  addDataRow("2. CURRENT LIABILITIES", "", { isSection: true });
  addDataRow("Accounts Payable (Suppliers)", data.liabilities.payables, { indent: true });
  if (data.liabilities.bankOverdraft && data.liabilities.bankOverdraft > 0) {
    addDataRow("Bank Overdraft Facilities", data.liabilities.bankOverdraft, { indent: true });
  }
  addDataRow("TOTAL CURRENT LIABILITIES", data.liabilities.totalLiabilities, { isTotal: true });

  ws.addRow([]);

  // EQUITY
  addDataRow("3. NET EQUITY", "", { isSection: true });
  addDataRow("Owner's Equity & Cumulative Retained Earnings", data.equity, { indent: true });
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
    addDataRow("Total Stock Weight in Tonnes", `${data.assets.inventoryMetrics.totalTonnage} Tonnes`, {
      indent: true,
    });
  }

  autoFitColumns(ws, { 1: 44, 2: 24 });

  // Sheet 2: Receivables Schedule (Party ID, Customer Name, Ref, Balance)
  if (data.receivablesSchedule && data.receivablesSchedule.length > 0) {
    const wsRec = wb.addWorksheet("Receivables Schedule", { views: [{ showGridLines: true }] });
    wsRec.mergeCells("A1:G1");
    const rTitle = wsRec.getCell("A1");
    rTitle.value = "PaperTrade - Accounts Receivable Schedule (Customer Outstandings)";
    rTitle.font = { name: "Calibri", size: 14, bold: true, color: { argb: "FF0F172A" } };

    wsRec.addRow([]);
    const rHeaders = wsRec.addRow([
      "Party ID",
      "Customer Name",
      "Party Type",
      "Contact Phone",
      "Latest Ref Type",
      "Latest Ref ID",
      "Balance Dr (PKR)",
    ]);
    rHeaders.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    rHeaders.fill = HEADER_FILL;
    rHeaders.eachCell((c) => (c.border = THIN_BORDER));

    let totalRec = 0;
    for (const item of data.receivablesSchedule) {
      totalRec += item.balance;
      const row = wsRec.addRow([
        item.partyId,
        item.partyName,
        item.partyType,
        item.phone || "—",
        item.referenceType,
        item.referenceId,
        item.balance,
      ]);
      row.font = { name: "Calibri", size: 10, color: { argb: "FF334155" } };
      row.getCell(1).alignment = { horizontal: "center" };
      row.getCell(7).numFmt = "#,##0.00";
      row.getCell(7).alignment = { horizontal: "right" };
      row.eachCell((c) => (c.border = THIN_BORDER));
    }

    const rTotal = wsRec.addRow(["TOTAL", "", "", "", "", "Total Accounts Receivable", totalRec]);
    rTotal.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FF0F172A" } };
    rTotal.fill = TOTAL_FILL;
    rTotal.getCell(7).numFmt = "#,##0.00";
    rTotal.eachCell((c) => (c.border = DOUBLE_BOTTOM_BORDER));

    autoFitColumns(wsRec, { 1: 18, 2: 32, 3: 16, 4: 18, 5: 18, 6: 22, 7: 22 });
  }

  // Sheet 3: Payables Schedule (Party ID, Supplier Name, Ref, Balance)
  if (data.payablesSchedule && data.payablesSchedule.length > 0) {
    const wsPay = wb.addWorksheet("Payables Schedule", { views: [{ showGridLines: true }] });
    wsPay.mergeCells("A1:G1");
    const pTitle = wsPay.getCell("A1");
    pTitle.value = "PaperTrade - Accounts Payable Schedule (Supplier Outstandings)";
    pTitle.font = { name: "Calibri", size: 14, bold: true, color: { argb: "FF0F172A" } };

    wsPay.addRow([]);
    const pHeaders = wsPay.addRow([
      "Party ID",
      "Supplier Name",
      "Party Type",
      "Contact Phone",
      "Latest Ref Type",
      "Latest Ref ID",
      "Balance Cr (PKR)",
    ]);
    pHeaders.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    pHeaders.fill = HEADER_FILL;
    pHeaders.eachCell((c) => (c.border = THIN_BORDER));

    let totalPay = 0;
    for (const item of data.payablesSchedule) {
      totalPay += item.balance;
      const row = wsPay.addRow([
        item.partyId,
        item.partyName,
        item.partyType,
        item.phone || "—",
        item.referenceType,
        item.referenceId,
        item.balance,
      ]);
      row.font = { name: "Calibri", size: 10, color: { argb: "FF334155" } };
      row.getCell(1).alignment = { horizontal: "center" };
      row.getCell(7).numFmt = "#,##0.00";
      row.getCell(7).alignment = { horizontal: "right" };
      row.eachCell((c) => (c.border = THIN_BORDER));
    }

    const pTotal = wsPay.addRow(["TOTAL", "", "", "", "", "Total Accounts Payable", totalPay]);
    pTotal.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FF0F172A" } };
    pTotal.fill = TOTAL_FILL;
    pTotal.getCell(7).numFmt = "#,##0.00";
    pTotal.eachCell((c) => (c.border = DOUBLE_BOTTOM_BORDER));

    autoFitColumns(wsPay, { 1: 18, 2: 32, 3: 16, 4: 18, 5: 18, 6: 22, 7: 22 });
  }

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
  ws.mergeCells("A1:H1");
  const titleCell = ws.getCell("A1");
  titleCell.value = "PaperTrade - Statement of Cash Flows";
  titleCell.font = { name: "Calibri", size: 15, bold: true, color: { argb: "FF0F172A" } };

  ws.mergeCells("A2:H2");
  const periodCell = ws.getCell("A2");
  periodCell.value = `Period: ${periodText}`;
  periodCell.font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF475569" } };

  ws.mergeCells("A3:H3");
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

  // Table Headers with Party ID and Reference ID
  const tableHeaders = ws.addRow([
    "Date (dd/mm/yyyy)",
    "Party ID",
    "Party / Account",
    "Ref Type",
    "Reference ID",
    "Description",
    "Inflow (PKR)",
    "Outflow (PKR)",
    "Running Balance (PKR)",
  ]);
  tableHeaders.font = { name: "Calibri", size: 10.5, bold: true, color: { argb: "FFFFFFFF" } };
  tableHeaders.fill = HEADER_FILL;
  tableHeaders.getCell(1).alignment = { horizontal: "center" };
  tableHeaders.getCell(2).alignment = { horizontal: "center" };
  tableHeaders.getCell(3).alignment = { horizontal: "left" };
  tableHeaders.getCell(4).alignment = { horizontal: "center" };
  tableHeaders.getCell(5).alignment = { horizontal: "center" };
  tableHeaders.getCell(6).alignment = { horizontal: "left" };
  tableHeaders.getCell(7).alignment = { horizontal: "right" };
  tableHeaders.getCell(8).alignment = { horizontal: "right" };
  tableHeaders.getCell(9).alignment = { horizontal: "right" };
  tableHeaders.eachCell((c) => (c.border = THIN_BORDER));

  // Beginning balance opening row
  if (data.beginningBalance !== undefined && params?.startDate) {
    const obRow = ws.addRow([
      formatDate(params.startDate),
      "—",
      "Opening Position",
      "OPENING",
      "—",
      "Beginning Cash Balance (Brought Forward)",
      "",
      "",
      data.beginningBalance,
    ]);
    obRow.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF475569" } };
    obRow.fill = SECTION_FILL;
    obRow.getCell(1).alignment = { horizontal: "center" };
    obRow.getCell(4).alignment = { horizontal: "center" };
    obRow.getCell(9).numFmt = "#,##0.00";
    obRow.getCell(9).alignment = { horizontal: "right" };
    obRow.eachCell((c) => (c.border = THIN_BORDER));
  }

  // Detail rows
  for (const item of data.flowDetails) {
    const row = ws.addRow([
      formatDate(item.date),
      item.partyId || "—",
      item.partyName || "Direct Cash",
      item.referenceType,
      item.referenceId,
      item.description,
      item.inflow > 0 ? item.inflow : "",
      item.outflow > 0 ? item.outflow : "",
      item.balance,
    ]);

    row.font = { name: "Calibri", size: 10, color: { argb: "FF334155" } };
    row.getCell(1).alignment = { horizontal: "center" };
    row.getCell(2).alignment = { horizontal: "center" };
    row.getCell(3).alignment = { horizontal: "left" };
    row.getCell(4).alignment = { horizontal: "center" };
    row.getCell(5).alignment = { horizontal: "center" };
    row.getCell(6).alignment = { horizontal: "left" };

    if (item.inflow > 0) {
      row.getCell(7).numFmt = "#,##0.00";
      row.getCell(7).font = { name: "Calibri", size: 10, color: { argb: "FF0F172A" }, bold: true };
    }
    if (item.outflow > 0) {
      row.getCell(8).numFmt = "#,##0.00";
      row.getCell(8).font = { name: "Calibri", size: 10, color: { argb: "FF334155" } };
    }

    row.getCell(7).alignment = { horizontal: "right" };
    row.getCell(8).alignment = { horizontal: "right" };
    row.getCell(9).numFmt = "#,##0.00";
    row.getCell(9).alignment = { horizontal: "right" };
    row.eachCell((c) => (c.border = THIN_BORDER));
  }

  // Total summary closing row
  const totalRow = ws.addRow([
    "TOTAL",
    "",
    "",
    "",
    "",
    "Period Net Summary",
    data.cashInflow,
    data.cashOutflow,
    data.endingBalance,
  ]);
  totalRow.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FF0F172A" } };
  totalRow.fill = TOTAL_FILL;
  totalRow.getCell(1).alignment = { horizontal: "center" };
  totalRow.getCell(7).numFmt = "#,##0.00";
  totalRow.getCell(8).numFmt = "#,##0.00";
  totalRow.getCell(9).numFmt = "#,##0.00";
  totalRow.eachCell((c) => (c.border = DOUBLE_BOTTOM_BORDER));

  autoFitColumns(ws, { 1: 16, 2: 18, 3: 28, 4: 16, 5: 20, 6: 35, 7: 18, 8: 18, 9: 20 });
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
  ws.mergeCells("A1:G1");
  const titleCell = ws.getCell("A1");
  titleCell.value = `PaperTrade - Statement of Account (${data.party.type})`;
  titleCell.font = { name: "Calibri", size: 15, bold: true, color: { argb: "FF0F172A" } };

  ws.mergeCells("A2:G2");
  const partyCell = ws.getCell("A2");
  partyCell.value = `Party: ${data.party.name}  |  Party ID: ${data.party.id}  |  Phone: ${data.party.phone || "—"}  |  Address: ${data.party.address || "—"}`;
  partyCell.font = { name: "Calibri", size: 10.5, color: { argb: "FF334155" } };

  ws.mergeCells("A3:G3");
  const periodCell = ws.getCell("A3");
  periodCell.value = `Statement Period: ${periodText}  |  Generated: ${formatDateTime(new Date())}`;
  periodCell.font = { name: "Calibri", size: 9.5, italic: true, color: { argb: "FF64748B" } };

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

  // Ledger Table Headers with Document No and Reference ID
  const tableHeaders = ws.addRow([
    "Date (dd/mm/yyyy)",
    "Doc Type",
    "Doc Number",
    "Reference ID",
    "Description / Particulars",
    "Debit (PKR)",
    "Credit (PKR)",
    "Running Balance (PKR)",
  ]);
  tableHeaders.font = { name: "Calibri", size: 10.5, bold: true, color: { argb: "FFFFFFFF" } };
  tableHeaders.fill = HEADER_FILL;
  tableHeaders.getCell(1).alignment = { horizontal: "center" };
  tableHeaders.getCell(2).alignment = { horizontal: "center" };
  tableHeaders.getCell(3).alignment = { horizontal: "center" };
  tableHeaders.getCell(4).alignment = { horizontal: "center" };
  tableHeaders.getCell(5).alignment = { horizontal: "left" };
  tableHeaders.getCell(6).alignment = { horizontal: "right" };
  tableHeaders.getCell(7).alignment = { horizontal: "right" };
  tableHeaders.getCell(8).alignment = { horizontal: "right" };
  tableHeaders.eachCell((c) => (c.border = THIN_BORDER));

  // Opening Balance Row
  const obLabel = (data as any).openingBalanceSourceYear
    ? `Opening Balance (Carried forward from FY ${(data as any).openingBalanceSourceYear})`
    : "Opening Balance Brought Forward";

  const obRow = ws.addRow([
    params?.startDate ? formatDate(params.startDate) : "—",
    "OPENING",
    "—",
    "—",
    obLabel,
    data.openingBalance > 0 ? data.openingBalance : "",
    data.openingBalance < 0 ? Math.abs(data.openingBalance) : "",
    data.openingBalance,
  ]);
  obRow.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF475569" } };
  obRow.fill = SECTION_FILL;
  obRow.getCell(1).alignment = { horizontal: "center" };
  obRow.getCell(2).alignment = { horizontal: "center" };
  if (data.openingBalance > 0) obRow.getCell(6).numFmt = "#,##0.00";
  if (data.openingBalance < 0) obRow.getCell(7).numFmt = "#,##0.00";
  obRow.getCell(8).numFmt = "#,##0.00";
  obRow.eachCell((c) => (c.border = THIN_BORDER));

  // Detail Ledger Rows
  for (const row of data.ledgerRows) {
    const isOpening = row.referenceType === "OPENING_BALANCE";
    const desc = isOpening && (row as any).sourceFinancialYear
      ? `Opening Balance (Carried forward from FY ${(row as any).sourceFinancialYear})`
      : row.description;

    const tableRow = ws.addRow([
      formatDate(row.date),
      row.referenceType,
      row.referenceDocNo || "—",
      row.referenceId,
      desc,
      row.debit > 0 ? row.debit : "",
      row.credit > 0 ? row.credit : "",
      row.runningBalance,
    ]);

    tableRow.font = { name: "Calibri", size: 10, color: { argb: "FF334155" } };
    tableRow.getCell(1).alignment = { horizontal: "center" };
    tableRow.getCell(2).alignment = { horizontal: "center" };
    tableRow.getCell(3).alignment = { horizontal: "center" };
    tableRow.getCell(4).alignment = { horizontal: "center" };
    tableRow.getCell(5).alignment = { horizontal: "left" };

    if (row.debit > 0) {
      tableRow.getCell(6).numFmt = "#,##0.00";
      tableRow.getCell(6).font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF0F172A" } };
    }
    if (row.credit > 0) {
      tableRow.getCell(7).numFmt = "#,##0.00";
      tableRow.getCell(7).font = { name: "Calibri", size: 10, color: { argb: "FF334155" } };
    }

    tableRow.getCell(6).alignment = { horizontal: "right" };
    tableRow.getCell(7).alignment = { horizontal: "right" };
    tableRow.getCell(8).numFmt = "#,##0.00";
    tableRow.getCell(8).alignment = { horizontal: "right" };
    tableRow.eachCell((c) => (c.border = THIN_BORDER));
  }

  // Closing Total Row
  const totalRow = ws.addRow([
    "CLOSING",
    "",
    "",
    "",
    "Period Totals & Net Closing Balance",
    data.totalPeriodDebits,
    data.totalPeriodCredits,
    data.closingBalance,
  ]);
  totalRow.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FF0F172A" } };
  totalRow.fill = TOTAL_FILL;
  totalRow.getCell(1).alignment = { horizontal: "center" };
  totalRow.getCell(6).numFmt = "#,##0.00";
  totalRow.getCell(7).numFmt = "#,##0.00";
  totalRow.getCell(8).numFmt = "#,##0.00";
  totalRow.eachCell((c) => (c.border = DOUBLE_BOTTOM_BORDER));

  autoFitColumns(ws, { 1: 16, 2: 16, 3: 18, 4: 20, 5: 38, 6: 18, 7: 18, 8: 20 });

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
    itemHeaders.font = { name: "Calibri", size: 10.5, bold: true, color: { argb: "FFFFFFFF" } };
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

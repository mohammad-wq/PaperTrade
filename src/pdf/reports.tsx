import React from "react";
import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";

// Prevent hyphenation crashes and prevent words/numbers from breaking across lines
Font.registerHyphenationCallback((word) => [word]);

const formatMoney = (val?: number | null) => {
  if (typeof val !== "number" || isNaN(val)) return "0.00";
  return val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 44,
    paddingHorizontal: 36,
    fontSize: 8.5,
    fontFamily: "Helvetica",
    color: "#111827",
    lineHeight: 1.35,
  },
  pageLandscape: {
    paddingTop: 32,
    paddingBottom: 40,
    paddingHorizontal: 32,
    fontSize: 8,
    fontFamily: "Helvetica",
    color: "#111827",
    lineHeight: 1.3,
  },
  // Top Header Block
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 1.5,
    borderBottomColor: "#000000",
    paddingBottom: 10,
    marginBottom: 12,
  },
  brandBox: {
    width: "55%",
  },
  brandName: {
    fontSize: 18,
    fontFamily: "Times-Bold",
    color: "#000000",
    letterSpacing: 0.3,
    marginBottom: 3,
  },
  brandMeta: {
    fontSize: 8,
    fontFamily: "Helvetica",
    color: "#374151",
    marginTop: 1,
    lineHeight: 1.35,
  },
  reportTitleBox: {
    width: "45%",
    alignItems: "flex-end",
  },
  reportTitle: {
    fontSize: 15,
    fontFamily: "Times-Bold",
    color: "#000000",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 3,
  },
  reportSubtitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#1f2937",
    marginTop: 1,
  },
  filterBadge: {
    fontSize: 8,
    fontFamily: "Helvetica",
    color: "#4b5563",
    marginTop: 2,
  },
  // KPI Summary Bar
  summaryGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#000000",
  },
  kpiCard: {
    flex: 1,
    padding: 6,
    borderRightWidth: 1,
    borderRightColor: "#000000",
    backgroundColor: "#ffffff",
  },
  kpiCardLast: {
    flex: 1,
    padding: 6,
    backgroundColor: "#f9fafb",
  },
  kpiLabel: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: "#374151",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  kpiValue: {
    fontSize: 10.5,
    fontFamily: "Helvetica-Bold",
    color: "#000000",
    marginTop: 2,
  },
  // Section Headings
  sectionHeadingBox: {
    marginTop: 10,
    marginBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#374151",
    paddingBottom: 2,
  },
  sectionTitle: {
    fontSize: 10,
    fontFamily: "Times-Bold",
    color: "#000000",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  // Itemized Tables
  table: {
    marginBottom: 12,
    borderTopWidth: 1,
    borderTopColor: "#000000",
    borderBottomWidth: 1,
    borderBottomColor: "#000000",
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    borderBottomWidth: 1,
    borderBottomColor: "#000000",
    paddingVertical: 4.5,
    paddingHorizontal: 4,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e7eb",
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  tableRowAlternate: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e7eb",
    backgroundColor: "#fafafa",
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  tableRowTotal: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#000000",
    borderBottomWidth: 2,
    borderBottomColor: "#000000",
    backgroundColor: "#f9fafb",
    paddingVertical: 4.5,
    paddingHorizontal: 4,
  },
  tableRowSubtotal: {
    flexDirection: "row",
    borderTopWidth: 0.75,
    borderTopColor: "#374151",
    borderBottomWidth: 0.75,
    borderBottomColor: "#374151",
    backgroundColor: "#f9fafb",
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  headerCell: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    color: "#000000",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  cell: {
    fontSize: 8,
    fontFamily: "Helvetica",
    color: "#111827",
  },
  cellBold: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#000000",
  },
  cellMono: {
    fontSize: 7.5,
    fontFamily: "Helvetica",
    color: "#374151",
  },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 36,
    right: 36,
    borderTopWidth: 0.75,
    borderTopColor: "#9ca3af",
    paddingTop: 5,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7.5,
    fontFamily: "Helvetica",
    color: "#6b7280",
  },
});

// 1. Income Statement (Profit & Loss) PDF
export function ProfitLossPdfView({
  companyName = "PAPER TRADE CO.",
  companyAddress = "Wholesale Paper Market, Station Road",
  companyPhone = "+92-300-1234567",
  period = "All Time",
  sales,
  purchases,
  grossProfit,
  expenses,
  netProfit,
  grossSales,
  salesReturns,
  grossPurchases,
  purchaseReturns,
  grossMarginPct,
  netMarginPct,
  expenseBreakdown,
  expenseItems,
  salesBreakdown,
  purchasesBreakdown,
  paperSize = "A4",
}: {
  paperSize?: "A4" | "A5";
  companyName?: string;
  companyAddress?: string;
  companyPhone?: string;
  period?: string;
  sales: number;
  purchases: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
  grossSales?: number;
  salesReturns?: number;
  grossPurchases?: number;
  purchaseReturns?: number;
  grossMarginPct?: number;
  netMarginPct?: number;
  expenseBreakdown?: Array<{ name: string; amount: number }>;
  expenseItems?: Array<{
    date: string;
    partyId: string | null;
    partyName: string | null;
    referenceType: string;
    referenceId: string;
    description: string;
    amount: number;
  }>;
  salesBreakdown?: Array<{
    date: string;
    partyId: string;
    partyName: string;
    referenceType: string;
    referenceId: string;
    description: string;
    amount: number;
  }>;
  purchasesBreakdown?: Array<{
    date: string;
    partyId: string;
    partyName: string;
    referenceType: string;
    referenceId: string;
    description: string;
    amount: number;
  }>;
}) {
  return (
    <Document>
      <Page size={paperSize} style={styles.page}>
        {/* Header Block */}
        <View style={styles.headerRow}>
          <View style={styles.brandBox}>
            <Text style={styles.brandName}>{companyName}</Text>
            <Text style={styles.brandMeta}>{companyAddress}</Text>
            <Text style={styles.brandMeta}>Phone: {companyPhone}</Text>
          </View>
          <View style={styles.reportTitleBox}>
            <Text style={styles.reportTitle}>Income Statement</Text>
            <Text style={styles.reportSubtitle}>Profit & Loss Statement</Text>
            <Text style={styles.filterBadge}>Period: {period}</Text>
          </View>
        </View>

        {/* Executive KPI Summary Bar */}
        <View style={styles.summaryGrid}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Trading Revenue</Text>
            <Text style={styles.kpiValue}>PKR {formatMoney(sales)}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Cost of Goods (COGS)</Text>
            <Text style={styles.kpiValue}>PKR {formatMoney(purchases)}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Gross Profit Margin</Text>
            <Text style={styles.kpiValue}>PKR {formatMoney(grossProfit)}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Operating Expenses</Text>
            <Text style={styles.kpiValue}>PKR {formatMoney(expenses)}</Text>
          </View>
          <View style={styles.kpiCardLast}>
            <Text style={styles.kpiLabel}>{netProfit >= 0 ? "Net Profit" : "Net Loss"}</Text>
            <Text style={styles.kpiValue}>PKR {formatMoney(netProfit)}</Text>
          </View>
        </View>

        {/* Statement Summary Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[{ width: "70%" }, styles.headerCell]}>Accounting Particulars</Text>
            <Text style={[{ width: "30%", textAlign: "right" }, styles.headerCell]}>Amount (PKR)</Text>
          </View>

          {/* Revenue */}
          <View style={styles.tableRow}>
            <Text style={[{ width: "70%" }, styles.cellBold]}>1. Trading Sales Revenue</Text>
            <Text style={[{ width: "30%", textAlign: "right" }, styles.cellBold]}>
              {formatMoney(grossSales ?? sales)}
            </Text>
          </View>
          {salesReturns !== undefined && salesReturns > 0 ? (
            <View style={styles.tableRowAlternate}>
              <Text style={[{ width: "70%", paddingLeft: 10 }, styles.cell]}>
                Less: Sales Returns & Credit Allowances
              </Text>
              <Text style={[{ width: "30%", textAlign: "right" }, styles.cell]}>
                ({formatMoney(salesReturns)})
              </Text>
            </View>
          ) : null}
          <View style={styles.tableRowSubtotal}>
            <Text style={[{ width: "70%", paddingLeft: 10 }, styles.cellBold]}>Net Operating Sales</Text>
            <Text style={[{ width: "30%", textAlign: "right" }, styles.cellBold]}>{formatMoney(sales)}</Text>
          </View>

          {/* Cost of Goods */}
          <View style={styles.tableRow}>
            <Text style={[{ width: "70%" }, styles.cellBold]}>2. Cost of Goods Sold (Purchases)</Text>
            <Text style={[{ width: "30%", textAlign: "right" }, styles.cellBold]}>
              ({formatMoney(grossPurchases ?? purchases)})
            </Text>
          </View>
          {purchaseReturns !== undefined && purchaseReturns > 0 ? (
            <View style={styles.tableRowAlternate}>
              <Text style={[{ width: "70%", paddingLeft: 10 }, styles.cell]}>
                Less: Purchase Returns & Mill Debit Notes
              </Text>
              <Text style={[{ width: "30%", textAlign: "right" }, styles.cell]}>
                + {formatMoney(purchaseReturns)}
              </Text>
            </View>
          ) : null}
          <View style={styles.tableRowSubtotal}>
            <Text style={[{ width: "70%", paddingLeft: 10 }, styles.cellBold]}>Net Cost of Goods Sold (COGS)</Text>
            <Text style={[{ width: "30%", textAlign: "right" }, styles.cellBold]}>({formatMoney(purchases)})</Text>
          </View>

          {/* Gross Margin */}
          <View style={[styles.tableRow, { backgroundColor: "#f9fafb" }]}>
            <Text style={[{ width: "70%" }, styles.cellBold]}>
              GROSS TRADING PROFIT {grossMarginPct !== undefined ? `(${grossMarginPct.toFixed(1)}% Margin)` : ""}
            </Text>
            <Text style={[{ width: "30%", textAlign: "right" }, styles.cellBold]}>{formatMoney(grossProfit)}</Text>
          </View>

          {/* Operating Expenses */}
          <View style={styles.tableRow}>
            <Text style={[{ width: "70%" }, styles.cellBold]}>3. Operating & Storage Expenses</Text>
            <Text style={[{ width: "30%", textAlign: "right" }, styles.cellBold]}>({formatMoney(expenses)})</Text>
          </View>
          {expenseBreakdown && expenseBreakdown.length > 0
            ? expenseBreakdown.map((exp, idx) => (
                <View key={idx} style={styles.tableRowAlternate}>
                  <Text style={[{ width: "70%", paddingLeft: 10 }, styles.cell]}>Less: {exp.name}</Text>
                  <Text style={[{ width: "30%", textAlign: "right" }, styles.cell]}>({formatMoney(exp.amount)})</Text>
                </View>
              ))
            : null}

          {/* Net Profit */}
          <View style={styles.tableRowTotal}>
            <Text style={[{ width: "70%" }, styles.cellBold]}>
              NET OPERATING {netProfit >= 0 ? "PROFIT" : "LOSS"} {netMarginPct !== undefined ? `(${netMarginPct.toFixed(1)}% Net Margin)` : ""}
            </Text>
            <Text style={[{ width: "30%", textAlign: "right" }, styles.cellBold]}>{formatMoney(netProfit)}</Text>
          </View>
        </View>

        {/* Sales Breakdown Schedule */}
        {salesBreakdown && salesBreakdown.length > 0 && (
          <View wrap={false}>
            <View style={styles.sectionHeadingBox}>
              <Text style={styles.sectionTitle}>Sales Audit Schedule (Party ID & Transaction References)</Text>
            </View>
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={[{ width: "12%" }, styles.headerCell]}>Date</Text>
                <Text style={[{ width: "16%" }, styles.headerCell]}>Party ID</Text>
                <Text style={[{ width: "26%" }, styles.headerCell]}>Customer Name</Text>
                <Text style={[{ width: "22%" }, styles.headerCell]}>Ref (Type & ID)</Text>
                <Text style={[{ width: "24%", textAlign: "right" }, styles.headerCell]}>Amount (PKR)</Text>
              </View>
              {salesBreakdown.slice(0, 25).map((row, idx) => (
                <View key={idx} style={idx % 2 === 1 ? styles.tableRowAlternate : styles.tableRow}>
                  <Text style={[{ width: "12%" }, styles.cell]}>{row.date}</Text>
                  <Text style={[{ width: "16%" }, styles.cellMono]}>{row.partyId}</Text>
                  <Text style={[{ width: "26%" }, styles.cellBold]}>{row.partyName}</Text>
                  <Text style={[{ width: "22%" }, styles.cellMono]}>{row.referenceType}: {row.referenceId}</Text>
                  <Text style={[{ width: "24%", textAlign: "right" }, styles.cellBold]}>{formatMoney(row.amount)}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Purchases Breakdown Schedule */}
        {purchasesBreakdown && purchasesBreakdown.length > 0 && (
          <View wrap={false}>
            <View style={styles.sectionHeadingBox}>
              <Text style={styles.sectionTitle}>Purchases Audit Schedule (Party ID & Transaction References)</Text>
            </View>
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={[{ width: "12%" }, styles.headerCell]}>Date</Text>
                <Text style={[{ width: "16%" }, styles.headerCell]}>Party ID</Text>
                <Text style={[{ width: "26%" }, styles.headerCell]}>Supplier / Mill</Text>
                <Text style={[{ width: "22%" }, styles.headerCell]}>Ref (Type & ID)</Text>
                <Text style={[{ width: "24%", textAlign: "right" }, styles.headerCell]}>Amount (PKR)</Text>
              </View>
              {purchasesBreakdown.slice(0, 25).map((row, idx) => (
                <View key={idx} style={idx % 2 === 1 ? styles.tableRowAlternate : styles.tableRow}>
                  <Text style={[{ width: "12%" }, styles.cell]}>{row.date}</Text>
                  <Text style={[{ width: "16%" }, styles.cellMono]}>{row.partyId}</Text>
                  <Text style={[{ width: "26%" }, styles.cellBold]}>{row.partyName}</Text>
                  <Text style={[{ width: "22%" }, styles.cellMono]}>{row.referenceType}: {row.referenceId}</Text>
                  <Text style={[{ width: "24%", textAlign: "right" }, styles.cellBold]}>{formatMoney(row.amount)}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Operating Expenses Schedule */}
        {expenseItems && expenseItems.length > 0 && (
          <View wrap={false}>
            <View style={styles.sectionHeadingBox}>
              <Text style={styles.sectionTitle}>Operating Expenses Audit Schedule</Text>
            </View>
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={[{ width: "12%" }, styles.headerCell]}>Date</Text>
                <Text style={[{ width: "16%" }, styles.headerCell]}>Party ID</Text>
                <Text style={[{ width: "26%" }, styles.headerCell]}>Payee / Party</Text>
                <Text style={[{ width: "22%" }, styles.headerCell]}>Ref & Description</Text>
                <Text style={[{ width: "24%", textAlign: "right" }, styles.headerCell]}>Amount (PKR)</Text>
              </View>
              {expenseItems.slice(0, 25).map((row, idx) => (
                <View key={idx} style={idx % 2 === 1 ? styles.tableRowAlternate : styles.tableRow}>
                  <Text style={[{ width: "12%" }, styles.cell]}>{row.date}</Text>
                  <Text style={[{ width: "16%" }, styles.cellMono]}>{row.partyId || "—"}</Text>
                  <Text style={[{ width: "26%" }, styles.cellBold]}>{row.partyName || "Internal Expense"}</Text>
                  <Text style={[{ width: "22%" }, styles.cellMono]}>{row.description}</Text>
                  <Text style={[{ width: "24%", textAlign: "right" }, styles.cellBold]}>{formatMoney(row.amount)}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={styles.footer} fixed>
          <Text>{companyName} — Certified Financial Statement</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

// 2. Balance Sheet (Statement of Financial Position) PDF
export function BalanceSheetPdfView({
  companyName = "PAPER TRADE CO.",
  companyAddress = "Wholesale Paper Market, Station Road",
  companyPhone = "+92-300-1234567",
  asOfDate,
  assets,
  liabilities,
  equity,
  receivablesSchedule = [],
  payablesSchedule = [],
  paperSize = "A4",
}: {
  paperSize?: "A4" | "A5";
  companyName?: string;
  companyAddress?: string;
  companyPhone?: string;
  asOfDate: string;
  assets: {
    cash: number;
    receivables: number;
    inventory: number;
    totalAssets: number;
  };
  liabilities: {
    payables: number;
    totalLiabilities: number;
  };
  equity: number;
  receivablesSchedule?: Array<{
    partyId: string;
    partyName: string;
    phone: string | null;
    balance: number;
    referenceType: string;
    referenceId: string;
  }>;
  payablesSchedule?: Array<{
    partyId: string;
    partyName: string;
    phone: string | null;
    balance: number;
    referenceType: string;
    referenceId: string;
  }>;
}) {
  return (
    <Document>
      <Page size={paperSize} style={styles.page}>
        {/* Header Block */}
        <View style={styles.headerRow}>
          <View style={styles.brandBox}>
            <Text style={styles.brandName}>{companyName}</Text>
            <Text style={styles.brandMeta}>{companyAddress}</Text>
            <Text style={styles.brandMeta}>Phone: {companyPhone}</Text>
          </View>
          <View style={styles.reportTitleBox}>
            <Text style={styles.reportTitle}>Balance Sheet</Text>
            <Text style={styles.reportSubtitle}>Statement of Financial Position</Text>
            <Text style={styles.filterBadge}>As of: {asOfDate}</Text>
          </View>
        </View>

        {/* Top Summary Bar */}
        <View style={styles.summaryGrid}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Total Current Assets</Text>
            <Text style={styles.kpiValue}>PKR {formatMoney(assets.totalAssets)}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Total Liabilities</Text>
            <Text style={styles.kpiValue}>PKR {formatMoney(liabilities.totalLiabilities)}</Text>
          </View>
          <View style={styles.kpiCardLast}>
            <Text style={styles.kpiLabel}>Owner&apos;s Equity & Net Worth</Text>
            <Text style={styles.kpiValue}>PKR {formatMoney(equity)}</Text>
          </View>
        </View>

        {/* Assets Section */}
        <View style={styles.sectionHeadingBox}>
          <Text style={styles.sectionTitle}>1. Current Assets</Text>
        </View>
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[{ width: "70%" }, styles.headerCell]}>Asset Category</Text>
            <Text style={[{ width: "30%", textAlign: "right" }, styles.headerCell]}>Valuation (PKR)</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={[{ width: "70%" }, styles.cell]}>Cash in Hand & Bank Balances (Liquid Funds)</Text>
            <Text style={[{ width: "30%", textAlign: "right" }, styles.cell]}>{formatMoney(assets.cash)}</Text>
          </View>
          <View style={styles.tableRowAlternate}>
            <Text style={[{ width: "70%" }, styles.cell]}>Accounts Receivable (Customer Outstandings)</Text>
            <Text style={[{ width: "30%", textAlign: "right" }, styles.cell]}>{formatMoney(assets.receivables)}</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={[{ width: "70%" }, styles.cell]}>Physical Paper Inventory (At Cost Valuation)</Text>
            <Text style={[{ width: "30%", textAlign: "right" }, styles.cell]}>{formatMoney(assets.inventory)}</Text>
          </View>
          <View style={styles.tableRowTotal}>
            <Text style={[{ width: "70%" }, styles.cellBold]}>TOTAL CURRENT ASSETS</Text>
            <Text style={[{ width: "30%", textAlign: "right" }, styles.cellBold]}>{formatMoney(assets.totalAssets)}</Text>
          </View>
        </View>

        {/* Liabilities & Equity Section */}
        <View style={styles.sectionHeadingBox}>
          <Text style={styles.sectionTitle}>2. Liabilities & Equity</Text>
        </View>
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[{ width: "70%" }, styles.headerCell]}>Liabilities & Capital</Text>
            <Text style={[{ width: "30%", textAlign: "right" }, styles.headerCell]}>Amount (PKR)</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={[{ width: "70%" }, styles.cell]}>Accounts Payable (Paper Mills / Trade Suppliers)</Text>
            <Text style={[{ width: "30%", textAlign: "right" }, styles.cell]}>{formatMoney(liabilities.payables)}</Text>
          </View>
          <View style={styles.tableRowSubtotal}>
            <Text style={[{ width: "70%" }, styles.cellBold]}>TOTAL CURRENT LIABILITIES</Text>
            <Text style={[{ width: "30%", textAlign: "right" }, styles.cellBold]}>{formatMoney(liabilities.totalLiabilities)}</Text>
          </View>
          <View style={styles.tableRowAlternate}>
            <Text style={[{ width: "70%" }, styles.cell]}>Owner&apos;s Capital & Cumulative Retained Earnings</Text>
            <Text style={[{ width: "30%", textAlign: "right" }, styles.cell]}>{formatMoney(equity)}</Text>
          </View>
          <View style={styles.tableRowTotal}>
            <Text style={[{ width: "70%" }, styles.cellBold]}>TOTAL LIABILITIES & NET EQUITY</Text>
            <Text style={[{ width: "30%", textAlign: "right" }, styles.cellBold]}>
              {formatMoney(liabilities.totalLiabilities + equity)}
            </Text>
          </View>
        </View>

        {/* Receivables Schedule */}
        {receivablesSchedule && receivablesSchedule.length > 0 && (
          <View wrap={false}>
            <View style={styles.sectionHeadingBox}>
              <Text style={styles.sectionTitle}>Schedule of Accounts Receivable (Customers with Party ID & Ref)</Text>
            </View>
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={[{ width: "18%" }, styles.headerCell]}>Party ID</Text>
                <Text style={[{ width: "34%" }, styles.headerCell]}>Customer Name</Text>
                <Text style={[{ width: "24%" }, styles.headerCell]}>Latest Ref ID</Text>
                <Text style={[{ width: "24%", textAlign: "right" }, styles.headerCell]}>Balance Dr (PKR)</Text>
              </View>
              {receivablesSchedule.slice(0, 30).map((row, idx) => (
                <View key={idx} style={idx % 2 === 1 ? styles.tableRowAlternate : styles.tableRow}>
                  <Text style={[{ width: "18%" }, styles.cellMono]}>{row.partyId}</Text>
                  <Text style={[{ width: "34%" }, styles.cellBold]}>{row.partyName}</Text>
                  <Text style={[{ width: "24%" }, styles.cellMono]}>{row.referenceType}: {row.referenceId}</Text>
                  <Text style={[{ width: "24%", textAlign: "right" }, styles.cellBold]}>{formatMoney(row.balance)}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Payables Schedule */}
        {payablesSchedule && payablesSchedule.length > 0 && (
          <View wrap={false}>
            <View style={styles.sectionHeadingBox}>
              <Text style={styles.sectionTitle}>Schedule of Accounts Payable (Suppliers with Party ID & Ref)</Text>
            </View>
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={[{ width: "18%" }, styles.headerCell]}>Party ID</Text>
                <Text style={[{ width: "34%" }, styles.headerCell]}>Supplier Name</Text>
                <Text style={[{ width: "24%" }, styles.headerCell]}>Latest Ref ID</Text>
                <Text style={[{ width: "24%", textAlign: "right" }, styles.headerCell]}>Balance Cr (PKR)</Text>
              </View>
              {payablesSchedule.slice(0, 30).map((row, idx) => (
                <View key={idx} style={idx % 2 === 1 ? styles.tableRowAlternate : styles.tableRow}>
                  <Text style={[{ width: "18%" }, styles.cellMono]}>{row.partyId}</Text>
                  <Text style={[{ width: "34%" }, styles.cellBold]}>{row.partyName}</Text>
                  <Text style={[{ width: "24%" }, styles.cellMono]}>{row.referenceType}: {row.referenceId}</Text>
                  <Text style={[{ width: "24%", textAlign: "right" }, styles.cellBold]}>{formatMoney(row.balance)}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={styles.footer} fixed>
          <Text>{companyName} — Certified Statement of Financial Position</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

// 3. Statement of Cash Flows PDF
export function CashFlowPdfView({
  companyName = "PAPER TRADE CO.",
  companyAddress = "Wholesale Paper Market, Station Road",
  companyPhone = "+92-300-1234567",
  period = "All Time",
  cashInflow,
  cashOutflow,
  netCashFlow,
  startingBalance = 0,
  endingBalance,
  flowDetails,
  paperSize = "A4",
}: {
  paperSize?: "A4" | "A5";
  companyName?: string;
  companyAddress?: string;
  companyPhone?: string;
  period?: string;
  cashInflow: number;
  cashOutflow: number;
  netCashFlow: number;
  startingBalance?: number;
  endingBalance: number;
  flowDetails: Array<{
    date: string;
    partyId?: string | null;
    partyName?: string | null;
    description: string;
    referenceType: string;
    referenceId?: string;
    inflow: number;
    outflow: number;
    balance: number;
  }>;
}) {
  return (
    <Document>
      <Page size={paperSize} style={styles.page}>
        {/* Header Block */}
        <View style={styles.headerRow}>
          <View style={styles.brandBox}>
            <Text style={styles.brandName}>{companyName}</Text>
            <Text style={styles.brandMeta}>{companyAddress}</Text>
            <Text style={styles.brandMeta}>Phone: {companyPhone}</Text>
          </View>
          <View style={styles.reportTitleBox}>
            <Text style={styles.reportTitle}>Statement of Cash Flows</Text>
            <Text style={styles.reportSubtitle}>Cash & Bank Transactions</Text>
            <Text style={styles.filterBadge}>Period: {period}</Text>
          </View>
        </View>

        {/* Summary Bar */}
        <View style={styles.summaryGrid}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Beginning Balance (b/f)</Text>
            <Text style={styles.kpiValue}>PKR {formatMoney(startingBalance)}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Total Cash Inflow</Text>
            <Text style={styles.kpiValue}>+ {formatMoney(cashInflow)}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Total Cash Outflow</Text>
            <Text style={styles.kpiValue}>- {formatMoney(cashOutflow)}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Net Operational Flow</Text>
            <Text style={styles.kpiValue}>{formatMoney(netCashFlow)}</Text>
          </View>
          <View style={styles.kpiCardLast}>
            <Text style={styles.kpiLabel}>Ending Cash Position</Text>
            <Text style={styles.kpiValue}>PKR {formatMoney(endingBalance)}</Text>
          </View>
        </View>

        {/* Cash Flow Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[{ width: "11%" }, styles.headerCell]}>Date</Text>
            <Text style={[{ width: "23%" }, styles.headerCell]}>Party (Name & ID)</Text>
            <Text style={[{ width: "18%" }, styles.headerCell]}>Ref (Type & ID)</Text>
            <Text style={[{ width: "20%" }, styles.headerCell]}>Description</Text>
            <Text style={[{ width: "9%", textAlign: "right" }, styles.headerCell]}>Inflow</Text>
            <Text style={[{ width: "9%", textAlign: "right" }, styles.headerCell]}>Outflow</Text>
            <Text style={[{ width: "10%", textAlign: "right" }, styles.headerCell]}>Balance</Text>
          </View>

          {flowDetails.length === 0 ? (
            <View style={styles.tableRow}>
              <Text style={[{ width: "100%", textAlign: "center", color: "#6b7280" }, styles.cell]}>
                No cash transactions logged in this period.
              </Text>
            </View>
          ) : (
            flowDetails.slice(0, 45).map((row, idx) => (
              <View key={idx} style={idx % 2 === 1 ? styles.tableRowAlternate : styles.tableRow}>
                <Text style={[{ width: "11%" }, styles.cell]}>{row.date}</Text>
                <Text style={[{ width: "23%" }, styles.cellBold]}>
                  {row.partyName ? `${row.partyName}${row.partyId ? ` (${row.partyId.slice(-6)})` : ""}` : "Direct Cash"}
                </Text>
                <Text style={[{ width: "18%" }, styles.cellMono]}>
                  {row.referenceType}{row.referenceId ? `: ${row.referenceId}` : ""}
                </Text>
                <Text style={[{ width: "20%" }, styles.cell]}>{row.description}</Text>
                <Text style={[{ width: "9%", textAlign: "right" }, styles.cell]}>
                  {row.inflow > 0 ? formatMoney(row.inflow) : "—"}
                </Text>
                <Text style={[{ width: "9%", textAlign: "right" }, styles.cell]}>
                  {row.outflow > 0 ? formatMoney(row.outflow) : "—"}
                </Text>
                <Text style={[{ width: "10%", textAlign: "right" }, styles.cellBold]}>
                  {formatMoney(row.balance)}
                </Text>
              </View>
            ))
          )}

          {/* Totals Row */}
          <View style={styles.tableRowTotal}>
            <Text style={[{ width: "52%" }, styles.cellBold]}>Period Summary & Ending Position</Text>
            <Text style={[{ width: "20%" }, styles.cellMono]}></Text>
            <Text style={[{ width: "9%", textAlign: "right" }, styles.cellBold]}>{formatMoney(cashInflow)}</Text>
            <Text style={[{ width: "9%", textAlign: "right" }, styles.cellBold]}>{formatMoney(cashOutflow)}</Text>
            <Text style={[{ width: "10%", textAlign: "right" }, styles.cellBold]}>{formatMoney(endingBalance)}</Text>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text>{companyName} — Certified Cash Flow Statement</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

// 4. General Ledger PDF
export function GeneralLedgerPdfView({
  companyName = "PAPER TRADE CO.",
  companyAddress = "Wholesale Paper Market, Station Road",
  companyPhone = "+92-300-1234567",
  period = "All Time",
  filterInfo,
  openingBalance = 0,
  totalDebit = 0,
  totalCredit = 0,
  closingBalance,
  entries,
}: {
  companyName?: string;
  companyAddress?: string;
  companyPhone?: string;
  period?: string;
  filterInfo?: string;
  openingBalance?: number;
  totalDebit?: number;
  totalCredit?: number;
  closingBalance?: number;
  entries: Array<{
    date: string;
    accountType: string;
    partyName?: string | null;
    referenceType: string;
    referenceId: string;
    voucherType?: string;
    docNo?: string;
    description: string;
    debit: number;
    credit: number;
    runningBalance: number;
  }>;
}) {
  const safeOpeningBalance = Number(openingBalance) || 0;
  const safeTotalDebit = Number(totalDebit) || 0;
  const safeTotalCredit = Number(totalCredit) || 0;
  const safeClosingBalance = typeof closingBalance === "number" ? closingBalance : safeOpeningBalance + safeTotalDebit - safeTotalCredit;

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.pageLandscape}>
        <View style={styles.headerRow}>
          <View style={styles.brandBox}>
            <Text style={styles.brandName}>{companyName}</Text>
            <Text style={styles.brandMeta}>{companyAddress}</Text>
            <Text style={styles.brandMeta}>Phone: {companyPhone}</Text>
          </View>
          <View style={styles.reportTitleBox}>
            <Text style={styles.reportTitle}>General Ledger</Text>
            <Text style={styles.reportSubtitle}>Period: {period}</Text>
            {filterInfo && <Text style={styles.filterBadge}>Filters: {filterInfo}</Text>}
          </View>
        </View>

        <View style={styles.summaryGrid}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Opening Balance (b/f)</Text>
            <Text style={styles.kpiValue}>PKR {formatMoney(Math.abs(safeOpeningBalance))} {safeOpeningBalance >= 0 ? "Dr" : "Cr"}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Total Debits (Dr)</Text>
            <Text style={styles.kpiValue}>PKR {formatMoney(safeTotalDebit)}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Total Credits (Cr)</Text>
            <Text style={styles.kpiValue}>PKR {formatMoney(safeTotalCredit)}</Text>
          </View>
          <View style={styles.kpiCardLast}>
            <Text style={styles.kpiLabel}>Closing Balance</Text>
            <Text style={styles.kpiValue}>PKR {formatMoney(Math.abs(safeClosingBalance))} {safeClosingBalance >= 0 ? "Dr" : "Cr"}</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[{ width: "12%" }, styles.headerCell]}>Date</Text>
            <Text style={[{ width: "18%" }, styles.headerCell]}>Account</Text>
            <Text style={[{ width: "18%" }, styles.headerCell]}>Particulars</Text>
            <Text style={[{ width: "18%" }, styles.headerCell]}>Voucher</Text>
            <Text style={[{ width: "12%", textAlign: "right" }, styles.headerCell]}>Debit</Text>
            <Text style={[{ width: "12%", textAlign: "right" }, styles.headerCell]}>Credit</Text>
            <Text style={[{ width: "10%", textAlign: "right" }, styles.headerCell]}>Balance</Text>
          </View>

          {entries.length === 0 ? (
            <View style={styles.tableRow}>
              <Text style={[{ width: "100%", textAlign: "center", color: "#6b7280" }, styles.cell]}>No general ledger records found matching the applied criteria.</Text>
            </View>
          ) : (
            entries.map((row, idx) => (
              <View key={idx} style={idx % 2 === 1 ? styles.tableRowAlternate : styles.tableRow}>
                <Text style={[{ width: "12%" }, styles.cell]}>{row.date}</Text>
                <Text style={[{ width: "18%" }, styles.cellBold]}>{row.partyName || row.accountType || "—"}</Text>
                <Text style={[{ width: "18%" }, styles.cell]}>{row.description || "—"}</Text>
                <Text style={[{ width: "18%" }, styles.cellMono]}>{row.voucherType || row.referenceType}: {row.docNo || row.referenceId}</Text>
                <Text style={[{ width: "12%", textAlign: "right" }, styles.cell]}>{row.debit > 0 ? formatMoney(row.debit) : "—"}</Text>
                <Text style={[{ width: "12%", textAlign: "right" }, styles.cell]}>{row.credit > 0 ? formatMoney(row.credit) : "—"}</Text>
                <Text style={[{ width: "10%", textAlign: "right" }, styles.cellBold]}>{formatMoney(Math.abs(row.runningBalance))} {row.runningBalance >= 0 ? "Dr" : "Cr"}</Text>
              </View>
            ))
          )}

          <View style={styles.tableRowTotal}>
            <Text style={[{ width: "66%" }, styles.cellBold]}>Period Total Activity & Net Position</Text>
            <Text style={[{ width: "12%", textAlign: "right" }, styles.cellBold]}>{formatMoney(safeTotalDebit)}</Text>
            <Text style={[{ width: "12%", textAlign: "right" }, styles.cellBold]}>{formatMoney(safeTotalCredit)}</Text>
            <Text style={[{ width: "10%", textAlign: "right" }, styles.cellBold]}>{formatMoney(Math.abs(safeClosingBalance))} {safeClosingBalance >= 0 ? "Dr" : "Cr"}</Text>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text>{companyName} — General Ledger Audit Report</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

// 4. Statement of Account (Party Ledger) PDF
export function PartyStatementPdfView({
  companyName = "PAPER TRADE CO.",
  companyAddress = "Wholesale Paper Market, Station Road",
  companyPhone = "+92-300-1234567",
  party,
  currentBalance,
  openingBalance = 0,
  openingBalanceSourceYear,
  startDate,
  endDate,
  ledgerRows,
}: {
  companyName?: string;
  companyAddress?: string;
  companyPhone?: string;
  party: {
    id?: string;
    name: string;
    type: string;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    creditLimit?: number | null;
  };
  currentBalance: number;
  openingBalance?: number;
  openingBalanceSourceYear?: string | null;
  startDate?: string;
  endDate?: string;
  ledgerRows: Array<{
    date: string;
    partyId?: string;
    partyName?: string;
    description: string;
    referenceType: string;
    referenceId: string;
    referenceDocNo?: string | null;
    sourceFinancialYear?: string | null;
    debit: number;
    credit: number;
    runningBalance: number;
    detailRows?: Array<{
      productName: string;
      quantity: number;
      unit: string;
      rate: number;
      amount: number;
    }>;
  }>;
}) {
  const safeOpeningBalance = typeof openingBalance === "number" && !isNaN(openingBalance) ? openingBalance : 0;
  const safeCurrentBalance = typeof currentBalance === "number" && !isNaN(currentBalance) ? currentBalance : 0;
  const rows = Array.isArray(ledgerRows) ? ledgerRows : [];
  const totalDebits = rows.reduce((sum, r) => sum + (Number(r.debit) || 0), 0);
  const totalCredits = rows.reduce((sum, r) => sum + (Number(r.credit) || 0), 0);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View fixed style={{ top: 18, left: 36, right: 36, zIndex: 10 }}>
          <Text style={{ fontSize: 8, fontFamily: "Helvetica-Bold", color: "#374151", marginBottom: 2 }}>
            Ledger For The Period From {startDate || "Start"} To {endDate || "Present"}
          </Text>
          <Text style={{ fontSize: 7.5, fontFamily: "Helvetica", color: "#6b7280" }}>
            Opening Balance B/F: {formatMoney(Math.abs(safeOpeningBalance))} {safeOpeningBalance >= 0 ? "Debit" : "Credit"}
          </Text>
        </View>

        <View style={styles.headerRow}>
          <View style={styles.brandBox}>
            <Text style={styles.brandName}>{companyName}</Text>
            <Text style={styles.brandMeta}>{companyAddress}</Text>
            <Text style={styles.brandMeta}>Phone: {companyPhone}</Text>
          </View>
          <View style={styles.reportTitleBox}>
            <Text style={styles.reportTitle}>Party Statement</Text>
            <Text style={styles.reportSubtitle}>{party.name}</Text>
            <Text style={styles.filterBadge}>Party ID: {party.id || "—"}</Text>
          </View>
        </View>

        <View style={styles.summaryGrid}>
          <View style={[styles.kpiCard, { flex: 2 }]}> 
            <Text style={styles.kpiLabel}>Account Information</Text>
            <Text style={[styles.cellBold, { marginTop: 2 }]}>{party.name} ({party.type})</Text>
            <Text style={styles.cell}>Address: {party.address || "On file"} | Phone: {party.phone || "—"}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Opening Balance</Text>
            <Text style={styles.kpiValue}>{formatMoney(Math.abs(safeOpeningBalance))} {safeOpeningBalance >= 0 ? "Debit" : "Credit"}</Text>
          </View>
          <View style={styles.kpiCardLast}>
            <Text style={styles.kpiLabel}>Closing Balance</Text>
            <Text style={styles.kpiValue}>{formatMoney(Math.abs(safeCurrentBalance))} {safeCurrentBalance >= 0 ? "Debit" : "Credit"}</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeader} fixed>
            <Text style={[{ width: "12%" }, styles.headerCell]}>Date</Text>
            <Text style={[{ width: "13%" }, styles.headerCell]}>Tran. No.</Text>
            <Text style={[{ width: "35%" }, styles.headerCell]}>Description</Text>
            <Text style={[{ width: "11%", textAlign: "right" }, styles.headerCell]}>Credit</Text>
            <Text style={[{ width: "11%", textAlign: "right" }, styles.headerCell]}>Debit</Text>
            <Text style={[{ width: "18%", textAlign: "right" }, styles.headerCell]}>Balance</Text>
          </View>

          <View style={[styles.tableRow, { backgroundColor: "#fff7ed" }]}>
            <Text style={[{ width: "12%" }, styles.cellBold]}>{startDate || "—"}</Text>
            <Text style={[{ width: "13%" }, styles.cellBold]}>B/F</Text>
            <Text style={[{ width: "35%" }, styles.cellBold]}>Balance Brought Forward</Text>
            <Text style={[{ width: "11%", textAlign: "right" }, styles.cell]}>
              {safeOpeningBalance < 0 ? formatMoney(Math.abs(safeOpeningBalance)) : "—"}
            </Text>
            <Text style={[{ width: "11%", textAlign: "right" }, styles.cell]}>
              {safeOpeningBalance >= 0 ? formatMoney(Math.abs(safeOpeningBalance)) : "—"}
            </Text>
            <Text style={[{ width: "18%", textAlign: "right" }, styles.cellBold]}>
              {formatMoney(Math.abs(safeOpeningBalance))} {safeOpeningBalance >= 0 ? "Debit" : "Credit"}
            </Text>
          </View>

          {rows.length === 0 ? (
            <View style={styles.tableRow}>
              <Text style={[{ width: "100%", textAlign: "center", color: "#6b7280" }, styles.cell]}>
                No transaction records found for this account period.
              </Text>
            </View>
          ) : (
            rows.map((row, idx) => (
              <View key={idx} style={idx % 2 === 1 ? styles.tableRowAlternate : styles.tableRow}>
                <Text style={[{ width: "12%" }, styles.cell]}>{row.date}</Text>
                <Text style={[{ width: "13%" }, styles.cellBold]}>{row.referenceDocNo || row.referenceType || "—"}</Text>
                <View style={[{ width: "35%" }, { paddingRight: 4 }]}> 
                  <Text style={styles.cellBold}>{row.description}</Text>
                  {Array.isArray(row.detailRows) && row.detailRows.length > 0 && (
                    <View style={{ marginTop: 3, marginBottom: 2, paddingLeft: 4, borderLeftWidth: 1, borderLeftColor: "#cbd5e1" }}>
                      <View style={{ flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#cbd5e1", paddingBottom: 1, marginBottom: 1 }}>
                        <Text style={[{ width: "44%", fontSize: 6.5, fontFamily: "Helvetica-Bold", color: "#475569" }]}>Item Description</Text>
                        <Text style={[{ width: "20%", textAlign: "right", fontSize: 6.5, fontFamily: "Helvetica-Bold", color: "#475569" }]}>Qty</Text>
                        <Text style={[{ width: "18%", textAlign: "right", fontSize: 6.5, fontFamily: "Helvetica-Bold", color: "#475569" }]}>Rate</Text>
                        <Text style={[{ width: "18%", textAlign: "right", fontSize: 6.5, fontFamily: "Helvetica-Bold", color: "#475569" }]}>Amount</Text>
                      </View>
                      {row.detailRows.map((item, itemIndex) => (
                        <View key={`${idx}-${itemIndex}`} style={{ flexDirection: "row", paddingVertical: 0.8 }}>
                          <Text style={[{ width: "44%", fontSize: 6.5, fontFamily: "Helvetica", color: "#1e293b" }]}>{item.productName}</Text>
                          <Text style={[{ width: "20%", textAlign: "right", fontSize: 6.5, fontFamily: "Helvetica", color: "#1e293b" }]}>{item.quantity} {item.unit}</Text>
                          <Text style={[{ width: "18%", textAlign: "right", fontSize: 6.5, fontFamily: "Helvetica", color: "#1e293b" }]}>{formatMoney(item.rate)}</Text>
                          <Text style={[{ width: "18%", textAlign: "right", fontSize: 6.5, fontFamily: "Helvetica-Bold", color: "#0f172a" }]}>{formatMoney(item.amount)}</Text>
                        </View>
                      ))}
                      <View style={{ flexDirection: "row", borderTopWidth: 0.5, borderTopColor: "#cbd5e1", paddingTop: 1, marginTop: 1, justifyContent: "space-between" }}>
                        <Text style={{ fontSize: 6.5, fontFamily: "Helvetica-Bold", color: "#334155" }}>Total Bill Amount:</Text>
                        <Text style={{ fontSize: 6.5, fontFamily: "Helvetica-Bold", color: "#0f172a" }}>PKR {formatMoney(row.debit || row.credit)}</Text>
                      </View>
                    </View>
                  )}
                </View>
                <Text style={[{ width: "11%", textAlign: "right" }, styles.cell]}>
                  {row.credit > 0 ? formatMoney(row.credit) : "—"}
                </Text>
                <Text style={[{ width: "11%", textAlign: "right" }, styles.cell]}>
                  {row.debit > 0 ? formatMoney(row.debit) : "—"}
                </Text>
                <Text style={[{ width: "18%", textAlign: "right" }, styles.cellBold]}>
                  {formatMoney(Math.abs(row.runningBalance))} {row.runningBalance >= 0 ? "Debit" : "Credit"}
                </Text>
              </View>
            ))
          )}

          <View style={styles.tableRowTotal}>
            <Text style={[{ width: "60%" }, styles.cellBold]}>Total Debit / Total Credit / Total Balance</Text>
            <Text style={[{ width: "11%", textAlign: "right" }, styles.cellBold]}>{formatMoney(totalCredits)}</Text>
            <Text style={[{ width: "11%", textAlign: "right" }, styles.cellBold]}>{formatMoney(totalDebits)}</Text>
            <Text style={[{ width: "18%", textAlign: "right" }, styles.cellBold]}>{formatMoney(Math.abs(safeCurrentBalance))} {safeCurrentBalance >= 0 ? "Debit" : "Credit"}</Text>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text>{companyName} — Party Statement Ledger</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

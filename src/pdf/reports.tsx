import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#1e293b",
    lineHeight: 1.4,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 1.5,
    borderBottomColor: "#065f46",
    paddingBottom: 12,
    marginBottom: 16,
  },
  brandName: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#065f46",
    letterSpacing: 0.5,
  },
  brandMeta: {
    fontSize: 8,
    color: "#64748b",
    marginTop: 2,
  },
  reportTitleBox: {
    alignItems: "flex-end",
  },
  reportTitle: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#0f172a",
    textTransform: "uppercase",
  },
  reportSubtitle: {
    fontSize: 8.5,
    color: "#047857",
    marginTop: 2,
    fontWeight: "bold",
  },
  filterBadge: {
    fontSize: 8,
    color: "#64748b",
    marginTop: 2,
  },
  summaryGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
    gap: 8,
  },
  kpiCard: {
    flex: 1,
    padding: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
  },
  kpiLabel: {
    fontSize: 7.5,
    fontWeight: "bold",
    color: "#64748b",
    textTransform: "uppercase",
  },
  kpiValue: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#0f172a",
    marginTop: 3,
  },
  table: {
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 4,
    overflow: "hidden",
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f1f5f9",
    borderBottomWidth: 1,
    borderBottomColor: "#cbd5e1",
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  tableRowAlternate: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
    backgroundColor: "#fafafa",
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  tableRowHighlight: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#cbd5e1",
    backgroundColor: "#ecfdf5",
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  headerCell: {
    fontSize: 8,
    fontWeight: "bold",
    color: "#334155",
    textTransform: "uppercase",
  },
  cell: {
    fontSize: 8.5,
    color: "#1e293b",
  },
  cellBold: {
    fontSize: 8.5,
    fontWeight: "bold",
    color: "#0f172a",
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 36,
    right: 36,
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
    paddingTop: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7.5,
    color: "#94a3b8",
  },
});

// P&L Statement PDF
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
}: {
  companyName?: string;
  companyAddress?: string;
  companyPhone?: string;
  period?: string;
  sales: number;
  purchases: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
}) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
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

        {/* Executive KPI Cards */}
        <View style={styles.summaryGrid}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Trading Revenue</Text>
            <Text style={styles.kpiValue}>PKR {sales.toLocaleString()}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Cost of Goods (Purchases)</Text>
            <Text style={styles.kpiValue}>PKR {purchases.toLocaleString()}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Gross Margin</Text>
            <Text style={[styles.kpiValue, { color: "#065f46" }]}>PKR {grossProfit.toLocaleString()}</Text>
          </View>
          <View style={[styles.kpiCard, { backgroundColor: netProfit >= 0 ? "#ecfdf5" : "#fff1f2", borderColor: netProfit >= 0 ? "#a7f3d0" : "#fecdd3" }]}>
            <Text style={[styles.kpiLabel, { color: netProfit >= 0 ? "#065f46" : "#9f1239" }]}>Net Income</Text>
            <Text style={[styles.kpiValue, { color: netProfit >= 0 ? "#064e3b" : "#881337" }]}>PKR {netProfit.toLocaleString()}</Text>
          </View>
        </View>

        {/* Detailed Breakdown Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[{ width: "70%" }, styles.headerCell]}>Accounting Line Item</Text>
            <Text style={[{ width: "30%", textAlign: "right" }, styles.headerCell]}>Amount (PKR)</Text>
          </View>

          <View style={styles.tableRow}>
            <Text style={[{ width: "70%" }, styles.cellBold]}>Gross Trading Sales</Text>
            <Text style={[{ width: "30%", textAlign: "right" }, styles.cellBold]}>{sales.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
          </View>

          <View style={styles.tableRowAlternate}>
            <Text style={[{ width: "70%", paddingLeft: 12 }, styles.cell]}>Less: Purchases & Mill Stock Cost</Text>
            <Text style={[{ width: "30%", textAlign: "right" }, styles.cell]}>({purchases.toLocaleString(undefined, { minimumFractionDigits: 2 })})</Text>
          </View>

          <View style={[styles.tableRow, { backgroundColor: "#f8fafc" }]}>
            <Text style={[{ width: "70%" }, styles.cellBold]}>Gross Trading Margin</Text>
            <Text style={[{ width: "30%", textAlign: "right" }, styles.cellBold]}>{grossProfit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
          </View>

          <View style={styles.tableRowAlternate}>
            <Text style={[{ width: "70%", paddingLeft: 12 }, styles.cell]}>Less: Operating & Warehouse Storage Expenses</Text>
            <Text style={[{ width: "30%", textAlign: "right" }, styles.cell]}>({expenses.toLocaleString(undefined, { minimumFractionDigits: 2 })})</Text>
          </View>

          <View style={styles.tableRowHighlight}>
            <Text style={[{ width: "70%" }, styles.cellBold]}>Net Profit / Operating Income</Text>
            <Text style={[{ width: "30%", textAlign: "right", color: netProfit >= 0 ? "#065f46" : "#be123c" }, styles.cellBold]}>
              {netProfit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </Text>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text>{companyName} — Certified Financial Report</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

// Cash Flow Statement PDF
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
}: {
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
    description: string;
    referenceType: string;
    inflow: number;
    outflow: number;
    balance: number;
  }>;
}) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.brandName}>{companyName}</Text>
            <Text style={styles.brandMeta}>{companyAddress}</Text>
            <Text style={styles.brandMeta}>Phone: {companyPhone}</Text>
          </View>
          <View style={styles.reportTitleBox}>
            <Text style={styles.reportTitle}>Statement of Cash Flows</Text>
            <Text style={styles.reportSubtitle}>Cash & Bank Movements</Text>
            <Text style={styles.filterBadge}>Period: {period}</Text>
          </View>
        </View>

        <View style={styles.summaryGrid}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Total Collections (Inflow)</Text>
            <Text style={[styles.kpiValue, { color: "#065f46" }]}>PKR {cashInflow.toLocaleString()}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Total Disbursements (Outflow)</Text>
            <Text style={[styles.kpiValue, { color: "#b45309" }]}>PKR {cashOutflow.toLocaleString()}</Text>
          </View>
          <View style={[styles.kpiCard, { backgroundColor: netCashFlow >= 0 ? "#ecfdf5" : "#fff1f2" }]}>
            <Text style={styles.kpiLabel}>Net Operational Flow</Text>
            <Text style={[styles.kpiValue, { color: netCashFlow >= 0 ? "#065f46" : "#be123c" }]}>PKR {netCashFlow.toLocaleString()}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Current Liquid Balance</Text>
            <Text style={styles.kpiValue}>PKR {endingBalance.toLocaleString()}</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[{ width: "16%" }, styles.headerCell]}>Date</Text>
            <Text style={[{ width: "42%" }, styles.headerCell]}>Description / Reference</Text>
            <Text style={[{ width: "14%", textAlign: "right" }, styles.headerCell]}>Inflow (Dr)</Text>
            <Text style={[{ width: "14%", textAlign: "right" }, styles.headerCell]}>Outflow (Cr)</Text>
            <Text style={[{ width: "14%", textAlign: "right" }, styles.headerCell]}>Cash Position</Text>
          </View>

          {flowDetails.length === 0 ? (
            <View style={styles.tableRow}>
              <Text style={[{ width: "100%", textAlign: "center", color: "#64748b" }, styles.cell]}>
                No cash transactions found for this period.
              </Text>
            </View>
          ) : (
            flowDetails.slice(0, 30).map((row, idx) => (
              <View key={idx} style={idx % 2 === 1 ? styles.tableRowAlternate : styles.tableRow}>
                <Text style={[{ width: "16%" }, styles.cell]}>{row.date}</Text>
                <Text style={[{ width: "42%" }, styles.cell]}>{row.description}</Text>
                <Text style={[{ width: "14%", textAlign: "right", color: row.inflow > 0 ? "#065f46" : "#94a3b8" }, styles.cell]}>
                  {row.inflow > 0 ? row.inflow.toLocaleString() : "—"}
                </Text>
                <Text style={[{ width: "14%", textAlign: "right", color: row.outflow > 0 ? "#b45309" : "#94a3b8" }, styles.cell]}>
                  {row.outflow > 0 ? row.outflow.toLocaleString() : "—"}
                </Text>
                <Text style={[{ width: "14%", textAlign: "right", fontWeight: "bold" }, styles.cellBold]}>
                  {row.balance.toLocaleString()}
                </Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.footer} fixed>
          <Text>{companyName} — Certified Cash Flow Report</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

// Balance Sheet PDF
export function BalanceSheetPdfView({
  companyName = "PAPER TRADE CO.",
  companyAddress = "Wholesale Paper Market, Station Road",
  companyPhone = "+92-300-1234567",
  asOfDate,
  assets,
  liabilities,
  equity,
}: {
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
}) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
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

        {/* Top Summary */}
        <View style={styles.summaryGrid}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Total Assets</Text>
            <Text style={[styles.kpiValue, { color: "#065f46" }]}>PKR {assets.totalAssets.toLocaleString()}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Total Liabilities</Text>
            <Text style={[styles.kpiValue, { color: "#b45309" }]}>PKR {liabilities.totalLiabilities.toLocaleString()}</Text>
          </View>
          <View style={[styles.kpiCard, { backgroundColor: "#ecfdf5", borderColor: "#a7f3d0" }]}>
            <Text style={styles.kpiLabel}>Owner Equity / Net Worth</Text>
            <Text style={[styles.kpiValue, { color: "#064e3b" }]}>PKR {equity.toLocaleString()}</Text>
          </View>
        </View>

        {/* Assets Section */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[{ width: "70%" }, styles.headerCell]}>Current Assets</Text>
            <Text style={[{ width: "30%", textAlign: "right" }, styles.headerCell]}>Valuation (PKR)</Text>
          </View>

          <View style={styles.tableRow}>
            <Text style={[{ width: "70%" }, styles.cell]}>Cash in Hand & Bank Balances</Text>
            <Text style={[{ width: "30%", textAlign: "right" }, styles.cell]}>{assets.cash.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
          </View>

          <View style={styles.tableRowAlternate}>
            <Text style={[{ width: "70%" }, styles.cell]}>Accounts Receivable (Customer Outstandings)</Text>
            <Text style={[{ width: "30%", textAlign: "right" }, styles.cell]}>{assets.receivables.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
          </View>

          <View style={styles.tableRow}>
            <Text style={[{ width: "70%" }, styles.cell]}>Warehouse & Shop Physical Inventory (At Cost)</Text>
            <Text style={[{ width: "30%", textAlign: "right" }, styles.cell]}>{assets.inventory.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
          </View>

          <View style={styles.tableRowHighlight}>
            <Text style={[{ width: "70%" }, styles.cellBold]}>Total Current Assets</Text>
            <Text style={[{ width: "30%", textAlign: "right" }, styles.cellBold]}>{assets.totalAssets.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
          </View>
        </View>

        {/* Liabilities & Equity Section */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[{ width: "70%" }, styles.headerCell]}>Liabilities & Net Equity</Text>
            <Text style={[{ width: "30%", textAlign: "right" }, styles.headerCell]}>Amount (PKR)</Text>
          </View>

          <View style={styles.tableRow}>
            <Text style={[{ width: "70%" }, styles.cell]}>Accounts Payable (Paper Mills / Suppliers)</Text>
            <Text style={[{ width: "30%", textAlign: "right" }, styles.cell]}>{liabilities.payables.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
          </View>

          <View style={[styles.tableRow, { backgroundColor: "#fffbeb" }]}>
            <Text style={[{ width: "70%" }, styles.cellBold]}>Total Current Liabilities</Text>
            <Text style={[{ width: "30%", textAlign: "right" }, styles.cellBold]}>{liabilities.totalLiabilities.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
          </View>

          <View style={styles.tableRowAlternate}>
            <Text style={[{ width: "70%" }, styles.cell]}>Owner&apos;s Retained Capital & Net Worth</Text>
            <Text style={[{ width: "30%", textAlign: "right", color: "#065f46" }, styles.cellBold]}>{equity.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
          </View>

          <View style={styles.tableRowHighlight}>
            <Text style={[{ width: "70%" }, styles.cellBold]}>Total Liabilities & Equity</Text>
            <Text style={[{ width: "30%", textAlign: "right" }, styles.cellBold]}>{(liabilities.totalLiabilities + equity).toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text>{companyName} — Certified Balance Sheet</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

// Party Account Statement PDF
export function PartyStatementPdfView({
  companyName = "PAPER TRADE CO.",
  companyAddress = "Wholesale Paper Market, Station Road",
  companyPhone = "+92-300-1234567",
  party,
  currentBalance,
  openingBalance = 0,
  startDate,
  endDate,
  ledgerRows,
}: {
  companyName?: string;
  companyAddress?: string;
  companyPhone?: string;
  party: {
    name: string;
    type: string;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    creditLimit?: number | null;
  };
  currentBalance: number;
  openingBalance?: number;
  startDate?: string;
  endDate?: string;
  ledgerRows: Array<{
    date: string;
    description: string;
    referenceType: string;
    referenceId: string;
    debit: number;
    credit: number;
    runningBalance: number;
  }>;
}) {
  const totalDebits = ledgerRows.reduce((sum, r) => sum + r.debit, 0);
  const totalCredits = ledgerRows.reduce((sum, r) => sum + r.credit, 0);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.brandName}>{companyName}</Text>
            <Text style={styles.brandMeta}>{companyAddress}</Text>
            <Text style={styles.brandMeta}>Phone: {companyPhone}</Text>
          </View>
          <View style={styles.reportTitleBox}>
            <Text style={styles.reportTitle}>Statement of Account</Text>
            <Text style={styles.reportSubtitle}>{party.name} ({party.type})</Text>
            <Text style={styles.filterBadge}>
              Period: {startDate || "Start"} to {endDate || "Present"}
            </Text>
          </View>
        </View>

        {/* Party Profile Banner */}
        <View style={[styles.summaryGrid, { marginBottom: 12 }]}>
          <View style={[styles.kpiCard, { flex: 2 }]}>
            <Text style={styles.kpiLabel}>Account Contact</Text>
            <Text style={[styles.cellBold, { marginTop: 2 }]}>{party.address || "Address on file"}</Text>
            <Text style={styles.cell}>Tel: {party.phone || "—"} | Email: {party.email || "—"}</Text>
          </View>
          {party.creditLimit ? (
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Credit Limit</Text>
              <Text style={styles.kpiValue}>PKR {party.creditLimit.toLocaleString()}</Text>
            </View>
          ) : null}
          <View style={[styles.kpiCard, { backgroundColor: currentBalance >= 0 ? "#ecfdf5" : "#fff1f2" }]}>
            <Text style={styles.kpiLabel}>Closing Balance</Text>
            <Text style={[styles.kpiValue, { color: currentBalance >= 0 ? "#065f46" : "#9f1239" }]}>
              PKR {Math.abs(currentBalance).toLocaleString()}{" "}
              {currentBalance >= 0 ? "(Receivable)" : "(Payable)"}
            </Text>
          </View>
        </View>

        {/* Ledger Records Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[{ width: "15%" }, styles.headerCell]}>Date</Text>
            <Text style={[{ width: "16%" }, styles.headerCell]}>Doc Type</Text>
            <Text style={[{ width: "37%" }, styles.headerCell]}>Transaction Particulars</Text>
            <Text style={[{ width: "11%", textAlign: "right" }, styles.headerCell]}>Debit (Dr)</Text>
            <Text style={[{ width: "11%", textAlign: "right" }, styles.headerCell]}>Credit (Cr)</Text>
            <Text style={[{ width: "10%", textAlign: "right" }, styles.headerCell]}>Balance</Text>
          </View>

          {/* Opening Balance Row if date-filtered */}
          {openingBalance !== 0 && (
            <View style={[styles.tableRow, { backgroundColor: "#fef9c3" }]}>
              <Text style={[{ width: "15%" }, styles.cellBold]}>{startDate || "—"}</Text>
              <Text style={[{ width: "16%" }, styles.cellBold]}>B/F</Text>
              <Text style={[{ width: "37%" }, styles.cellBold]}>Opening Balance (Brought Forward)</Text>
              <Text style={[{ width: "11%", textAlign: "right" }, styles.cell]}>{openingBalance > 0 ? openingBalance.toLocaleString() : "—"}</Text>
              <Text style={[{ width: "11%", textAlign: "right" }, styles.cell]}>{openingBalance < 0 ? Math.abs(openingBalance).toLocaleString() : "—"}</Text>
              <Text style={[{ width: "10%", textAlign: "right" }, styles.cellBold]}>{openingBalance.toLocaleString()}</Text>
            </View>
          )}

          {ledgerRows.length === 0 ? (
            <View style={styles.tableRow}>
              <Text style={[{ width: "100%", textAlign: "center", color: "#64748b" }, styles.cell]}>
                No transaction records found for this account period.
              </Text>
            </View>
          ) : (
            ledgerRows.map((row, idx) => (
              <View key={idx} style={idx % 2 === 1 ? styles.tableRowAlternate : styles.tableRow}>
                <Text style={[{ width: "15%" }, styles.cell]}>{row.date}</Text>
                <Text style={[{ width: "16%" }, styles.cell]}>{row.referenceType}</Text>
                <Text style={[{ width: "37%" }, styles.cell]}>{row.description}</Text>
                <Text style={[{ width: "11%", textAlign: "right", color: row.debit > 0 ? "#065f46" : "#94a3b8" }, styles.cell]}>
                  {row.debit > 0 ? row.debit.toLocaleString() : "—"}
                </Text>
                <Text style={[{ width: "11%", textAlign: "right", color: row.credit > 0 ? "#b45309" : "#94a3b8" }, styles.cell]}>
                  {row.credit > 0 ? row.credit.toLocaleString() : "—"}
                </Text>
                <Text style={[{ width: "10%", textAlign: "right", fontWeight: "bold" }, styles.cellBold]}>
                  {row.runningBalance.toLocaleString()}
                </Text>
              </View>
            ))
          )}

          {/* Period Summary Totals */}
          <View style={[styles.tableRowHighlight, { borderTopWidth: 1.5 }]}>
            <Text style={[{ width: "68%" }, styles.cellBold]}>Total Period Activity & Net Closing Balance</Text>
            <Text style={[{ width: "11%", textAlign: "right" }, styles.cellBold]}>{totalDebits.toLocaleString()}</Text>
            <Text style={[{ width: "11%", textAlign: "right" }, styles.cellBold]}>{totalCredits.toLocaleString()}</Text>
            <Text style={[{ width: "10%", textAlign: "right", color: "#065f46" }, styles.cellBold]}>{currentBalance.toLocaleString()}</Text>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text>{companyName} — Account Statement</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

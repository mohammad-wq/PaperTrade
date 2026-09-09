import { prisma } from "../src/lib/db";
import {
  calculateProfitLoss,
  calculateBalanceSheet,
  calculateCashFlow,
  calculatePartyStatement,
} from "../src/lib/financial-reports";

async function main() {
  console.log("=== 1. PROFIT & LOSS (INCOME STATEMENT) ===");
  const pl = await calculateProfitLoss();
  console.log({
    grossSales: pl.grossSales,
    salesReturns: pl.salesReturns,
    netSales: pl.sales,
    grossPurchases: pl.grossPurchases,
    purchaseReturns: pl.purchaseReturns,
    netPurchases: pl.purchases,
    grossProfit: pl.grossProfit,
    grossMarginPct: `${pl.grossMarginPct}%`,
    operatingExpenses: pl.operatingExpenses,
    expenseBreakdown: pl.expenseBreakdown,
    netProfit: pl.netProfit,
    netMarginPct: `${pl.netMarginPct}%`,
  });

  console.log("\n=== 2. BALANCE SHEET (STATEMENT OF FINANCIAL POSITION) ===");
  const bs = await calculateBalanceSheet();
  console.log({
    assets: bs.assets,
    liabilities: bs.liabilities,
    equity: bs.equity,
    totalLiabilitiesAndEquity: bs.totalLiabilitiesAndEquity,
    isBalanced: bs.isBalanced,
  });

  console.log("\n=== 3. CASH FLOW STATEMENT ===");
  const cf = await calculateCashFlow();
  console.log({
    beginningBalance: cf.beginningBalance,
    cashInflow: cf.cashInflow,
    cashOutflow: cf.cashOutflow,
    netCashFlow: cf.netCashFlow,
    endingBalance: cf.endingBalance,
    totalEvents: cf.flowDetails.length,
  });

  console.log("\n=== 4. PARTY STATEMENT (LEDGER) ===");
  const sampleParty = await prisma.party.findFirst();
  if (sampleParty) {
    const ps = await calculatePartyStatement(sampleParty.id);
    console.log({
      partyName: ps.party.name,
      partyType: ps.party.type,
      openingBalance: ps.openingBalance,
      totalPeriodDebits: ps.totalPeriodDebits,
      totalPeriodCredits: ps.totalPeriodCredits,
      closingBalance: ps.closingBalance,
      currentBalance: ps.currentBalance,
      rowsCount: ps.ledgerRows.length,
    });
  } else {
    console.log("No sample party found.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

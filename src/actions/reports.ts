"use server";

import { runAction } from "@/actions/_helpers";
import { requireSession } from "@/lib/auth/session";
import {
  calculateProfitLoss,
  calculateBalanceSheet,
  calculateCashFlow,
  calculatePartyStatement,
} from "@/lib/financial-reports";

export async function getProfitLossAction(params?: { startDate?: string; endDate?: string }) {
  return runAction("reports.profitLoss", async () => {
    await requireSession();
    return calculateProfitLoss(params);
  });
}

export async function getBalanceSheetAction(params?: { asOfDate?: string }) {
  return runAction("reports.balanceSheet", async () => {
    await requireSession();
    return calculateBalanceSheet(params);
  });
}

export async function getPartyStatementAction(params: {
  partyId: string;
  startDate?: string;
  endDate?: string;
  productId?: string;
}) {
  return runAction("reports.partyStatement", async () => {
    await requireSession();
    return calculatePartyStatement(params);
  });
}

export async function getCashFlowAction(params?: { startDate?: string; endDate?: string }) {
  return runAction("reports.cashFlow", async () => {
    await requireSession();
    return calculateCashFlow(params);
  });
}

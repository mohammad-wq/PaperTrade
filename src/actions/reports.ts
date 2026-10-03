"use server";

import { runAction } from "@/actions/_helpers";
import { requireSession } from "@/lib/auth/session";
import { userError } from "@/lib/errors";
import { canPerformAction } from "@/lib/auth/permissions";
import {
  calculateProfitLoss,
  calculateBalanceSheet,
  calculateCashFlow,
  calculatePartyStatement,
} from "@/lib/financial-reports";

export async function getProfitLossAction(params?: { startDate?: string; endDate?: string }) {
  return runAction("reports.profitLoss", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "reports", "view", (session.user as any).permissions)) {
      throw userError("You do not have permission to view Profit & Loss reports.");
    }
    return calculateProfitLoss(params);
  });
}

export async function getBalanceSheetAction(params?: { asOfDate?: string }) {
  return runAction("reports.balanceSheet", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "reports", "view", (session.user as any).permissions)) {
      throw userError("You do not have permission to view Balance Sheet reports.");
    }
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
    const session = await requireSession();
    if (
      !canPerformAction(session.user.role, "reports", "view", (session.user as any).permissions) &&
      !canPerformAction(session.user.role, "ledger", "view", (session.user as any).permissions) &&
      !canPerformAction(session.user.role, "parties", "view", (session.user as any).permissions)
    ) {
      throw userError("You do not have permission to view Party Statements.");
    }
    return calculatePartyStatement(params);
  });
}

export async function getCashFlowAction(params?: { startDate?: string; endDate?: string }) {
  return runAction("reports.cashFlow", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "reports", "view", (session.user as any).permissions)) {
      throw userError("You do not have permission to view Cash Flow reports.");
    }
    return calculateCashFlow(params);
  });
}

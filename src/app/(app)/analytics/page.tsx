import React from "react";
import { getExecutiveAnalyticsAction } from "@/actions/analytics";
import AnalyticsClient from "./AnalyticsClient";

export const metadata = {
  title: "Executive Business Analytics | PaperTrade",
  description: "CPA-grade executive accounting, inventory velocity, and financial performance analytics",
};

export default async function AnalyticsPage() {
  const res = await getExecutiveAnalyticsAction({ preset: "THIS_MONTH" });

  const initialData = res.success && res.data ? res.data : {
    periodLabel: "This Month",
    grossSalesRevenue: 0,
    costOfGoodsSold: 0,
    realizedGrossMargin: 0,
    grossMarginPercentage: 0,
    totalInventoryAssetValue: 0,
    totalReceivables: 0,
    totalPayables: 0,
    topFastMovingProducts: [],
    deadStockProducts: [],
    profitabilityRanking: [],
    cashSalesAmount: 0,
    creditSalesAmount: 0,
    cashSalesRatio: 0,
    creditSalesRatio: 0,
    topDebtors: [],
  };

  return <AnalyticsClient initialData={initialData} />;
}

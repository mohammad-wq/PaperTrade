"use client";

import React, { useState, useEffect, useTransition } from "react";
import {
  TrendingUp,
  DollarSign,
  Package,
  Users,
  AlertTriangle,
  Flame,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  Layers,
  Building2,
  RefreshCw,
  Clock,
  Lock,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getExecutiveAnalyticsAction,
  ExecutiveAnalyticsData,
  AnalyticsFilter,
} from "@/actions/analytics";

interface AnalyticsClientProps {
  initialData: ExecutiveAnalyticsData;
}

export default function AnalyticsClient({ initialData }: AnalyticsClientProps) {
  const [data, setData] = useState<ExecutiveAnalyticsData>(initialData);
  const [preset, setPreset] = useState<AnalyticsFilter["preset"]>("THIS_MONTH");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleApplyFilter = (selectedPreset: AnalyticsFilter["preset"]) => {
    setPreset(selectedPreset);
    startTransition(async () => {
      const res = await getExecutiveAnalyticsAction({
        preset: selectedPreset,
        startDate: selectedPreset === "CUSTOM" ? startDate : undefined,
        endDate: selectedPreset === "CUSTOM" ? endDate : undefined,
      });
      if (res.success && res.data) {
        setData(res.data);
      }
    });
  };

  const handleCustomApply = () => {
    if (!startDate || !endDate) return;
    setPreset("CUSTOM");
    startTransition(async () => {
      const res = await getExecutiveAnalyticsAction({
        preset: "CUSTOM",
        startDate,
        endDate,
      });
      if (res.success && res.data) {
        setData(res.data);
      }
    });
  };

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Top Banner & Date Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-xl shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-400 rounded-lg">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
                Executive Business Analytics
              </h1>
              <p className="text-xs text-slate-500">
                Real-time IFRS financial KPIs, inventory asset valuation, velocity, and debt exposure
              </p>
            </div>
          </div>
        </div>

        {/* Date Filter Bar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-300 dark:border-slate-700 p-1 bg-slate-100 dark:bg-slate-800 text-xs font-semibold">
            <button
              type="button"
              onClick={() => handleApplyFilter("TODAY")}
              disabled={isPending}
              className={`px-3 py-1.5 rounded-md transition-all ${
                preset === "TODAY"
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => handleApplyFilter("LAST_7_DAYS")}
              disabled={isPending}
              className={`px-3 py-1.5 rounded-md transition-all ${
                preset === "LAST_7_DAYS"
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
            >
              Last 7 Days
            </button>
            <button
              type="button"
              onClick={() => handleApplyFilter("THIS_MONTH")}
              disabled={isPending}
              className={`px-3 py-1.5 rounded-md transition-all ${
                preset === "THIS_MONTH"
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
            >
              This Month
            </button>
            <button
              type="button"
              onClick={() => setPreset("CUSTOM")}
              disabled={isPending}
              className={`px-3 py-1.5 rounded-md transition-all ${
                preset === "CUSTOM"
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
            >
              Custom Range
            </button>
          </div>

          {preset === "CUSTOM" && (
            <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2 py-1 rounded-lg">
              <Calendar className="h-3.5 w-3.5 text-slate-400" />
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-7 w-32 text-xs p-1 bg-transparent border-0"
              />
              <span className="text-slate-400 text-xs">to</span>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-7 w-32 text-xs p-1 bg-transparent border-0"
              />
              <Button
                size="sm"
                onClick={handleCustomApply}
                disabled={isPending || !startDate || !endDate}
                className="h-7 px-2.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
              >
                Apply
              </Button>
            </div>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleApplyFilter(preset)}
            disabled={isPending}
            className="h-8 w-8 p-0"
            title="Refresh analytics"
          >
            <RefreshCw className={`h-4 w-4 ${isPending ? "animate-spin text-slate-400" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Core Financial Performance KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Gross Sales Revenue */}
        <Card className="border-slate-200 dark:border-slate-800 shadow-xs bg-white dark:bg-slate-900">
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
              <span className="font-semibold uppercase tracking-wider text-[10px]">Gross Sales Revenue</span>
              <span className="p-1.5 bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 rounded-md">
                <DollarSign className="h-4 w-4" />
              </span>
            </div>
            <div className="text-2xl font-black text-slate-900 dark:text-slate-100 font-mono tracking-tight">
              PKR {data.grossSalesRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
            <div className="mt-2 text-[11px] text-slate-500 flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-1.5">
              <span>Cost of Goods Sold (COGS):</span>
              <strong className="font-mono text-slate-700 dark:text-slate-300">
                PKR {data.costOfGoodsSold.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </strong>
            </div>
          </CardContent>
        </Card>

        {/* Realized Gross Margin */}
        <Card className="border-slate-200 dark:border-slate-800 shadow-xs bg-white dark:bg-slate-900">
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
              <span className="font-semibold uppercase tracking-wider text-[10px]">Realized Gross Margin</span>
              <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 font-bold rounded text-xs font-mono">
                {data.grossMarginPercentage}% Margin
              </span>
            </div>
            <div className="text-2xl font-black text-emerald-700 dark:text-emerald-400 font-mono tracking-tight">
              PKR {data.realizedGrossMargin.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
            <div className="mt-2 text-[11px] text-slate-500 flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-1.5">
              <span>Gross Profit Ratio:</span>
              <span className="font-bold text-emerald-700 dark:text-emerald-400">
                {data.grossMarginPercentage}% of Gross Revenue
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Current Total Inventory Asset Value */}
        <Card className="border-slate-200 dark:border-slate-800 shadow-xs bg-white dark:bg-slate-900">
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
              <span className="font-semibold uppercase tracking-wider text-[10px]">Total Inventory Value</span>
              <span className="p-1.5 bg-sky-50 dark:bg-sky-950 text-sky-600 dark:text-sky-400 rounded-md">
                <Package className="h-4 w-4" />
              </span>
            </div>
            <div className="text-2xl font-black text-sky-800 dark:text-sky-400 font-mono tracking-tight">
              PKR {data.totalInventoryAssetValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
            <div className="mt-2 text-[11px] text-slate-500 flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-1.5">
              <span>Valuation Standard:</span>
              <span className="font-semibold text-slate-700 dark:text-slate-300">Lower of Cost / NRV</span>
            </div>
          </CardContent>
        </Card>

        {/* Working Capital Balances: AR & AP */}
        <Card className="border-slate-200 dark:border-slate-800 shadow-xs bg-white dark:bg-slate-900">
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
              <span className="font-semibold uppercase tracking-wider text-[10px]">Receivables vs Payables</span>
              <span className="p-1.5 bg-purple-50 dark:bg-purple-950 text-purple-600 dark:text-purple-400 rounded-md">
                <Users className="h-4 w-4" />
              </span>
            </div>
            <div className="flex items-baseline justify-between mt-1">
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Trade Debtors (AR)</span>
                <span className="text-lg font-black text-emerald-700 dark:text-emerald-400 font-mono">
                  PKR {data.totalReceivables.toLocaleString()}
                </span>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Trade Creditors (AP)</span>
                <span className="text-lg font-black text-rose-700 dark:text-rose-400 font-mono">
                  PKR {data.totalPayables.toLocaleString()}
                </span>
              </div>
            </div>
            <div className="mt-2 text-[10px] text-slate-500 border-t border-slate-100 dark:border-slate-800 pt-1.5 flex justify-between">
              <span>Net Working Capital Balance:</span>
              <strong className={data.totalReceivables - data.totalPayables >= 0 ? "text-emerald-700" : "text-rose-700"}>
                PKR {(data.totalReceivables - data.totalPayables).toLocaleString()}
              </strong>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Cash vs Credit Sales Health & Top Debtors */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Cash vs Credit Sales Ratio */}
        <Card className="lg:col-span-5 border-slate-200 dark:border-slate-800 shadow-xs bg-white dark:bg-slate-900">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 flex items-center justify-between">
              <span>Cash Flow & Receivables Health</span>
              <span className="text-[10px] font-normal text-slate-400">{data.periodLabel}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            <div>
              <div className="flex justify-between text-xs font-semibold mb-1.5">
                <span className="text-emerald-700 dark:text-emerald-400">Cash / Immediate ({data.cashSalesRatio}%)</span>
                <span className="text-amber-700 dark:text-amber-400">Credit Sales ({data.creditSalesRatio}%)</span>
              </div>
              <div className="h-3 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex">
                <div
                  className="bg-emerald-600 h-full transition-all duration-500"
                  style={{ width: `${data.cashSalesRatio}%` }}
                  title={`Cash: PKR ${data.cashSalesAmount.toLocaleString()}`}
                />
                <div
                  className="bg-amber-500 h-full transition-all duration-500"
                  style={{ width: `${data.creditSalesRatio}%` }}
                  title={`Credit: PKR ${data.creditSalesAmount.toLocaleString()}`}
                />
              </div>
              <div className="flex justify-between text-[11px] font-mono text-slate-500 mt-1">
                <span>PKR {data.cashSalesAmount.toLocaleString()}</span>
                <span>PKR {data.creditSalesAmount.toLocaleString()}</span>
              </div>
            </div>

            <div className="border-t border-slate-100 dark:border-slate-800 pt-3">
              <span className="text-[11px] uppercase font-bold text-slate-500 block mb-2">
                Top 5 Trade Debtors (Accounts Receivable)
              </span>
              {data.topDebtors.length === 0 ? (
                <div className="text-xs text-slate-400 italic py-2">No active outstanding debtor balances.</div>
              ) : (
                <div className="space-y-2">
                  {data.topDebtors.map((debtor, idx) => (
                    <div
                      key={debtor.id}
                      className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="font-bold text-slate-900 dark:text-slate-100 truncate">
                          {idx + 1}. {debtor.name}
                        </div>
                        {debtor.creditLimit && (
                          <div className="text-[10px] text-slate-400">
                            Limit: PKR {debtor.creditLimit.toLocaleString()}
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                          PKR {debtor.balance.toLocaleString()}
                        </div>
                        <div className="text-[9px] text-slate-400">Receivable</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Profitability Ranking Table */}
        <Card className="lg:col-span-7 border-slate-200 dark:border-slate-800 shadow-xs bg-white dark:bg-slate-900">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 flex items-center justify-between">
              <span>Product Profitability Ranking</span>
              <span className="text-[10px] font-normal text-slate-400">Ranked by Gross Margin %</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {data.profitabilityRanking.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">No product sales in selected period.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 text-[10px] uppercase font-bold text-slate-500">
                    <tr>
                      <th className="py-2 px-3">#</th>
                      <th className="py-2 px-3">Product</th>
                      <th className="py-2 px-3 text-right">Units Sold</th>
                      <th className="py-2 px-3 text-right">Revenue</th>
                      <th className="py-2 px-3 text-right">COGS</th>
                      <th className="py-2 px-3 text-right">Gross Profit</th>
                      <th className="py-2 px-3 text-right">Margin %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-[11px]">
                    {data.profitabilityRanking.map((p, idx) => (
                      <tr key={p.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                        <td className="py-2 px-3 text-slate-400 font-mono text-[10px]">{idx + 1}</td>
                        <td className="py-2 px-3 font-semibold text-slate-900 dark:text-slate-100">
                          <span className="font-mono text-slate-400 font-normal mr-1">{p.productNo}</span>
                          {p.name}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                          {p.quantitySold.toLocaleString()} {p.unit}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                          PKR {p.revenue.toLocaleString()}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-500">
                          PKR {p.cogs.toLocaleString()}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-emerald-700 dark:text-emerald-400">
                          PKR {p.margin.toLocaleString()}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold">
                          <span className="inline-block px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-[10px]">
                            {p.marginPercentage}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Product Movement & Velocity: Fast-Moving vs Slow-Moving / Dead Stock */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Top 10 Fast-Moving Products */}
        <Card className="border-slate-200 dark:border-slate-800 shadow-xs bg-white dark:bg-slate-900">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-amber-600">
                <Flame className="h-4 w-4" /> Top 10 Fast-Moving Products
              </span>
              <span className="text-[10px] font-normal text-slate-400">Ranked by Volume Sold</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {data.topFastMovingProducts.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">No sales movements recorded in period.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 text-[10px] uppercase font-bold text-slate-500">
                    <tr>
                      <th className="py-2 px-3">#</th>
                      <th className="py-2 px-3">Product Name</th>
                      <th className="py-2 px-3 text-right">Units Sold</th>
                      <th className="py-2 px-3 text-right">Revenue Contrib.</th>
                      <th className="py-2 px-3 text-right">Gross Margin</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-[11px]">
                    {data.topFastMovingProducts.map((p, idx) => (
                      <tr key={p.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                        <td className="py-2 px-3 text-slate-400 font-mono text-[10px]">{idx + 1}</td>
                        <td className="py-2 px-3 font-semibold text-slate-900 dark:text-slate-100">
                          <span className="font-mono text-slate-400 font-normal mr-1">{p.productNo}</span>
                          {p.name}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-slate-900 dark:text-slate-100">
                          {p.quantitySold.toLocaleString()} {p.unit}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                          PKR {p.revenueContribution.toLocaleString()}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-emerald-700 dark:text-emerald-400">
                          PKR {p.marginContribution.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Slow-Moving / Dead Stock (30+ Days Inactive) */}
        <Card className="border-slate-200 dark:border-slate-800 shadow-xs bg-white dark:bg-slate-900">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-rose-600">
                <AlertTriangle className="h-4 w-4" /> Slow-Moving / Dead Stock (30+ Days)
              </span>
              <span className="text-[10px] font-normal text-slate-400">Locked Capital Analysis</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {data.deadStockProducts.length === 0 ? (
              <div className="p-6 text-center text-xs text-emerald-600 font-semibold">
                ✓ Zero dead stock detected. All stocked inventory has recorded sales velocity within 30 days!
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 text-[10px] uppercase font-bold text-slate-500">
                    <tr>
                      <th className="py-2 px-3">#</th>
                      <th className="py-2 px-3">Product Name</th>
                      <th className="py-2 px-3 text-right">Stock on Hand</th>
                      <th className="py-2 px-3 text-right">Cost Rate</th>
                      <th className="py-2 px-3 text-right text-rose-600">Locked Capital</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-[11px]">
                    {data.deadStockProducts.map((p, idx) => (
                      <tr key={p.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                        <td className="py-2 px-3 text-slate-400 font-mono text-[10px]">{idx + 1}</td>
                        <td className="py-2 px-3 font-semibold text-slate-900 dark:text-slate-100">
                          <span className="font-mono text-slate-400 font-normal mr-1">{p.productNo}</span>
                          {p.name}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-slate-700 dark:text-slate-300">
                          {p.currentStock.toLocaleString()} {p.unit}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-500">
                          PKR {p.unitCost.toLocaleString()}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-rose-700 dark:text-rose-400">
                          PKR {p.lockedCapital.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

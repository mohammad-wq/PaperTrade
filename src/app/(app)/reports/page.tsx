"use client";

import { useEffect, useState } from "react";
import {
  BarChart3,
  Calendar,
  DollarSign,
  TrendingUp,
  FileSpreadsheet,
  Users,
  Printer,
  Download,
  Search,
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getProfitLossAction,
  getBalanceSheetAction,
  getCashFlowAction,
  getPartyStatementAction,
} from "@/actions/reports";
import { listPartiesAction } from "@/actions/parties";
import { listProductsAction } from "@/actions/products";
import { format } from "date-fns";

type ProfitLossData = {
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
};

type BalanceSheetData = {
  asOf: string;
  assets: {
    cash: number;
    receivables: number;
    inventory: number;
    totalAssets: number;
    inventoryMetrics?: {
      totalUnits: number;
      totalTonnage: number;
    };
  };
  liabilities: {
    payables: number;
    bankOverdraft?: number;
    totalLiabilities: number;
  };
  equity: number;
  isBalanced?: boolean;
  totalLiabilitiesAndEquity?: number;
};

type CashFlowData = {
  beginningBalance?: number;
  cashInflow: number;
  cashOutflow: number;
  netCashFlow: number;
  endingBalance: number;
  flowDetails: Array<{
    id: string;
    date: string;
    description: string;
    referenceType: string;
    referenceId: string;
    inflow: number;
    outflow: number;
    balance: number;
  }>;
};

type PartyStatementData = {
  party: {
    id: string;
    name: string;
    type: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    creditLimit: number | null;
  };
  openingBalance: number;
  totalPeriodDebits: number;
  totalPeriodCredits: number;
  closingBalance: number;
  currentBalance: number;
  ledgerRows: Array<{
    id: string;
    date: Date;
    description: string;
    referenceType: string;
    referenceId: string;
    debit: number;
    credit: number;
    runningBalance: number;
  }>;
  productTransactions: Array<{
    date: Date;
    docNo: string;
    docType: string;
    productName: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    total: number;
  }>;
};

export default function ReportsPage() {
  const [tab, setTab] = useState<"PL" | "CASH" | "BS" | "PARTY">("PL");

  // P&L State
  const [plStart, setPlStart] = useState("");
  const [plEnd, setPlEnd] = useState("");
  const [plData, setPlData] = useState<ProfitLossData | null>(null);

  // Cash Flow State
  const [cfStart, setCfStart] = useState("");
  const [cfEnd, setCfEnd] = useState("");
  const [cfData, setCfData] = useState<CashFlowData | null>(null);

  // Balance Sheet State
  const [bsDate, setBsDate] = useState(new Date().toISOString().slice(0, 10));
  const [bsData, setBsData] = useState<BalanceSheetData | null>(null);

  // Party Statement State
  const [parties, setParties] = useState<Array<{ id: string; name: string; type: string }>>([]);
  const [products, setProducts] = useState<Array<{ id: string; productNo: string; name: string }>>([]);
  const [selectedPartyId, setSelectedPartyId] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("ALL");
  const [partyStart, setPartyStart] = useState("");
  const [partyEnd, setPartyEnd] = useState("");
  const [partyData, setPartyData] = useState<PartyStatementData | null>(null);

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function loadLookups() {
      const [partyRes, prodRes] = await Promise.all([
        listPartiesAction(),
        listProductsAction(),
      ]);
      if (partyRes.success && partyRes.data) {
        const partyList = partyRes.data as Array<{ id: string; name: string; type: string }>;
        setParties(partyList);
        if (partyList.length > 0) setSelectedPartyId(partyList[0].id);
      }
      if (prodRes.success && prodRes.data) {
        setProducts(prodRes.data as Array<{ id: string; productNo: string; name: string }>);
      }
    }
    void loadLookups();
  }, []);

  async function fetchPL() {
    setLoading(true);
    try {
      const res = await getProfitLossAction({
        startDate: plStart || undefined,
        endDate: plEnd || undefined,
      });
      if (res.success && res.data) {
        setPlData(res.data);
      }
    } finally {
      setLoading(false);
    }
  }

  async function fetchCashFlow() {
    setLoading(true);
    try {
      const res = await getCashFlowAction({
        startDate: cfStart || undefined,
        endDate: cfEnd || undefined,
      });
      if (res.success && res.data) {
        setCfData(res.data);
      }
    } finally {
      setLoading(false);
    }
  }

  async function fetchBS() {
    setLoading(true);
    try {
      const res = await getBalanceSheetAction({
        asOfDate: bsDate || undefined,
      });
      if (res.success && res.data) {
        setBsData(res.data);
      }
    } finally {
      setLoading(false);
    }
  }

  async function fetchPartyStatement() {
    if (!selectedPartyId) return;
    setLoading(true);
    try {
      const res = await getPartyStatementAction({
        partyId: selectedPartyId,
        startDate: partyStart || undefined,
        endDate: partyEnd || undefined,
        productId: selectedProductId === "ALL" ? undefined : selectedProductId,
      });
      if (res.success && res.data) {
        setPartyData(res.data as PartyStatementData);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (tab === "PL") void fetchPL();
    if (tab === "CASH") void fetchCashFlow();
    if (tab === "BS") void fetchBS();
    if (tab === "PARTY") void fetchPartyStatement();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, plStart, plEnd, cfStart, cfEnd, bsDate, selectedPartyId, selectedProductId, partyStart, partyEnd]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-emerald-800" />
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Financial Reports & Accounts</h1>
          </div>
          <p className="text-sm text-slate-600">
            Income Statement, Cash Flow, Balance Sheet, and Party Statements directly from transactional ledger records.
          </p>
        </div>
      </div>

      {/* Report Tabs */}
      <div className="flex flex-wrap rounded-lg border border-slate-200 bg-white p-1 max-w-xl shadow-2xs">
        <button
          onClick={() => setTab("PL")}
          className={`flex-1 min-w-[120px] rounded-md py-1.5 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${
            tab === "PL" ? "bg-emerald-100 text-emerald-900 shadow-2xs font-bold" : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <TrendingUp className="h-3.5 w-3.5 text-emerald-700" />
          Income Statement (P&L)
        </button>
        <button
          onClick={() => setTab("CASH")}
          className={`flex-1 min-w-[110px] rounded-md py-1.5 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${
            tab === "CASH" ? "bg-teal-100 text-teal-900 shadow-2xs font-bold" : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <Wallet className="h-3.5 w-3.5 text-teal-700" />
          Cash Flow
        </button>
        <button
          onClick={() => setTab("BS")}
          className={`flex-1 min-w-[110px] rounded-md py-1.5 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${
            tab === "BS" ? "bg-amber-100 text-amber-900 shadow-2xs font-bold" : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <FileSpreadsheet className="h-3.5 w-3.5 text-amber-700" />
          Balance Sheet
        </button>
        <button
          onClick={() => setTab("PARTY")}
          className={`flex-1 min-w-[120px] rounded-md py-1.5 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${
            tab === "PARTY" ? "bg-sky-100 text-sky-900 shadow-2xs font-bold" : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <Users className="h-3.5 w-3.5 text-sky-700" />
          Party Statement
        </button>
      </div>

      {/* Tab 1: Profit & Loss */}
      {tab === "PL" && (
        <div className="space-y-6">
          <Card className="border-slate-200/80 bg-white">
            <CardContent className="p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-600">Period From</label>
                  <Input
                    type="date"
                    value={plStart}
                    onChange={(e) => setPlStart(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-600">Period To</label>
                  <Input
                    type="date"
                    value={plEnd}
                    onChange={(e) => setPlEnd(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                <Button onClick={fetchPL} size="sm" variant="outline" className="text-xs">
                  Recalculate
                </Button>
                <Button asChild size="sm" className="bg-emerald-800 text-white hover:bg-emerald-700 text-xs shadow-xs">
                  <a
                    href={`/api/pdf/reports/profit-loss?download=true${plStart ? `&startDate=${plStart}` : ""}${plEnd ? `&endDate=${plEnd}` : ""}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                    Download P&L PDF
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>

          {plData && (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Card className="border-emerald-900/15 bg-white">
                  <CardContent className="p-4">
                    <p className="text-xs font-semibold text-emerald-800 uppercase tracking-wider">Trading Revenue (Sales)</p>
                    <p className="text-2xl font-bold text-slate-900 mt-1">PKR {plData.sales.toLocaleString()}</p>
                  </CardContent>
                </Card>

                <Card className="border-amber-900/15 bg-white">
                  <CardContent className="p-4">
                    <p className="text-xs font-semibold text-amber-800 uppercase tracking-wider">Cost of Purchases</p>
                    <p className="text-2xl font-bold text-slate-900 mt-1">PKR {plData.purchases.toLocaleString()}</p>
                  </CardContent>
                </Card>

                <Card className="border-slate-200 bg-white">
                  <CardContent className="p-4">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Operating & Storage Expenses</p>
                    <p className="text-2xl font-bold text-slate-900 mt-1">PKR {plData.expenses.toLocaleString()}</p>
                  </CardContent>
                </Card>

                <Card className={`border-2 ${plData.netProfit >= 0 ? "border-emerald-500 bg-emerald-50/50" : "border-rose-500 bg-rose-50/50"}`}>
                  <CardContent className="p-4">
                    <p className={`text-xs font-bold uppercase tracking-wider ${plData.netProfit >= 0 ? "text-emerald-800" : "text-rose-800"}`}>
                      Net {plData.netProfit >= 0 ? "Profit" : "Loss"}
                    </p>
                    <p className={`text-2xl font-extrabold mt-1 ${plData.netProfit >= 0 ? "text-emerald-900" : "text-rose-900"}`}>
                      PKR {plData.netProfit.toLocaleString()}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Statement Breakdown */}
              <Card className="border-slate-200 bg-white">
                <CardHeader className="pb-3 border-b border-slate-100 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-base font-bold">Income Statement (Profit & Loss)</CardTitle>
                    <CardDescription className="text-xs">Formal accrual basis summary of revenue and costs</CardDescription>
                  </div>
                  <Button asChild variant="outline" size="sm" className="h-8 text-xs border-slate-200">
                    <a
                      href={`/api/pdf/reports/profit-loss?${plStart ? `startDate=${plStart}&` : ""}${plEnd ? `endDate=${plEnd}` : ""}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Printer className="mr-1.5 h-3.5 w-3.5 text-slate-600" />
                      View Print Preview
                    </a>
                  </Button>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y divide-slate-100 text-sm">
                    {/* Sales Section */}
                    {plData.grossSales !== undefined && plData.salesReturns !== undefined && plData.salesReturns > 0 ? (
                      <>
                        <div className="p-3 flex justify-between text-xs text-slate-600">
                          <span>Gross Trading Sales</span>
                          <span>PKR {plData.grossSales.toLocaleString()}</span>
                        </div>
                        <div className="p-3 flex justify-between text-xs text-rose-700 bg-rose-50/30">
                          <span>Less: Sales Returns & Credit Notes</span>
                          <span>(PKR {plData.salesReturns.toLocaleString()})</span>
                        </div>
                      </>
                    ) : null}
                    <div className="p-3.5 flex justify-between bg-slate-50/70 font-semibold text-slate-800">
                      <span>Net Sales Revenue</span>
                      <span className="font-bold text-slate-900">PKR {plData.sales.toLocaleString()}</span>
                    </div>

                    {/* Purchases Section */}
                    {plData.grossPurchases !== undefined && plData.purchaseReturns !== undefined && plData.purchaseReturns > 0 ? (
                      <>
                        <div className="p-3 flex justify-between text-xs text-slate-600">
                          <span>Gross Mill Purchases</span>
                          <span>(PKR {plData.grossPurchases.toLocaleString()})</span>
                        </div>
                        <div className="p-3 flex justify-between text-xs text-emerald-700 bg-emerald-50/30">
                          <span>Less: Purchase Returns & Debit Notes</span>
                          <span>+ PKR {plData.purchaseReturns.toLocaleString()}</span>
                        </div>
                      </>
                    ) : null}
                    <div className="p-3.5 flex justify-between bg-slate-50/50 text-slate-700">
                      <span>Net Cost of Purchased Stock (COGS)</span>
                      <span className="font-semibold">(PKR {plData.purchases.toLocaleString()})</span>
                    </div>

                    {/* Gross Margin */}
                    <div className="p-3.5 flex justify-between font-bold bg-amber-50/50 text-amber-950">
                      <div className="flex items-center gap-2">
                        <span>Gross Trading Margin</span>
                        {plData.grossMarginPct !== undefined && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">
                            {plData.grossMarginPct}% Margin
                          </span>
                        )}
                      </div>
                      <span>PKR {plData.grossProfit.toLocaleString()}</span>
                    </div>

                    {/* Operating Expenses */}
                    {plData.expenseBreakdown && plData.expenseBreakdown.length > 0 ? (
                      plData.expenseBreakdown.map((exp) => (
                        <div key={exp.name} className="p-3 flex justify-between text-xs text-slate-600 pl-6">
                          <span>Less: {exp.name}</span>
                          <span>(PKR {exp.amount.toLocaleString()})</span>
                        </div>
                      ))
                    ) : (
                      <div className="p-3.5 flex justify-between bg-slate-50/50 text-slate-600">
                        <span>Less: Operating & Storage Expenses</span>
                        <span>(PKR {plData.expenses.toLocaleString()})</span>
                      </div>
                    )}

                    {/* Net Income */}
                    <div className="p-4 flex justify-between text-base font-bold bg-emerald-50/60 text-emerald-950 border-t border-emerald-200">
                      <div className="flex items-center gap-2">
                        <span>Net Operating Income (Profit)</span>
                        {plData.netMarginPct !== undefined && (
                          <span className={`text-xs px-2 py-0.5 rounded-full ${plData.netProfit >= 0 ? "bg-emerald-100 text-emerald-900" : "bg-rose-100 text-rose-900"}`}>
                            {plData.netMarginPct}% Net Margin
                          </span>
                        )}
                      </div>
                      <span className={plData.netProfit >= 0 ? "text-emerald-900" : "text-rose-900"}>
                        PKR {plData.netProfit.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Cash Flow Statement */}
      {tab === "CASH" && (
        <div className="space-y-6">
          <Card className="border-slate-200/80 bg-white">
            <CardContent className="p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-600">Period From</label>
                  <Input
                    type="date"
                    value={cfStart}
                    onChange={(e) => setCfStart(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-600">Period To</label>
                  <Input
                    type="date"
                    value={cfEnd}
                    onChange={(e) => setCfEnd(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                <Button onClick={fetchCashFlow} size="sm" variant="outline" className="text-xs">
                  Recalculate
                </Button>
                <Button asChild size="sm" className="bg-teal-800 text-white hover:bg-teal-700 text-xs shadow-xs">
                  <a
                    href={`/api/pdf/reports/cash-flow?download=true${cfStart ? `&startDate=${cfStart}` : ""}${cfEnd ? `&endDate=${cfEnd}` : ""}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                    Download Cash Flow PDF
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>

          {cfData && (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Card className="border-emerald-900/15 bg-white">
                  <CardContent className="p-4">
                    <p className="text-xs font-semibold text-emerald-800 uppercase tracking-wider">Total Cash Inflow</p>
                    <p className="text-2xl font-bold text-emerald-900 mt-1">PKR {cfData.cashInflow.toLocaleString()}</p>
                    <p className="text-[11px] text-slate-500 mt-1">Customer payments & receipts</p>
                  </CardContent>
                </Card>

                <Card className="border-amber-900/15 bg-white">
                  <CardContent className="p-4">
                    <p className="text-xs font-semibold text-amber-800 uppercase tracking-wider">Total Cash Outflow</p>
                    <p className="text-2xl font-bold text-amber-900 mt-1">PKR {cfData.cashOutflow.toLocaleString()}</p>
                    <p className="text-[11px] text-slate-500 mt-1">Supplier & operational payments</p>
                  </CardContent>
                </Card>

                <Card className={`border-2 ${cfData.netCashFlow >= 0 ? "border-emerald-500 bg-emerald-50/50" : "border-rose-500 bg-rose-50/50"}`}>
                  <CardContent className="p-4">
                    <p className={`text-xs font-bold uppercase tracking-wider ${cfData.netCashFlow >= 0 ? "text-emerald-800" : "text-rose-800"}`}>
                      Net Cash Flow
                    </p>
                    <p className={`text-2xl font-extrabold mt-1 ${cfData.netCashFlow >= 0 ? "text-emerald-900" : "text-rose-900"}`}>
                      PKR {cfData.netCashFlow.toLocaleString()}
                    </p>
                    <p className="text-[11px] text-slate-600 mt-1">Period liquidity change</p>
                  </CardContent>
                </Card>

                <Card className="border-slate-200 bg-white">
                  <CardContent className="p-4">
                    <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Current Liquid Balance</p>
                    <p className="text-2xl font-bold text-slate-900 mt-1">PKR {cfData.endingBalance.toLocaleString()}</p>
                    <p className="text-[11px] text-slate-500 mt-1">Cash on hand & in bank</p>
                  </CardContent>
                </Card>
              </div>

              {/* Cash Movement Ledger */}
              <Card className="border-slate-200 bg-white">
                <CardHeader className="pb-3 border-b border-slate-100 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-base font-bold">Cash Flow Audit Trail</CardTitle>
                    <CardDescription className="text-xs">Detailed chronological cash ledger entries</CardDescription>
                  </div>
                  <Button asChild variant="outline" size="sm" className="h-8 text-xs border-slate-200">
                    <a
                      href={`/api/pdf/reports/cash-flow?${cfStart ? `startDate=${cfStart}&` : ""}${cfEnd ? `endDate=${cfEnd}` : ""}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Printer className="mr-1.5 h-3.5 w-3.5 text-slate-600" />
                      View Print Preview
                    </a>
                  </Button>
                </CardHeader>
                <CardContent className="p-0">
                  {cfData.beginningBalance !== undefined && cfData.beginningBalance !== 0 && (
                    <div className="p-3 bg-amber-50/80 border-b border-amber-200 flex justify-between items-center text-xs font-semibold text-amber-950">
                      <div>
                        <span>Beginning Cash & Bank Position (B/F)</span>
                        <span className="text-[10px] text-amber-800 ml-2">As of {cfStart || "Start of Period"}</span>
                      </div>
                      <span className="font-bold">PKR {cfData.beginningBalance.toLocaleString()}</span>
                    </div>
                  )}

                  {cfData.flowDetails.length === 0 ? (
                    <p className="p-8 text-center text-xs text-slate-500">No cash transactions logged in this period.</p>
                  ) : (
                    <div className="divide-y divide-slate-100 text-xs">
                      {cfData.flowDetails.map((tx) => (
                        <div key={tx.id} className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-slate-50/50">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-800">
                                {format(new Date(tx.date), "dd MMM yyyy")}
                              </span>
                              <span className="text-[10px] font-bold rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
                                {tx.referenceType}
                              </span>
                            </div>
                            <p className="text-slate-600">{tx.description}</p>
                          </div>

                          <div className="flex items-center gap-4 text-right">
                            {tx.inflow > 0 && (
                              <div>
                                <span className="text-[10px] text-slate-400 block">Inflow</span>
                                <span className="font-bold text-emerald-800">+ PKR {tx.inflow.toLocaleString()}</span>
                              </div>
                            )}
                            {tx.outflow > 0 && (
                              <div>
                                <span className="text-[10px] text-slate-400 block">Outflow</span>
                                <span className="font-bold text-amber-800">- PKR {tx.outflow.toLocaleString()}</span>
                              </div>
                            )}
                            <div className="border-l border-slate-200 pl-3">
                              <span className="text-[10px] text-slate-400 block">Cash Position</span>
                              <span className="font-bold text-slate-900">PKR {tx.balance.toLocaleString()}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="p-3.5 bg-emerald-50/70 border-t border-emerald-200 flex justify-between items-center text-xs font-bold text-emerald-950">
                    <span>Net Ending Cash & Bank Position</span>
                    <span>PKR {cfData.endingBalance.toLocaleString()}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Balance Sheet */}
      {tab === "BS" && (
        <div className="space-y-6">
          <Card className="border-slate-200/80 bg-white">
            <CardContent className="p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-600">Statement As Of Date</label>
                <Input
                  type="date"
                  value={bsDate}
                  onChange={(e) => setBsDate(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={fetchBS} size="sm" variant="outline" className="text-xs">
                  Recalculate
                </Button>
                <Button asChild size="sm" className="bg-amber-800 text-white hover:bg-amber-700 text-xs shadow-xs">
                  <a
                    href={`/api/pdf/reports/balance-sheet?download=true${bsDate ? `&asOfDate=${bsDate}` : ""}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                    Download Balance Sheet PDF
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>

          {bsData && (
            <div className="grid gap-6 md:grid-cols-2">
              {/* Assets Column */}
              <Card className="border-emerald-900/15 bg-white">
                <CardHeader className="border-b border-slate-100 pb-3">
                  <div className="flex justify-between items-center">
                    <CardTitle className="text-base font-bold text-emerald-900">Current Assets</CardTitle>
                    <span className="text-xs font-bold text-emerald-800">
                      PKR {bsData.assets.totalAssets.toLocaleString()}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="p-0 divide-y divide-slate-100 text-xs">
                  <div className="p-3.5 flex justify-between">
                    <div>
                      <p className="font-semibold text-slate-900">Cash & Bank Balances</p>
                      <p className="text-[10px] text-slate-500">Liquid operational funds</p>
                    </div>
                    <span className="font-bold text-slate-800">PKR {bsData.assets.cash.toLocaleString()}</span>
                  </div>
                  <div className="p-3.5 flex justify-between">
                    <div>
                      <p className="font-semibold text-slate-900">Accounts Receivable</p>
                      <p className="text-[10px] text-slate-500">Outstanding credit sales from customers</p>
                    </div>
                    <span className="font-bold text-slate-800">PKR {bsData.assets.receivables.toLocaleString()}</span>
                  </div>
                  <div className="p-3.5 flex justify-between">
                    <div>
                      <p className="font-semibold text-slate-900">Physical Paper Inventory</p>
                      <p className="text-[10px] text-slate-500">Stock on hand @ cost valuation</p>
                    </div>
                    <span className="font-bold text-slate-800">PKR {bsData.assets.inventory.toLocaleString()}</span>
                  </div>
                  <div className="p-3.5 flex justify-between font-bold bg-emerald-50 text-emerald-950 text-sm">
                    <span>Total Assets</span>
                    <span>PKR {bsData.assets.totalAssets.toLocaleString()}</span>
                  </div>
                </CardContent>
              </Card>

              {/* Liabilities & Equity */}
              <Card className="border-amber-900/15 bg-white">
                <CardHeader className="border-b border-slate-100 pb-3">
                  <div className="flex justify-between items-center">
                    <CardTitle className="text-base font-bold text-amber-900">Liabilities & Net Equity</CardTitle>
                    <span className="text-xs font-bold text-amber-800">
                      PKR {(bsData.liabilities.totalLiabilities + bsData.equity).toLocaleString()}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="p-0 divide-y divide-slate-100 text-xs">
                  <div className="p-3.5 flex justify-between">
                    <div>
                      <p className="font-semibold text-slate-900">Accounts Payable</p>
                      <p className="text-[10px] text-slate-500">Owed to paper mills / suppliers</p>
                    </div>
                    <span className="font-bold text-slate-800">PKR {bsData.liabilities.payables.toLocaleString()}</span>
                  </div>
                  <div className="p-3.5 flex justify-between font-bold bg-amber-50/50 text-amber-950">
                    <span>Total Liabilities</span>
                    <span>PKR {bsData.liabilities.totalLiabilities.toLocaleString()}</span>
                  </div>
                  <div className="p-3.5 flex justify-between">
                    <div>
                      <p className="font-semibold text-slate-900">Owner&apos;s Equity & Retained Capital</p>
                      <p className="text-[10px] text-slate-500">Cumulative business net worth</p>
                    </div>
                    <span className="font-bold text-emerald-800">PKR {bsData.equity.toLocaleString()}</span>
                  </div>
                  <div className="p-3.5 flex justify-between font-bold bg-slate-50 text-slate-900 text-sm">
                    <span>Total Liabilities & Equity</span>
                    <span>PKR {(bsData.liabilities.totalLiabilities + bsData.equity).toLocaleString()}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Party Statement */}
      {tab === "PARTY" && (
        <div className="space-y-6">
          <Card className="border-slate-200/80 bg-white">
            <CardContent className="p-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-600">Select Party *</label>
                  <select
                    value={selectedPartyId}
                    onChange={(e) => setSelectedPartyId(e.target.value)}
                    className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium"
                  >
                    {parties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.type})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-600">Filter by Product (Optional)</label>
                  <select
                    value={selectedProductId}
                    onChange={(e) => setSelectedProductId(e.target.value)}
                    className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium"
                  >
                    <option value="ALL">All Products (Full Ledger)</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.productNo} - {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-600">From Date</label>
                  <Input
                    type="date"
                    value={partyStart}
                    onChange={(e) => setPartyStart(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-600">To Date</label>
                  <Input
                    type="date"
                    value={partyEnd}
                    onChange={(e) => setPartyEnd(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {partyData && (
            <div className="space-y-6">
              {/* Party Profile Summary */}
              <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold text-slate-900">{partyData.party.name}</h2>
                    <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-800">
                      {partyData.party.type}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-1">
                    {partyData.party.phone || "No phone"} • {partyData.party.address || "No address"}
                  </p>
                  {partyData.party.creditLimit && (
                    <p className="text-xs text-slate-500 mt-0.5">
                      Credit Limit: <strong>PKR {partyData.party.creditLimit.toLocaleString()}</strong>
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  <div className="text-right">
                    <p className="text-[10px] text-slate-500 font-semibold uppercase">Opening (b/f)</p>
                    <p className="text-sm font-bold text-slate-700">
                      PKR {Math.abs(partyData.openingBalance).toLocaleString()}{" "}
                      <span className="text-[10px] text-slate-500">{partyData.openingBalance >= 0 ? "Dr" : "Cr"}</span>
                    </p>
                  </div>

                  <div className="text-right border-l border-sky-200 pl-4">
                    <p className="text-[10px] text-slate-500 font-semibold uppercase">Closing Balance</p>
                    <p className={`text-base font-bold ${partyData.closingBalance >= 0 ? "text-emerald-800" : "text-rose-800"}`}>
                      PKR {Math.abs(partyData.closingBalance).toLocaleString()}{" "}
                      <span className="text-[10px] font-semibold">{partyData.closingBalance >= 0 ? "Dr (Receivable)" : "Cr (Payable)"}</span>
                    </p>
                  </div>

                  <Button asChild size="sm" className="bg-sky-800 text-white hover:bg-sky-700 text-xs shadow-xs">
                    <a
                      href={`/api/pdf/reports/party-statement?download=true&partyId=${partyData.party.id}${partyStart ? `&startDate=${partyStart}` : ""}${partyEnd ? `&endDate=${partyEnd}` : ""}${selectedProductId !== "ALL" ? `&productId=${selectedProductId}` : ""}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Download className="mr-1.5 h-3.5 w-3.5" />
                      Download PDF
                    </a>
                  </Button>
                </div>
              </div>

              {/* Product Breakdown if filter selected */}
              {partyData.productTransactions.length > 0 && (
                <Card className="border-slate-200">
                  <CardHeader className="pb-3 border-b border-slate-100">
                    <CardTitle className="text-sm font-bold">Item-Wise Purchase/Sale History</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="divide-y divide-slate-100 text-xs">
                      {partyData.productTransactions.map((tx, idx) => (
                        <div key={idx} className="p-3 flex justify-between items-center hover:bg-slate-50/50">
                          <div>
                            <span className="font-semibold text-slate-900">{tx.docNo}</span>
                            <span className="ml-2 text-slate-500">({tx.docType})</span>
                            <p className="text-[11px] text-slate-400">{format(new Date(tx.date), "dd MMM yyyy")}</p>
                          </div>
                          <div className="text-right">
                            <span className="font-bold text-slate-900">
                              {tx.quantity} {tx.unit} @ PKR {tx.unitPrice}
                            </span>
                            <p className="text-[11px] font-semibold text-emerald-800">
                              PKR {tx.total.toLocaleString()}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Running Ledger Rows */}
              <Card className="border-slate-200">
                <CardHeader className="pb-3 border-b border-slate-100 flex flex-row items-center justify-between">
                  <CardTitle className="text-sm font-bold">Account Statement & Running Balance</CardTitle>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.print()}
                      className="h-8 text-xs border-slate-200"
                    >
                      <Printer className="mr-1.5 h-3.5 w-3.5" />
                      Print
                    </Button>
                    <Button asChild size="sm" variant="outline" className="h-8 text-xs border-slate-200">
                      <a
                        href={`/api/pdf/reports/party-statement?partyId=${partyData.party.id}${partyStart ? `&startDate=${partyStart}` : ""}${partyEnd ? `&endDate=${partyEnd}` : ""}${selectedProductId !== "ALL" ? `&productId=${selectedProductId}` : ""}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Download className="mr-1.5 h-3.5 w-3.5 text-slate-600" />
                        PDF Preview
                      </a>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {/* Opening Balance Row */}
                  <div className="p-3 bg-amber-50/70 border-b border-amber-200/60 flex items-center justify-between text-xs font-semibold text-amber-950">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-amber-200/80 px-1.5 py-0.5 text-[10px] font-bold text-amber-900 uppercase tracking-wide">
                        Opening b/f
                      </span>
                      <span>Opening Balance Brought Forward</span>
                    </div>
                    <div className="text-right font-bold text-slate-900">
                      PKR {Math.abs(partyData.openingBalance).toLocaleString()}{" "}
                      <span className="text-[10px] font-semibold text-slate-500">
                        {partyData.openingBalance >= 0 ? "Dr (Receivable)" : "Cr (Payable)"}
                      </span>
                    </div>
                  </div>

                  {partyData.ledgerRows.length === 0 ? (
                    <p className="p-6 text-center text-xs text-slate-500">No ledger entries for the selected range.</p>
                  ) : (
                    <div className="divide-y divide-slate-100 text-xs">
                      {partyData.ledgerRows.map((row) => (
                        <div key={row.id} className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-slate-50/50">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-800">
                                {format(new Date(row.date), "dd MMM yyyy")}
                              </span>
                              <span className="text-[10px] font-bold rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
                                {row.referenceType}
                              </span>
                            </div>
                            <p className="text-slate-600">{row.description}</p>
                          </div>

                          <div className="flex items-center gap-4 text-right">
                            {row.debit > 0 && (
                              <div>
                                <span className="text-[10px] text-slate-400 block">Debit</span>
                                <span className="font-bold text-emerald-800">PKR {row.debit.toLocaleString()}</span>
                              </div>
                            )}
                            {row.credit > 0 && (
                              <div>
                                <span className="text-[10px] text-slate-400 block">Credit</span>
                                <span className="font-bold text-amber-800">PKR {row.credit.toLocaleString()}</span>
                              </div>
                            )}
                            <div className="border-l border-slate-200 pl-3">
                              <span className="text-[10px] text-slate-400 block">Balance</span>
                              <span className="font-bold text-slate-900">PKR {row.runningBalance.toLocaleString()}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Summary Footer */}
                  <div className="p-3.5 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-6">
                      <div>
                        <span className="text-[10px] text-slate-500 block uppercase font-medium">Period Debits</span>
                        <span className="font-bold text-emerald-800">PKR {partyData.totalPeriodDebits.toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block uppercase font-medium">Period Credits</span>
                        <span className="font-bold text-amber-800">PKR {partyData.totalPeriodCredits.toLocaleString()}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-slate-500 block uppercase font-medium">Closing Balance</span>
                      <span className={`text-sm font-bold ${partyData.closingBalance >= 0 ? "text-emerald-800" : "text-rose-800"}`}>
                        PKR {Math.abs(partyData.closingBalance).toLocaleString()}{" "}
                        {partyData.closingBalance >= 0 ? "Dr (Receivable)" : "Cr (Payable)"}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

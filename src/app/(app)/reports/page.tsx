"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { canPerformAction } from "@/lib/auth/permissions";
import { cleanPartyDisplayName } from "@/lib/party-display";
import {
  BarChart3,
  Calendar,
  DollarSign,
  TrendingUp,
  FileSpreadsheet,
  Users,
  Printer,
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
  expenseItems?: Array<{
    id: string;
    date: string;
    partyId: string | null;
    partyName: string | null;
    referenceType: string;
    referenceId: string;
    description: string;
    amount: number;
  }>;
  salesBreakdown?: Array<{
    id: string;
    date: string;
    partyId: string;
    partyName: string;
    referenceType: string;
    referenceId: string;
    description: string;
    amount: number;
  }>;
  purchasesBreakdown?: Array<{
    id: string;
    date: string;
    partyId: string;
    partyName: string;
    referenceType: string;
    referenceId: string;
    description: string;
    amount: number;
  }>;
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
  receivablesSchedule?: Array<{
    partyId: string;
    partyName: string;
    partyType: string;
    phone: string | null;
    balance: number;
    referenceType: string;
    referenceId: string;
    asOfDate: string;
  }>;
  payablesSchedule?: Array<{
    partyId: string;
    partyName: string;
    partyType: string;
    phone: string | null;
    balance: number;
    referenceType: string;
    referenceId: string;
    asOfDate: string;
  }>;
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
    partyId?: string | null;
    partyName?: string | null;
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
  openingBalanceSourceYear?: string | null;
  totalPeriodDebits: number;
  totalPeriodCredits: number;
  closingBalance: number;
  currentBalance: number;
  ledgerRows: Array<{
    id: string;
    date: Date;
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const canView = !session?.user ? true : canPerformAction(session.user.role, "reports", "view", (session.user as any).permissions);

  useEffect(() => {
    if (session?.user && !canView) {
      router.replace("/dashboard");
    }
  }, [session, canView, router]);

  const [tab, setTab] = useState<"PL" | "CASH" | "BS" | "PARTY">("PL");

  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam === "BS" || tabParam === "PL" || tabParam === "CASH" || tabParam === "PARTY") {
      setTab(tabParam);
    }
  }, [searchParams]);

  // P&L State
  const [plStart, setPlStart] = useState("");
  const [plEnd, setPlEnd] = useState("");
  const [plData, setPlData] = useState<ProfitLossData | null>(null);
  const [plDetailTab, setPlDetailTab] = useState<"summary" | "sales" | "purchases" | "expenses">("summary");

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

  const formatMoney = (value: number) =>
    (Number.isFinite(value) ? value : 0).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  function getReferenceRoute(referenceType: string, referenceId: string) {
    switch (referenceType) {
      case "SALE_INVOICE":
        return `/sales/${referenceId}`;
      case "PURCHASE_INVOICE":
        return `/purchases/${referenceId}`;
      case "PAYMENT":
        return `/payments?paymentId=${referenceId}`;
      case "SALE_RETURN":
        return `/returns?saleReturnId=${referenceId}`;
      case "PURCHASE_RETURN":
        return `/returns?purchaseReturnId=${referenceId}`;
      default:
        return "/reports?tab=PARTY";
    }
  }

  function getBalanceText(value: number) {
    const abs = Math.abs(value);
    return `${formatMoney(abs)} ${value >= 0 ? "Debit" : "Credit"}`;
  }

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
    <div className="space-y-3">
      {/* Printable Black & White Header (Only visible when printing) */}
      <div className="hidden print:block mb-4 border-b-2 border-black pb-2 text-black">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-xl font-bold uppercase tracking-tight">Paper Trade Management</h1>
            <p className="text-xs font-semibold uppercase">
              {tab === "PL" && "Income Statement (Profit & Loss)"}
              {tab === "CASH" && "Cash Flow Statement"}
              {tab === "BS" && "Balance Sheet Statement"}
              {tab === "PARTY" && "Party Account Statement"}
            </p>
          </div>
          <div className="text-right text-[10px] space-y-0.5">
            <p>Printed: {format(new Date(), "dd/MM/yyyy HH:mm")}</p>
            {tab === "PL" && <p>Period: {plStart || "Beginning"} to {plEnd || "Present"}</p>}
            {tab === "CASH" && <p>Period: {cfStart || "Beginning"} to {cfEnd || "Present"}</p>}
            {tab === "BS" && <p>As of: {bsDate || "Current"}</p>}
            {tab === "PARTY" && partyData && (
              <>
                <p>Party: {cleanPartyDisplayName(partyData.party.name)} ({partyData.party.type})</p>
                <p>Period: {partyStart || "Beginning"} to {partyEnd || "Present"}</p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Top Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-2.5 rounded-md shadow-xs print:hidden">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-50 dark:bg-emerald-950/40 rounded-md border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300">
            <BarChart3 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900 dark:text-slate-100 tracking-tight">
              Financial Reports & Statements
            </h1>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              P&L, Cash Flow, Balance Sheet, and Party Statements directly from transactional ledger records
            </p>
          </div>
        </div>

        {/* Quick Jump Navigation */}
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" className="h-8 text-xs border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
            <Link href="/ledger">
              General Ledger
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="h-8 text-xs border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
            <Link href="/receivables-payables">
              Receivables / Payables
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="h-8 text-xs border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
            <Link href="/payments">
              Payments
            </Link>
          </Button>
        </div>
      </div>

      {/* Segmented Report Tabs */}
      <div className="flex flex-wrap gap-1 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 p-1 shadow-2xs print:hidden">
        <button
          onClick={() => setTab("PL")}
          className={`flex-1 min-w-[130px] rounded px-3 py-1.5 text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
            tab === "PL"
              ? "bg-white dark:bg-slate-800 text-emerald-800 dark:text-emerald-300 shadow-xs font-bold"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
          }`}
        >
          <TrendingUp className="h-3.5 w-3.5 text-emerald-700" />
          Income Statement (P&L)
        </button>
        <button
          onClick={() => setTab("CASH")}
          className={`flex-1 min-w-[110px] rounded px-3 py-1.5 text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
            tab === "CASH"
              ? "bg-white dark:bg-slate-800 text-teal-800 dark:text-teal-300 shadow-xs font-bold"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
          }`}
        >
          <Wallet className="h-3.5 w-3.5 text-teal-700" />
          Cash Flow
        </button>
        <button
          onClick={() => setTab("BS")}
          className={`flex-1 min-w-[110px] rounded px-3 py-1.5 text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
            tab === "BS"
              ? "bg-white dark:bg-slate-800 text-amber-800 dark:text-amber-300 shadow-xs font-bold"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
          }`}
        >
          <FileSpreadsheet className="h-3.5 w-3.5 text-amber-700" />
          Balance Sheet
        </button>
        <button
          onClick={() => setTab("PARTY")}
          className={`flex-1 min-w-[120px] rounded px-3 py-1.5 text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
            tab === "PARTY"
              ? "bg-white dark:bg-slate-800 text-sky-800 dark:text-sky-300 shadow-xs font-bold"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
          }`}
        >
          <Users className="h-3.5 w-3.5 text-sky-700" />
          Party Statement
        </button>
      </div>

      {/* Tab 1: Profit & Loss */}
      {tab === "PL" && (
        <div className="space-y-6">
          <Card className="border-slate-200/80 bg-white print:hidden">
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
              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
                <Button onClick={fetchPL} size="sm" variant="outline" className="text-xs">
                  Recalculate
                </Button>
                <Button asChild size="sm" variant="outline" className="text-xs border-emerald-300 text-emerald-800 hover:bg-emerald-50">
                  <a
                    href={`/api/excel/reports/profit-loss?${plStart ? `startDate=${plStart}&` : ""}${plEnd ? `endDate=${plEnd}` : ""}`}
                    download
                  >
                    <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5 text-emerald-700" />
                    Download Excel
                  </a>
                </Button>
                <Button
                  type="button"
                  onClick={() => window.print()}
                  size="sm"
                  className="bg-emerald-800 text-white hover:bg-emerald-700 text-xs shadow-xs gap-1.5"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print P&L
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
                  <div className="flex items-center gap-2">
                    <Button asChild variant="outline" size="sm" className="h-8 text-xs border-slate-200">
                      <a
                        href={`/api/excel/reports/profit-loss?${plStart ? `startDate=${plStart}&` : ""}${plEnd ? `endDate=${plEnd}` : ""}`}
                        download
                      >
                        <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5 text-emerald-700" />
                        Excel
                      </a>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => window.print()}
                      className="h-8 text-xs border-slate-200 gap-1.5"
                    >
                      <Printer className="h-3.5 w-3.5 text-slate-600" />
                      Print
                    </Button>
                  </div>
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

              {/* Detailed Transaction Breakdown (Sales, Purchases, Expenses) with Party ID & Reference ID */}
              <Card className="border-slate-200 bg-white">
                <CardHeader className="pb-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-sm font-bold">Transaction Audit Breakdown</CardTitle>
                    <CardDescription className="text-xs">
                      Inspect individual sales, purchases, and expenses with counterparty IDs and reference tracking
                    </CardDescription>
                  </div>
                  <div className="flex rounded-md border border-slate-200 bg-slate-50 p-0.5 text-xs">
                    <button
                      onClick={() => setPlDetailTab("summary")}
                      className={`px-2.5 py-1 rounded font-medium transition-colors ${
                        plDetailTab === "summary" ? "bg-white text-slate-900 font-bold shadow-2xs" : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      Summary
                    </button>
                    <button
                      onClick={() => setPlDetailTab("sales")}
                      className={`px-2.5 py-1 rounded font-medium transition-colors ${
                        plDetailTab === "sales" ? "bg-white text-emerald-900 font-bold shadow-2xs" : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      Sales ({plData.salesBreakdown?.length || 0})
                    </button>
                    <button
                      onClick={() => setPlDetailTab("purchases")}
                      className={`px-2.5 py-1 rounded font-medium transition-colors ${
                        plDetailTab === "purchases" ? "bg-white text-amber-900 font-bold shadow-2xs" : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      Purchases ({plData.purchasesBreakdown?.length || 0})
                    </button>
                    <button
                      onClick={() => setPlDetailTab("expenses")}
                      className={`px-2.5 py-1 rounded font-medium transition-colors ${
                        plDetailTab === "expenses" ? "bg-white text-rose-900 font-bold shadow-2xs" : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      Expenses ({plData.expenseItems?.length || 0})
                    </button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {plDetailTab === "sales" && (
                    <div className="divide-y divide-slate-100 text-xs">
                      {(!plData.salesBreakdown || plData.salesBreakdown.length === 0) ? (
                        <p className="p-6 text-center text-slate-500">No sales transactions logged for this period.</p>
                      ) : (
                        plData.salesBreakdown.map((tx) => (
                          <div key={tx.id} className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-slate-50/50">
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-slate-800">
                                  {format(new Date(tx.date), "dd/MM/yyyy")}
                                </span>
                                <span className="font-semibold text-slate-900">{tx.partyName}</span>
                                {tx.partyId && tx.partyId !== "N/A" && (
                                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-600 border border-slate-200">
                                    Party ID: {tx.partyId}
                                  </span>
                                )}
                                <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800 border border-emerald-200">
                                  {tx.referenceType}
                                </span>
                                <span className="text-[10px] font-mono text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">
                                  Ref: {tx.referenceId}
                                </span>
                              </div>
                              <p className="text-slate-600">{tx.description}</p>
                            </div>
                            <div className="text-right">
                              <span className="font-bold text-emerald-800 text-sm">
                                PKR {tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {plDetailTab === "purchases" && (
                    <div className="divide-y divide-slate-100 text-xs">
                      {(!plData.purchasesBreakdown || plData.purchasesBreakdown.length === 0) ? (
                        <p className="p-6 text-center text-slate-500">No purchase transactions logged for this period.</p>
                      ) : (
                        plData.purchasesBreakdown.map((tx) => (
                          <div key={tx.id} className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-slate-50/50">
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-slate-800">
                                  {format(new Date(tx.date), "dd/MM/yyyy")}
                                </span>
                                <span className="font-semibold text-slate-900">{tx.partyName}</span>
                                {tx.partyId && tx.partyId !== "N/A" && (
                                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-600 border border-slate-200">
                                    Party ID: {tx.partyId}
                                  </span>
                                )}
                                <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 border border-amber-200">
                                  {tx.referenceType}
                                </span>
                                <span className="text-[10px] font-mono text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">
                                  Ref: {tx.referenceId}
                                </span>
                              </div>
                              <p className="text-slate-600">{tx.description}</p>
                            </div>
                            <div className="text-right">
                              <span className="font-bold text-amber-800 text-sm">
                                PKR {tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {plDetailTab === "expenses" && (
                    <div className="divide-y divide-slate-100 text-xs">
                      {(!plData.expenseItems || plData.expenseItems.length === 0) ? (
                        <p className="p-6 text-center text-slate-500">No itemized expense records for this period.</p>
                      ) : (
                        plData.expenseItems.map((tx) => (
                          <div key={tx.id} className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-slate-50/50">
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-slate-800">
                                  {format(new Date(tx.date), "dd/MM/yyyy")}
                                </span>
                                {tx.partyName && (
                                  <span className="font-semibold text-slate-900">{tx.partyName}</span>
                                )}
                                {tx.partyId && (
                                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-600 border border-slate-200">
                                    Party ID: {tx.partyId}
                                  </span>
                                )}
                                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 border border-slate-200">
                                  {tx.referenceType}
                                </span>
                                <span className="text-[10px] font-mono text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">
                                  Ref: {tx.referenceId}
                                </span>
                              </div>
                              <p className="text-slate-600">{tx.description}</p>
                            </div>
                            <div className="text-right">
                              <span className="font-bold text-slate-800 text-sm">
                                PKR {tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {plDetailTab === "summary" && (
                    <div className="p-4 text-xs text-slate-600 space-y-2">
                      <p>
                        Click the tabs above (<strong>Sales</strong>, <strong>Purchases</strong>, or <strong>Expenses</strong>) to audit individual transactions contributing to this Income Statement, complete with counterparty IDs and document references.
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                        <div className="p-3 rounded-lg border border-slate-100 bg-slate-50">
                          <p className="text-slate-500 font-semibold">Total Sales Entries</p>
                          <p className="text-lg font-bold text-slate-800">{plData.salesBreakdown?.length || 0} Transactions</p>
                        </div>
                        <div className="p-3 rounded-lg border border-slate-100 bg-slate-50">
                          <p className="text-slate-500 font-semibold">Total Purchase Entries</p>
                          <p className="text-lg font-bold text-slate-800">{plData.purchasesBreakdown?.length || 0} Transactions</p>
                        </div>
                        <div className="p-3 rounded-lg border border-slate-100 bg-slate-50">
                          <p className="text-slate-500 font-semibold">Total Expense Entries</p>
                          <p className="text-lg font-bold text-slate-800">{plData.expenseItems?.length || 0} Records</p>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Cash Flow Statement */}
      {tab === "CASH" && (
        <div className="space-y-6">
          <Card className="border-slate-200/80 bg-white print:hidden">
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
              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
                <Button onClick={fetchCashFlow} size="sm" variant="outline" className="text-xs">
                  Recalculate
                </Button>
                <Button asChild size="sm" variant="outline" className="text-xs border-teal-300 text-teal-800 hover:bg-teal-50">
                  <a
                    href={`/api/excel/reports/cash-flow?${cfStart ? `startDate=${cfStart}&` : ""}${cfEnd ? `endDate=${cfEnd}` : ""}`}
                    download
                  >
                    <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5 text-teal-700" />
                    Download Excel
                  </a>
                </Button>
                <Button
                  type="button"
                  onClick={() => window.print()}
                  size="sm"
                  className="bg-teal-800 text-white hover:bg-teal-700 text-xs shadow-xs gap-1.5"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print Cash Flow
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
                  <div className="flex items-center gap-2">
                    <Button asChild variant="outline" size="sm" className="h-8 text-xs border-slate-200">
                      <a
                        href={`/api/excel/reports/cash-flow?${cfStart ? `startDate=${cfStart}&` : ""}${cfEnd ? `endDate=${cfEnd}` : ""}`}
                        download
                      >
                        <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5 text-teal-700" />
                        Excel
                      </a>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => window.print()}
                      className="h-8 text-xs border-slate-200 gap-1.5"
                    >
                      <Printer className="h-3.5 w-3.5 text-slate-600" />
                      Print
                    </Button>
                  </div>
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
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-slate-800">
                                {format(new Date(tx.date), "dd/MM/yyyy")}
                              </span>
                              <span className="text-[10px] font-bold rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
                                {tx.referenceType}
                              </span>
                              {tx.referenceId && (
                                <span className="text-[10px] font-mono text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                                  Ref: {tx.referenceId}
                                </span>
                              )}
                              {tx.partyName && (
                                <span className="text-[10px] font-medium text-slate-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                                  Party: {tx.partyName} {tx.partyId ? `(${tx.partyId.slice(-6)})` : ""}
                                </span>
                              )}
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
          <Card className="border-slate-200/80 bg-white print:hidden">
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
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={fetchBS} size="sm" variant="outline" className="text-xs">
                  Recalculate
                </Button>
                <Button asChild size="sm" variant="outline" className="text-xs border-amber-300 text-amber-900 hover:bg-amber-50">
                  <a
                    href={`/api/excel/reports/balance-sheet?${bsDate ? `asOfDate=${bsDate}` : ""}`}
                    download
                  >
                    <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5 text-amber-700" />
                    Download Excel
                  </a>
                </Button>
                <Button
                  type="button"
                  onClick={() => window.print()}
                  size="sm"
                  className="bg-amber-800 text-white hover:bg-amber-700 text-xs shadow-xs gap-1.5"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print Balance Sheet
                </Button>
              </div>
            </CardContent>
          </Card>

          {bsData && (
            <div className="space-y-6">
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

              {/* Receivables & Payables Detailed Party Schedules with Party ID & Reference ID */}
              <div className="grid gap-6 md:grid-cols-2">
                {/* Receivables Schedule */}
                <Card className="border-slate-200 bg-white">
                  <CardHeader className="border-b border-slate-100 pb-3">
                    <div className="flex justify-between items-center">
                      <div>
                        <CardTitle className="text-sm font-bold text-slate-900">Accounts Receivable Schedule</CardTitle>
                        <CardDescription className="text-xs">Outstanding customer balances with party tracking</CardDescription>
                      </div>
                      <span className="text-xs font-bold text-emerald-800">
                        {bsData.receivablesSchedule?.length || 0} Customers
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    {(!bsData.receivablesSchedule || bsData.receivablesSchedule.length === 0) ? (
                      <p className="p-6 text-center text-xs text-slate-500">No outstanding customer receivables.</p>
                    ) : (
                      <div className="divide-y divide-slate-100 text-xs max-h-96 overflow-y-auto">
                        {bsData.receivablesSchedule.map((item) => (
                          <div key={item.partyId} className="p-3 flex items-center justify-between hover:bg-slate-50/50">
                            <div className="space-y-0.5">
                              <p className="font-semibold text-slate-900">{item.partyName}</p>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[10px] font-mono text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                                  ID: {item.partyId}
                                </span>
                                {item.phone && (
                                  <span className="text-[10px] text-slate-500">{item.phone}</span>
                                )}
                                {item.referenceId && item.referenceId !== "—" && (
                                  <span className="text-[10px] font-mono text-slate-500 bg-slate-50 px-1 py-0.5 rounded border border-slate-200">
                                    Ref: {item.referenceId}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="text-right">
                              <span className="font-bold text-slate-900">
                                PKR {item.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </span>
                              <span className="text-[10px] text-emerald-700 block font-semibold">Dr (Receivable)</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Payables Schedule */}
                <Card className="border-slate-200 bg-white">
                  <CardHeader className="border-b border-slate-100 pb-3">
                    <div className="flex justify-between items-center">
                      <div>
                        <CardTitle className="text-sm font-bold text-slate-900">Accounts Payable Schedule</CardTitle>
                        <CardDescription className="text-xs">Outstanding supplier balances with party tracking</CardDescription>
                      </div>
                      <span className="text-xs font-bold text-amber-800">
                        {bsData.payablesSchedule?.length || 0} Suppliers
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    {(!bsData.payablesSchedule || bsData.payablesSchedule.length === 0) ? (
                      <p className="p-6 text-center text-xs text-slate-500">No outstanding supplier payables.</p>
                    ) : (
                      <div className="divide-y divide-slate-100 text-xs max-h-96 overflow-y-auto">
                        {bsData.payablesSchedule.map((item) => (
                          <div key={item.partyId} className="p-3 flex items-center justify-between hover:bg-slate-50/50">
                            <div className="space-y-0.5">
                              <p className="font-semibold text-slate-900">{item.partyName}</p>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[10px] font-mono text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                                  ID: {item.partyId}
                                </span>
                                {item.phone && (
                                  <span className="text-[10px] text-slate-500">{item.phone}</span>
                                )}
                                {item.referenceId && item.referenceId !== "—" && (
                                  <span className="text-[10px] font-mono text-slate-500 bg-slate-50 px-1 py-0.5 rounded border border-slate-200">
                                    Ref: {item.referenceId}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="text-right">
                              <span className="font-bold text-slate-900">
                                PKR {item.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </span>
                              <span className="text-[10px] text-rose-700 block font-semibold">Cr (Payable)</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Party Statement */}
      {tab === "PARTY" && (
        <div className="space-y-6">
          <Card className="border-slate-200/80 bg-white print:hidden">
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
                        {p.name}
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
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-lg font-bold text-slate-900">{cleanPartyDisplayName(partyData.party.name)}</h2>
                    <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-800">
                      {partyData.party.type}
                    </span>
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-mono font-semibold text-slate-700">
                      ID: {partyData.party.id}
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

                  <Button asChild size="sm" variant="outline" className="text-xs border-sky-300 text-sky-900 hover:bg-sky-50">
                    <a
                      href={`/api/excel/reports/party-statement?partyId=${partyData.party.id}${partyStart ? `&startDate=${partyStart}` : ""}${partyEnd ? `&endDate=${partyEnd}` : ""}${selectedProductId !== "ALL" ? `&productId=${selectedProductId}` : ""}`}
                      download
                    >
                      <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5 text-sky-700" />
                      Download Excel
                    </a>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => window.print()}
                    className="bg-sky-800 text-white hover:bg-sky-700 text-xs shadow-xs gap-1.5"
                  >
                    <Printer className="h-3.5 w-3.5" />
                    Print Statement
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
                            <p className="text-[11px] text-slate-400">{format(new Date(tx.date), "dd/MM/yyyy")}</p>
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

              <Card className="border-slate-200">
                <CardHeader className="pb-3 border-b border-slate-100 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-bold">Ledger For The Period</CardTitle>
                    <CardDescription className="text-[11px]">
                      {partyStart || "Start"} to {partyEnd || "Present"}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => window.print()} className="h-8 text-xs border-slate-200 gap-1.5">
                      <Printer className="mr-1.5 h-3.5 w-3.5" />
                      Print
                    </Button>
                    <Button asChild size="sm" variant="outline" className="h-8 text-xs border-slate-200">
                      <a
                        href={`/api/excel/reports/party-statement?partyId=${partyData.party.id}${partyStart ? `&startDate=${partyStart}` : ""}${partyEnd ? `&endDate=${partyEnd}` : ""}${selectedProductId !== "ALL" ? `&productId=${selectedProductId}` : ""}`}
                        download
                      >
                        <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5 text-emerald-700" />
                        Excel
                      </a>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-[11px] border-collapse">
                      <thead className="bg-slate-100 text-slate-700">
                        <tr>
                          <th className="border-b border-slate-200 px-2 py-2 text-left font-bold">Date</th>
                          <th className="border-b border-slate-200 px-2 py-2 text-left font-bold">Tran. No.</th>
                          <th className="border-b border-slate-200 px-2 py-2 text-left font-bold">Description</th>
                          <th className="border-b border-slate-200 px-2 py-2 text-right font-bold">Credit</th>
                          <th className="border-b border-slate-200 px-2 py-2 text-right font-bold">Debit</th>
                          <th className="border-b border-slate-200 px-2 py-2 text-right font-bold">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="bg-amber-50/80 text-amber-950">
                          <td className="border-b border-amber-200 px-2 py-2">{partyStart || "—"}</td>
                          <td className="border-b border-amber-200 px-2 py-2 font-semibold">B/F</td>
                          <td className="border-b border-amber-200 px-2 py-2 font-semibold">Balance Brought Forward</td>
                          <td className="border-b border-amber-200 px-2 py-2 text-right">{partyData.openingBalance < 0 ? formatMoney(Math.abs(partyData.openingBalance)) : "—"}</td>
                          <td className="border-b border-amber-200 px-2 py-2 text-right">{partyData.openingBalance >= 0 ? formatMoney(Math.abs(partyData.openingBalance)) : "—"}</td>
                          <td className="border-b border-amber-200 px-2 py-2 text-right font-bold">{getBalanceText(partyData.openingBalance)}</td>
                        </tr>

                        {partyData.ledgerRows.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-2 py-6 text-center text-slate-500">No ledger entries for the selected range.</td>
                          </tr>
                        ) : (
                          partyData.ledgerRows.map((row) => {
                            const href = getReferenceRoute(row.referenceType, row.referenceId);
                            const isClickable = row.referenceId && href && href !== "/reports?tab=PARTY";
                            const balanceLabel = row.runningBalance >= 0 ? "Debit" : "Credit";

                            return (
                              <tr key={row.id} className="align-top hover:bg-slate-50/80">
                                <td className="border-b border-slate-200 px-2 py-2 align-top">{format(new Date(row.date), "dd-MM-yyyy")}</td>
                                <td className="border-b border-slate-200 px-2 py-2 align-top font-semibold text-slate-700">
                                  {isClickable ? (
                                    <Link href={href} className="text-sky-700 underline underline-offset-2 hover:text-sky-900">
                                      {row.referenceDocNo || row.referenceType}
                                    </Link>
                                  ) : (
                                    row.referenceDocNo || row.referenceType
                                  )}
                                </td>
                                <td className="border-b border-slate-200 px-2 py-2 align-top">
                                  <div className="font-medium text-slate-800">{row.description}</div>
                                  {row.detailRows && row.detailRows.length > 0 && (
                                    <div className="mt-2 space-y-1 border-l border-slate-200 pl-2 text-[10px] text-slate-600">
                                      {row.detailRows.map((item, idx) => (
                                        <div key={`${row.id}-${idx}`} className="flex items-center justify-between gap-3">
                                          <span>{item.productName}</span>
                                          <span>{item.quantity} {item.unit} @ {formatMoney(item.rate)}</span>
                                          <span className="font-semibold text-slate-700">{formatMoney(item.amount)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </td>
                                <td className="border-b border-slate-200 px-2 py-2 text-right align-top text-amber-700 font-semibold">
                                  {row.credit > 0 ? formatMoney(row.credit) : "—"}
                                </td>
                                <td className="border-b border-slate-200 px-2 py-2 text-right align-top text-emerald-700 font-semibold">
                                  {row.debit > 0 ? formatMoney(row.debit) : "—"}
                                </td>
                                <td className="border-b border-slate-200 px-2 py-2 text-right align-top font-bold text-slate-900">
                                  {formatMoney(Math.abs(row.runningBalance))} {balanceLabel}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                      <tfoot>
                        <tr className="bg-slate-50 text-slate-900 font-bold">
                          <td colSpan={3} className="border-t border-slate-200 px-2 py-2 text-left">Total</td>
                          <td className="border-t border-slate-200 px-2 py-2 text-right text-amber-700">{formatMoney(partyData.totalPeriodCredits)}</td>
                          <td className="border-t border-slate-200 px-2 py-2 text-right text-emerald-700">{formatMoney(partyData.totalPeriodDebits)}</td>
                          <td className="border-t border-slate-200 px-2 py-2 text-right">{getBalanceText(partyData.closingBalance)}</td>
                        </tr>
                      </tfoot>
                    </table>
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

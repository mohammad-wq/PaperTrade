"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import {
  Calendar,
  Plus,
  Lock,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ArrowRight,
  ShieldCheck,
  ShieldAlert,
  Info,
  Layers,
  Receipt,
  ShoppingCart,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/utils";
import {
  listFinancialYearsAction,
  createFinancialYearAction,
  closeFinancialYearAction,
  activateFinancialYearAction,
  resetDocumentSequenceAction,
} from "@/actions/financial-years";

type FinancialYearItem = {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  isClosed: boolean;
  createdAt: string;
  sequences?: Array<{ documentType: string; lastSequence: number }>;
  documentCounts: {
    sales: number;
    purchases: number;
    purchaseOrders: number;
    deliveryOrders: number;
    saleReturns: number;
    purchaseReturns: number;
    openingBalances: number;
  };
};

export default function FinancialYearsPage() {
  const { data: session } = useSession();
  const isOwner = session?.user?.role === "OWNER";

  const [years, setYears] = useState<FinancialYearItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // New Year / Period Modal state
  const [showNewYearModal, setShowNewYearModal] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newStartDate, setNewStartDate] = useState("");
  const [newEndDate, setNewEndDate] = useState("");
  const [makeActiveNow, setMakeActiveNow] = useState(true);
  const [creatingYear, setCreatingYear] = useState(false);
  const [activatingYearId, setActivatingYearId] = useState<string | null>(null);

  // Close Year Modal state
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closingYear, setClosingYear] = useState<FinancialYearItem | null>(null);
  const [targetYearId, setTargetYearId] = useState("");
  const [customNextLabel, setCustomNextLabel] = useState("");
  const [customNextStart, setCustomNextStart] = useState("");
  const [customNextEnd, setCustomNextEnd] = useState("");
  const [closingYearProgress, setClosingYearProgress] = useState(false);

  async function loadData() {
    setLoading(true);
    setStatusMessage(null);
    try {
      const res = await listFinancialYearsAction();
      if (res.success) {
        setYears(res.data);
      } else {
        setStatusMessage({ type: "error", text: res.error || "Failed to load financial years." });
      }
    } catch {
      setStatusMessage({ type: "error", text: "An unexpected error occurred while loading financial years." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  function handleOpenNewYearModal() {
    // Propose reasonable default for the next year
    const lastYear = years[0];
    if (lastYear) {
      const lastEndDate = new Date(lastYear.endDate);
      const nextStart = new Date(lastEndDate.getTime() + 86400000);
      const nextStartYear = nextStart.getFullYear();
      const proposedLabel = `${nextStartYear}-${nextStartYear + 1}`;
      const proposedEnd = new Date(nextStartYear + 1, 11, 31);

      setNewLabel(proposedLabel);
      setNewStartDate(nextStart.toISOString().slice(0, 10));
      setNewEndDate(proposedEnd.toISOString().slice(0, 10));
    } else {
      const now = new Date();
      const curYear = now.getFullYear();
      setNewLabel(`${curYear}-${curYear + 1}`);
      setNewStartDate(`${curYear}-01-01`);
      setNewEndDate(`${curYear + 1}-12-31`);
    }
    setShowNewYearModal(true);
  }

  async function handleCreateYear(e: React.FormEvent) {
    e.preventDefault();
    setCreatingYear(true);
    setStatusMessage(null);

    try {
      const res = await createFinancialYearAction({
        label: newLabel.trim(),
        startDate: newStartDate,
        endDate: newEndDate,
        makeActive: makeActiveNow,
      });

      if (res.success) {
        setStatusMessage({
          type: "success",
          text: `Financial Period "${newLabel}" created successfully.${makeActiveNow ? " It is now the active accounting period." : ""}`,
        });
        setShowNewYearModal(false);
        await loadData();
      } else {
        setStatusMessage({ type: "error", text: res.error || "Failed to create financial year." });
      }
    } catch (err: any) {
      setStatusMessage({ type: "error", text: err.message || "Failed to create financial year." });
    } finally {
      setCreatingYear(false);
    }
  }

  async function handleActivateYear(fy: FinancialYearItem) {
    setActivatingYearId(fy.id);
    setStatusMessage(null);
    try {
      const res = await activateFinancialYearAction(fy.id);
      if (res.success) {
        setStatusMessage({
          type: "success",
          text: `Period "${fy.label}" is now ACTIVE. Subsequent documents will start with 001 for this period.`,
        });
        await loadData();
      } else {
        setStatusMessage({ type: "error", text: res.error || "Failed to activate period." });
      }
    } catch (err: any) {
      setStatusMessage({ type: "error", text: err.message || "Failed to activate period." });
    } finally {
      setActivatingYearId(null);
    }
  }

  async function handleResetSequence(docType: string, nextNo = 1) {
    if (!activeYear) return;
    try {
      const res = await resetDocumentSequenceAction({
        financialYearId: activeYear.id,
        documentType: docType as any,
        nextSequenceNo: nextNo,
      });
      if (res.success) {
        setStatusMessage({
          type: "success",
          text: `Sequence for ${docType} reset to #${String(nextNo).padStart(3, "0")}.`,
        });
        await loadData();
      } else {
        setStatusMessage({ type: "error", text: res.error || "Failed to reset sequence." });
      }
    } catch (err: any) {
      setStatusMessage({ type: "error", text: err.message || "Failed to reset sequence." });
    }
  }

  function applyPeriodPreset(preset: "ANNUAL" | "Q1" | "Q2" | "Q3" | "Q4" | "H1" | "H2") {
    const currentYear = new Date().getFullYear();
    if (preset === "ANNUAL") {
      setNewLabel(`${currentYear}`);
      setNewStartDate(`${currentYear}-01-01`);
      setNewEndDate(`${currentYear}-12-31`);
    } else if (preset === "Q1") {
      setNewLabel(`Q1-${currentYear}`);
      setNewStartDate(`${currentYear}-01-01`);
      setNewEndDate(`${currentYear}-03-31`);
    } else if (preset === "Q2") {
      setNewLabel(`Q2-${currentYear}`);
      setNewStartDate(`${currentYear}-04-01`);
      setNewEndDate(`${currentYear}-06-30`);
    } else if (preset === "Q3") {
      setNewLabel(`Q3-${currentYear}`);
      setNewStartDate(`${currentYear}-07-01`);
      setNewEndDate(`${currentYear}-09-30`);
    } else if (preset === "Q4") {
      setNewLabel(`Q4-${currentYear}`);
      setNewStartDate(`${currentYear}-10-01`);
      setNewEndDate(`${currentYear}-12-31`);
    } else if (preset === "H1") {
      setNewLabel(`H1-${currentYear}`);
      setNewStartDate(`${currentYear}-01-01`);
      setNewEndDate(`${currentYear}-06-30`);
    } else if (preset === "H2") {
      setNewLabel(`H2-${currentYear}`);
      setNewStartDate(`${currentYear}-07-01`);
      setNewEndDate(`${currentYear}-12-31`);
    }
  }

  function handleOpenCloseModal(fy: FinancialYearItem) {
    setClosingYear(fy);
    // Find candidate unclosed years that start after or match
    const upcomingCandidates = years.filter((y) => y.id !== fy.id && !y.isClosed);
    if (upcomingCandidates.length > 0) {
      setTargetYearId(upcomingCandidates[0].id);
    } else {
      setTargetYearId("");
      const fyEndDate = new Date(fy.endDate);
      const nextStart = new Date(fyEndDate.getTime() + 86400000);
      const nextStartYear = nextStart.getFullYear();
      setCustomNextLabel(`${nextStartYear}-${nextStartYear + 1}`);
      setCustomNextStart(nextStart.toISOString().slice(0, 10));
      setCustomNextEnd(new Date(nextStartYear + 1, 11, 31).toISOString().slice(0, 10));
    }
    setShowCloseModal(true);
  }

  async function handleConfirmCloseYear() {
    if (!closingYear) return;
    setClosingYearProgress(true);
    setStatusMessage(null);

    try {
      const payload: any = {
        closingYearId: closingYear.id,
      };
      if (targetYearId) {
        payload.targetYearId = targetYearId;
      } else {
        payload.targetYearLabel = customNextLabel.trim();
        payload.targetYearStartDate = customNextStart;
        payload.targetYearEndDate = customNextEnd;
      }

      const res = await closeFinancialYearAction(payload);
      if (res.success) {
        setStatusMessage({
          type: "success",
          text: `Financial Year ${res.data.closedYearLabel} has been closed. ${res.data.carriedBalancesCount} party balance(s) successfully carried forward to ${res.data.activeYearLabel} as Opening Balances.`,
        });
        setShowCloseModal(false);
        setClosingYear(null);
        await loadData();
      } else {
        setStatusMessage({ type: "error", text: res.error || "Failed to close financial year." });
      }
    } catch (err: any) {
      setStatusMessage({ type: "error", text: err.message || "Failed to close financial year." });
    } finally {
      setClosingYearProgress(false);
    }
  }

  if (!isOwner) {
    return (
      <div className="max-w-4xl p-6">
        <Card className="border-rose-200 bg-rose-50">
          <CardContent className="p-6 flex items-center gap-4">
            <ShieldAlert className="h-8 w-8 text-rose-600 shrink-0" />
            <div>
              <h2 className="text-base font-bold text-rose-900">Access Restricted</h2>
              <p className="text-xs text-rose-700 mt-1">
                Financial Year management and accounting period closures are strictly restricted to Company Owners.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const activeYear = years.find((y) => y.isActive);

  return (
    <div className="space-y-6 max-w-6xl pb-16">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-emerald-800" />
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Financial Years & Archiving</h1>
          </div>
          <p className="text-xs text-slate-600 mt-0.5">
            Manage accounting years, sequential document numbering, and balance carry-forward workflows.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={loading}
            className="h-8 text-xs px-2.5 text-slate-600"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>

          <Button
            size="sm"
            onClick={handleOpenNewYearModal}
            className="h-8 text-xs bg-emerald-800 text-white hover:bg-emerald-700 shadow-sm"
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Start New Year
          </Button>
        </div>
      </div>

      {/* Status feedback */}
      {statusMessage && (
        <div
          className={`rounded-lg p-3 text-xs flex items-center gap-2 border ${
            statusMessage.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-rose-50 border-rose-200 text-rose-800"
          }`}
        >
          {statusMessage.type === "success" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
          )}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Info Notice on Archiving */}
      <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 flex items-start gap-2.5 text-xs text-slate-700">
        <Info className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" />
        <div className="leading-relaxed space-y-1">
          <p className="font-semibold text-slate-900">How Financial Year Archiving Works:</p>
          <ul className="list-disc list-inside space-y-0.5 text-slate-600 text-[11px]">
            <li>Document sequence numbers reset annually per document type (formatted as <code className="bg-white px-1 py-0.2 rounded border text-emerald-800 font-bold">YYYY-0001</code>).</li>
            <li>Closing a year locks it against creating any new invoices, orders, or returns in that period.</li>
            <li>Closing automatically calculates each customer and supplier&apos;s net closing balance and creates an explicit <strong className="text-slate-800">Opening Balance</strong> entry in the new year referencing the closed year.</li>
            <li>Operational list views default to the active year with a quick toggle to view settled and prior-year archived documents.</li>
          </ul>
        </div>
      </div>

      {/* Active Year Highlight Card */}
      {activeYear && (
        <Card className="border-emerald-200 bg-emerald-50/40 shadow-xs">
          <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-700 text-white uppercase tracking-wider">
                  Active Period
                </span>
                <span className="text-lg font-bold text-slate-900">{activeYear.label}</span>
              </div>
              <p className="text-xs text-slate-600">
                {formatDate(activeYear.startDate)} &mdash; {formatDate(activeYear.endDate)}
              </p>
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600 pt-1">
                <span><strong>{activeYear.documentCounts.sales}</strong> Sales</span>
                <span>•</span>
                <span><strong>{activeYear.documentCounts.purchases}</strong> Purchases</span>
                <span>•</span>
                <span><strong>{activeYear.documentCounts.deliveryOrders}</strong> Delivery Orders</span>
                <span>•</span>
                <span><strong>{activeYear.documentCounts.purchaseOrders}</strong> Purchase Orders</span>
                <span>•</span>
                <span><strong>{activeYear.documentCounts.saleReturns + activeYear.documentCounts.purchaseReturns}</strong> Returns</span>
              </div>

              {/* Document Sequence Status */}
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-emerald-200 text-xs font-mono">
                <span className="text-[11px] font-sans font-bold text-slate-700">Next Document Sequences:</span>
                {[
                  { key: "SALE_INVOICE", label: "Sales Inv" },
                  { key: "PURCHASE_INVOICE", label: "Pur Inv" },
                  { key: "DELIVERY_ORDER", label: "DO" },
                  { key: "PURCHASE_ORDER", label: "PO" },
                ].map((dt) => {
                  const seqRec = activeYear.sequences?.find((s) => s.documentType === dt.key);
                  const lastSeq = seqRec ? seqRec.lastSequence : 0;
                  const nextPadded = String(lastSeq + 1).padStart(3, "0");
                  return (
                    <span
                      key={dt.key}
                      className="inline-flex items-center gap-1.5 bg-white border border-emerald-300 px-2 py-0.5 rounded text-[11px]"
                    >
                      <span className="text-slate-600">{dt.label}:</span>
                      <strong className="text-emerald-900">#{nextPadded}</strong>
                    </span>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleOpenCloseModal(activeYear)}
                className="h-8 text-xs border-amber-300 text-amber-900 bg-amber-50 hover:bg-amber-100 shadow-xs"
              >
                <Lock className="h-3.5 w-3.5 mr-1.5 text-amber-700" />
                Close Financial Year
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Financial Years List Table */}
      <Card className="border-slate-200 bg-white shadow-xs">
        <CardHeader className="pb-3 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Layers className="h-4 w-4 text-emerald-800" />
              All Financial Years
            </CardTitle>
            <span className="text-xs font-semibold text-slate-500">
              Total: {years.length} Periods
            </span>
          </div>
          <CardDescription className="text-xs">
            Complete history of company accounting cycles and archived documentation.
          </CardDescription>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-600 uppercase font-semibold text-[10px] tracking-wider border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2.5">Year Label</th>
                  <th className="px-4 py-2.5">Date Range</th>
                  <th className="px-4 py-2.5 text-center">Status</th>
                  <th className="px-4 py-2.5 text-center">Sales</th>
                  <th className="px-4 py-2.5 text-center">Purchases</th>
                  <th className="px-4 py-2.5 text-center">Orders & DOs</th>
                  <th className="px-4 py-2.5 text-center">Opening Balances</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {years.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-slate-400">
                      {loading ? "Loading financial years..." : "No financial years recorded."}
                    </td>
                  </tr>
                ) : (
                  years.map((fy) => {
                    const isYearActive = fy.isActive;
                    const isYearClosed = fy.isClosed;

                    return (
                      <tr
                        key={fy.id}
                        className={`hover:bg-slate-50/70 transition-colors ${
                          isYearActive ? "bg-emerald-50/20 font-medium" : ""
                        }`}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900 text-sm">{fy.label}</span>
                            {isYearActive && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                                ACTIVE
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                          {formatDate(fy.startDate)} &mdash; {formatDate(fy.endDate)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {isYearClosed ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-300">
                              <Lock className="h-3 w-3 text-slate-500" />
                              Closed
                            </span>
                          ) : isYearActive ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-300">
                              <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                              Open
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-50 text-sky-800 border border-sky-300">
                              Upcoming
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center font-mono font-medium">
                          {fy.documentCounts.sales}
                        </td>
                        <td className="px-4 py-3 text-center font-mono font-medium">
                          {fy.documentCounts.purchases}
                        </td>
                        <td className="px-4 py-3 text-center font-mono font-medium">
                          {fy.documentCounts.purchaseOrders + fy.documentCounts.deliveryOrders}
                        </td>
                        <td className="px-4 py-3 text-center font-mono font-medium">
                          {fy.documentCounts.openingBalances}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {isYearActive && !isYearClosed ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleOpenCloseModal(fy)}
                              className="h-7 text-xs px-2.5 text-amber-800 border-amber-300 bg-amber-50 hover:bg-amber-100"
                            >
                              <Lock className="h-3 w-3 mr-1" />
                              Close Year
                            </Button>
                          ) : !isYearClosed ? (
                            <Button
                              size="sm"
                              disabled={activatingYearId === fy.id}
                              onClick={() => handleActivateYear(fy)}
                              className="h-7 text-xs px-2.5 bg-emerald-700 hover:bg-emerald-800 text-white font-medium"
                            >
                              {activatingYearId === fy.id ? "Activating..." : "Activate Period"}
                            </Button>
                          ) : (
                            <span className="text-[11px] text-slate-400 italic">
                              Locked
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Start New Year Modal */}
      {showNewYearModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Plus className="h-4 w-4 text-emerald-800" />
                Start New Financial Year
              </h3>
              <button
                type="button"
                onClick={() => setShowNewYearModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateYear} className="p-5 space-y-4 text-xs">
              {/* Quick Period Presets */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Quick Period Presets</Label>
                <div className="flex flex-wrap gap-1">
                  {[
                    { key: "ANNUAL", label: "Annual / Full Year" },
                    { key: "Q1", label: "Q1 (Jan-Mar)" },
                    { key: "Q2", label: "Q2 (Apr-Jun)" },
                    { key: "Q3", label: "Q3 (Jul-Sep)" },
                    { key: "Q4", label: "Q4 (Oct-Dec)" },
                    { key: "H1", label: "H1 (Jan-Jun)" },
                    { key: "H2", label: "H2 (Jul-Dec)" },
                  ].map((preset) => (
                    <button
                      key={preset.key}
                      type="button"
                      onClick={() => applyPeriodPreset(preset.key as any)}
                      className="px-2 py-0.5 rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 text-[11px] font-medium text-slate-700"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="yearLabel" className="text-xs font-semibold">Period / Year Label *</Label>
                <Input
                  id="yearLabel"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="e.g. 2026, Q1-2026, H1-2026"
                  className="h-8 text-xs font-medium"
                  required
                />
                <p className="text-[10px] text-slate-500">
                  Document numbers will be prefixed with this label (e.g. {newLabel || "PERIOD"}-001).
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="startDate" className="text-xs font-semibold">Start Date *</Label>
                  <Input
                    id="startDate"
                    type="date"
                    value={newStartDate}
                    onChange={(e) => setNewStartDate(e.target.value)}
                    className="h-8 text-xs"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="endDate" className="text-xs font-semibold">End Date *</Label>
                  <Input
                    id="endDate"
                    type="date"
                    value={newEndDate}
                    onChange={(e) => setNewEndDate(e.target.value)}
                    className="h-8 text-xs"
                    required
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="makeActiveNow"
                  checked={makeActiveNow}
                  onChange={(e) => setMakeActiveNow(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                />
                <Label htmlFor="makeActiveNow" className="text-xs font-medium text-slate-700 cursor-pointer">
                  Activate this accounting period immediately (starts document numbers from 001)
                </Label>
              </div>

              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-[11px] text-slate-600 space-y-1">
                <p className="font-semibold text-slate-800">Note:</p>
                <p>Creating this year does not close the current year immediately. You can prepare upcoming periods in advance.</p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowNewYearModal(false)}
                  className="h-8 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={creatingYear}
                  className="h-8 text-xs bg-emerald-800 text-white hover:bg-emerald-700 shadow-sm"
                >
                  {creatingYear ? "Creating..." : "Create Financial Year"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Close Year Modal */}
      {showCloseModal && closingYear && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-amber-50">
              <h3 className="text-base font-bold text-amber-950 flex items-center gap-2">
                <Lock className="h-4 w-4 text-amber-800" />
                Close Financial Year: {closingYear.label}
              </h3>
              <button
                type="button"
                onClick={() => setShowCloseModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="p-3.5 bg-amber-50/70 border border-amber-200 rounded-lg text-amber-950 space-y-2 text-xs">
                <p className="font-bold flex items-center gap-1.5">
                  <AlertCircle className="h-4 w-4 text-amber-700 shrink-0" />
                  What happens upon closing:
                </p>
                <ol className="list-decimal list-inside space-y-1 text-[11px] text-amber-900">
                  <li><strong>Lock Accounting:</strong> Year <code className="font-bold">{closingYear.label}</code> is permanently marked CLOSED. No new sales, purchases, orders, or returns can be created in this period.</li>
                  <li><strong>Calculate Balances:</strong> The system computes each Customer and Supplier&apos;s closing balance as of the year end date ({formatDate(closingYear.endDate)}).</li>
                  <li><strong>Carry Forward Balances:</strong> Creates an official <code className="font-bold">Opening Balance</code> ledger entry in the new year for each non-zero balance with an explicit link to <code className="font-bold">{closingYear.label}</code>.</li>
                  <li><strong>Activate New Year:</strong> The designated new year is marked active and document sequence numbers restart from <code className="font-bold">0001</code>.</li>
                </ol>
              </div>

              {/* Target Year Selection */}
              <div className="space-y-3 pt-1">
                <Label className="text-xs font-semibold text-slate-800">Designate Next Active Year</Label>

                {years.filter((y) => y.id !== closingYear.id && !y.isClosed).length > 0 ? (
                  <div className="space-y-2">
                    <select
                      value={targetYearId}
                      onChange={(e) => setTargetYearId(e.target.value)}
                      className="w-full h-9 rounded-md border border-slate-300 bg-white px-3 py-1 text-xs shadow-xs focus:outline-hidden focus:ring-1 focus:ring-emerald-700"
                    >
                      {years
                        .filter((y) => y.id !== closingYear.id && !y.isClosed)
                        .map((y) => (
                          <option key={y.id} value={y.id}>
                            {y.label} ({formatDate(y.startDate)} to {formatDate(y.endDate)})
                          </option>
                        ))}
                    </select>
                  </div>
                ) : (
                  <div className="space-y-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    <p className="text-[11px] text-slate-600 font-medium">
                      No upcoming financial year exists yet. Define the new year to activate immediately:
                    </p>
                    <div className="space-y-1">
                      <Label className="text-[11px] font-semibold">New Year Label *</Label>
                      <Input
                        value={customNextLabel}
                        onChange={(e) => setCustomNextLabel(e.target.value)}
                        className="h-8 text-xs"
                        placeholder="e.g. 2027-2028"
                        required
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[11px] font-semibold">Start Date *</Label>
                        <Input
                          type="date"
                          value={customNextStart}
                          onChange={(e) => setCustomNextStart(e.target.value)}
                          className="h-8 text-xs"
                          required
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] font-semibold">End Date *</Label>
                        <Input
                          type="date"
                          value={customNextEnd}
                          onChange={(e) => setCustomNextEnd(e.target.value)}
                          className="h-8 text-xs"
                          required
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCloseModal(false)}
                  disabled={closingYearProgress}
                  className="h-8 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleConfirmCloseYear}
                  disabled={closingYearProgress}
                  className="h-8 text-xs bg-amber-800 text-white hover:bg-amber-700 shadow-sm"
                >
                  {closingYearProgress ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      Closing & Carrying Balances...
                    </>
                  ) : (
                    <>
                      <Lock className="h-3.5 w-3.5 mr-1.5" />
                      Confirm & Close Financial Year
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


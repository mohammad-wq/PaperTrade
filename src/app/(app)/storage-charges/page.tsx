"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import {
  Warehouse,
  Plus,
  Calendar,
  AlertCircle,
  Calculator,
  Search,
  X,
  RefreshCw,
  FileSpreadsheet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  listStorageChargesAction,
  createStorageChargeAction,
} from "@/actions/storage-charges";
import { listLocationsAction } from "@/actions/orders";
import { format } from "date-fns";
import { useRealtimeListener } from "@/hooks/use-realtime";
import { useConfirm } from "@/components/providers/confirm-provider";

type StorageChargeRow = {
  id: string;
  weightInTonnes: number;
  ratePerTonne: number;
  periodStart: Date;
  periodEnd: Date;
  totalCharge: number;
  createdAt: Date;
  location: { id: string; name: string };
};

export default function StorageChargesPage() {
  const confirm = useConfirm();
  const [charges, setCharges] = useState<StorageChargeRow[]>([]);
  const [locations, setLocations] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLocationFilter, setSelectedLocationFilter] = useState("ALL");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Modal State
  const [showPostModal, setShowPostModal] = useState(false);

  // Form State
  const [locationId, setLocationId] = useState("");
  const [weightInTonnes, setWeightInTonnes] = useState<number | "">("");
  const [ratePerTonne, setRatePerTonne] = useState<number | "">("");
  const [periodStart, setPeriodStart] = useState(new Date().toISOString().slice(0, 10));
  const [periodEnd, setPeriodEnd] = useState(new Date().toISOString().slice(0, 10));
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadData(isBackground = false) {
    if (!isBackground) setLoading(true);
    try {
      const [chargeRes, locRes] = await Promise.all([
        listStorageChargesAction(),
        listLocationsAction(),
      ]);

      if (chargeRes.success && chargeRes.data) {
        setCharges(chargeRes.data as StorageChargeRow[]);
      }
      if (locRes.success && locRes.data) {
        const unique = locRes.data as Array<{ id: string; name: string }>;
        setLocations(unique);
        if (unique.length > 0 && !locationId) {
          const warehouseLoc = unique.find((l) => l.name.toLowerCase().includes("warehouse")) || unique[0];
          setLocationId(warehouseLoc.id);
        }
      }
    } finally {
      if (!isBackground) setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useRealtimeListener(["storage-charges", "expenses"], () => {
    void loadData(true);
  });

  // Keyboard shortcuts: F2/Insert opens modal, Esc closes, / focuses search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "F2" || e.key === "Insert") {
        e.preventDefault();
        setShowPostModal(true);
      } else if (e.key === "Escape" && showPostModal) {
        e.preventDefault();
        setShowPostModal(false);
      } else if (
        e.key === "/" &&
        !showPostModal &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showPostModal]);

  const calculatedTotal = useMemo(() => {
    const w = Number(weightInTonnes) || 0;
    const r = Number(ratePerTonne) || 0;
    return w * r;
  }, [weightInTonnes, ratePerTonne]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!locationId) {
      setFormError("Please select a storage warehouse.");
      return;
    }
    if (!weightInTonnes || Number(weightInTonnes) <= 0) {
      setFormError("Weight in tonnes must be greater than 0.");
      return;
    }
    if (ratePerTonne === "" || Number(ratePerTonne) < 0) {
      setFormError("Rate per tonne must be 0 or greater.");
      return;
    }
    if (new Date(periodEnd) < new Date(periodStart)) {
      setFormError("Period end date cannot be before period start date.");
      return;
    }

    const ok = await confirm({
      title: "Post Storage Charge",
      description: "Are you sure you want to post this storage charge to the accounts ledger?",
      confirmText: "Post Charge",
      variant: "primary",
    });
    if (!ok) return;

    setSubmitting(true);
    try {
      const res = await createStorageChargeAction({
        locationId,
        weightInTonnes: Number(weightInTonnes),
        ratePerTonne: Number(ratePerTonne),
        periodStart: new Date(periodStart),
        periodEnd: new Date(periodEnd),
      });

      if (!res.success) {
        setFormError(res.error || "Failed to post storage charge.");
      } else {
        setWeightInTonnes("");
        setRatePerTonne("");
        setPeriodStart(new Date().toISOString().slice(0, 10));
        setPeriodEnd(new Date().toISOString().slice(0, 10));
        setShowPostModal(false);
        await loadData();
      }
    } finally {
      setSubmitting(false);
    }
  }

  const totalHistoricalStorage = useMemo(
    () => charges.reduce((sum, c) => sum + c.totalCharge, 0),
    [charges],
  );

  const filteredCharges = useMemo(() => {
    return charges.filter((c) => {
      if (selectedLocationFilter !== "ALL" && c.location.id !== selectedLocationFilter) {
        return false;
      }
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        c.location.name.toLowerCase().includes(q) ||
        format(new Date(c.periodStart), "dd/MM/yyyy").includes(q) ||
        format(new Date(c.periodEnd), "dd/MM/yyyy").includes(q) ||
        c.totalCharge.toString().includes(q) ||
        c.weightInTonnes.toString().includes(q)
      );
    });
  }, [charges, selectedLocationFilter, searchQuery]);

  function exportToCSV() {
    const headers = ["Warehouse Location", "Period Start", "Period End", "Weight (Tonnes)", "Rate / Tonne (PKR)", "Total Charge (PKR)", "Posted Date"];
    const rows = filteredCharges.map((c) => [
      `"${c.location.name.replace(/"/g, '""')}"`,
      format(new Date(c.periodStart), "yyyy-MM-dd"),
      format(new Date(c.periodEnd), "yyyy-MM-dd"),
      c.weightInTonnes,
      c.ratePerTonne,
      c.totalCharge.toFixed(2),
      format(new Date(c.createdAt), "yyyy-MM-dd HH:mm"),
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Storage_Charges_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <div className="space-y-3">
      {/* Top Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-2.5 rounded-md shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-50 dark:bg-amber-950/40 rounded-md border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300">
            <Warehouse className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900 dark:text-slate-100 tracking-tight">
              Warehouse Storage Charges
            </h1>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Compute tonnage fees for off-site godowns & post directly to ledger expense
            </p>
          </div>
        </div>

        {/* Aggregate KPI Chips */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-mono">
          <span className="px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            Total Accrued: <strong>PKR {totalHistoricalStorage.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</strong>
          </span>
          <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
            Records: <strong>{charges.length}</strong>
          </span>
          <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
            Godowns: <strong>{locations.length}</strong>
          </span>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => loadData()}
            className="h-8 text-xs border-slate-200 dark:border-slate-800"
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Refresh
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={exportToCSV}
            className="h-8 text-xs border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300"
          >
            <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5 text-emerald-700" />
            Export CSV
          </Button>
          <Button
            type="button"
            onClick={() => setShowPostModal(true)}
            size="sm"
            className="h-8 bg-amber-800 hover:bg-amber-700 text-white text-xs shadow-xs font-semibold"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Post Storage Charge <span className="ml-1 opacity-70 text-[10px] font-mono">[F2]</span>
          </Button>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="flex flex-col sm:flex-row gap-2 items-center justify-between bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2.5 rounded-md shadow-xs">
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <Input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search storage records (Press / to focus)..."
              className="pl-8 h-8 text-xs bg-slate-50 dark:bg-slate-950"
            />
            {searchQuery && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSearchQuery("")}
                className="absolute right-1 top-1 h-6 px-1.5 text-[10px] text-slate-500"
              >
                Clear
              </Button>
            )}
          </div>

          <select
            value={selectedLocationFilter}
            onChange={(e) => setSelectedLocationFilter(e.target.value)}
            className="h-8 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-2.5 text-xs text-slate-700 dark:text-slate-300"
          >
            <option value="ALL">All Warehouses</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
        </div>

        <span className="text-xs text-slate-500 font-mono">
          Showing {filteredCharges.length} of {charges.length} records
        </span>
      </div>

      {/* High-Density Full-Width Storage Records Table */}
      <div className="overflow-hidden rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                <th className="py-2.5 px-3">Warehouse Godown</th>
                <th className="py-2.5 px-3">Billing Period</th>
                <th className="py-2.5 px-3 text-right">Tonnage</th>
                <th className="py-2.5 px-3 text-right">Rate / Tonne</th>
                <th className="py-2.5 px-3 text-right">Total Posted Fee</th>
                <th className="py-2.5 px-3 text-right">Posted On</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-xs text-slate-400">
                    Loading warehouse storage records...
                  </td>
                </tr>
              ) : filteredCharges.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-xs text-slate-400">
                    {searchQuery || selectedLocationFilter !== "ALL"
                      ? "No storage charges match your search criteria."
                      : "No warehouse storage charges recorded yet. Press F2 to post a new charge."}
                  </td>
                </tr>
              ) : (
                filteredCharges.map((charge) => (
                  <tr
                    key={charge.id}
                    className="hover:bg-slate-50/70 dark:hover:bg-slate-800/50 transition-colors"
                  >
                    <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-slate-100">
                      <div className="flex items-center gap-2">
                        <Warehouse className="h-3.5 w-3.5 text-amber-700 shrink-0" />
                        <span>{charge.location.name}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300 font-mono text-[11px]">
                      {format(new Date(charge.periodStart), "dd/MM/yyyy")} &rarr; {format(new Date(charge.periodEnd), "dd/MM/yyyy")}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                      {charge.weightInTonnes.toLocaleString(undefined, { minimumFractionDigits: 3 })} Tonnes
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                      PKR {charge.ratePerTonne.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-900 dark:text-amber-300 text-sm">
                      PKR {charge.totalCharge.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-2.5 px-3 text-right text-[11px] text-slate-400 font-mono">
                      {format(new Date(charge.createdAt), "dd/MM/yyyy HH:mm")}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Calculate & Post Modal Dialog */}
      {showPostModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-xl bg-white dark:bg-slate-900 p-5 shadow-2xl border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-amber-50 dark:bg-amber-950/40 rounded-md border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300">
                  <Calculator className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Calculate & Post Storage Charge
                  </h2>
                  <p className="text-[10px] text-slate-500">
                    Calculates fee: Weight (Tonnes) &times; Rate per Tonne &rarr; Posts expense to ledger
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPostModal(false)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {formError && (
              <div className="mt-3 rounded-md bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 p-2.5 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-4 space-y-3 text-xs">
              <div className="space-y-1">
                <Label htmlFor="post-stloc" className="text-xs font-semibold">
                  Warehouse Location <span className="text-rose-500">*</span>
                </Label>
                <select
                  id="post-stloc"
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                  className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs"
                  required
                >
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="post-weight" className="text-xs font-semibold">
                    Weight in Tonnes <span className="text-rose-500">*</span>
                  </Label>
                  <Input
                    id="post-weight"
                    type="number"
                    step="0.001"
                    min="0.001"
                    value={weightInTonnes}
                    onChange={(e) => setWeightInTonnes(Number(e.target.value) || "")}
                    placeholder="e.g. 15.5"
                    className="h-8 text-xs font-mono"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="post-rate" className="text-xs font-semibold">
                    Rate per Tonne (PKR) <span className="text-rose-500">*</span>
                  </Label>
                  <Input
                    id="post-rate"
                    type="number"
                    step="0.01"
                    min="0"
                    value={ratePerTonne}
                    onChange={(e) => setRatePerTonne(Number(e.target.value) || "")}
                    placeholder="e.g. 1200"
                    className="h-8 text-xs font-mono"
                    required
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="post-pstart" className="text-xs font-semibold">
                    Period Start <span className="text-rose-500">*</span>
                  </Label>
                  <Input
                    id="post-pstart"
                    type="date"
                    value={periodStart}
                    onChange={(e) => setPeriodStart(e.target.value)}
                    className="h-8 text-xs"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="post-pend" className="text-xs font-semibold">
                    Period End <span className="text-rose-500">*</span>
                  </Label>
                  <Input
                    id="post-pend"
                    type="date"
                    value={periodEnd}
                    onChange={(e) => setPeriodEnd(e.target.value)}
                    className="h-8 text-xs"
                    required
                  />
                </div>
              </div>

              <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30 p-3 flex justify-between items-center">
                <div>
                  <p className="text-[10px] uppercase font-bold text-amber-800 dark:text-amber-300">
                    Total Calculated Charge
                  </p>
                  <p className="text-lg font-extrabold text-amber-950 dark:text-amber-200 font-mono">
                    PKR {calculatedTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div className="text-right text-[11px] text-slate-500">
                  {Number(weightInTonnes) > 0 && Number(ratePerTonne) > 0 ? (
                    <span>{weightInTonnes} T &times; PKR {ratePerTonne}</span>
                  ) : (
                    <span>Awaiting inputs</span>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowPostModal(false)}
                  className="h-8 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={submitting}
                  className="h-8 bg-amber-800 hover:bg-amber-700 text-white text-xs font-semibold shadow-xs"
                >
                  {submitting ? "Posting..." : "Post to Ledger Expense"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

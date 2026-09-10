"use client";

import { useEffect, useState, useMemo } from "react";
import {
  Warehouse,
  Plus,
  Calendar,
  AlertCircle,
  Calculator,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  listStorageChargesAction,
  createStorageChargeAction,
} from "@/actions/storage-charges";
import { listInventoryAction } from "@/actions/parties";
import { format } from "date-fns";

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
  const [charges, setCharges] = useState<StorageChargeRow[]>([]);
  const [locations, setLocations] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);

  // Form
  const [locationId, setLocationId] = useState("");
  const [weightInTonnes, setWeightInTonnes] = useState<number | "">("");
  const [ratePerTonne, setRatePerTonne] = useState<number | "">("");
  const [periodStart, setPeriodStart] = useState(new Date().toISOString().slice(0, 10));
  const [periodEnd, setPeriodEnd] = useState(new Date().toISOString().slice(0, 10));
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const [chargeRes, invRes] = await Promise.all([
        listStorageChargesAction(),
        listInventoryAction(),
      ]);

      if (chargeRes.success && chargeRes.data) {
        setCharges(chargeRes.data as StorageChargeRow[]);
      }
      if (invRes.success && invRes.data) {
        const rows = invRes.data as Array<{ locationId: string; locationName: string }>;
        const unique = Array.from(new Map(rows.map((r) => [r.locationId, r.locationName])).entries()).map(
          ([id, name]) => ({ id, name }),
        );
        setLocations(unique);
        if (unique.length > 0 && !locationId) {
          const warehouseLoc = unique.find((l) => l.name.toLowerCase().includes("warehouse")) || unique[0];
          setLocationId(warehouseLoc.id);
        }
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

    if (!window.confirm("Confirm: post this storage charge?")) return;

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
        setLocationId("");
        setWeightInTonnes("");
        setRatePerTonne("");
        setPeriodStart(new Date().toISOString().slice(0, 10));
        setPeriodEnd(new Date().toISOString().slice(0, 10));
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <Warehouse className="h-5 w-5 text-amber-800" />
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Warehouse Storage Charges</h1>
        </div>
        <p className="text-sm text-slate-600">
          Compute tonnage fees for stock occupying off-site and third-party warehouses, with direct ledger expense recording.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(340px,400px)_1fr]">
        {/* Entry Form */}
        <Card className="border-amber-900/15 bg-white shadow-xs">
          <CardHeader className="pb-3 border-b border-slate-100">
            <CardTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Calculator className="h-4 w-4 text-amber-700" />
              Calculate & Post Charge
            </CardTitle>
            <CardDescription className="text-xs">
              Calculates fee: Weight (Tonnes) × Rate per Tonne
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4">
            {formError && (
              <div className="mb-4 rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div className="space-y-1">
                <Label htmlFor="stloc" className="text-xs font-semibold">Warehouse Location *</Label>
                <select
                  id="stloc"
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                  className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs"
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
                  <Label htmlFor="weight" className="text-xs font-semibold">Weight in Tonnes *</Label>
                  <Input
                    id="weight"
                    type="number"
                    step="0.001"
                    min="0.001"
                    value={weightInTonnes}
                    onChange={(e) => setWeightInTonnes(Number(e.target.value) || "")}
                    placeholder="e.g. 15.5"
                    className="h-8 text-xs"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="rate" className="text-xs font-semibold">Rate per Tonne (PKR) *</Label>
                  <Input
                    id="rate"
                    type="number"
                    step="0.01"
                    min="0"
                    value={ratePerTonne}
                    onChange={(e) => setRatePerTonne(Number(e.target.value) || "")}
                    placeholder="e.g. 1200"
                    className="h-8 text-xs"
                    required
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="pstart" className="text-xs font-semibold">Period Start *</Label>
                  <Input
                    id="pstart"
                    type="date"
                    value={periodStart}
                    onChange={(e) => setPeriodStart(e.target.value)}
                    className="h-8 text-xs"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="pend" className="text-xs font-semibold">Period End *</Label>
                  <Input
                    id="pend"
                    type="date"
                    value={periodEnd}
                    onChange={(e) => setPeriodEnd(e.target.value)}
                    className="h-8 text-xs"
                    required
                  />
                </div>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 flex justify-between items-center">
                <div>
                  <p className="text-[10px] uppercase font-bold text-amber-800">Total Calculated Charge</p>
                  <p className="text-xl font-extrabold text-amber-950">PKR {calculatedTotal.toLocaleString()}</p>
                </div>
              </div>

              <Button
                type="submit"
                disabled={submitting}
                className="w-full bg-amber-800 text-white hover:bg-amber-700 text-xs shadow-sm"
              >
                {submitting ? "Posting..." : "Post to Ledger Expense"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* History List */}
        <div className="space-y-4">
          <Card className="border-slate-200/80 bg-white">
            <CardHeader className="pb-3 border-b border-slate-100 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold text-slate-900">Historical Storage Charges</CardTitle>
                <CardDescription className="text-xs">All past posted charges</CardDescription>
              </div>
              <span className="text-xs font-bold text-amber-900 bg-amber-50 px-2.5 py-1 rounded-md border border-amber-200">
                Total: PKR {totalHistoricalStorage.toLocaleString()}
              </span>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <p className="p-8 text-center text-xs text-slate-500">Loading storage charges...</p>
              ) : charges.length === 0 ? (
                <p className="p-8 text-center text-xs text-slate-500">No warehouse storage charges recorded yet.</p>
              ) : (
                <div className="divide-y divide-slate-100 text-xs">
                  {charges.map((charge) => (
                    <div key={charge.id} className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-slate-50/50">
                      <div>
                        <span className="font-bold text-slate-900">{charge.location.name}</span>
                        <p className="text-[11px] text-slate-500">
                          {format(new Date(charge.periodStart), "dd MMM yyyy")} to {format(new Date(charge.periodEnd), "dd MMM yyyy")}
                        </p>
                      </div>
                      <div className="flex items-center gap-4 text-right">
                        <div>
                          <span className="text-[10px] text-slate-400 block">Tonnage & Rate</span>
                          <span className="text-slate-700 font-medium">
                            {charge.weightInTonnes} Tonnes @ PKR {charge.ratePerTonne}
                          </span>
                        </div>
                        <div className="border-l border-slate-200 pl-3">
                          <span className="text-[10px] text-slate-400 block">Total Posted</span>
                          <span className="font-bold text-amber-900 text-sm">
                            PKR {charge.totalCharge.toLocaleString()}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

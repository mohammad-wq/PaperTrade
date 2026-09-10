"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Unit } from "@prisma/client";
import { AlertCircle, Calculator, Package2, Save, Trash2 } from "lucide-react";
import { productSchema, type ProductInput } from "@/schemas/product";
import { calculateWeights } from "@/lib/weights";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type ProductFormValues = ProductInput;

type ProductFormProps = {
  initialValues?: Partial<ProductFormValues>;
  categories: { id: string; name: string }[];
  qualities: { id: string; name: string }[];
  submitting?: boolean;
  onSubmit: (values: ProductFormValues) => Promise<void>;
  onDelete?: () => Promise<void>;
  submitLabel?: string;
  deleteLabel?: string;
};

const EMPTY_VALUES: ProductFormValues = {
  productNo: "",
  name: "",
  categoryId: "",
  qualityId: "",
  unit: Unit.PACKET,
  length: 0,
  breadth: 0,
  gsm: 0,
  costPrice: 0,
  retailPrice: 0,
  wholesalePrice: 0,
  labourCharges: 0,
  reorderLevel: 0,
  serialNo: "",
  remarks: "",
  isActive: true,
};

export function ProductForm({
  initialValues,
  categories,
  qualities,
  submitting = false,
  onSubmit,
  onDelete,
  submitLabel = "Save product",
  deleteLabel = "Delete",
}: ProductFormProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [showGsmHelper, setShowGsmHelper] = useState(false);
  const [weighedPacketInput, setWeighedPacketInput] = useState("");
  const [weighedReamInput, setWeighedReamInput] = useState("");
  const [showPricingHelper, setShowPricingHelper] = useState(false);
  const [ratePerKgInput, setRatePerKgInput] = useState("");

  const defaultValues = useMemo(() => ({
    ...EMPTY_VALUES,
    ...initialValues,
    unit: initialValues?.unit ?? Unit.PACKET,
    isActive: initialValues?.isActive ?? true,
    reorderLevel: initialValues?.reorderLevel ?? 0,
    serialNo: initialValues?.serialNo ?? "",
    remarks: initialValues?.remarks ?? "",
  }), [initialValues]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    watch,
    setValue,
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues,
  });

  useEffect(() => {
    setValue("unit", initialValues?.unit ?? Unit.PACKET, { shouldDirty: false });
  }, [initialValues, setValue]);

  const length = Number(watch("length") || 0);
  const breadth = Number(watch("breadth") || 0);
  const gsm = Number(watch("gsm") || 0);
  const weights = useMemo(() => calculateWeights(length, breadth, gsm), [length, breadth, gsm]);

  async function handleFormSubmit(values: ProductFormValues) {
    setServerError(null);
    const action = initialValues?.productNo ? "update this product" : "create this product";
    if (!window.confirm(`Confirm: ${action}?`)) return;
    try {
      await onSubmit(values);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Unable to save product.");
    }
  }

  return (
    <Card className="overflow-hidden border-emerald-100 bg-gradient-to-br from-emerald-50/60 via-white to-sky-50/60 shadow-sm">
      <CardHeader className="border-b border-emerald-100 bg-white/70">
        <CardTitle className="flex items-center gap-2 text-slate-800">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
            <Package2 className="h-4 w-4" />
          </span>
          {initialValues?.productNo ? "Edit product" : "Add product"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-5">
        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-6" noValidate>
          {serverError ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4" />
              <span>{serverError}</span>
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="productNo">
                Product No <span className="text-rose-500">*</span>
              </Label>
              <Input id="productNo" className="border-emerald-100 bg-white/80 focus-visible:ring-emerald-200" {...register("productNo")} />
              {errors.productNo ? <p className="text-sm text-destructive">{errors.productNo.message}</p> : null}
            </div>
            <div className="space-y-2 md:col-span-2 xl:col-span-2">
              <Label htmlFor="name">
                Product Name <span className="text-rose-500">*</span>
              </Label>
              <Input id="name" className="border-emerald-100 bg-white/80 focus-visible:ring-emerald-200" {...register("name")} />
              {errors.name ? <p className="text-sm text-destructive">{errors.name.message}</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="categoryId">
                Category <span className="text-rose-500">*</span>
              </Label>
              <select
                id="categoryId"
                className="flex min-h-11 w-full rounded-md border border-emerald-100 bg-white/80 px-3 py-2 text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200"
                {...register("categoryId")}
              >
                <option value="">Select category</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              {errors.categoryId ? <p className="text-sm text-destructive">{errors.categoryId.message}</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="qualityId">
                Quality <span className="text-rose-500">*</span>
              </Label>
              <select
                id="qualityId"
                className="flex min-h-11 w-full rounded-md border border-emerald-100 bg-white/80 px-3 py-2 text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200"
                {...register("qualityId")}
              >
                <option value="">Select quality</option>
                {qualities.map((quality) => (
                  <option key={quality.id} value={quality.id}>
                    {quality.name}
                  </option>
                ))}
              </select>
              {errors.qualityId ? <p className="text-sm text-destructive">{errors.qualityId.message}</p> : null}
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="unit">
                  Dealing Unit <span className="text-rose-500">*</span>
                </Label>
                <span className="text-[10px] uppercase font-bold text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                  Default: Packets
                </span>
              </div>
              <select
                id="unit"
                className="flex min-h-11 w-full rounded-md border border-emerald-100 bg-white/80 px-3 py-2 text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200 font-medium"
                {...register("unit")}
              >
                <option value={Unit.PACKET}>PACKET (100 Sheets) — Primary Dealing Default</option>
                <option value={Unit.REAM}>REAM (500 Sheets) — Bulk Mill Packaging</option>
              </select>
              <p className="text-[11px] text-slate-500">All local customer dealing defaults to packets.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="serialNo">
                Serial No <span className="text-slate-400 font-normal text-xs">(Optional)</span>
              </Label>
              <Input id="serialNo" className="border-emerald-100 bg-white/80 focus-visible:ring-emerald-200" {...register("serialNo")} />
            </div>
          </div>

          {/* Quick Standard Size Presets */}
          <div className="space-y-1.5 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3">
            <p className="text-xs font-semibold text-slate-700">Quick Size Presets (Inches):</p>
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: '23" × 36"', l: 23, b: 36 },
                { label: '25" × 36"', l: 25, b: 36 },
                { label: '20" × 30"', l: 20, b: 30 },
                { label: '27" × 34"', l: 27, b: 34 },
                { label: '30" × 40"', l: 30, b: 40 },
                { label: "A4", l: 8.27, b: 11.69 },
                { label: "A3", l: 11.69, b: 16.54 },
                { label: "Legal", l: 8.5, b: 14 },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    setValue("length", preset.l, { shouldDirty: true });
                    setValue("breadth", preset.b, { shouldDirty: true });
                  }}
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                    length === preset.l && breadth === preset.b
                      ? "border-emerald-700 bg-emerald-100 text-emerald-900 font-bold"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="length">
                Length (Inches) <span className="text-rose-500">*</span>
              </Label>
              <Input id="length" type="number" step="0.01" className="border-emerald-100 bg-white/80 focus-visible:ring-emerald-200" {...register("length", { valueAsNumber: true })} />
              {errors.length ? <p className="text-sm text-destructive">{errors.length.message}</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="breadth">
                Breadth (Inches) <span className="text-rose-500">*</span>
              </Label>
              <Input id="breadth" type="number" step="0.01" className="border-emerald-100 bg-white/80 focus-visible:ring-emerald-200" {...register("breadth", { valueAsNumber: true })} />
              {errors.breadth ? <p className="text-sm text-destructive">{errors.breadth.message}</p> : null}
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="gsm">
                  GSM <span className="text-rose-500">*</span>
                </Label>
                <button
                  type="button"
                  onClick={() => setShowGsmHelper((prev) => !prev)}
                  className="text-[11px] font-semibold text-emerald-700 hover:underline"
                >
                  {showGsmHelper ? "Close Helper" : "Calculate from Weight"}
                </button>
              </div>
              <Input id="gsm" type="number" step="0.01" className="border-emerald-100 bg-white/80 focus-visible:ring-emerald-200" {...register("gsm", { valueAsNumber: true })} />
              {errors.gsm ? <p className="text-sm text-destructive">{errors.gsm.message}</p> : null}
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="reorderLevel">
                  Reorder Level <span className="text-slate-400 font-normal text-xs">(Optional)</span>
                </Label>
                <span className="text-[10px] uppercase font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">Packets</span>
              </div>
              <Input id="reorderLevel" type="number" step="1" min="0" placeholder="e.g. 20" className="border-emerald-100 bg-white/80 focus-visible:ring-emerald-200 text-xs" {...register("reorderLevel", { valueAsNumber: true })} />
              <p className="text-[11px] text-slate-500">Minimum threshold in packets before low-stock alert is triggered.</p>
              {errors.reorderLevel ? <p className="text-sm text-destructive">{errors.reorderLevel.message}</p> : null}
            </div>
          </div>

          {/* Collapsible GSM Calculation Helper */}
          {showGsmHelper && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-amber-900">
                  Weighed Scale: Derive GSM from Physical Weight
                </p>
                <span className="text-[11px] text-amber-700">Formula: (Weight × 15,499) ÷ (L × B)</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="weighedPacketInput" className="text-xs text-amber-900">
                    Weighed Packet Weight (kg for 100 sheets)
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="weighedPacketInput"
                      type="number"
                      step="0.01"
                      placeholder="e.g. 4.15"
                      className="bg-white border-amber-200"
                      value={weighedPacketInput}
                      onChange={(e) => setWeighedPacketInput(e.target.value)}
                    />
                    <Button
                      type="button"
                      size="sm"
                      className="bg-amber-800 text-white hover:bg-amber-700 shrink-0 text-xs"
                      onClick={() => {
                        const w = parseFloat(weighedPacketInput);
                        if (w > 0 && length > 0 && breadth > 0) {
                          const derivedGsm = (w * 15499) / (length * breadth);
                          setValue("gsm", Math.round(derivedGsm * 10) / 10, { shouldDirty: true });
                        }
                      }}
                    >
                      Apply GSM
                    </Button>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="weighedReamInput" className="text-xs text-amber-900">
                    Or Weighed Ream Weight (kg for 500 sheets)
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="weighedReamInput"
                      type="number"
                      step="0.01"
                      placeholder="e.g. 20.75"
                      className="bg-white border-amber-200"
                      value={weighedReamInput}
                      onChange={(e) => setWeighedReamInput(e.target.value)}
                    />
                    <Button
                      type="button"
                      size="sm"
                      className="bg-amber-800 text-white hover:bg-amber-700 shrink-0 text-xs"
                      onClick={() => {
                        const w = parseFloat(weighedReamInput);
                        if (w > 0 && length > 0 && breadth > 0) {
                          const derivedGsm = (w * 3100) / (length * breadth);
                          setValue("gsm", Math.round(derivedGsm * 10) / 10, { shouldDirty: true });
                        }
                      }}
                    >
                      Apply GSM
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Live Specs & Weight Estimate Banner */}
          <div className="rounded-2xl border border-emerald-100 bg-gradient-to-r from-emerald-50 to-sky-50 p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between font-medium text-slate-700">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white text-emerald-700 shadow-sm">
                  <Calculator className="h-4 w-4" />
                </span>
                <span>Auto-Calculated Weight Metrics</span>
              </div>
              <span className="text-xs text-slate-500">
                1 Tonne = {weights.packetWeight > 0 ? Math.round(1000 / weights.packetWeight).toLocaleString() : 0} Packets
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-white bg-white/80 p-3 shadow-sm">
                <p className="text-xs uppercase tracking-wide text-slate-500">Packet Weight (100 Sheets)</p>
                <p className="mt-1 text-lg font-bold text-slate-900">{weights.packetWeight.toFixed(3)} kg</p>
              </div>
              <div className="rounded-xl border border-white bg-white/80 p-3 shadow-sm">
                <p className="text-xs uppercase tracking-wide text-slate-500">Ream Weight (500 Sheets)</p>
                <p className="mt-1 text-lg font-bold text-slate-900">{weights.reamWeight.toFixed(3)} kg</p>
              </div>
              <div className="rounded-xl border border-white bg-white/80 p-3 shadow-sm">
                <p className="text-xs uppercase tracking-wide text-slate-500">Single Sheet Weight</p>
                <p className="mt-1 text-lg font-bold text-slate-900">{(weights.packetWeight * 10).toFixed(2)} grams</p>
              </div>
            </div>
          </div>

          {/* Pricing Auto-Calculator Helper */}
          <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-sky-950">Pricing Helper: Mill Rate per kg → Selling Prices</span>
              </div>
              <button
                type="button"
                onClick={() => setShowPricingHelper((prev) => !prev)}
                className="text-[11px] font-semibold text-sky-700 hover:underline"
              >
                {showPricingHelper ? "Hide Helper" : "Calculate Prices from Rate/kg"}
              </button>
            </div>

            {showPricingHelper && (
              <div className="pt-2 border-t border-sky-200/80 space-y-2">
                <p className="text-[11px] text-sky-800">
                  Enter supplier or market rate per kg. Prices for Cost, Retail (+15%), and Wholesale (+8%) will be calculated automatically based on Packet Weight ({weights.packetWeight.toFixed(3)} kg):
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    type="number"
                    step="1"
                    placeholder="e.g. 320 PKR / kg"
                    className="bg-white border-sky-200 text-sm"
                    value={ratePerKgInput}
                    onChange={(e) => setRatePerKgInput(e.target.value)}
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="bg-sky-800 text-white hover:bg-sky-700 shrink-0 text-xs"
                    onClick={() => {
                      const rate = parseFloat(ratePerKgInput);
                      if (rate > 0 && weights.packetWeight > 0) {
                        const cost = Math.round(rate * weights.packetWeight);
                        const retail = Math.round(cost * 1.15);
                        const wholesale = Math.round(cost * 1.08);
                        setValue("costPrice", cost, { shouldDirty: true });
                        setValue("retailPrice", retail, { shouldDirty: true });
                        setValue("wholesalePrice", wholesale, { shouldDirty: true });
                      }
                    }}
                  >
                    Auto-Fill Prices
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="costPrice">
                Cost Price ({watch("unit")}) <span className="text-rose-500">*</span>
              </Label>
              <Input id="costPrice" type="number" step="0.01" className="border-emerald-100 bg-white/80 focus-visible:ring-emerald-200" {...register("costPrice", { valueAsNumber: true })} />
              {errors.costPrice ? <p className="text-sm text-destructive">{errors.costPrice.message}</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="retailPrice">
                Retail Price <span className="text-rose-500">*</span>
              </Label>
              <Input id="retailPrice" type="number" step="0.01" className="border-emerald-100 bg-white/80 focus-visible:ring-emerald-200" {...register("retailPrice", { valueAsNumber: true })} />
              {errors.retailPrice ? <p className="text-sm text-destructive">{errors.retailPrice.message}</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="wholesalePrice">
                Wholesale Price <span className="text-slate-400 font-normal text-xs">(Optional)</span>
              </Label>
              <Input id="wholesalePrice" type="number" step="0.01" className="border-emerald-100 bg-white/80 focus-visible:ring-emerald-200" {...register("wholesalePrice", { valueAsNumber: true })} />
              {errors.wholesalePrice ? <p className="text-sm text-destructive">{errors.wholesalePrice.message}</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="labourCharges">
                Labour Charges <span className="text-slate-400 font-normal text-xs">(Optional)</span>
              </Label>
              <Input id="labourCharges" type="number" step="0.01" className="border-emerald-100 bg-white/80 focus-visible:ring-emerald-200" {...register("labourCharges", { valueAsNumber: true })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="isActive">
                Status <span className="text-rose-500">*</span>
              </Label>
              <select
                id="isActive"
                className="flex min-h-11 w-full rounded-md border border-emerald-100 bg-white/80 px-3 py-2 text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200"
                {...register("isActive", { setValueAs: (value) => value === "true" })}
              >
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="remarks">
              Remarks <span className="text-slate-400 font-normal text-xs">(Optional)</span>
            </Label>
            <Textarea id="remarks" className="border-emerald-100 bg-white/80 focus-visible:ring-emerald-200" {...register("remarks")} />
            {errors.remarks ? <p className="text-sm text-destructive">{errors.remarks.message}</p> : null}
          </div>

          <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end">
            {onDelete ? (
              <Button type="button" variant="destructive" onClick={() => {
                if (window.confirm("Confirm: deactivate this product?")) void onDelete();
              }} disabled={submitting || isSubmitting} className="shadow-sm">
                <Trash2 className="mr-2 h-4 w-4" />
                {deleteLabel}
              </Button>
            ) : null}
            <Button type="submit" disabled={submitting || isSubmitting} className="bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm">
              <Save className="mr-2 h-4 w-4" />
              {isSubmitting || submitting ? "Saving…" : submitLabel}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

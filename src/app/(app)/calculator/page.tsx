"use client";

import { useState } from "react";
import {
  Calculator,
  Scale,
  DollarSign,
  Truck,
  RotateCcw,
  Sparkles,
  ArrowRight,
  Check,
  Copy,
  Layers,
  HelpCircle,
  Plus,
  Trash2,
  Scissors,
  AlertTriangle,
  CheckCircle,
  BookmarkCheck,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  STANDARD_SIZES,
  COMMON_CONVERTING_PRESETS,
  calculatePacketWeight,
  calculateReamWeight,
  calculateGsmFromPacketWeight,
  calculateGsmFromReamWeight,
  calculateSheetWeightGrams,
  calculateRatePerPacket,
  calculateRatePerKgFromPacket,
  calculateRatePerReam,
  calculateRatePerTonne,
  calculateTotalWeightFromPackets,
  calculateQuantityFromTargetTonnes,
  calculateQuantityFromTargetKg,
  calculateRollToSheetYield,
  calculateMultiSlitRollYield,
  type SlitPatternInput,
  inchesToMm,
  mmToInches,
} from "@/lib/paper-math";

export default function PaperCalculatorPage() {
  const [activeTab, setActiveTab] = useState<"gsm" | "pricing" | "logistics" | "reel">("gsm");

  // Tab 1: GSM & Weight
  const [gsmMode, setGsmMode] = useState<"from_specs" | "from_packet" | "from_ream">("from_packet");
  const [length, setLength] = useState<number>(23);
  const [breadth, setBreadth] = useState<number>(36);
  const [gsm, setGsm] = useState<number>(75);
  const [weighedPacketKg, setWeighedPacketKg] = useState<number>(4.0);
  const [weighedReamKg, setWeighedReamKg] = useState<number>(20.0);

  // Tab 2: Pricing & Rates
  const [priceMode, setPriceMode] = useState<"from_kg" | "from_packet">("from_kg");
  const [pricePerKg, setPricePerKg] = useState<number>(320);
  const [pricePerPacketInput, setPricePerPacketInput] = useState<number>(1280);
  const [calcPacketWeight, setCalcPacketWeight] = useState<number>(4.0);

  // Tab 3: Logistics & Tonnage
  const [logisticsMode, setLogisticsMode] = useState<"packets_to_tonnes" | "tonnes_to_packets">("packets_to_tonnes");
  const [orderPackets, setOrderPackets] = useState<number>(500);
  const [targetTonnes, setTargetTonnes] = useState<number>(10);
  const [itemPacketWeight, setItemPacketWeight] = useState<number>(4.0);

  // Tab 4: Industrial Multi-Slit & Reel Sheeting Engine
  const [reelName, setReelName] = useState<string>("PINDO BLEACH BOARD");
  const [reelsCount, setReelsCount] = useState<number>(3);
  const [totalReelWeightKg, setTotalReelWeightKg] = useState<number>(4647);
  const [reelWidthInches, setReelWidthInches] = useState<number>(56.0);
  const [reelGsm, setReelGsm] = useState<number>(350);
  const [ratePerKg, setRatePerKg] = useState<number>(272);
  const [patterns, setPatterns] = useState<SlitPatternInput[]>([
    {
      id: "p1",
      label: 'Main Sheeting Cut (28" × 22")',
      slitWidth: 28.0,
      slitsCount: 2,
      cutLength: 22.0,
      sheetsPerPack: 100,
    },
  ]);

  function loadBenchmarkExample() {
    setReelName("PINDO BLEACH BOARD");
    setReelsCount(3);
    setTotalReelWeightKg(4647);
    setReelWidthInches(56.0);
    setReelGsm(350);
    setRatePerKg(272);
    setPatterns([
      {
        id: "p1",
        label: '28.00" × 22.00" (2 Slits across 56" Reel)',
        slitWidth: 28.0,
        slitsCount: 2,
        cutLength: 22.0,
        sheetsPerPack: 100,
      },
    ]);
  }

  function addCutDimension(preset?: { width: number; length: number; label: string }) {
    const newId = "p_" + Date.now();
    setPatterns((prev) => [
      ...prev,
      {
        id: newId,
        label: preset ? preset.label : `Cut #${prev.length + 1}`,
        slitWidth: preset ? preset.width : 22.0,
        slitsCount: 1,
        cutLength: preset ? preset.length : 28.0,
        sheetsPerPack: 100,
      },
    ]);
  }

  function updateCutDimension(id: string, field: keyof SlitPatternInput, val: any) {
    setPatterns((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: val } : item))
    );
  }

  function removeCutDimension(id: string) {
    if (patterns.length <= 1) return;
    setPatterns((prev) => prev.filter((item) => item.id !== id));
  }

  // Copy feedback state
  const [copied, setCopied] = useState<string | null>(null);

  function copyToClipboard(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  // Derived GSM & Weights
  const derivedGsmFromPacket = calculateGsmFromPacketWeight(length, breadth, weighedPacketKg);
  const derivedGsmFromReam = calculateGsmFromReamWeight(length, breadth, weighedReamKg);
  const computedPacketWeight = calculatePacketWeight(length, breadth, gsm);
  const computedReamWeight = calculateReamWeight(length, breadth, gsm);
  const sheetWeightGrams = calculateSheetWeightGrams(computedPacketWeight);

  // Derived Pricing
  const effectivePacketWeight = calcPacketWeight > 0 ? calcPacketWeight : computedPacketWeight || 4.0;
  const effectiveReamWeight = effectivePacketWeight * 5;
  const derivedPacketPrice = calculateRatePerPacket(pricePerKg, effectivePacketWeight);
  const derivedReamPrice = calculateRatePerReam(pricePerKg, effectiveReamWeight);
  const derivedTonnePrice = calculateRatePerTonne(pricePerKg);
  const derivedRatePerKgFromPacket = calculateRatePerKgFromPacket(pricePerPacketInput, effectivePacketWeight);

  // Derived Logistics
  const orderWeight = calculateTotalWeightFromPackets(orderPackets, itemPacketWeight);
  const tonnesRequirement = calculateQuantityFromTargetTonnes(targetTonnes, itemPacketWeight);

  // Derived Multi-Slit Roll Sheeting Yield
  const multiSlitYield = calculateMultiSlitRollYield({
    reelWidthInches,
    totalReelWeightKg,
    gsm: reelGsm,
    reelsCount,
    ratePerKg,
    patterns,
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-800 text-amber-200 shadow-sm">
              <Calculator className="h-5 w-5" />
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Paper Trade Calculator</h1>
          </div>
          <p className="text-sm text-slate-600 mt-1">
            Instant paper industry calculations: GSM, packet & ream weights, rates per kg/packet, tonnage, and reel yields.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        <Button
          variant={activeTab === "gsm" ? "default" : "outline"}
          size="sm"
          className={activeTab === "gsm" ? "bg-emerald-800 text-white hover:bg-emerald-700" : ""}
          onClick={() => setActiveTab("gsm")}
        >
          <Scale className="mr-1.5 h-4 w-4" />
          GSM & Weight Solver
        </Button>
        <Button
          variant={activeTab === "pricing" ? "default" : "outline"}
          size="sm"
          className={activeTab === "pricing" ? "bg-emerald-800 text-white hover:bg-emerald-700" : ""}
          onClick={() => setActiveTab("pricing")}
        >
          <DollarSign className="mr-1.5 h-4 w-4" />
          Rate & Price Converter
        </Button>
        <Button
          variant={activeTab === "logistics" ? "default" : "outline"}
          size="sm"
          className={activeTab === "logistics" ? "bg-emerald-800 text-white hover:bg-emerald-700" : ""}
          onClick={() => setActiveTab("logistics")}
        >
          <Truck className="mr-1.5 h-4 w-4" />
          Tonnage & Logistics
        </Button>
        <Button
          variant={activeTab === "reel" ? "default" : "outline"}
          size="sm"
          className={activeTab === "reel" ? "bg-emerald-800 text-white hover:bg-emerald-700" : ""}
          onClick={() => setActiveTab("reel")}
        >
          <Layers className="mr-1.5 h-4 w-4" />
          Roll / Reel to Sheets
        </Button>
      </div>

      {/* TAB 1: GSM & WEIGHT SOLVER */}
      {activeTab === "gsm" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2 shadow-sm border-slate-200">
            <CardHeader>
              <CardTitle className="text-base text-slate-900 flex items-center justify-between">
                <span>Select Calculation Mode</span>
                <span className="text-xs font-normal text-slate-500">Standard Divisors: 15499 (100s) / 3100 (500s)</span>
              </CardTitle>
              <div className="flex flex-wrap gap-2 pt-2">
                <Button
                  size="sm"
                  variant={gsmMode === "from_packet" ? "default" : "outline"}
                  className={gsmMode === "from_packet" ? "bg-emerald-800 text-white" : "text-xs"}
                  onClick={() => setGsmMode("from_packet")}
                >
                  Find GSM from Packet Weight
                </Button>
                <Button
                  size="sm"
                  variant={gsmMode === "from_ream" ? "default" : "outline"}
                  className={gsmMode === "from_ream" ? "bg-emerald-800 text-white" : "text-xs"}
                  onClick={() => setGsmMode("from_ream")}
                >
                  Find GSM from Ream Weight
                </Button>
                <Button
                  size="sm"
                  variant={gsmMode === "from_specs" ? "default" : "outline"}
                  className={gsmMode === "from_specs" ? "bg-emerald-800 text-white" : "text-xs"}
                  onClick={() => setGsmMode("from_specs")}
                >
                  Find Weight from GSM & Size
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Quick Standard Size Presets */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Quick Size Presets (Inches)</Label>
                <div className="flex flex-wrap gap-1.5">
                  {STANDARD_SIZES.map((s) => (
                    <button
                      key={s.label}
                      type="button"
                      onClick={() => {
                        setLength(s.length);
                        setBreadth(s.breadth);
                      }}
                      className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                        length === s.length && breadth === s.breadth
                          ? "border-emerald-800 bg-emerald-50 text-emerald-900 font-bold"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      {s.label.split(" ")[0]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Dimensions Input */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="len" className="text-xs">Length (Inches)</Label>
                    <span className="text-[11px] text-slate-400">{inchesToMm(length).toFixed(1)} mm</span>
                  </div>
                  <Input
                    id="len"
                    type="number"
                    step="0.1"
                    value={length || ""}
                    onChange={(e) => setLength(parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="brd" className="text-xs">Breadth / Width (Inches)</Label>
                    <span className="text-[11px] text-slate-400">{inchesToMm(breadth).toFixed(1)} mm</span>
                  </div>
                  <Input
                    id="brd"
                    type="number"
                    step="0.1"
                    value={breadth || ""}
                    onChange={(e) => setBreadth(parseFloat(e.target.value) || 0)}
                  />
                </div>
              </div>

              {/* Variable Input based on mode */}
              {gsmMode === "from_packet" && (
                <div className="space-y-1.5 rounded-xl border border-amber-200/80 bg-amber-50/50 p-4">
                  <Label htmlFor="wp" className="text-xs font-semibold text-amber-900">
                    Weighed Packet Weight (kg for 100 sheets)
                  </Label>
                  <p className="text-[11px] text-amber-800">
                    Place a 100-sheet packet on the scale and enter the reading in kg:
                  </p>
                  <Input
                    id="wp"
                    type="number"
                    step="0.01"
                    className="bg-white"
                    value={weighedPacketKg || ""}
                    onChange={(e) => setWeighedPacketKg(parseFloat(e.target.value) || 0)}
                  />
                </div>
              )}

              {gsmMode === "from_ream" && (
                <div className="space-y-1.5 rounded-xl border border-sky-200/80 bg-sky-50/50 p-4">
                  <Label htmlFor="wr" className="text-xs font-semibold text-sky-900">
                    Weighed Ream Weight (kg for 500 sheets)
                  </Label>
                  <p className="text-[11px] text-sky-800">
                    Place a 500-sheet ream on the scale and enter the reading in kg:
                  </p>
                  <Input
                    id="wr"
                    type="number"
                    step="0.01"
                    className="bg-white"
                    value={weighedReamKg || ""}
                    onChange={(e) => setWeighedReamKg(parseFloat(e.target.value) || 0)}
                  />
                </div>
              )}

              {gsmMode === "from_specs" && (
                <div className="space-y-1.5 rounded-xl border border-emerald-200/80 bg-emerald-50/50 p-4">
                  <Label htmlFor="cgsm" className="text-xs font-semibold text-emerald-900">
                    Paper GSM (Grams per Square Metre)
                  </Label>
                  <p className="text-[11px] text-emerald-800">
                    Enter known paper GSM (e.g. 68, 70, 75, 80, 100, 120, 250, 300):
                  </p>
                  <Input
                    id="cgsm"
                    type="number"
                    step="1"
                    className="bg-white"
                    value={gsm || ""}
                    onChange={(e) => setGsm(parseFloat(e.target.value) || 0)}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Results Card */}
          <Card className="shadow-sm border-emerald-200 bg-gradient-to-br from-emerald-50/70 via-white to-amber-50/40">
            <CardHeader>
              <CardTitle className="text-base text-emerald-950 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-emerald-700" />
                Calculation Results
              </CardTitle>
              <CardDescription>Live computed paper specifications</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {gsmMode === "from_packet" && (
                <div className="rounded-xl border border-emerald-200 bg-white p-4 shadow-xs">
                  <p className="text-xs uppercase font-semibold tracking-wider text-slate-500">Calculated GSM</p>
                  <div className="flex items-baseline justify-between mt-1">
                    <p className="text-3xl font-extrabold text-emerald-900">
                      {derivedGsmFromPacket ? derivedGsmFromPacket.toFixed(1) : "0"} <span className="text-sm font-semibold">GSM</span>
                    </p>
                    <span className="text-xs text-slate-500 font-medium">
                      ≈ {Math.round(derivedGsmFromPacket)} GSM
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-2">
                    Formula: ({weighedPacketKg} kg × 15,499) ÷ ({length}&quot; × {breadth}&quot;)
                  </p>
                </div>
              )}

              {gsmMode === "from_ream" && (
                <div className="rounded-xl border border-sky-200 bg-white p-4 shadow-xs">
                  <p className="text-xs uppercase font-semibold tracking-wider text-slate-500">Calculated GSM</p>
                  <div className="flex items-baseline justify-between mt-1">
                    <p className="text-3xl font-extrabold text-sky-900">
                      {derivedGsmFromReam ? derivedGsmFromReam.toFixed(1) : "0"} <span className="text-sm font-semibold">GSM</span>
                    </p>
                    <span className="text-xs text-slate-500 font-medium">
                      ≈ {Math.round(derivedGsmFromReam)} GSM
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-2">
                    Formula: ({weighedReamKg} kg × 3,100) ÷ ({length}&quot; × {breadth}&quot;)
                  </p>
                </div>
              )}

              {/* Weights Breakdown */}
              <div className="space-y-2.5 pt-2">
                <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-white p-3">
                  <div>
                    <p className="text-xs text-slate-500">Packet Weight (100 Sheets)</p>
                    <p className="text-base font-bold text-slate-900">
                      {(gsmMode === "from_packet" ? weighedPacketKg : computedPacketWeight).toFixed(3)} kg
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-slate-400"
                    onClick={() => copyToClipboard((gsmMode === "from_packet" ? weighedPacketKg : computedPacketWeight).toFixed(3), "pw")}
                  >
                    {copied === "pw" ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-white p-3">
                  <div>
                    <p className="text-xs text-slate-500">Ream Weight (500 Sheets)</p>
                    <p className="text-base font-bold text-slate-900">
                      {(gsmMode === "from_ream" ? weighedReamKg : (gsmMode === "from_packet" ? weighedPacketKg * 5 : computedReamWeight)).toFixed(3)} kg
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-slate-400"
                    onClick={() => copyToClipboard(((gsmMode === "from_ream" ? weighedReamKg : (gsmMode === "from_packet" ? weighedPacketKg * 5 : computedReamWeight))).toFixed(3), "rw")}
                  >
                    {copied === "rw" ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-white p-3">
                  <div>
                    <p className="text-xs text-slate-500">Single Sheet Weight</p>
                    <p className="text-base font-bold text-slate-900">
                      {((gsmMode === "from_packet" ? weighedPacketKg : computedPacketWeight) * 10).toFixed(2)} grams
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* TAB 2: PRICING & RATE CONVERTER */}
      {activeTab === "pricing" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2 shadow-sm border-slate-200">
            <CardHeader>
              <CardTitle className="text-base text-slate-900">Paper Rate & Pricing Converter</CardTitle>
              <CardDescription>
                Convert between Mill Rate per kg and Selling Rate per Packet (100s), Ream (500s), or Tonne.
              </CardDescription>
              <div className="flex flex-wrap gap-2 pt-2">
                <Button
                  size="sm"
                  variant={priceMode === "from_kg" ? "default" : "outline"}
                  className={priceMode === "from_kg" ? "bg-emerald-800 text-white" : "text-xs"}
                  onClick={() => setPriceMode("from_kg")}
                >
                  Rate per kg → Packet & Ream Price
                </Button>
                <Button
                  size="sm"
                  variant={priceMode === "from_packet" ? "default" : "outline"}
                  className={priceMode === "from_packet" ? "bg-emerald-800 text-white" : "text-xs"}
                  onClick={() => setPriceMode("from_packet")}
                >
                  Packet Price → Effective Rate per kg
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="cpw" className="text-xs font-semibold">Packet Weight in kg (100 Sheets)</Label>
                  <Input
                    id="cpw"
                    type="number"
                    step="0.01"
                    value={calcPacketWeight || ""}
                    onChange={(e) => setCalcPacketWeight(parseFloat(e.target.value) || 0)}
                  />
                  <p className="text-[11px] text-slate-500">
                    Ream weight = {(effectivePacketWeight * 5).toFixed(2)} kg
                  </p>
                </div>

                {priceMode === "from_kg" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="rkg" className="text-xs font-semibold">Mill / Market Rate per kg (PKR)</Label>
                    <Input
                      id="rkg"
                      type="number"
                      step="1"
                      value={pricePerKg || ""}
                      onChange={(e) => setPricePerKg(parseFloat(e.target.value) || 0)}
                    />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="rpk" className="text-xs font-semibold">Selling / Quoted Price per Packet (PKR)</Label>
                    <Input
                      id="rpk"
                      type="number"
                      step="1"
                      value={pricePerPacketInput || ""}
                      onChange={(e) => setPricePerPacketInput(parseFloat(e.target.value) || 0)}
                    />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Pricing Results */}
          <Card className="shadow-sm border-emerald-200 bg-gradient-to-br from-emerald-50/70 via-white to-amber-50/40">
            <CardHeader>
              <CardTitle className="text-base text-emerald-950 flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-emerald-700" />
                Equivalent Rates
              </CardTitle>
              <CardDescription>Instant conversion across paper trading units</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {priceMode === "from_kg" ? (
                <>
                  <div className="rounded-xl border border-emerald-200 bg-white p-4">
                    <p className="text-xs font-semibold uppercase text-slate-500">Rate per Packet (100 Sheets)</p>
                    <p className="text-2xl font-black text-emerald-900 mt-1">
                      PKR {Math.round(derivedPacketPrice).toLocaleString()}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1">
                      {pricePerKg} PKR/kg × {effectivePacketWeight.toFixed(3)} kg
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                    <p className="text-xs font-semibold uppercase text-slate-500">Rate per Ream (500 Sheets)</p>
                    <p className="text-xl font-bold text-slate-800 mt-1">
                      PKR {Math.round(derivedReamPrice).toLocaleString()}
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                    <p className="text-xs font-semibold uppercase text-slate-500">Rate per Metric Tonne (1,000 kg)</p>
                    <p className="text-xl font-bold text-slate-800 mt-1">
                      PKR {Math.round(derivedTonnePrice).toLocaleString()}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="rounded-xl border border-emerald-200 bg-white p-4">
                    <p className="text-xs font-semibold uppercase text-slate-500">Derived Rate per kg</p>
                    <p className="text-2xl font-black text-emerald-900 mt-1">
                      PKR {derivedRatePerKgFromPacket.toFixed(2)} <span className="text-sm font-normal">/ kg</span>
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1">
                      PKR {pricePerPacketInput} ÷ {effectivePacketWeight.toFixed(3)} kg
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                    <p className="text-xs font-semibold uppercase text-slate-500">Equivalent Ream Price</p>
                    <p className="text-xl font-bold text-slate-800 mt-1">
                      PKR {Math.round(pricePerPacketInput * 5).toLocaleString()}
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                    <p className="text-xs font-semibold uppercase text-slate-500">Equivalent Rate per Tonne</p>
                    <p className="text-xl font-bold text-slate-800 mt-1">
                      PKR {Math.round(derivedRatePerKgFromPacket * 1000).toLocaleString()}
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* TAB 3: TONNAGE & LOGISTICS */}
      {activeTab === "logistics" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2 shadow-sm border-slate-200">
            <CardHeader>
              <CardTitle className="text-base text-slate-900">Tonnage & Truck Load Estimator</CardTitle>
              <CardDescription>
                Calculate total cargo weight for dispatch or calculate required packet count for a target tonne order.
              </CardDescription>
              <div className="flex flex-wrap gap-2 pt-2">
                <Button
                  size="sm"
                  variant={logisticsMode === "packets_to_tonnes" ? "default" : "outline"}
                  className={logisticsMode === "packets_to_tonnes" ? "bg-emerald-800 text-white" : "text-xs"}
                  onClick={() => setLogisticsMode("packets_to_tonnes")}
                >
                  Packet Count → Total Weight & Tonnes
                </Button>
                <Button
                  size="sm"
                  variant={logisticsMode === "tonnes_to_packets" ? "default" : "outline"}
                  className={logisticsMode === "tonnes_to_packets" ? "bg-emerald-800 text-white" : "text-xs"}
                  onClick={() => setLogisticsMode("tonnes_to_packets")}
                >
                  Target Tonnes → Required Packets
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="lpw" className="text-xs font-semibold">Product Packet Weight (kg)</Label>
                  <Input
                    id="lpw"
                    type="number"
                    step="0.01"
                    value={itemPacketWeight || ""}
                    onChange={(e) => setItemPacketWeight(parseFloat(e.target.value) || 0)}
                  />
                </div>

                {logisticsMode === "packets_to_tonnes" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="pqty" className="text-xs font-semibold">Number of Packets (100 sheets each)</Label>
                    <Input
                      id="pqty"
                      type="number"
                      min="0.0001"
                      step="any"
                      value={orderPackets || ""}
                      onChange={(e) => setOrderPackets(parseFloat(e.target.value) || 0)}
                    />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="tton" className="text-xs font-semibold">Target Order Weight (Metric Tonnes)</Label>
                    <Input
                      id="tton"
                      type="number"
                      step="0.1"
                      value={targetTonnes || ""}
                      onChange={(e) => setTargetTonnes(parseFloat(e.target.value) || 0)}
                    />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Logistics Results */}
          <Card className="shadow-sm border-emerald-200 bg-gradient-to-br from-emerald-50/70 via-white to-amber-50/40">
            <CardHeader>
              <CardTitle className="text-base text-emerald-950 flex items-center gap-2">
                <Truck className="h-4 w-4 text-emerald-700" />
                Dispatch Summary
              </CardTitle>
              <CardDescription>Cargo weights & unit counts</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {logisticsMode === "packets_to_tonnes" ? (
                <>
                  <div className="rounded-xl border border-emerald-200 bg-white p-4">
                    <p className="text-xs font-semibold uppercase text-slate-500">Gross Cargo Weight</p>
                    <p className="text-3xl font-extrabold text-emerald-900 mt-1">
                      {orderWeight.metricTonnes.toFixed(3)} <span className="text-sm font-semibold">Tonnes</span>
                    </p>
                    <p className="text-xs text-slate-600 mt-1">
                      = {orderWeight.totalKg.toLocaleString()} kg
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                    <p className="text-xs font-semibold uppercase text-slate-500">Equivalent Physical Units</p>
                    <p className="text-sm font-bold text-slate-800 mt-1">
                      {orderPackets.toLocaleString()} Packets = {(orderPackets / 5).toLocaleString()} Reams
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {orderWeight.totalSheets.toLocaleString()} Total Sheets
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="rounded-xl border border-emerald-200 bg-white p-4">
                    <p className="text-xs font-semibold uppercase text-slate-500">Required Packet Count</p>
                    <p className="text-3xl font-extrabold text-emerald-900 mt-1">
                      {Math.ceil(tonnesRequirement.packets).toLocaleString()} <span className="text-sm font-semibold">Packets</span>
                    </p>
                    <p className="text-xs text-slate-600 mt-1">
                      ≈ {Math.ceil(tonnesRequirement.reams).toLocaleString()} Reams
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                    <p className="text-xs font-semibold uppercase text-slate-500">Net Weight</p>
                    <p className="text-base font-bold text-slate-800 mt-1">
                      {tonnesRequirement.totalKg.toLocaleString()} kg ({targetTonnes} Tonnes)
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* TAB 4: REEL / ROLL TO SHEETS MULTI-SLIT ENGINE */}
      {activeTab === "reel" && (
        <div className="space-y-6">
          {/* Benchmark Load Banner */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-gradient-to-r from-emerald-50 via-white to-amber-50 p-4 shadow-sm">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-emerald-700" />
                <h3 className="text-sm font-bold text-emerald-950">
                  Industrial Roll Converting & Multi-Dimension Sheeting Engine
                </h3>
              </div>
              <p className="text-xs text-slate-600 mt-0.5">
                Support multiple slits across reel width, multiple sheet lengths, deckle trim calculations, and exact real-number packet yields.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={loadBenchmarkExample}
              className="shrink-0 bg-emerald-800 hover:bg-emerald-900 text-white font-semibold text-xs shadow-sm flex items-center gap-1.5"
            >
              <BookmarkCheck className="h-4 w-4 text-amber-300" />
              Load Benchmark (PINDO BLEACH BOARD 56&quot; → 28×22)
            </Button>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Master Reel Input Column */}
            <div className="lg:col-span-2 space-y-6">
              {/* Master Reel Parameters */}
              <Card className="shadow-sm border-slate-200">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base text-slate-900 flex items-center gap-2">
                    <Layers className="h-4 w-4 text-emerald-700" />
                    Master Paper Reel Specifications
                  </CardTitle>
                  <CardDescription>
                    Enter the master roll dimensions, reel count, gross weight, and pricing.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="sm:col-span-2 space-y-1.5">
                      <Label htmlFor="rname" className="text-xs font-semibold">
                        Reel Paper Quality / Description
                      </Label>
                      <Input
                        id="rname"
                        value={reelName}
                        onChange={(e) => setReelName(e.target.value)}
                        placeholder="e.g. PINDO BLEACH BOARD, ART CARD..."
                        className="h-8 text-xs font-medium"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="rcount" className="text-xs font-semibold">
                        Number of Reels
                      </Label>
                      <Input
                        id="rcount"
                        type="number"
                        min="1"
                        step="1"
                        value={reelsCount || ""}
                        onChange={(e) => setReelsCount(parseInt(e.target.value, 10) || 1)}
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="rweight" className="text-xs font-semibold">
                        Total Weight (kg)
                      </Label>
                      <Input
                        id="rweight"
                        type="number"
                        min="0.1"
                        step="any"
                        value={totalReelWeightKg || ""}
                        onChange={(e) => setTotalReelWeightKg(parseFloat(e.target.value) || 0)}
                        className="h-8 text-xs font-mono font-bold text-slate-900"
                      />
                      <p className="text-[10px] text-slate-500">
                        ≈ {(totalReelWeightKg / Math.max(1, reelsCount)).toFixed(1)} kg / reel
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="rgsm_val" className="text-xs font-semibold">
                        Paper GSM
                      </Label>
                      <Input
                        id="rgsm_val"
                        type="number"
                        min="1"
                        step="any"
                        value={reelGsm || ""}
                        onChange={(e) => setReelGsm(parseFloat(e.target.value) || 0)}
                        className="h-8 text-xs font-mono font-bold"
                      />
                      <p className="text-[10px] text-slate-500">Substance (g/m²)</p>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="rwidth_val" className="text-xs font-semibold">
                        Reel Deckle Width (Inches)
                      </Label>
                      <Input
                        id="rwidth_val"
                        type="number"
                        min="1"
                        step="any"
                        value={reelWidthInches || ""}
                        onChange={(e) => setReelWidthInches(parseFloat(e.target.value) || 0)}
                        className="h-8 text-xs font-mono font-bold text-emerald-800"
                      />
                      <p className="text-[10px] text-slate-500">Master roll width</p>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="rrate" className="text-xs font-semibold">
                        Paper Rate (PKR / kg)
                      </Label>
                      <Input
                        id="rrate"
                        type="number"
                        min="0"
                        step="0.01"
                        value={ratePerKg || ""}
                        onChange={(e) => setRatePerKg(parseFloat(e.target.value) || 0)}
                        className="h-8 text-xs font-mono font-bold text-emerald-700"
                      />
                      <p className="text-[10px] text-slate-500">Price per kg</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Standard Size Presets (1-Click) */}
              <Card className="shadow-sm border-slate-200">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-xs font-bold uppercase text-slate-700">
                        Standard Size Presets (1-Click Add / Convert)
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Click any standard market size to append it to your roll cutting plan:
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex flex-wrap gap-2">
                    {COMMON_CONVERTING_PRESETS.map((preset) => (
                      <Button
                        key={preset.label}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          addCutDimension({
                            width: preset.width,
                            length: preset.length,
                            label: `${preset.label} (${preset.description})`,
                          })
                        }
                        className="h-7 text-xs border-slate-300 hover:border-emerald-600 hover:bg-emerald-50 hover:text-emerald-900 font-mono"
                      >
                        + {preset.label}
                        <span className="text-[10px] text-slate-500 font-sans ml-1">
                          ({preset.description})
                        </span>
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Slitting & Cutting Plan Table */}
              <Card className="shadow-sm border-slate-200">
                <CardHeader className="pb-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <CardTitle className="text-base text-slate-900 flex items-center gap-2">
                        <Scissors className="h-4 w-4 text-emerald-700" />
                        Slit & Cut Dimensions Plan
                      </CardTitle>
                      <CardDescription>
                        Define multiple cuts across deckle width and unwind cut lengths.
                      </CardDescription>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => addCutDimension()}
                      className="h-8 text-xs bg-emerald-700 hover:bg-emerald-800 text-white font-medium"
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Add Slit / Cut Dimension
                    </Button>
                  </div>

                  {/* Deckle Utilization Meter */}
                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                    <div className="flex flex-wrap items-center justify-between text-xs gap-2 font-medium">
                      <div>
                        Deckle Utilization:{" "}
                        <strong className="font-mono text-slate-900">
                          {multiSlitYield.totalUtilizedDeckle.toFixed(2)}&quot;
                        </strong>{" "}
                        /{" "}
                        <span className="font-mono text-slate-600">{multiSlitYield.reelWidthInches.toFixed(2)}&quot;</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {multiSlitYield.isOverDeckle ? (
                          <span className="flex items-center gap-1 text-rose-700 font-bold">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            Over Deckle by +{multiSlitYield.excessDeckle.toFixed(2)}&quot;
                          </span>
                        ) : (
                          <span className="text-slate-600">
                            Trim Waste:{" "}
                            <strong className="font-mono text-slate-900">
                              {multiSlitYield.trimWasteWidth.toFixed(2)}&quot;
                            </strong>{" "}
                            ({multiSlitYield.trimWastePercent.toFixed(1)}% /{" "}
                            <span className="font-mono font-bold text-slate-900">
                              {multiSlitYield.trimWasteKg.toFixed(1)} kg
                            </span>
                            )
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Visual Progress Bar */}
                    <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
                      <div
                        className={`h-full transition-all ${
                          multiSlitYield.isOverDeckle ? "bg-rose-600" : "bg-emerald-600"
                        }`}
                        style={{
                          width: `${Math.min(
                            100,
                            multiSlitYield.reelWidthInches > 0
                              ? (multiSlitYield.totalUtilizedDeckle / multiSlitYield.reelWidthInches) * 100
                              : 0
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="pt-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-slate-100 text-slate-700 text-[10px] font-bold uppercase border-b border-slate-200">
                        <tr>
                          <th className="py-2 px-2.5 w-8 text-center border-r border-slate-200">#</th>
                          <th className="py-2 px-2.5 border-r border-slate-200 min-w-[160px]">Cut Label</th>
                          <th className="py-2 px-2.5 border-r border-slate-200 w-28 text-right">Slit Width (Inches)</th>
                          <th className="py-2 px-2.5 border-r border-slate-200 w-24 text-center">Slits Qty</th>
                          <th className="py-2 px-2.5 border-r border-slate-200 w-28 text-right">Cut Length (Inches)</th>
                          <th className="py-2 px-2.5 border-r border-slate-200 w-24 text-center">Sheets / Pack</th>
                          <th className="py-2 px-2.5 border-r border-slate-200 w-24 text-right">Deckle Used</th>
                          <th className="py-2 px-2 w-10 text-center">Del</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono">
                        {patterns.map((item, idx) => {
                          const usedWidth = (item.slitWidth || 0) * (item.slitsCount || 1);
                          return (
                            <tr key={item.id} className="hover:bg-slate-50">
                              <td className="py-1.5 px-2.5 text-center text-slate-400 border-r border-slate-100">
                                {idx + 1}
                              </td>
                              <td className="py-1.5 px-2.5 border-r border-slate-100 font-sans">
                                <Input
                                  value={item.label || ""}
                                  onChange={(e) => updateCutDimension(item.id, "label", e.target.value)}
                                  className="h-7 text-xs font-sans"
                                  placeholder="e.g. Size A"
                                />
                              </td>
                              <td className="py-1.5 px-2.5 border-r border-slate-100">
                                <Input
                                  type="number"
                                  min="0.1"
                                  step="any"
                                  value={item.slitWidth || ""}
                                  onChange={(e) =>
                                    updateCutDimension(item.id, "slitWidth", parseFloat(e.target.value) || 0)
                                  }
                                  className="h-7 text-xs text-right font-bold"
                                />
                              </td>
                              <td className="py-1.5 px-2.5 border-r border-slate-100">
                                <Input
                                  type="number"
                                  min="1"
                                  step="1"
                                  value={item.slitsCount || ""}
                                  onChange={(e) =>
                                    updateCutDimension(item.id, "slitsCount", parseInt(e.target.value, 10) || 1)
                                  }
                                  className="h-7 text-xs text-center font-bold"
                                />
                              </td>
                              <td className="py-1.5 px-2.5 border-r border-slate-100">
                                <Input
                                  type="number"
                                  min="0.1"
                                  step="any"
                                  value={item.cutLength || ""}
                                  onChange={(e) =>
                                    updateCutDimension(item.id, "cutLength", parseFloat(e.target.value) || 0)
                                  }
                                  className="h-7 text-xs text-right font-bold"
                                />
                              </td>
                              <td className="py-1.5 px-2.5 border-r border-slate-100">
                                <select
                                  value={item.sheetsPerPack || 100}
                                  onChange={(e) =>
                                    updateCutDimension(item.id, "sheetsPerPack", parseInt(e.target.value, 10) || 100)
                                  }
                                  className="h-7 w-full rounded border border-slate-300 bg-white px-1 text-xs font-mono font-medium"
                                >
                                  <option value={100}>100s (Pack)</option>
                                  <option value={500}>500s (Ream)</option>
                                </select>
                              </td>
                              <td className="py-1.5 px-2.5 border-r border-slate-100 text-right font-bold text-slate-800">
                                {usedWidth.toFixed(2)}&quot;
                              </td>
                              <td className="py-1.5 px-2 text-center">
                                <button
                                  type="button"
                                  onClick={() => removeCutDimension(item.id)}
                                  disabled={patterns.length <= 1}
                                  className="text-slate-400 hover:text-rose-600 p-1 disabled:opacity-30"
                                  title="Remove Cut"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Sheeting Yield Results Column */}
            <div className="space-y-4">
              {/* Main Total Sheeting Yield */}
              <Card className="shadow-sm border-emerald-200 bg-gradient-to-br from-emerald-50/80 via-white to-amber-50/50">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base text-emerald-950 flex items-center gap-2">
                      <Layers className="h-4 w-4 text-emerald-700" />
                      Total Sheeting Yield
                    </CardTitle>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-200/80 text-emerald-900 font-mono">
                      {reelName || "Paper Roll"}
                    </span>
                  </div>
                  <CardDescription>
                    Exact output from {totalReelWeightKg.toLocaleString()} kg reel stock
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="rounded-xl border border-emerald-200 bg-white p-4">
                    <p className="text-xs font-semibold uppercase text-slate-500">
                      Total Packet Yield (Exact Decimal)
                    </p>
                    <p className="text-3xl font-black text-emerald-950 mt-1">
                      {multiSlitYield.totalPacketsDecimal.toFixed(2)}{" "}
                      <span className="text-sm font-semibold">Packets</span>
                    </p>
                    <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600 font-medium">
                      <span>≈ {multiSlitYield.totalPacketsInt.toLocaleString()} Approx Packets</span>
                      <span>≈ {multiSlitYield.totalReamsDecimal.toFixed(2)} Reams</span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1 font-mono">
                      = {multiSlitYield.totalSheets.toLocaleString()} Total Sheeting Sheets
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-600 font-medium">Gross Commercial Value:</span>
                      <span className="font-mono font-bold text-slate-900 text-sm">
                        PKR {Math.round(multiSlitYield.totalCommercialValue).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-600 font-medium">Net Converted Paper:</span>
                      <span className="font-mono font-bold text-emerald-800">
                        {multiSlitYield.convertedWeightKg.toFixed(2)} kg
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-600 font-medium">Trim / Side Scrap Waste:</span>
                      <span className="font-mono text-slate-700">
                        {multiSlitYield.trimWasteKg.toFixed(2)} kg ({multiSlitYield.trimWastePercent.toFixed(1)}%)
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Itemized Yield Per Slit Dimension */}
              <div className="space-y-3">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-600 px-1">
                  Itemized Dimension Breakdown ({multiSlitYield.items.length})
                </p>
                {multiSlitYield.items.map((item, idx) => (
                  <Card key={item.id} className="shadow-sm border-slate-200 bg-white">
                    <CardContent className="p-3.5 space-y-2.5">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                        <div className="font-sans font-bold text-xs text-slate-900">
                          {item.label}
                        </div>
                        <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                          {item.deckleSharePercent.toFixed(1)}% of Reel
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded bg-slate-50 p-2">
                          <p className="text-[10px] text-slate-500 font-semibold uppercase">Packet Weight</p>
                          <p className="font-mono font-bold text-slate-900 text-sm mt-0.5">
                            {item.packetWeightKg.toFixed(3)} kg
                          </p>
                          <p className="text-[10px] text-slate-500 font-mono">
                            {item.singleSheetWeightGrams.toFixed(2)} g / sheet
                          </p>
                        </div>

                        <div className="rounded bg-emerald-50/70 p-2">
                          <p className="text-[10px] text-emerald-800 font-semibold uppercase">Yield Output</p>
                          <p className="font-mono font-black text-emerald-950 text-sm mt-0.5">
                            {item.packetsYieldDecimal.toFixed(2)} Packs
                          </p>
                          <p className="text-[10px] text-emerald-800 font-mono">
                            ≈ {item.packetsYieldInt} Approx ({item.reamsYieldDecimal.toFixed(2)} Reams)
                          </p>
                        </div>
                      </div>

                      <div className="pt-1 border-t border-slate-100 text-xs flex justify-between items-center text-slate-700">
                        <span>
                          Rate:{" "}
                          <strong className="font-mono text-emerald-900">
                            PKR {item.ratePerPack.toFixed(2)}
                          </strong>{" "}
                          / pack
                        </span>
                        <span className="font-mono font-bold text-slate-900">
                          PKR {Math.round(item.totalAmount).toLocaleString()}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

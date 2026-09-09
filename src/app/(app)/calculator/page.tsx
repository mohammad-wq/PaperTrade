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
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  STANDARD_SIZES,
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

  // Tab 4: Roll to Sheet Yield
  const [rollWeightKg, setRollWeightKg] = useState<number>(650);
  const [rollWidthInches, setRollWidthInches] = useState<number>(25);
  const [cutLengthInches, setCutLengthInches] = useState<number>(36);
  const [rollGsm, setRollGsm] = useState<number>(80);

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

  // Derived Roll Yield
  const rollYield = calculateRollToSheetYield({
    rollWeightKg,
    rollWidthInches,
    cutLengthInches,
    gsm: rollGsm,
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
                      step="1"
                      value={orderPackets || ""}
                      onChange={(e) => setOrderPackets(parseInt(e.target.value, 10) || 0)}
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

      {/* TAB 4: REEL / ROLL TO SHEETS */}
      {activeTab === "reel" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2 shadow-sm border-slate-200">
            <CardHeader>
              <CardTitle className="text-base text-slate-900">Paper Roll / Reel Yield Calculator</CardTitle>
              <CardDescription>
                Calculate how many cut sheets and packets a paper reel will yield for sheeting orders.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="rwk" className="text-xs font-semibold">Roll Weight (kg)</Label>
                  <Input
                    id="rwk"
                    type="number"
                    step="1"
                    value={rollWeightKg || ""}
                    onChange={(e) => setRollWeightKg(parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rgsm" className="text-xs font-semibold">Paper GSM</Label>
                  <Input
                    id="rgsm"
                    type="number"
                    step="1"
                    value={rollGsm || ""}
                    onChange={(e) => setRollGsm(parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rwi" className="text-xs font-semibold">Roll / Deckle Width (Inches)</Label>
                  <Input
                    id="rwi"
                    type="number"
                    step="0.1"
                    value={rollWidthInches || ""}
                    onChange={(e) => setRollWidthInches(parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cli" className="text-xs font-semibold">Sheet Cut Length (Inches)</Label>
                  <Input
                    id="cli"
                    type="number"
                    step="0.1"
                    value={cutLengthInches || ""}
                    onChange={(e) => setCutLengthInches(parseFloat(e.target.value) || 0)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Reel Yield Results */}
          <Card className="shadow-sm border-emerald-200 bg-gradient-to-br from-emerald-50/70 via-white to-amber-50/40">
            <CardHeader>
              <CardTitle className="text-base text-emerald-950 flex items-center gap-2">
                <Layers className="h-4 w-4 text-emerald-700" />
                Reel Sheeting Yield
              </CardTitle>
              <CardDescription>Calculated output from {rollWeightKg} kg roll</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-xl border border-emerald-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase text-slate-500">Total Packets Yield (100s)</p>
                <p className="text-3xl font-extrabold text-emerald-900 mt-1">
                  {rollYield.totalPackets.toLocaleString()} <span className="text-sm font-semibold">Packets</span>
                </p>
                <p className="text-xs text-slate-600 mt-1">
                  ≈ {rollYield.totalReams.toLocaleString()} Reams ({rollYield.totalSheets.toLocaleString()} Sheets)
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                <p className="text-xs font-semibold uppercase text-slate-500">Per Packet Weight</p>
                <p className="text-base font-bold text-slate-800 mt-1">
                  {rollYield.packetWeightKg.toFixed(3)} kg (100 sheets)
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {(rollYield.singleSheetWeightKg * 1000).toFixed(2)} grams per sheet
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

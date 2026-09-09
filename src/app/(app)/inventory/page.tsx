"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRightLeft,
  PackageSearch,
  Plus,
  Search,
  TrendingDown,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Scale,
  Weight,
} from "lucide-react";
import { listInventoryAction, adjustStockAction, transferStockAction } from "@/actions/parties";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type InventoryRow = {
  productId: string;
  productNo: string;
  productName: string;
  locationId: string;
  locationName: string;
  available: number;
  unit: string;
  reorderLevel: number | null;
  gsm: number;
  length: number;
  breadth: number;
  packetWeight: number;
  reamWeight: number;
};

export default function InventoryPage() {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [query, setQuery] = useState("");
  const [selectedLocationId, setSelectedLocationId] = useState("all");
  const [activeTab, setActiveTab] = useState<"ALL" | "LOW">("ALL");

  // Adjustment form
  const [productId, setProductId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [direction, setDirection] = useState<"IN" | "OUT">("IN");
  const [reason, setReason] = useState("");

  // Transfer form
  const [transferProductId, setTransferProductId] = useState("");
  const [fromLocationId, setFromLocationId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [transferQuantity, setTransferQuantity] = useState(1);
  const [transferNotes, setTransferNotes] = useState("");

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listInventoryAction();
      if (result.success) {
        const inventoryRows = result.data as unknown as InventoryRow[];
        setRows(inventoryRows);
        if (inventoryRows.length) {
          if (!locationId) setLocationId(inventoryRows[0].locationId);
          if (!fromLocationId) setFromLocationId(inventoryRows[0].locationId);
          if (!toLocationId && inventoryRows.length > 1) {
            setToLocationId(inventoryRows[1].locationId);
          }
        }
      }
    } finally {
      setLoading(false);
    }
  }, [locationId, fromLocationId, toLocationId]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  const locations = useMemo(
    () => Array.from(new Map(rows.map((row) => [row.locationId, row.locationName])).entries()).map(([id, name]) => ({ id, name })),
    [rows],
  );

  const uniqueProducts = useMemo(
    () => Array.from(new Map(rows.map((row) => [row.productId, { id: row.productId, name: row.productName, no: row.productNo }])).values()),
    [rows],
  );

  const filteredRows = useMemo(() => {
    const search = query.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesLocation = selectedLocationId === "all" || row.locationId === selectedLocationId;
      const matchesQuery = !search || `${row.productName} ${row.productNo} ${row.locationName}`.toLowerCase().includes(search);
      const availableInPkts = row.unit === "REAM" ? row.available * 5 : row.unit === "SHEET" ? row.available / 100 : row.available;
      const isLowStock = row.reorderLevel !== null && availableInPkts <= row.reorderLevel;
      const matchesTab = activeTab === "ALL" || isLowStock;
      return matchesLocation && matchesQuery && matchesTab;
    });
  }, [rows, query, selectedLocationId, activeTab]);

  const lowStockCount = useMemo(
    () => rows.filter((r) => {
      if (r.reorderLevel === null) return false;
      const availableInPkts = r.unit === "REAM" ? r.available * 5 : r.unit === "SHEET" ? r.available / 100 : r.available;
      return availableInPkts <= r.reorderLevel;
    }).length,
    [rows],
  );

  // Calculate total inventory weight in kg and tonnes
  const totalWeightInKg = useMemo(() => {
    return filteredRows.reduce((sum, row) => {
      if (row.available <= 0) return sum;
      const unitWeight = row.unit === "PACKET" ? (row.packetWeight || 0) : (row.reamWeight || 0);
      return sum + (row.available * unitWeight);
    }, 0);
  }, [filteredRows]);

  const totalWeightInTonnes = useMemo(() => totalWeightInKg / 1000, [totalWeightInKg]);

  const totalPhysicalUnits = useMemo(() => {
    return filteredRows.reduce((sum, row) => sum + Math.max(0, row.available), 0);
  }, [filteredRows]);

  async function handleAdjustment(event: React.FormEvent) {
    event.preventDefault();
    setMsg(null);
    if (!productId || !locationId || !quantity || !reason.trim()) return;

    const res = await adjustStockAction({ productId, locationId, quantity, direction, reason });
    if (res.success) {
      setReason("");
      setQuantity(1);
      setMsg({ type: "success", text: "Stock adjustment recorded successfully." });
      await fetchRows();
    } else {
      setMsg({ type: "error", text: res.error || "Adjustment failed." });
    }
  }

  async function handleTransfer(event: React.FormEvent) {
    event.preventDefault();
    setMsg(null);
    if (!transferProductId || !fromLocationId || !toLocationId || !transferQuantity) return;

    if (fromLocationId === toLocationId) {
      setMsg({ type: "error", text: "Source and destination locations must be different." });
      return;
    }

    const res = await transferStockAction({
      productId: transferProductId,
      fromLocationId,
      toLocationId,
      quantity: transferQuantity,
      notes: transferNotes,
    });

    if (res.success) {
      setTransferNotes("");
      setTransferQuantity(1);
      setMsg({ type: "success", text: "Stock transferred successfully between locations." });
      await fetchRows();
    } else {
      setMsg({ type: "error", text: res.error || "Transfer failed." });
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <PackageSearch className="h-5 w-5 text-emerald-800" />
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Inventory Stock & Tonnage</h1>
        </div>
        <p className="text-sm text-slate-600">
          Real-time physical stock counts, individual unit weights, and cumulative tonnage across shop floor and warehouse storage.
        </p>
      </div>

      {/* Aggregate Weight & Tonnage Overview KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-emerald-900/15 bg-gradient-to-br from-emerald-50/70 via-white to-white shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">Total Stock Weight</p>
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800">
                <Scale className="h-3.5 w-3.5" />
              </div>
            </div>
            <p className="text-2xl font-bold text-slate-900 mt-1.5">
              {totalWeightInKg.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Cumulative weight of active filtered stock
            </p>
          </CardContent>
        </Card>

        <Card className="border-teal-900/15 bg-gradient-to-br from-teal-50/70 via-white to-white shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-teal-800">Tonnage on Hand</p>
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-100 text-teal-800">
                <Weight className="h-3.5 w-3.5" />
              </div>
            </div>
            <p className="text-2xl font-bold text-teal-950 mt-1.5">
              {totalWeightInTonnes.toFixed(3)} Tonnes
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Metric tonnes stored across locations
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Physical Stock Count</p>
            <p className="text-2xl font-bold text-slate-900 mt-1.5">
              {totalPhysicalUnits.toLocaleString()} Units
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Total packets and reams in inventory
            </p>
          </CardContent>
        </Card>

        <Card className={`border shadow-xs ${lowStockCount > 0 ? "border-rose-300 bg-rose-50/50" : "border-slate-200 bg-white"}`}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className={`text-xs font-semibold uppercase tracking-wider ${lowStockCount > 0 ? "text-rose-800" : "text-slate-500"}`}>
                Low Stock Items
              </p>
              <AlertTriangle className={`h-4 w-4 ${lowStockCount > 0 ? "text-rose-600" : "text-slate-400"}`} />
            </div>
            <p className={`text-2xl font-bold mt-1.5 ${lowStockCount > 0 ? "text-rose-900" : "text-slate-900"}`}>
              {lowStockCount}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {lowStockCount > 0 ? "Products at or below reorder limit" : "All products within safe levels"}
            </p>
          </CardContent>
        </Card>
      </div>

      {msg && (
        <div
          className={`rounded-lg p-3 text-xs flex items-center gap-2 border ${
            msg.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-rose-50 border-rose-200 text-rose-800"
          }`}
        >
          {msg.type === "success" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
          )}
          <span>{msg.text}</span>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        {/* Left: Stock Overview */}
        <Card className="border-slate-200/80 bg-white shadow-xs">
          <CardHeader className="pb-3 border-b border-slate-100">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <CardTitle className="text-base font-bold text-slate-900">Stock on Hand</CardTitle>
              <div className="flex rounded-md border border-slate-200 p-0.5 bg-slate-50 text-xs">
                <button
                  onClick={() => setActiveTab("ALL")}
                  className={`px-3 py-1 rounded font-semibold transition-colors ${
                    activeTab === "ALL" ? "bg-white text-slate-900 shadow-2xs" : "text-slate-500 hover:text-slate-900"
                  }`}
                >
                  All Items ({rows.length})
                </button>
                <button
                  onClick={() => setActiveTab("LOW")}
                  className={`px-3 py-1 rounded font-semibold transition-colors flex items-center gap-1.5 ${
                    activeTab === "LOW" ? "bg-rose-100 text-rose-900 shadow-2xs" : "text-slate-500 hover:text-rose-700"
                  }`}
                >
                  <AlertTriangle className="h-3 w-3 text-rose-600" />
                  Low Stock ({lowStockCount})
                </button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-9 text-xs"
                  placeholder="Filter by product name, code, or location..."
                />
              </div>
              <select
                value={selectedLocationId}
                onChange={(e) => setSelectedLocationId(e.target.value)}
                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium"
              >
                <option value="all">All locations</option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </div>

            {loading ? (
              <p className="text-xs text-slate-500 py-8 text-center">Recalculating stock on hand and weights...</p>
            ) : filteredRows.length === 0 ? (
              <p className="text-xs text-slate-500 py-8 text-center">No inventory items match the filter.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {filteredRows.map((row) => {
                  const availableInPkts = row.unit === "REAM" ? row.available * 5 : row.unit === "SHEET" ? row.available / 100 : row.available;
                  const isLow = row.reorderLevel !== null && availableInPkts <= row.reorderLevel;
                  const unitWeight = row.unit === "PACKET" ? (row.packetWeight || 0) : (row.reamWeight || 0);
                  const totalLineWeightKg = Math.max(0, row.available) * unitWeight;
                  const totalLineWeightTonnes = totalLineWeightKg / 1000;

                  return (
                    <div
                      key={`${row.locationId}-${row.productId}`}
                      className={`rounded-xl border p-3.5 transition-all flex flex-col justify-between ${
                        isLow ? "border-rose-200 bg-rose-50/40" : "border-slate-200/80 bg-white hover:border-slate-300"
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-bold text-xs text-slate-900">{row.productNo}</p>
                            <p className="text-xs font-semibold text-slate-800">{row.productName}</p>
                          </div>
                          <span
                            className={`rounded-md px-2 py-0.5 text-xs font-extrabold ${
                              isLow
                                ? "bg-rose-100 text-rose-800 border border-rose-200"
                                : "bg-emerald-100 text-emerald-800"
                            }`}
                          >
                            {row.available} {row.unit}
                          </span>
                        </div>

                        <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-1.5 pt-1">
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700">
                            {row.length}&quot; × {row.breadth}&quot;
                          </span>
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700">
                            {row.gsm} GSM
                          </span>
                          <span className="text-slate-400">•</span>
                          <span className="font-medium text-slate-700">{row.locationName}</span>
                        </div>

                        {/* Individual and Total Weight metrics */}
                        <div className="mt-2.5 grid grid-cols-2 gap-2 rounded-lg bg-slate-50/80 p-2 border border-slate-100 text-[11px]">
                          <div>
                            <span className="text-slate-400 block text-[10px] uppercase font-semibold">Unit Weight ({row.unit})</span>
                            <span className="font-semibold text-slate-800">{unitWeight.toFixed(3)} kg</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[10px] uppercase font-semibold">Total Stock Weight</span>
                            <span className="font-bold text-emerald-900">
                              {totalLineWeightKg.toFixed(1)} kg{" "}
                              <span className="text-[10px] text-slate-500 font-normal">({totalLineWeightTonnes.toFixed(3)} T)</span>
                            </span>
                          </div>
                        </div>
                      </div>

                      {row.reorderLevel !== null && (
                        <div className="mt-2.5 border-t border-slate-100 pt-1.5 flex justify-between text-[11px]">
                          <span className="text-slate-500">Reorder Threshold:</span>
                          <span className={`font-semibold ${isLow ? "text-rose-700 font-bold" : "text-slate-700"}`}>
                            {row.reorderLevel} Packets
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right: Adjustment and Transfer forms */}
        <div className="space-y-6">
          {/* Stock Adjustment Card */}
          <Card className="border-slate-200/80 bg-white shadow-xs">
            <CardHeader className="pb-3 border-b border-slate-100">
              <CardTitle className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-700" />
                Manual Stock Adjustment
              </CardTitle>
              <CardDescription className="text-xs">
                Log write-ins or write-offs for damaged or counted stock.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4">
              <form onSubmit={handleAdjustment} className="space-y-3 text-xs">
                <div className="space-y-1">
                  <Label htmlFor="adjprod" className="text-xs font-semibold">Product *</Label>
                  <select
                    id="adjprod"
                    value={productId}
                    onChange={(e) => setProductId(e.target.value)}
                    className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                    required
                  >
                    <option value="">Select product</option>
                    {uniqueProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.no} - {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="adjloc" className="text-xs font-semibold">Location *</Label>
                  <select
                    id="adjloc"
                    value={locationId}
                    onChange={(e) => setLocationId(e.target.value)}
                    className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
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
                    <Label htmlFor="adjqty" className="text-xs font-semibold">Quantity *</Label>
                    <Input
                      id="adjqty"
                      type="number"
                      min="1"
                      value={quantity}
                      onChange={(e) => setQuantity(Number(e.target.value) || 1)}
                      className="h-8 text-xs"
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="adjdir" className="text-xs font-semibold">Direction *</Label>
                    <select
                      id="adjdir"
                      value={direction}
                      onChange={(e) => setDirection(e.target.value as "IN" | "OUT")}
                      className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs h-8 font-medium"
                    >
                      <option value="IN">+ Increase Stock</option>
                      <option value="OUT">- Decrease Stock</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="adjreason" className="text-xs font-semibold">Reason (Mandatory) *</Label>
                  <Input
                    id="adjreason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Physical inventory count correction"
                    className="h-8 text-xs"
                    required
                  />
                </div>

                <Button type="submit" className="w-full bg-emerald-800 text-white hover:bg-emerald-700 text-xs shadow-sm mt-1">
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Post Adjustment
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Transfer Card */}
          <Card className="border-slate-200/80 bg-white shadow-xs">
            <CardHeader className="pb-3 border-b border-slate-100">
              <CardTitle className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <ArrowRightLeft className="h-4 w-4 text-amber-700" />
                Shop / Warehouse Transfer
              </CardTitle>
              <CardDescription className="text-xs">
                Move paper between shop floor and warehouse storage.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4">
              <form onSubmit={handleTransfer} className="space-y-3 text-xs">
                <div className="space-y-1">
                  <Label htmlFor="trprod" className="text-xs font-semibold">Product *</Label>
                  <select
                    id="trprod"
                    value={transferProductId}
                    onChange={(e) => setTransferProductId(e.target.value)}
                    className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                    required
                  >
                    <option value="">Select product</option>
                    {uniqueProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.no} - {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="fromloc" className="text-xs font-semibold">From *</Label>
                    <select
                      id="fromloc"
                      value={fromLocationId}
                      onChange={(e) => setFromLocationId(e.target.value)}
                      className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                      required
                    >
                      {locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="toloc" className="text-xs font-semibold">To *</Label>
                    <select
                      id="toloc"
                      value={toLocationId}
                      onChange={(e) => setToLocationId(e.target.value)}
                      className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                      required
                    >
                      {locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="trqty" className="text-xs font-semibold">Quantity to Move *</Label>
                  <Input
                    id="trqty"
                    type="number"
                    min="1"
                    value={transferQuantity}
                    onChange={(e) => setTransferQuantity(Number(e.target.value) || 1)}
                    className="h-8 text-xs"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="trnotes" className="text-xs">Notes</Label>
                  <Input
                    id="trnotes"
                    value={transferNotes}
                    onChange={(e) => setTransferNotes(e.target.value)}
                    placeholder="e.g. Replenishing shop floor"
                    className="h-8 text-xs"
                  />
                </div>

                <Button type="submit" variant="outline" className="w-full text-xs border-amber-300 text-amber-900 hover:bg-amber-50 mt-1">
                  <ArrowRightLeft className="mr-1 h-3.5 w-3.5" />
                  Execute Transfer
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

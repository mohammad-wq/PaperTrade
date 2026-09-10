"use client";

import { useEffect, useState, useMemo } from "react";
import {
  ArrowRightLeft,
  Search,
  Filter,
  Package,
  Calendar,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { listStockMovementsAction } from "@/actions/stock-movements";
import { listProductsAction } from "@/actions/products";
import { listInventoryAction } from "@/actions/parties";
import { StockMovementType } from "@prisma/client";
import { format } from "date-fns";
import { useRealtimeListener } from "@/hooks/use-realtime";

type MovementRow = {
  id: string;
  type: StockMovementType;
  quantity: number;
  referenceType: string;
  referenceId: string;
  notes: string | null;
  createdAt: Date;
  product: { productNo: string; name: string; unit: string };
  location: { name: string };
  createdBy: { name: string };
};

export default function StockMovementsPage() {
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [products, setProducts] = useState<Array<{ id: string; productNo: string; name: string }>>([]);
  const [locations, setLocations] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [productId, setProductId] = useState("ALL");
  const [locationId, setLocationId] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [query, setQuery] = useState("");

  async function loadMovements(isBackground = false) {
    if (!isBackground) setLoading(true);
    try {
      const res = await listStockMovementsAction({
        productId: productId === "ALL" ? undefined : productId,
        locationId: locationId === "ALL" ? undefined : locationId,
        type: typeFilter === "ALL" ? undefined : (typeFilter as StockMovementType),
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });

      if (res.success && res.data) {
        setMovements(res.data as MovementRow[]);
      }
    } finally {
      if (!isBackground) setLoading(false);
    }
  }

  useRealtimeListener(["stock-movements", "inventory", "sales", "purchases", "delivery-orders"], () => {
    void loadMovements(true);
  });

  useEffect(() => {
    async function loadLookups() {
      const [prodRes, invRes] = await Promise.all([
        listProductsAction(),
        listInventoryAction(),
      ]);
      if (prodRes.success && prodRes.data) {
        setProducts(prodRes.data as Array<{ id: string; productNo: string; name: string }>);
      }
      if (invRes.success && invRes.data) {
        const rows = invRes.data as Array<{ locationId: string; locationName: string }>;
        const unique = Array.from(new Map(rows.map((r) => [r.locationId, r.locationName])).entries()).map(
          ([id, name]) => ({ id, name }),
        );
        setLocations(unique);
      }
    }
    void loadLookups();
  }, []);

  useEffect(() => {
    void loadMovements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, locationId, typeFilter, startDate, endDate]);

  const filteredMovements = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return movements;
    return movements.filter(
      (m) =>
        m.product.productNo.toLowerCase().includes(q) ||
        m.product.name.toLowerCase().includes(q) ||
        m.location.name.toLowerCase().includes(q) ||
        m.referenceType.toLowerCase().includes(q) ||
        (m.notes && m.notes.toLowerCase().includes(q)),
    );
  }, [movements, query]);

  function getBadge(type: StockMovementType) {
    switch (type) {
      case StockMovementType.PURCHASE_IN:
      case StockMovementType.TRANSFER_IN:
      case StockMovementType.SALE_RETURN:
        return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">+{type}</span>;
      case StockMovementType.SALE_OUT:
      case StockMovementType.TRANSFER_OUT:
      case StockMovementType.DELIVERY_OUT:
      case StockMovementType.PURCHASE_RETURN:
        return <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800">-{type}</span>;
      case StockMovementType.ADJUSTMENT:
        return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">{type}</span>;
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="h-5 w-5 text-emerald-800" />
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Stock Movements</h1>
        </div>
        <p className="text-sm text-slate-600">
          Complete audit trail of all warehouse and shop inventory changes. Current stock is derived from these logs.
        </p>
      </div>

      {/* Filter Bar */}
      <Card className="border-slate-200/80 bg-white shadow-xs">
        <CardContent className="p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-5">
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-600">Product</label>
              <select
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium"
              >
                <option value="ALL">All Products</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.productNo} - {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-600">Location</label>
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium"
              >
                <option value="ALL">All Locations</option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-600">Movement Type</label>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium"
              >
                <option value="ALL">All Types</option>
                {Object.values(StockMovementType).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-600">From Date</label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-600">To Date</label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>

          <div className="relative pt-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Quick search by product, reference, notes..."
              className="pl-9 h-9 text-xs bg-slate-50/60"
            />
          </div>
        </CardContent>
      </Card>

      {/* Movements Table / Cards */}
      {loading ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500 text-sm">Loading stock movements...</CardContent>
        </Card>
      ) : filteredMovements.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500 text-sm">No stock movements found.</CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredMovements.map((m) => (
            <div
              key={m.id}
              className="rounded-xl border border-slate-200/80 bg-white p-3.5 hover:bg-slate-50/80 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-xs text-slate-900">{m.product.productNo}</span>
                  <span className="text-xs text-slate-700 font-medium">{m.product.name}</span>
                  {getBadge(m.type)}
                </div>
                <div className="text-[11px] text-slate-500 flex flex-wrap gap-2">
                  <span>Location: <strong className="text-slate-700">{m.location.name}</strong></span>
                  <span>• Ref: <strong className="text-slate-700">{m.referenceType}</strong></span>
                  <span>• By: {m.createdBy.name}</span>
                  {m.notes && <span>• &quot;{m.notes}&quot;</span>}
                </div>
              </div>

              <div className="flex sm:flex-col items-center sm:items-end justify-between border-t sm:border-0 border-slate-100 pt-2 sm:pt-0">
                <span className="text-sm font-bold text-slate-900">
                  {m.quantity > 0 ? `+${m.quantity}` : m.quantity} {m.product.unit}
                </span>
                <span className="text-[10px] text-slate-400">{format(new Date(m.createdAt), "dd MMM yyyy, HH:mm")}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

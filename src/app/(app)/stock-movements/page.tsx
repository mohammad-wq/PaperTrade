"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import Link from "next/link";
import {
  ArrowRightLeft,
  Search,
  RefreshCw,
  FileSpreadsheet,
  Package,
} from "lucide-react";
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
  const searchInputRef = useRef<HTMLInputElement>(null);

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

  // Keyboard shortcut '/' to search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.key === "/" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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
        return (
          <span className="rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 px-1.5 py-0.5 text-[10px] font-mono font-bold">
            +{type}
          </span>
        );
      case StockMovementType.SALE_OUT:
      case StockMovementType.TRANSFER_OUT:
      case StockMovementType.DELIVERY_OUT:
      case StockMovementType.PURCHASE_RETURN:
        return (
          <span className="rounded-md bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800 px-1.5 py-0.5 text-[10px] font-mono font-bold">
            -{type}
          </span>
        );
      case StockMovementType.ADJUSTMENT:
        return (
          <span className="rounded-md bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 px-1.5 py-0.5 text-[10px] font-mono font-bold">
            {type}
          </span>
        );
    }
  }

  function exportToCSV() {
    const headers = ["Timestamp", "Product No", "Product Name", "Movement Type", "Quantity", "Unit", "Location", "Reference Type", "Operator", "Notes"];
    const rows = filteredMovements.map((m) => [
      format(new Date(m.createdAt), "yyyy-MM-dd HH:mm:ss"),
      `"${m.product.productNo}"`,
      `"${m.product.name.replace(/"/g, '""')}"`,
      m.type,
      m.quantity,
      `"${m.product.unit}"`,
      `"${m.location.name.replace(/"/g, '""')}"`,
      `"${m.referenceType}"`,
      `"${m.createdBy.name.replace(/"/g, '""')}"`,
      `"${(m.notes || "").replace(/"/g, '""')}"`,
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Stock_Movements_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <div className="space-y-3">
      {/* Top Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-2.5 rounded-md shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
            <ArrowRightLeft className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900 dark:text-slate-100 tracking-tight">
              Stock Movements Audit Trail
            </h1>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Immutable log of all physical stock ins, outs, transfers, and warehouse adjustments
            </p>
          </div>
        </div>

        {/* Live Aggregate Chips */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-mono">
          <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
            Logs: <strong>{movements.length}</strong>
          </span>
          <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
            Products: <strong>{products.length}</strong>
          </span>
          <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
            Locations: <strong>{locations.length}</strong>
          </span>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => loadMovements()}
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
          <Button asChild size="sm" variant="outline" className="h-8 text-xs border-slate-200 dark:border-slate-800">
            <Link href="/inventory">
              <Package className="mr-1.5 h-3.5 w-3.5" />
              Live Stock
            </Link>
          </Button>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="flex flex-col gap-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2.5 rounded-md shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <Input
              ref={searchInputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by product, reference, notes (Press / to focus)..."
              className="pl-8 h-8 text-xs bg-slate-50 dark:bg-slate-950"
            />
            {query && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setQuery("")}
                className="absolute right-1 top-1 h-6 px-1.5 text-[10px] text-slate-500"
              >
                Clear
              </Button>
            )}
          </div>

          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className="h-8 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-2.5 text-xs text-slate-700 dark:text-slate-300 max-w-[180px]"
          >
            <option value="ALL">All Products</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.productNo} - {p.name}
              </option>
            ))}
          </select>

          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="h-8 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-2.5 text-xs text-slate-700 dark:text-slate-300"
          >
            <option value="ALL">All Locations</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-8 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-2.5 text-xs text-slate-700 dark:text-slate-300"
          >
            <option value="ALL">All Movement Types</option>
            {Object.values(StockMovementType).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1.5 text-xs text-slate-500 font-mono">
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-8 text-xs w-32 bg-slate-50 dark:bg-slate-950"
              title="Filter from date"
            />
            <span>&rarr;</span>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-8 text-xs w-32 bg-slate-50 dark:bg-slate-950"
              title="Filter to date"
            />
          </div>
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono pt-1 border-t border-slate-100 dark:border-slate-800">
          <span>Showing {filteredMovements.length} of {movements.length} audit logs</span>
          {(productId !== "ALL" || locationId !== "ALL" || typeFilter !== "ALL" || startDate || endDate || query) && (
            <button
              type="button"
              onClick={() => {
                setProductId("ALL");
                setLocationId("ALL");
                setTypeFilter("ALL");
                setStartDate("");
                setEndDate("");
                setQuery("");
              }}
              className="text-xs text-rose-600 hover:underline"
            >
              Reset All Filters
            </button>
          )}
        </div>
      </div>

      {/* Movements High-Density Table */}
      <div className="overflow-hidden rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                <th className="py-2.5 px-3">Date & Time</th>
                <th className="py-2.5 px-3">Product</th>
                <th className="py-2.5 px-3">Type</th>
                <th className="py-2.5 px-3 text-right">Quantity</th>
                <th className="py-2.5 px-3">Location</th>
                <th className="py-2.5 px-3">Reference / Doc</th>
                <th className="py-2.5 px-3">Operator</th>
                <th className="py-2.5 px-3">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-xs text-slate-400">
                    Loading stock movements...
                  </td>
                </tr>
              ) : filteredMovements.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-xs text-slate-400">
                    No stock movements found matching the current filters.
                  </td>
                </tr>
              ) : (
                filteredMovements.map((m) => (
                  <tr
                    key={m.id}
                    className="hover:bg-slate-50/70 dark:hover:bg-slate-800/50 transition-colors"
                  >
                    <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                      {format(new Date(m.createdAt), "dd/MM/yyyy HH:mm")}
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-slate-100">
                      <div>
                        <span>{m.product.name}</span>
                        <span className="ml-1.5 text-[10px] text-slate-400 font-mono">[{m.product.productNo}]</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      {getBadge(m.type)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-sm">
                      <span className={m.quantity > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}>
                        {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                      </span>
                      <span className="text-[10px] text-slate-400 font-normal font-sans ml-1">{m.product.unit}</span>
                    </td>
                    <td className="py-2.5 px-3 font-medium text-slate-700 dark:text-slate-300">
                      {m.location.name}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300 font-mono text-[11px]">
                      {m.referenceType}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300 text-[11px]">
                      {m.createdBy.name}
                    </td>
                    <td className="py-2.5 px-3 text-slate-500 text-[11px] italic max-w-[200px] truncate">
                      {m.notes || "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

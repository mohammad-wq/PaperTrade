"use client";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
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
  Layers,
  Warehouse,
  Store,
  Trash2,
  X,
  Printer,
  Download,
  LayoutGrid,
  ListFilter,
  SlidersHorizontal,
  Table2,
} from "lucide-react";
import {
  listInventoryAction,
  adjustStockAction,
  transferStockAction,
  bulkAdjustStockAction,
  bulkTransferStockAction,
} from "@/actions/parties";
import { listLocationsAction } from "@/actions/orders";
import { listWarehouseLotsAction, createWarehouseLotAction } from "@/actions/warehouse-lots";
import { SearchCombobox, type ComboboxOption } from "@/components/ui/search-combobox";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRealtimeListener } from "@/hooks/use-realtime";
import { useRealtime } from "@/components/providers/realtime-provider";
import { cn } from "@/lib/utils";

type InventoryRow = {
  productId: string;
  productNo: string;
  productName: string;
  locationId: string;
  locationName: string;
  locationType?: string;
  available: number;
  unit: string;
  reorderLevel: number | null;
  gsm: number;
  length: number;
  breadth: number;
  packetWeight: number;
  reamWeight: number;
  isActive?: boolean;
  lots?: {
    id: string | null;
    lotNumber: string;
    description: string | null;
    available: number;
  }[];
};

type LotItem = {
  id: string;
  locationId: string;
  locationName: string;
  lotNumber: string;
  description: string | null;
  currentStock: number;
};

export default function InventoryClient({
  initialInventory,
  initialLots,
  initialLocations,
}: {
  initialInventory?: InventoryRow[];
  initialLots?: LotItem[];
  initialLocations?: Array<{ id: string; name: string; type: "SHOP" | "WAREHOUSE" }>;
}) {
  const router = useRouter();
  const { broadcastLocalChange } = useRealtime();
  const [rows, setRows] = useState<InventoryRow[]>(initialInventory || []);
  const [allLots, setAllLots] = useState<LotItem[]>(initialLots || []);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(query);
    }, 250);
    return () => clearTimeout(handler);
  }, [query]);

  const [selectedLocationId, setSelectedLocationId] = useState("all");
  const [selectedLotId, setSelectedLotId] = useState("all");
  const [stockFilter, setStockFilter] = useState<"NON_ZERO" | "ZERO" | "ALL">("NON_ZERO");
  const [activeTab, setActiveTab] = useState<"ALL" | "LOW">("ALL");
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Adjustment form
  const [productId, setProductId] = useState("");
  const [locationId, setLocationId] = useState(initialInventory?.[0]?.locationId || "");
  const [warehouseLotId, setWarehouseLotId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [direction, setDirection] = useState<"IN" | "OUT">("IN");
  const [reason, setReason] = useState("");

  function openAdjustForRow(row: InventoryRow) {
    setProductId(row.productId);
    setLocationId(row.locationId);
    setWarehouseLotId("");
    setQuantity(1);
    setDirection("IN");
    setReason("");
    setShowAdjustModal(true);
  }

  function openTransferForRow(row: InventoryRow) {
    setTransferProductId(row.productId);
    setFromLocationId(row.locationId);
    setFromWarehouseLotId("");
    const other = locations.find((l) => l.id !== row.locationId) || locations[0];
    if (other) setToLocationId(other.id);
    setToWarehouseLotId("");
    setTransferQuantity(1);
    setTransferNotes("");
    setShowTransferModal(true);
  }

  // Transfer form
  const [transferProductId, setTransferProductId] = useState("");
  const [fromLocationId, setFromLocationId] = useState("");
  const [fromWarehouseLotId, setFromWarehouseLotId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [toWarehouseLotId, setToWarehouseLotId] = useState("");
  const [transferQuantity, setTransferQuantity] = useState(1);
  const [transferNotes, setTransferNotes] = useState("");

  // Quick Lot creation modal state
  const [showQuickLotModal, setShowQuickLotModal] = useState(false);
  const [quickLotLocationId, setQuickLotLocationId] = useState("");
  const [quickLotNumber, setQuickLotNumber] = useState("");
  const [quickLotDescription, setQuickLotDescription] = useState("");
  const [submittingQuickLot, setSubmittingQuickLot] = useState(false);
  const [quickLotTarget, setQuickLotTarget] = useState<{
    type: "single-adj" | "single-from" | "single-to" | "bulk-adj" | "bulk-from" | "bulk-to";
    itemIndex?: number;
  } | null>(null);

  // Bulk adjustment state
  const [showBulkAdjustModal, setShowBulkAdjustModal] = useState(false);

  const [bulkAdjLocationId, setBulkAdjLocationId] = useState("");
  // Ensure each bulk adjust item inherits the header location when it changes
  useEffect(() => {
    if (bulkAdjLocationId) {
      setBulkAdjItems((prev) =>
        prev.map((item) => (item.locationId ? item : { ...item, locationId: bulkAdjLocationId }))
      );
    }
  }, [bulkAdjLocationId]);
  const [bulkAdjReason, setBulkAdjReason] = useState("");
  const [bulkAdjItems, setBulkAdjItems] = useState<
    Array<{
      productId: string;
      locationId: string;
      warehouseLotId?: string;
      quantity: number;
      direction: "IN" | "OUT";
      notes?: string;
    }>
  >([{ productId: "", locationId: "", warehouseLotId: "", quantity: 1, direction: "IN", notes: "" }]);
  const [submittingBulkAdj, setSubmittingBulkAdj] = useState(false);
  const [bulkAdjError, setBulkAdjError] = useState<string | null>(null);

  // Bulk transfer state
  const [showBulkTransferModal, setShowBulkTransferModal] = useState(false);
  const [bulkTrFromLocationId, setBulkTrFromLocationId] = useState("");
  const [bulkTrToLocationId, setBulkTrToLocationId] = useState("");
  const [bulkTrNotes, setBulkTrNotes] = useState("");
  const [bulkTrItems, setBulkTrItems] = useState<
    Array<{
      productId: string;
      fromWarehouseLotId?: string;
      toWarehouseLotId?: string;
      quantity: number;
    }>
  >([{ productId: "", fromWarehouseLotId: "", toWarehouseLotId: "", quantity: 1 }]);
  const [submittingBulkTr, setSubmittingBulkTr] = useState(false);
  const [bulkTrError, setBulkTrError] = useState<string | null>(null);

  const [adjError, setAdjError] = useState<string | null>(null);
  const [trError, setTrError] = useState<string | null>(null);

  const [dbLocations, setDbLocations] = useState<Array<{ id: string; name: string; type: "SHOP" | "WAREHOUSE" }>>(initialLocations || []);
  const [loading, setLoading] = useState(!initialInventory);
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchRows = useCallback(async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    try {
      const [result, lotsRes, locsRes] = await Promise.all([
        listInventoryAction(),
        listWarehouseLotsAction(),
        listLocationsAction(),
      ]);
      if (result.success) {
        const inventoryRows = result.data as unknown as InventoryRow[];
        setRows(inventoryRows);
        if (inventoryRows.length) {
          setLocationId((prev) => prev || inventoryRows[0].locationId);
          setFromLocationId((prev) => prev || inventoryRows[0].locationId);
          setToLocationId((prev) => prev || (inventoryRows.length > 1 ? inventoryRows[1].locationId : ""));
        }
      }
      if (lotsRes.success) {
        setAllLots(lotsRes.data);
      }
      if (locsRes.success && locsRes.data) {
        setDbLocations(locsRes.data as Array<{ id: string; name: string; type: "SHOP" | "WAREHOUSE" }>);
      }
    } finally {
      if (!isBackground) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialInventory) {
      void fetchRows();
    }
  }, [fetchRows, initialInventory]);

  useRealtimeListener(["inventory", "warehouse-lots", "locations", "sales", "purchases", "delivery-orders", "purchase-orders", "returns"], () => {
    void fetchRows(true);
  });

  const locations = useMemo(() => {
    if (dbLocations.length > 0) return dbLocations;
    return Array.from(
      new Map(
        rows.map((row) => [
          row.locationId,
          { id: row.locationId, name: row.locationName, type: (row.locationType || "SHOP") as "SHOP" | "WAREHOUSE" },
        ])
      ).values()
    );
  }, [dbLocations, rows]);

  const locationOptions: ComboboxOption[] = useMemo(() => {
    return locations.map((loc) => ({
      id: loc.id,
      label: loc.name,
      badge: loc.type,
      badgeColor: (loc.type === "WAREHOUSE" ? "sky" : "green") as any,
    }));
  }, [locations]);

  const uniqueProducts = useMemo(
    () =>
      Array.from(
        new Map(
          rows.map((row) => [
            row.productId,
            { id: row.productId, name: row.productName, no: row.productNo, unit: row.unit || "pkts" },
          ]),
        ).values(),
      ),
    [rows],
  );

  const getProductStock = useCallback(
    (pId: string, locId?: string, lotId?: string | null): number => {
      if (!pId) return 0;
      if (locId && locId !== "all") {
        const row = rows.find((r) => r.productId === pId && r.locationId === locId);
        if (!row) return 0;
        if (lotId) {
          const foundLot = row.lots?.find((l) => l.id === lotId);
          return foundLot ? foundLot.available : 0;
        }
        if (lotId === null || lotId === "") {
          const locLots = allLots.filter((l) => l.locationId === locId);
          if (locLots.length > 0) {
            const unassigned = row.lots?.find((l) => l.id === null);
            return unassigned ? unassigned.available : 0;
          }
          return row.available;
        }
        return row.available;
      }
      return rows.filter((r) => r.productId === pId).reduce((sum, r) => sum + r.available, 0);
    },
    [rows, allLots],
  );

  const getProductOptionsForLocation = useCallback(
    (locId?: string, lotId?: string | null): ComboboxOption[] => {
      const locName = locId && locId !== "all" ? locations.find((l) => l.id === locId)?.name : null;
      return uniqueProducts.map((p) => {
        const stock = getProductStock(p.id, locId, lotId);
        const sublabel = locName
          ? `In ${locName}: ${stock} ${p.unit}`
          : `Total Stock: ${stock} ${p.unit}`;
        return {
          id: p.id,
          label: `${p.no} - ${p.name}`,
          sublabel,
          badge: `${stock} ${p.unit}`,
          badgeColor: stock > 0 ? ("green" as const) : ("rose" as const),
        };
      });
    },
    [locations, uniqueProducts, getProductStock],
  );

  const adjLocationLots = useMemo(
    () => allLots.filter((l) => l.locationId === locationId),
    [allLots, locationId],
  );

  const fromLocationLots = useMemo(
    () => allLots.filter((l) => l.locationId === fromLocationId),
    [allLots, fromLocationId],
  );

  const toLocationLots = useMemo(
    () => allLots.filter((l) => l.locationId === toLocationId),
    [allLots, toLocationId],
  );

  const getLotsForLocation = useCallback(
    (locId: string, pId?: string): ComboboxOption[] => {
      const lots = allLots.filter((l) => l.locationId === locId);
      const standardStock = pId ? getProductStock(pId, locId, "") : undefined;
      return [
        {
          id: "",
          label: "No Lot / Standard Stock",
          sublabel: pId ? `${standardStock} pkts on hand` : undefined,
          badge: pId ? `${standardStock} pkts` : undefined,
          badgeColor: (standardStock ?? 0) > 0 ? ("green" as const) : ("slate" as const),
        },
        ...lots.map((l) => {
          const lotStock = pId ? getProductStock(pId, locId, l.id) : (l.currentStock || 0);
          return {
            id: l.id,
            label: l.lotNumber,
            sublabel: pId ? `${lotStock} pkts on hand` : `${lotStock} pkts`,
            badge: `${lotStock} pkts`,
            badgeColor: lotStock > 0 ? ("green" as const) : ("slate" as const),
          };
        }),
      ];
    },
    [allLots, getProductStock],
  );

  const bulkAdjLocationLots = useMemo(
    () => allLots.filter((l) => l.locationId === bulkAdjLocationId),
    [allLots, bulkAdjLocationId],
  );

  const bulkTrFromLots = useMemo(
    () => allLots.filter((l) => l.locationId === bulkTrFromLocationId),
    [allLots, bulkTrFromLocationId],
  );

  const bulkTrToLots = useMemo(
    () => allLots.filter((l) => l.locationId === bulkTrToLocationId),
    [allLots, bulkTrToLocationId],
  );

  const selectedLocationLots = useMemo(
    () => (selectedLocationId !== "all" ? allLots.filter((l) => l.locationId === selectedLocationId) : []),
    [allLots, selectedLocationId]
  );

  const nonZeroCount = useMemo(() => rows.filter((r) => r.available !== 0).length, [rows]);
  const zeroCount = useMemo(() => rows.filter((r) => r.available === 0).length, [rows]);

  const filteredRows = useMemo(() => {
    const search = debouncedQuery.trim().toLowerCase();
    return rows.filter((row) => {
      // 1. Location Filter
      const matchesLocation = selectedLocationId === "all" || row.locationId === selectedLocationId;
      if (!matchesLocation) return false;

      // 2. Lot Filter (Active when selected location has multiple lots)
      if (selectedLocationId !== "all" && selectedLocationLots.length > 1 && selectedLotId !== "all") {
        if (selectedLotId === "unassigned") {
          const unassignedStock = row.lots?.find((l) => l.id === null)?.available ?? 0;
          if (unassignedStock === 0) return false;
        } else {
          const specificLotStock = row.lots?.find((l) => l.id === selectedLotId)?.available ?? 0;
          if (specificLotStock === 0) return false;
        }
      }

      // 3. Stock Level Filter (Issue 5: Only show non-zero by default, with separate filter for zero products)
      if (stockFilter === "NON_ZERO" && row.available === 0) {
        return false;
      }
      if (stockFilter === "ZERO" && row.available !== 0) {
        return false;
      }

      // 4. Query Omnisearch
      const matchesQuery =
        !search ||
        `${row.productName} ${row.productNo} ${row.locationName}`.toLowerCase().includes(search) ||
        (row.lots && row.lots.some((l) => l.lotNumber.toLowerCase().includes(search)));
      if (!matchesQuery) return false;

      // 5. Active Tab (Low Stock)
      const availableInPkts = row.unit === "REAM" ? row.available * 5 : row.unit === "SHEET" ? row.available / 100 : row.available;
      const isLowStock = row.reorderLevel !== null && availableInPkts <= row.reorderLevel;
      const matchesTab = activeTab === "ALL" || isLowStock;
      return matchesTab;
    });
  }, [rows, debouncedQuery, selectedLocationId, selectedLocationLots, selectedLotId, stockFilter, activeTab]);

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
    setAdjError(null);
    if (!productId || !locationId || !quantity || !reason.trim()) {
      setAdjError("All fields marked with * are required.");
      return;
    }
    if (reason.trim().length < 3) {
      setAdjError("Reason must be at least 3 characters.");
      return;
    }
    if (direction === "OUT") {
      const avail = getProductStock(productId, locationId, warehouseLotId ? warehouseLotId : "");
      if (quantity > avail) {
        setAdjError(`Cannot decrease stock by ${quantity}. Only ${avail} available.`);
        return;
      }
    }

    const res = await adjustStockAction({
      productId,
      locationId,
      warehouseLotId: warehouseLotId || undefined,
      quantity,
      direction,
      reason: reason.trim(),
    });
    if (res.success) {
      setShowAdjustModal(false);
      setReason("");
      setQuantity(1);
      setAdjError(null);
      setMsg({ type: "success", text: "Stock adjustment recorded successfully." });

      broadcastLocalChange(["inventory", "stock-movements", "dashboard"]);
      router.refresh();
      await fetchRows(true);
    } else {
      setAdjError(res.error || "Adjustment failed.");
    }
  }

  async function handleTransfer(event: React.FormEvent) {
    event.preventDefault();
    setMsg(null);
    setTrError(null);
    if (!transferProductId || !fromLocationId || !toLocationId || !transferQuantity) {
      setTrError("All fields marked with * are required.");
      return;
    }

    if (
      fromLocationId === toLocationId &&
      (fromWarehouseLotId || "") === (toWarehouseLotId || "")
    ) {
      setTrError("For transfers within the same warehouse, source and destination lots must differ.");
      return;
    }

    const avail = getProductStock(transferProductId, fromLocationId, fromWarehouseLotId ? fromWarehouseLotId : "");
    if (transferQuantity > avail) {
      setTrError(`Cannot transfer ${transferQuantity}. Only ${avail} available in selected source.`);
      return;
    }

    const res = await transferStockAction({
      productId: transferProductId,
      fromLocationId,
      fromWarehouseLotId: fromWarehouseLotId || undefined,
      toLocationId,
      toWarehouseLotId: toWarehouseLotId || undefined,
      quantity: transferQuantity,
      notes: transferNotes.trim() || undefined,
    });

    if (res.success) {
      setShowTransferModal(false);
      setTransferNotes("");
      setTransferQuantity(1);
      setTrError(null);
      setMsg({ type: "success", text: "Stock transferred successfully." });

      broadcastLocalChange(["inventory", "stock-movements", "dashboard"]);
      router.refresh();
      await fetchRows(true);
    } else {
      setTrError(res.error || "Transfer failed.");
    }
  }

  async function handleCreateQuickLot(e: React.FormEvent) {
    e.preventDefault();
    if (!quickLotLocationId || !quickLotNumber.trim()) return;
    setSubmittingQuickLot(true);
    try {
      const res = await createWarehouseLotAction({
        locationId: quickLotLocationId,
        lotNumber: quickLotNumber.trim(),
        description: quickLotDescription.trim() || null,
      });
      if (res.success && res.data) {
        const createdLot = res.data;
        setShowQuickLotModal(false);
        setQuickLotNumber("");
        setQuickLotDescription("");
        if (quickLotTarget?.type === "single-adj") {
          setWarehouseLotId(createdLot.id);
        } else if (quickLotTarget?.type === "single-from") {
          setFromWarehouseLotId(createdLot.id);
        } else if (quickLotTarget?.type === "single-to") {
          setToWarehouseLotId(createdLot.id);
        } else if (quickLotTarget?.type === "bulk-adj" && quickLotTarget.itemIndex !== undefined) {
          const idx = quickLotTarget.itemIndex;
          setBulkAdjItems((prev) => {
            const copy = [...prev];
            copy[idx] = { ...copy[idx], warehouseLotId: createdLot.id };
            return copy;
          });
        } else if (quickLotTarget?.type === "bulk-from" && quickLotTarget.itemIndex !== undefined) {
          const idx = quickLotTarget.itemIndex;
          setBulkTrItems((prev) => {
            const copy = [...prev];
            copy[idx] = { ...copy[idx], fromWarehouseLotId: createdLot.id };
            return copy;
          });
        } else if (quickLotTarget?.type === "bulk-to" && quickLotTarget.itemIndex !== undefined) {
          const idx = quickLotTarget.itemIndex;
          setBulkTrItems((prev) => {
            const copy = [...prev];
            copy[idx] = { ...copy[idx], toWarehouseLotId: createdLot.id };
            return copy;
          });
        }
        setMsg({ type: "success", text: `Lot "${createdLot.lotNumber}" created and selected.` });
        await fetchRows(true);
      } else {
        setMsg({ type: "error", text: !res.success ? res.error : "Failed to create lot." });
      }
    } finally {
      setSubmittingQuickLot(false);
    }
  }

  function addBulkAdjItem() {
    setBulkAdjItems((prev) => [
      ...prev,
      { productId: "", locationId: bulkAdjLocationId || (locations[0]?.id ?? ""), warehouseLotId: "", quantity: 1, direction: "IN", notes: "" },
    ]);
  }

  function removeBulkAdjItem(index: number) {
    if (bulkAdjItems.length <= 1) return;
    setBulkAdjItems((prev) => prev.filter((_, i) => i !== index));
  }

  function updateBulkAdjItem(
    index: number,
    field: "productId" | "locationId" | "warehouseLotId" | "quantity" | "direction" | "notes",
    value: any,
  ) {
    setBulkAdjItems((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      if (field === "locationId") {
        copy[index].warehouseLotId = "";
      }
      return copy;
    });
  }

  function closeBulkAdjustModal() {
    setShowBulkAdjustModal(false);
    setBulkAdjReason("");
    setBulkAdjLocationId("");
    setBulkAdjError(null);
    setBulkAdjItems([{ productId: "", locationId: "", warehouseLotId: "", quantity: 1, direction: "IN", notes: "" }]);
  }

  function closeBulkTransferModal() {
    setShowBulkTransferModal(false);
    setBulkTrFromLocationId("");
    setBulkTrToLocationId("");
    setBulkTrNotes("");
    setBulkTrError(null);
    setBulkTrItems([{ productId: "", fromWarehouseLotId: "", toWarehouseLotId: "", quantity: 1 }]);
  }

  function handleBulkAdjRowKeyDown(
    e: React.KeyboardEvent,
    rowIndex: number,
    field: "prod" | "loc" | "lot" | "qty" | "dir" | "notes",
  ) {
    if (e.key === "Enter") {
      e.preventDefault();
      const sequence: Array<"prod" | "loc" | "lot" | "qty" | "dir" | "notes"> = ["prod", "loc", "lot", "qty", "dir", "notes"];
      const currentIdx = sequence.indexOf(field);
      if (currentIdx < sequence.length - 1) {
        const nextField = sequence[currentIdx + 1];
        const nextEl = document.querySelector<HTMLElement>(`[data-bulk-adj="${rowIndex}-${nextField}"]`);
        if (nextEl) {
          nextEl.focus();
          if (nextEl instanceof HTMLInputElement) nextEl.select();
          return;
        }
      } else {
        if (rowIndex === bulkAdjItems.length - 1) {
          addBulkAdjItem();
          setTimeout(() => {
            const nextRowFirstEl = document.querySelector<HTMLElement>(`[data-bulk-adj="${rowIndex + 1}-prod"]`);
            if (nextRowFirstEl) nextRowFirstEl.focus();
          }, 50);
        } else {
          const nextRowFirstEl = document.querySelector<HTMLElement>(`[data-bulk-adj="${rowIndex + 1}-prod"]`);
          if (nextRowFirstEl) nextRowFirstEl.focus();
        }
      }
    } else if (e.key === "ArrowDown" && (field === "qty" || field === "notes")) {
      const nextRowEl = document.querySelector<HTMLElement>(`[data-bulk-adj="${rowIndex + 1}-${field}"]`);
      if (nextRowEl) {
        e.preventDefault();
        nextRowEl.focus();
        if (nextRowEl instanceof HTMLInputElement) nextRowEl.select();
      }
    } else if (e.key === "ArrowUp" && (field === "qty" || field === "notes")) {
      const prevRowEl = document.querySelector<HTMLElement>(`[data-bulk-adj="${rowIndex - 1}-${field}"]`);
      if (prevRowEl) {
        e.preventDefault();
        prevRowEl.focus();
        if (prevRowEl instanceof HTMLInputElement) prevRowEl.select();
      }
    }
  }

  async function handleBulkAdjustment(e: React.FormEvent) {
    e.preventDefault();
    setBulkAdjError(null);
    if (!bulkAdjReason.trim() || bulkAdjReason.trim().length < 3) {
      setBulkAdjError("Batch reason is mandatory (minimum 3 characters).");
      return;
    }
    if (bulkAdjItems.some((it) => !it.productId || it.quantity <= 0)) {
      setBulkAdjError("All items must have a product selected and quantity > 0.");
      return;
    }
    if (bulkAdjItems.some((it) => !it.locationId && !bulkAdjLocationId)) {
      setBulkAdjError("Please select a location for every adjustment item.");
      return;
    }

    for (let i = 0; i < bulkAdjItems.length; i++) {
      const it = bulkAdjItems[i];
      if (it.direction === "OUT") {
        const rowLocId = it.locationId || bulkAdjLocationId;
        const avail = getProductStock(it.productId, rowLocId, it.warehouseLotId ? it.warehouseLotId : "");
        if (it.quantity > avail) {
          const prod = uniqueProducts.find((p) => p.id === it.productId);
          const prodName = prod ? `${prod.no} - ${prod.name}` : `Item #${i + 1}`;
          const lotObj = allLots.find((l) => l.id === it.warehouseLotId);
          const lotDesc = lotObj ? `in lot "${lotObj.lotNumber}"` : "in standard stock";
          setBulkAdjError(`Cannot decrease stock for ${prodName} ${lotDesc} by ${it.quantity}. Only ${avail} available.`);
          return;
        }
      }
    }

    setSubmittingBulkAdj(true);
    try {
      const res = await bulkAdjustStockAction({
        locationId: bulkAdjLocationId || undefined,
        reason: bulkAdjReason.trim(),
        items: bulkAdjItems.map((it) => ({
          productId: it.productId,
          locationId: it.locationId || bulkAdjLocationId || undefined,
          warehouseLotId: it.warehouseLotId || undefined,
          quantity: it.quantity,
          direction: it.direction,
          notes: it.notes?.trim() || undefined,
        })),
      });

      if (res.success) {
        closeBulkAdjustModal();
        setMsg({ type: "success", text: `Bulk adjustment of ${bulkAdjItems.length} item(s) posted successfully.` });
        broadcastLocalChange(["inventory", "stock-movements", "dashboard"]);
        router.refresh();
        await fetchRows(true);
      } else {
        setBulkAdjError(res.error || "Bulk adjustment failed.");
      }
    } catch (err: any) {
      setBulkAdjError(err.message || "Bulk adjustment failed.");
    } finally {
      setSubmittingBulkAdj(false);
    }
  }

  function addBulkTrItem() {
    setBulkTrItems((prev) => [
      ...prev,
      { productId: "", fromWarehouseLotId: "", toWarehouseLotId: "", quantity: 1 },
    ]);
  }

  function removeBulkTrItem(index: number) {
    if (bulkTrItems.length <= 1) return;
    setBulkTrItems((prev) => prev.filter((_, i) => i !== index));
  }

  function updateBulkTrItem(
    index: number,
    field: "productId" | "fromWarehouseLotId" | "toWarehouseLotId" | "quantity",
    value: any,
  ) {
    setBulkTrItems((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      if (field === "productId" && value) {
        const fromLots = allLots.filter((l) => l.locationId === bulkTrFromLocationId);
        if (fromLots.length > 0) {
          const stdStock = getProductStock(value, bulkTrFromLocationId, "");
          if (stdStock === 0) {
            const firstLotWithStock = fromLots.find(
              (l) => getProductStock(value, bulkTrFromLocationId, l.id) > 0,
            );
            copy[index].fromWarehouseLotId = firstLotWithStock ? firstLotWithStock.id : "";
          } else {
            copy[index].fromWarehouseLotId = "";
          }
        }
      }
      return copy;
    });
  }

  async function handleBulkTransfer(e: React.FormEvent) {
    e.preventDefault();
    setBulkTrError(null);
    if (!bulkTrFromLocationId || !bulkTrToLocationId) {
      setBulkTrError("Please select both source and destination locations.");
      return;
    }
    if (bulkTrFromLocationId === bulkTrToLocationId) {
      const hasInvalidLot = bulkTrItems.some(
        (it) => (it.fromWarehouseLotId || "") === (it.toWarehouseLotId || ""),
      );
      if (hasInvalidLot) {
        setBulkTrError("For transfers within the same location, source and destination lots must differ.");
        return;
      }
    }
    if (bulkTrItems.some((it) => !it.productId || it.quantity <= 0)) {
      setBulkTrError("All transfer items must have a product selected and quantity > 0.");
      return;
    }

    for (let i = 0; i < bulkTrItems.length; i++) {
      const it = bulkTrItems[i];
      const avail = getProductStock(it.productId, bulkTrFromLocationId, it.fromWarehouseLotId ? it.fromWarehouseLotId : "");
      if (it.quantity > avail) {
        const prod = uniqueProducts.find((p) => p.id === it.productId);
        const prodName = prod ? `${prod.no} - ${prod.name}` : `Item #${i + 1}`;
        const lotObj = allLots.find((l) => l.id === it.fromWarehouseLotId);
        const lotDesc = lotObj ? `in source lot "${lotObj.lotNumber}"` : "in standard stock";
        setBulkTrError(`Insufficient stock for ${prodName} ${lotDesc}. Available: ${avail}, Required: ${it.quantity}.`);
        return;
      }
    }

    setSubmittingBulkTr(true);
    try {
      const res = await bulkTransferStockAction({
        fromLocationId: bulkTrFromLocationId,
        toLocationId: bulkTrToLocationId,
        notes: bulkTrNotes.trim() || undefined,
        items: bulkTrItems.map((it) => ({
          productId: it.productId,
          fromWarehouseLotId: it.fromWarehouseLotId || undefined,
          toWarehouseLotId: it.toWarehouseLotId || undefined,
          quantity: it.quantity,
        })),
      });

      if (res.success) {
        closeBulkTransferModal();
        setMsg({ type: "success", text: `Bulk transfer of ${bulkTrItems.length} item(s) executed successfully.` });
        broadcastLocalChange(["inventory", "stock-movements", "dashboard"]);
        router.refresh();
        await fetchRows(true);
      } else {
        setBulkTrError(res.error || "Bulk transfer failed.");
      }
    } catch (err: any) {
      setBulkTrError(err.message || "Bulk transfer failed.");
    } finally {
      setSubmittingBulkTr(false);
    }
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function handleExportCsv() {
    if (!filteredRows.length) return;
    const headers = ["Product Code", "Product Name", "GSM", "Size", "Location", "Stock", "Unit", "Unit Wt (kg)", "Total Wt (kg)", "Tonnage (T)", "Reorder Level"];
    const lines = filteredRows.map((r) => {
      const unitWeight = r.unit === "PACKET" ? (r.packetWeight || 0) : (r.reamWeight || 0);
      const totalWt = Math.max(0, r.available) * unitWeight;
      const tonnage = totalWt / 1000;
      return [
        `"${r.productNo}"`,
        `"${r.productName.replace(/"/g, '""')}"`,
        r.gsm,
        `"${r.length}x${r.breadth}"`,
        `"${r.locationName.replace(/"/g, '""')}"`,
        r.available,
        r.unit,
        unitWeight.toFixed(3),
        totalWt.toFixed(2),
        tonnage.toFixed(3),
        r.reorderLevel ?? ""
      ].join(",");
    });
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...lines].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `inventory_export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function handlePrint() {
    window.print();
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Printable Black & White Header (Only visible when printing) */}
      <div className="hidden print:block mb-4 border-b-2 border-black pb-2 text-black">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-xl font-bold uppercase tracking-tight">Paper Trade Management</h1>
            <p className="text-xs font-semibold uppercase">Inventory Stock & Tonnage Valuation Report</p>
          </div>
          <div className="text-right text-[10px] space-y-0.5">
            <p suppressHydrationWarning>Printed: {mounted ? new Date().toLocaleString() : ""}</p>
            <p>Location: {selectedLocationId === "all" ? "All Locations" : (locations.find((l) => l.id === selectedLocationId)?.name || selectedLocationId)}</p>
            <p>Filter: {activeTab === "ALL" ? "All Products" : "Low Stock Alert Only"}</p>
          </div>
        </div>
        <div className="mt-2 flex gap-4 text-xs font-mono border-t border-black pt-1">
          <span>Distinct Items: <strong>{filteredRows.length}</strong></span>
          <span>Total Weight: <strong>{totalWeightInKg.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg</strong></span>
          <span>Tonnage: <strong>{totalWeightInTonnes.toFixed(3)} T</strong></span>
          <span>Total Units: <strong>{totalPhysicalUnits.toLocaleString()}</strong></span>
        </div>
      </div>

      {/* Top Banner: Title, KPI Chips, and Quick Action Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-2.5 rounded-md shadow-xs print:hidden">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 rounded-md">
            <PackageSearch className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Inventory Stock & Tonnage
            </h1>
            <p className="text-[11px] text-slate-500">
              Live physical counts, individual unit weights, and cumulative tonnage across locations
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* KPI Chips */}
          <div className="hidden sm:flex items-center gap-2 text-xs font-mono">
            <span className="bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 px-2 py-1 rounded">
              Total Wt: <strong>{totalWeightInKg.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg</strong>
            </span>
            <span className="bg-teal-50 dark:bg-teal-950/40 text-teal-800 dark:text-teal-300 border border-teal-200 dark:border-teal-800 px-2 py-1 rounded">
              Tonnage: <strong>{totalWeightInTonnes.toFixed(3)} T</strong>
            </span>
            <span className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-300 px-2 py-1 rounded">
              Units: <strong>{totalPhysicalUnits.toLocaleString()}</strong>
            </span>
            <span
              className={`px-2 py-1 rounded border ${
                lowStockCount > 0
                  ? "bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-800"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 border-slate-200"
              }`}
            >
              Low Stock: <strong>{lowStockCount}</strong>
            </span>
          </div>

          {/* Action Buttons */}
          <Button
            type="button"
            onClick={() => {
              if (rows.length > 0 && !productId) {
                setProductId(rows[0].productId);
                setLocationId(rows[0].locationId);
              }
              setShowAdjustModal(true);
            }}
            className="h-8 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold shadow-xs px-2.5"
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            + Adjust
          </Button>

          <Button
            type="button"
            onClick={() => {
              if (rows.length > 0 && !transferProductId) {
                setTransferProductId(rows[0].productId);
                setFromLocationId(rows[0].locationId);
                const other = locations.find((l) => l.id !== rows[0].locationId) || locations[0];
                if (other) setToLocationId(other.id);
              }
              setShowTransferModal(true);
            }}
            variant="outline"
            className="h-8 border-amber-300 text-amber-900 hover:bg-amber-50 text-xs font-semibold shadow-xs px-2.5"
          >
            <ArrowRightLeft className="mr-1 h-3.5 w-3.5 text-amber-700" />
            ⇄ Transfer
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (!bulkAdjLocationId && locations.length > 0) setBulkAdjLocationId(locations[0].id);
              setShowBulkAdjustModal(true);
            }}
            className="h-8 text-xs font-semibold border-slate-300 hover:bg-slate-50 px-2"
          >
            Bulk Adjust
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (!bulkTrFromLocationId && locations.length > 0) setBulkTrFromLocationId(locations[0].id);
              if (!bulkTrToLocationId && locations.length > 1) setBulkTrToLocationId(locations[1].id);
              setShowBulkTransferModal(true);
            }}
            className="h-8 text-xs font-semibold border-slate-300 hover:bg-slate-50 px-2"
          >
            Bulk Transfer
          </Button>
        </div>
      </div>

      {/* Messages */}
      {msg && (
        <div
          className={`rounded-md p-2.5 text-xs flex items-center gap-2 border ${
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

      {/* Search & Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2.5 rounded-md shadow-xs print:hidden">
        <div className="flex items-center gap-2 flex-1 min-w-[280px]">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <Input
              ref={searchInputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search across all fields: Product No, Name, Location, Lots... (Press / to focus)"
              className="h-8 pl-8 pr-8 text-xs bg-slate-50 dark:bg-slate-950/50 border-slate-300 dark:border-slate-700 font-medium"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <select
            value={selectedLocationId}
            onChange={(e) => {
              setSelectedLocationId(e.target.value);
              setSelectedLotId("all");
            }}
            className="h-8 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200"
          >
            <option value="all">All Locations</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>

          {/* Issue 4: Lot Filter (activates when the selected location has multiple lots) */}
          {selectedLocationId !== "all" && selectedLocationLots.length > 1 && (
            <select
              value={selectedLotId}
              onChange={(e) => setSelectedLotId(e.target.value)}
              className="h-8 rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/30 px-2.5 text-xs font-semibold text-amber-900 dark:text-amber-200"
            >
              <option value="all">All Lots ({selectedLocationLots.length})</option>
              {selectedLocationLots.map((lot) => (
                <option key={lot.id} value={lot.id}>
                  Lot #{lot.lotNumber} ({lot.currentStock} pkts)
                </option>
              ))}
              <option value="unassigned">Unassigned Stock</option>
            </select>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* Issue 5: Stock Filter Pills (In Stock by default, Zero Stock, All Items) */}
          <div className="flex rounded-md bg-slate-100 dark:bg-slate-800 p-0.5 border border-slate-200 dark:border-slate-700 text-xs">
            <button
              onClick={() => setStockFilter("NON_ZERO")}
              className={`rounded px-2.5 py-1 font-semibold transition-colors ${
                stockFilter === "NON_ZERO"
                  ? "bg-emerald-800 text-white shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
              title="Show only products with non-zero stock"
            >
              In Stock ({nonZeroCount})
            </button>
            <button
              onClick={() => setStockFilter("ZERO")}
              className={`rounded px-2.5 py-1 font-semibold transition-colors ${
                stockFilter === "ZERO"
                  ? "bg-amber-800 text-white shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
              title="Show only products with zero stock"
            >
              Zero Stock ({zeroCount})
            </button>
            <button
              onClick={() => setStockFilter("ALL")}
              className={`rounded px-2.5 py-1 font-semibold transition-colors ${
                stockFilter === "ALL"
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
            >
              All Items ({rows.length})
            </button>
          </div>

          {/* Active Tab Toggle (Low Stock) */}
          <div className="flex rounded-md bg-slate-100 dark:bg-slate-800 p-0.5 border border-slate-200 dark:border-slate-700 text-xs">
            <button
              onClick={() => setActiveTab(activeTab === "LOW" ? "ALL" : "LOW")}
              className={`rounded px-2 py-1 font-semibold transition-colors flex items-center gap-1.5 ${
                activeTab === "LOW"
                  ? "bg-rose-50 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300 shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-rose-700"
              }`}
            >
              <AlertCircle className="h-3.5 w-3.5" />
              Low Stock ({lowStockCount})
            </button>
          </div>

          {/* View Mode Toggle */}
          <div className="flex rounded-md bg-slate-100 dark:bg-slate-800 p-0.5 border border-slate-200 dark:border-slate-700 text-xs">
            <button
              onClick={() => setViewMode("table")}
              className={`rounded p-1 transition-colors ${
                viewMode === "table"
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
              title="Table View"
            >
              <Table2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setViewMode("cards")}
              className={`rounded p-1 transition-colors ${
                viewMode === "cards"
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
              title="Cards View"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Export & Print */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            title="Export CSV"
            className="h-8 px-2 text-xs text-slate-600"
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrint}
            title="Print Inventory"
            className="h-8 px-2 text-xs text-slate-600"
          >
            <Printer className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Main Content Area */}
      {viewMode === "table" ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md shadow-xs overflow-hidden print:border-none print:shadow-none print:overflow-visible print:w-full">
          <div className="overflow-x-auto max-h-[calc(100vh-230px)] print:overflow-visible print:max-h-none print:w-full">
            <table className="w-full text-left text-xs border-collapse print:text-[8pt] print:table-auto">
              <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700 text-[11px] font-bold uppercase tracking-wider print:static print:bg-slate-200 print:text-black">
                <tr>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap print:border-black print:px-1.5">Code</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 min-w-[180px] print:min-w-0 print:border-black print:px-1.5">Product Name</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap print:border-black print:px-1.5">Size & GSM</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap print:border-black print:px-1.5">Location</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap font-bold print:border-black print:px-1.5">Available</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap print:border-black print:px-1.5">Unit Wt (kg)</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap font-bold print:border-black print:px-1.5">Total Wt (kg)</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap print:border-black print:px-1.5">Tonnage (T)</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 min-w-[180px] print:hidden">Lots Breakdown</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 text-center whitespace-nowrap print:hidden">Status</th>
                  <th className="py-2 px-2.5 text-center whitespace-nowrap print:hidden">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {loading ? (
                  <tr>
                    <td colSpan={11} className="py-12 text-center text-slate-500 font-medium">
                      Loading inventory records...
                    </td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-12 text-center text-slate-500 font-medium">
                      No stock items found matching your filter criteria.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => {
                    const isLotFiltered = selectedLocationId !== "all" && selectedLocationLots.length > 1 && selectedLotId !== "all";
                    const lotStock = isLotFiltered
                      ? (selectedLotId === "unassigned"
                          ? (row.lots?.find((l) => l.id === null)?.available ?? 0)
                          : (row.lots?.find((l) => l.id === selectedLotId)?.available ?? 0))
                      : row.available;
                    const availableInPkts = row.unit === "REAM" ? lotStock * 5 : row.unit === "SHEET" ? lotStock / 100 : lotStock;
                    const isLow = row.reorderLevel !== null && availableInPkts <= row.reorderLevel;
                    const isOutOfStock = lotStock <= 0;
                    const unitWeight = row.unit === "PACKET" ? (row.packetWeight || 0) : (row.reamWeight || 0);
                    const totalLineWeightKg = Math.max(0, lotStock) * unitWeight;
                    const totalLineWeightTonnes = totalLineWeightKg / 1000;

                    return (
                      <tr
                        key={`${row.locationId}-${row.productId}`}
                        className="hover:bg-amber-50/60 dark:hover:bg-slate-800/60 transition-colors even:bg-slate-50/40 dark:even:bg-slate-900/40"
                      >
                        <td className="py-1.5 px-2.5 border-r border-slate-200/60 font-mono font-bold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span>{row.productNo}</span>
                            {row.isActive === false && (
                              <span className="rounded bg-amber-100 text-amber-800 text-[9px] px-1 font-sans">
                                Inactive
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-1.5 px-2.5 border-r border-slate-200/60 font-medium text-slate-800 dark:text-slate-200">
                          {row.productName}
                        </td>
                        <td className="py-1.5 px-2.5 border-r border-slate-200/60 whitespace-nowrap text-slate-600">
                          {row.length}&quot; × {row.breadth}&quot; • {row.gsm} GSM
                        </td>
                        <td className="py-1.5 px-2.5 border-r border-slate-200/60 whitespace-nowrap font-medium text-slate-700">
                          {row.locationName}
                        </td>
                        <td className="py-1.5 px-2.5 border-r border-slate-200/60 text-right whitespace-nowrap font-mono font-extrabold text-slate-900">
                          {isLotFiltered ? (
                            <div className="flex flex-col items-end">
                              <span
                                className={`rounded px-1.5 py-0.5 ${
                                  lotStock <= 0
                                    ? "bg-rose-100 text-rose-800"
                                    : "bg-amber-100 text-amber-900"
                                }`}
                              >
                                {lotStock} {row.unit} <span className="text-[9px] font-sans font-normal">(Lot)</span>
                              </span>
                              <span className="text-[10px] text-slate-500 font-sans font-normal">
                                Total: {row.available} {row.unit}
                              </span>
                            </div>
                          ) : (
                            <span
                              className={`rounded px-1.5 py-0.5 ${
                                isLow
                                  ? "bg-rose-100 text-rose-800"
                                  : "bg-emerald-50 text-emerald-800"
                              }`}
                            >
                              {row.available} {row.unit}
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 px-2.5 border-r border-slate-200/60 text-right whitespace-nowrap font-mono text-slate-600">
                          {unitWeight.toFixed(3)}
                        </td>
                        <td className="py-1.5 px-2.5 border-r border-slate-200/60 text-right whitespace-nowrap font-mono font-bold text-emerald-900">
                          {totalLineWeightKg.toFixed(1)}
                        </td>
                        <td className="py-1.5 px-2.5 border-r border-slate-200/60 text-right whitespace-nowrap font-mono text-teal-800 font-semibold">
                          {totalLineWeightTonnes.toFixed(3)}
                        </td>
                        <td className="py-1 px-2 border-r border-slate-200/60 text-[11px] print:hidden">
                          {row.lots && row.lots.length > 0 ? (
                            <div className="flex flex-wrap gap-1 max-w-[280px]">
                              {row.lots.map((lot, lIdx) => {
                                const isSelected = selectedLotId === lot.id || (selectedLotId === "unassigned" && lot.id === null);
                                return (
                                  <span
                                    key={lot.id ?? `lot-${lIdx}`}
                                    className={cn(
                                      "inline-flex items-center gap-1 rounded px-1.5 py-0.2 font-mono text-[10px]",
                                      isSelected
                                        ? "bg-amber-100 text-amber-950 border border-amber-400 font-bold ring-1 ring-amber-400"
                                        : "bg-blue-50 border border-blue-200/70 text-blue-900"
                                    )}
                                  >
                                    <span>{lot.lotNumber}:</span>
                                    <strong>{lot.available}</strong>
                                  </span>
                                );
                              })}
                            </div>
                          ) : (
                            <span className="text-slate-400 text-[10px] italic">Default lot</span>
                          )}
                        </td>
                        <td className="py-1.5 px-2.5 border-r border-slate-200/60 text-center whitespace-nowrap print:hidden">
                          {isOutOfStock ? (
                            <span className="rounded bg-rose-100 text-rose-800 text-[10px] px-1.5 py-0.5 font-semibold">
                              Out of Stock
                            </span>
                          ) : isLow ? (
                            <span className="rounded bg-amber-100 text-amber-800 text-[10px] px-1.5 py-0.5 font-semibold">
                              Low Stock ({row.reorderLevel} limit)
                            </span>
                          ) : (
                            <span className="rounded bg-emerald-100 text-emerald-800 text-[10px] px-1.5 py-0.5 font-semibold">
                              In Stock
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 px-2 whitespace-nowrap text-center print:hidden">
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => openAdjustForRow(row)}
                              className="h-6 px-2 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 hover:text-emerald-900"
                              title="Stock Adjustment"
                            >
                              + Adjust
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => openTransferForRow(row)}
                              className="h-6 px-2 text-[11px] font-semibold text-amber-700 hover:bg-amber-50 hover:text-amber-900"
                              title="Transfer to other location"
                            >
                              ⇄ Transfer
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Cards View */
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredRows.map((row) => {
            const isLotFiltered = selectedLocationId !== "all" && selectedLocationLots.length > 1 && selectedLotId !== "all";
            const lotStock = isLotFiltered
              ? (selectedLotId === "unassigned"
                  ? (row.lots?.find((l) => l.id === null)?.available ?? 0)
                  : (row.lots?.find((l) => l.id === selectedLotId)?.available ?? 0))
              : row.available;
            const availableInPkts = row.unit === "REAM" ? lotStock * 5 : row.unit === "SHEET" ? lotStock / 100 : lotStock;
            const isLow = row.reorderLevel !== null && availableInPkts <= row.reorderLevel;
            const unitWeight = row.unit === "PACKET" ? (row.packetWeight || 0) : (row.reamWeight || 0);
            const totalLineWeightKg = Math.max(0, lotStock) * unitWeight;
            const totalLineWeightTonnes = totalLineWeightKg / 1000;

            return (
              <div
                key={`${row.locationId}-${row.productId}`}
                className={`rounded-lg border p-3.5 transition-all flex flex-col justify-between bg-white shadow-xs ${
                  isLow ? "border-rose-200 bg-rose-50/30" : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-xs text-slate-900">{row.productNo}</span>
                        {row.isActive === false && (
                          <span className="rounded bg-amber-100 px-1 py-0.2 text-[9px] font-semibold text-amber-800">
                            Inactive
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-semibold text-slate-800">{row.productName}</p>
                    </div>
                    <span
                      className={`rounded-md px-2 py-0.5 text-xs font-extrabold ${
                        isLow ? "bg-rose-100 text-rose-800" : isLotFiltered ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-800"
                      }`}
                    >
                      {lotStock} {row.unit} {isLotFiltered && <span className="text-[10px] font-normal">(Lot)</span>}
                    </span>
                  </div>

                  <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-1.5 pt-0.5">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700">
                      {row.length}&quot; × {row.breadth}&quot;
                    </span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700">
                      {row.gsm} GSM
                    </span>
                    <span className="text-slate-400">•</span>
                    <span className="font-medium text-slate-700">{row.locationName}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 rounded-md bg-slate-50 p-2 border border-slate-100 text-[11px]">
                    <div>
                      <span className="text-slate-400 block text-[9px] uppercase font-semibold">Unit Weight</span>
                      <span className="font-semibold text-slate-800">{unitWeight.toFixed(3)} kg</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[9px] uppercase font-semibold">Total Stock Wt</span>
                      <span className="font-bold text-emerald-900">
                        {totalLineWeightKg.toFixed(1)} kg <span className="text-[10px] font-normal text-slate-500">({totalLineWeightTonnes.toFixed(3)} T)</span>
                      </span>
                    </div>
                  </div>

                  {row.lots && row.lots.length > 0 && (
                    <div className="pt-1.5 border-t border-slate-100 space-y-1 text-[11px]">
                      <span className="text-[10px] font-bold text-blue-900 flex items-center gap-1">
                        <Layers className="h-3 w-3 text-blue-600" />
                        Lots ({row.lots.length})
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {row.lots.map((lot, idx) => (
                          <span
                            key={lot.id ?? `card-lot-${idx}`}
                            className="bg-blue-50 border border-blue-200/60 rounded px-1.5 py-0.5 text-[10px] font-mono text-blue-800"
                          >
                            {lot.lotNumber}: {lot.available}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[11px] text-slate-500">
                    Reorder: <strong>{row.reorderLevel ?? "None"}</strong>
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => openAdjustForRow(row)}
                      className="h-6 px-2 text-[11px] text-emerald-700 hover:bg-emerald-50"
                    >
                      + Adjust
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => openTransferForRow(row)}
                      className="h-6 px-2 text-[11px] text-amber-700 hover:bg-amber-50"
                    >
                      ⇄ Transfer
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* SINGLE STOCK ADJUSTMENT MODAL */}
      {showAdjustModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-700" />
                <h2 className="text-sm font-bold text-slate-900">Stock Adjustment</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowAdjustModal(false)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleAdjustment} className="mt-4 space-y-3 text-xs">
              {adjError && (
                <div className="rounded-lg bg-rose-50 border border-rose-200 p-2.5 text-xs text-rose-700 font-medium flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                  <span>{adjError}</span>
                </div>
              )}

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label htmlFor="adjprod" className="text-xs font-semibold">Product *</Label>
                  {productId && locationId && (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-slate-50 text-slate-700 border-slate-200">
                      On hand:{" "}
                      <strong className="text-slate-900 font-mono">
                        {getProductStock(productId, locationId, warehouseLotId ? warehouseLotId : "")}
                      </strong>{" "}
                      {uniqueProducts.find((p) => p.id === productId)?.unit || "units"}
                      {warehouseLotId && " (in lot)"}
                    </span>
                  )}
                </div>
                <SearchCombobox
                  options={getProductOptionsForLocation(locationId)}
                  value={productId}
                  onChange={(val) => {
                    setProductId(val);
                    if (val && adjLocationLots.length > 0) {
                      const stdStock = getProductStock(val, locationId, "");
                      if (stdStock === 0) {
                        const lotWithStock = adjLocationLots.find(
                          (l) => getProductStock(val, locationId, l.id) > 0
                        );
                        if (lotWithStock) setWarehouseLotId(lotWithStock.id);
                      }
                    }
                  }}
                  placeholder="Type product no or name..."
                  className="w-full text-xs font-medium"
                  required
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="adjloc" className="text-xs font-semibold">Location *</Label>
                <select
                  id="adjloc"
                  value={locationId}
                  onChange={(e) => {
                    setLocationId(e.target.value);
                    setWarehouseLotId("");
                  }}
                  className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium"
                  required
                >
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </div>

              {adjLocationLots.length > 0 && (
                <div className="space-y-1 p-2 bg-blue-50/60 rounded-md border border-blue-200">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="adjlot" className="text-xs font-semibold text-blue-900 flex items-center gap-1">
                      <Layers className="h-3 w-3 text-blue-600" />
                      Warehouse Lot
                    </Label>
                    <button
                      type="button"
                      onClick={() => {
                        setQuickLotLocationId(locationId);
                        setQuickLotTarget({ type: "single-adj" });
                        setShowQuickLotModal(true);
                      }}
                      className="text-[10px] text-blue-700 hover:text-blue-900 font-semibold hover:underline"
                    >
                      + New Lot
                    </button>
                  </div>
                  <SearchCombobox
                    options={getLotsForLocation(locationId, productId)}
                    value={warehouseLotId}
                    onChange={(val) => setWarehouseLotId(val)}
                    placeholder="Select Lot (or leave for Standard Stock)"
                    className="w-full text-xs font-mono font-medium"
                  />
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="adjqty" className="text-xs font-semibold">Quantity *</Label>
                  <Input
                    id="adjqty"
                    type="number"
                    min="0.0001"
                    step="any"
                    value={quantity}
                    onChange={(e) => setQuantity(parseFloat(e.target.value) || 0)}
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
                    className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs h-8 font-medium"
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

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAdjustModal(false)}
                  className="text-xs h-8"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  className="bg-emerald-800 text-white hover:bg-emerald-700 text-xs h-8"
                >
                  Post Adjustment
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SINGLE STOCK TRANSFER MODAL */}
      {showTransferModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="h-4 w-4 text-amber-700" />
                <h2 className="text-sm font-bold text-slate-900">Stock Transfer</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowTransferModal(false)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleTransfer} className="mt-4 space-y-3 text-xs">
              {trError && (
                <div className="rounded-lg bg-rose-50 border border-rose-200 p-2.5 text-xs text-rose-700 font-medium flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                  <span>{trError}</span>
                </div>
              )}

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label htmlFor="trprod" className="text-xs font-semibold">Product *</Label>
                  {transferProductId && fromLocationId && (
                    <span className={cn(
                      "text-[11px] font-semibold px-2 py-0.5 rounded-full border",
                      getProductStock(transferProductId, fromLocationId, fromWarehouseLotId ? fromWarehouseLotId : "") > 0
                        ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                        : "bg-rose-50 text-rose-800 border-rose-200"
                    )}>
                      Available in {locations.find((l) => l.id === fromLocationId)?.name || "Source"}:{" "}
                      <strong className="font-mono">
                        {getProductStock(transferProductId, fromLocationId, fromWarehouseLotId ? fromWarehouseLotId : "")}
                      </strong>{" "}
                      {uniqueProducts.find((p) => p.id === transferProductId)?.unit || "pkts"}
                      {fromWarehouseLotId && " (in lot)"}
                    </span>
                  )}
                </div>
                <SearchCombobox
                  options={getProductOptionsForLocation(fromLocationId)}
                  value={transferProductId}
                  onChange={(val) => {
                    setTransferProductId(val);
                    if (val && fromLocationLots.length > 0) {
                      const stdStock = getProductStock(val, fromLocationId, "");
                      if (stdStock === 0) {
                        const lotWithStock = fromLocationLots.find(
                          (l) => getProductStock(val, fromLocationId, l.id) > 0
                        );
                        setFromWarehouseLotId(lotWithStock ? lotWithStock.id : "");
                      } else {
                        setFromWarehouseLotId("");
                      }
                    }
                  }}
                  placeholder="Type product no or name..."
                  className="w-full text-xs font-medium"
                  required
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="fromloc" className="text-xs font-semibold">From Location *</Label>
                  <select
                    id="fromloc"
                    value={fromLocationId}
                    onChange={(e) => {
                      setFromLocationId(e.target.value);
                      setFromWarehouseLotId("");
                    }}
                    className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium"
                    required
                  >
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>

                  {fromLocationLots.length > 0 && (
                    <div className="mt-1 space-y-1 bg-amber-50/60 p-1.5 rounded border border-amber-200">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="fromlot" className="text-[10px] font-bold text-amber-900 flex items-center gap-1">
                          <Layers className="h-2.5 w-2.5 text-amber-600" />
                          Source Lot
                        </Label>
                        <button
                          type="button"
                          onClick={() => {
                            setQuickLotLocationId(fromLocationId);
                            setQuickLotTarget({ type: "single-from" });
                            setShowQuickLotModal(true);
                          }}
                          className="text-[10px] text-blue-700 hover:text-blue-900 font-semibold hover:underline"
                        >
                          + New
                        </button>
                      </div>
                      <SearchCombobox
                        options={getLotsForLocation(fromLocationId, transferProductId)}
                        value={fromWarehouseLotId}
                        onChange={(val) => setFromWarehouseLotId(val)}
                        placeholder="Select Lot (or leave for Standard Stock)"
                        className="w-full text-[11px] font-mono font-medium"
                      />
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <Label htmlFor="toloc" className="text-xs font-semibold">To Location *</Label>
                  <select
                    id="toloc"
                    value={toLocationId}
                    onChange={(e) => {
                      setToLocationId(e.target.value);
                      setToWarehouseLotId("");
                    }}
                    className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium"
                    required
                  >
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>

                  {toLocationLots.length > 0 && (
                    <div className="mt-1 space-y-1 bg-amber-50/60 p-1.5 rounded border border-amber-200">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="tolot" className="text-[10px] font-bold text-amber-900 flex items-center gap-1">
                          <Layers className="h-2.5 w-2.5 text-amber-600" />
                          Dest Lot
                        </Label>
                        <button
                          type="button"
                          onClick={() => {
                            setQuickLotLocationId(toLocationId);
                            setQuickLotTarget({ type: "single-to" });
                            setShowQuickLotModal(true);
                          }}
                          className="text-[10px] text-blue-700 hover:text-blue-900 font-semibold hover:underline"
                        >
                          + New
                        </button>
                      </div>
                      <SearchCombobox
                        options={getLotsForLocation(toLocationId, transferProductId)}
                        value={toWarehouseLotId}
                        onChange={(val) => setToWarehouseLotId(val)}
                        placeholder="Select Lot (or leave for Standard Stock)"
                        className="w-full text-[11px] font-mono font-medium"
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label htmlFor="trqty" className="text-xs font-semibold">Quantity *</Label>
                  {transferProductId && fromLocationId && transferQuantity > getProductStock(transferProductId, fromLocationId, fromWarehouseLotId || undefined) && (
                    <span className="text-[10px] text-rose-600 font-semibold">
                      Exceeds available stock ({getProductStock(transferProductId, fromLocationId, fromWarehouseLotId || undefined)})
                    </span>
                  )}
                </div>
                <Input
                  id="trqty"
                  type="number"
                  min="0.0001"
                  step="any"
                  value={transferQuantity}
                  onChange={(e) => setTransferQuantity(parseFloat(e.target.value) || 0)}
                  className={cn(
                    "h-8 text-xs",
                    transferProductId && fromLocationId && transferQuantity > getProductStock(transferProductId, fromLocationId, fromWarehouseLotId || undefined)
                      ? "border-rose-400 focus-visible:ring-rose-400 text-rose-700"
                      : ""
                  )}
                  required
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="trnotes" className="text-xs font-semibold">Transfer Note (Optional)</Label>
                <Input
                  id="trnotes"
                  value={transferNotes}
                  onChange={(e) => setTransferNotes(e.target.value)}
                  placeholder="e.g. Moved to retail shop floor"
                  className="h-8 text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowTransferModal(false)}
                  className="text-xs h-8"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  className="bg-amber-800 text-white hover:bg-amber-700 text-xs h-8"
                >
                  Execute Transfer
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* BULK STOCK ADJUSTMENT MODAL */}
      {showBulkAdjustModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs overflow-y-auto">
          <div className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-emerald-700" />
                  Bulk Stock Adjustment (Multi-Product)
                </h2>
                <p className="text-xs text-slate-500">
                  Batch adjust physical stock counts or write-offs for multiple products at once.
                </p>
              </div>
              <button
                type="button"
                onClick={closeBulkAdjustModal}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={handleBulkAdjustment}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "BUTTON") {
                  e.preventDefault();
                }
              }}
              className="mt-4 space-y-4"
            >
              {bulkAdjError && (
                <div className="rounded-lg bg-rose-50 border border-rose-200 p-2.5 text-xs text-rose-700 font-medium flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                  <span>{bulkAdjError}</span>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="bulkAdjLoc" className="text-xs font-semibold">
                    Default Location <span className="text-slate-400 font-normal">(Optional default)</span>
                  </Label>
                  <select
                    id="bulkAdjLoc"
                    value={bulkAdjLocationId}
                    onChange={(e) => {
                      setBulkAdjLocationId(e.target.value);
                    }}
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs"
                  >
                    <option value="">(Select default or specify per row)</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="bulkAdjReason" className="text-xs font-semibold">
                    Batch Reason (Mandatory) <span className="text-rose-500">*</span>
                  </Label>
                  <Input
                    id="bulkAdjReason"
                    value={bulkAdjReason}
                    onChange={(e) => setBulkAdjReason(e.target.value)}
                    placeholder="e.g. End-of-month stock count reconciliation"
                    className="text-xs h-9"
                    required
                  />
                </div>
              </div>

              {/* Items List */}
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Adjustment Items ({bulkAdjItems.length})
                  </Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addBulkAdjItem}
                    className="h-7 text-xs"
                  >
                    <Plus className="mr-1 h-3 w-3" /> Add Product
                  </Button>
                </div>

                <div className="hidden sm:grid gap-2 px-2.5 py-1 text-[11px] font-bold text-slate-500 uppercase tracking-wider sm:grid-cols-[1.5fr_1.2fr_1.2fr_90px_100px_1fr_36px]">
                  <span>Product *</span>
                  <span>Location</span>
                  <span>Lot</span>
                  <span className="text-right">Quantity *</span>
                  <span>Direction</span>
                  <span>Notes</span>
                  <span></span>
                </div>

                <div className="space-y-2.5">
                  {bulkAdjItems.map((item, idx) => {
                    const rowLocId = item.locationId || bulkAdjLocationId;
                    const rowLots = rowLocId ? getLotsForLocation(rowLocId, item.productId) : [];
                    const rowLocObj = locations.find((l) => l.id === rowLocId);
                    const isWarehouse = rowLocObj?.type === "WAREHOUSE" || rowLots.length > 1;

                    return (
                      <div
                        key={idx}
                        className="grid gap-2 items-center rounded-lg border border-slate-100 p-2.5 bg-slate-50/50 sm:grid-cols-[1.5fr_1.2fr_1.2fr_90px_100px_1fr_36px]"
                      >
                        <div data-bulk-adj={`${idx}-prod`}>
                          <Label className="text-[10px] text-slate-500 mb-0.5 block sm:hidden">Product</Label>
                          <SearchCombobox
                            options={getProductOptionsForLocation(rowLocId)}
                            value={item.productId}
                            onChange={(val) => {
                              updateBulkAdjItem(idx, "productId", val);
                              if (val) {
                                const lots = getLotsForLocation(rowLocId, val);
                                if (lots.length > 1) {
                                  const stdStock = getProductStock(val, rowLocId, "");
                                  if (stdStock === 0) {
                                    const lotWithStock = allLots.filter((l) => l.locationId === rowLocId).find((l) => getProductStock(val, rowLocId, l.id) > 0);
                                    if (lotWithStock) updateBulkAdjItem(idx, "warehouseLotId", lotWithStock.id);
                                  }
                                }
                              }
                            }}
                            onEnterPress={() => {
                              const nextEl = document.querySelector<HTMLElement>(`[data-bulk-adj="${idx}-qty"]`);
                              if (nextEl) {
                                nextEl.focus();
                                if (nextEl instanceof HTMLInputElement) nextEl.select();
                              }
                            }}
                            placeholder="Type product no or name..."
                            className="w-full text-xs"
                            required
                          />
                          {item.productId && (
                            <div className="mt-0.5 flex items-center justify-between text-[10px] text-slate-500 font-mono">
                              <span>On hand:</span>
                              <span className="font-bold text-slate-700">
                                {getProductStock(item.productId, rowLocId, item.warehouseLotId ? item.warehouseLotId : "")} pkts
                              </span>
                            </div>
                          )}
                        </div>

                        <div>
                          <Label className="text-[10px] text-slate-500 mb-0.5 block sm:hidden">Location</Label>
                          <SearchCombobox
                            options={locationOptions}
                            value={item.locationId || bulkAdjLocationId}
                            onChange={(val) => {
                              updateBulkAdjItem(idx, "locationId", val);
                              updateBulkAdjItem(idx, "warehouseLotId", "");
                            }}
                            onEnterPress={() => {
                              const nextEl = document.querySelector<HTMLElement>(`[data-bulk-adj="${idx}-lot"] input, [data-bulk-adj="${idx}-qty"]`);
                              nextEl?.focus();
                            }}
                            placeholder="Select location"
                            className="w-full text-xs"
                          />
                        </div>

                        <div data-bulk-adj={`${idx}-lot`}>
                          <Label className="text-[10px] text-slate-500 mb-0.5 block sm:hidden">Lot</Label>
                          <SearchCombobox
                            options={rowLots}
                            value={item.warehouseLotId || ""}
                            onChange={(val) => updateBulkAdjItem(idx, "warehouseLotId", val)}
                            onEnterPress={() => {
                              const nextEl = document.querySelector<HTMLElement>(`[data-bulk-adj="${idx}-qty"]`);
                              if (nextEl) {
                                nextEl.focus();
                                if (nextEl instanceof HTMLInputElement) nextEl.select();
                              }
                            }}
                            placeholder={isWarehouse ? "Select lot" : "No lot"}
                            disabled={rowLots.length <= 1}
                            className="w-full text-xs font-mono"
                          />
                        </div>

                        <div>
                          <Label className="text-[10px] text-slate-500 mb-0.5 block sm:hidden">Quantity</Label>
                          <Input
                            data-bulk-adj={`${idx}-qty`}
                            type="number"
                            min="0.0001"
                            step="any"
                            value={item.quantity}
                            onChange={(e) => updateBulkAdjItem(idx, "quantity", parseFloat(e.target.value) || 0)}
                            onKeyDown={(e) => handleBulkAdjRowKeyDown(e, idx, "qty")}
                            className="h-8 text-xs text-right"
                            placeholder="Qty"
                            required
                          />
                        </div>

                        <div>
                          <Label className="text-[10px] text-slate-500 mb-0.5 block sm:hidden">Direction</Label>
                          <select
                            data-bulk-adj={`${idx}-dir`}
                            value={item.direction}
                            onChange={(e) => updateBulkAdjItem(idx, "direction", e.target.value as "IN" | "OUT")}
                            onKeyDown={(e) => handleBulkAdjRowKeyDown(e, idx, "dir")}
                            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium"
                          >
                            <option value="IN">+ Increase</option>
                            <option value="OUT">- Decrease</option>
                          </select>
                        </div>

                        <div>
                          <Label className="text-[10px] text-slate-500 mb-0.5 block sm:hidden">Notes</Label>
                          <Input
                            data-bulk-adj={`${idx}-notes`}
                            value={item.notes || ""}
                            onChange={(e) => updateBulkAdjItem(idx, "notes", e.target.value)}
                            onKeyDown={(e) => handleBulkAdjRowKeyDown(e, idx, "notes")}
                            placeholder="Item note (optional)"
                            className="h-8 text-xs"
                          />
                        </div>

                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => removeBulkAdjItem(idx)}
                            disabled={bulkAdjItems.length <= 1}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:text-rose-600 disabled:opacity-30"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeBulkAdjustModal}
                  className="text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={submittingBulkAdj}
                  className="bg-emerald-800 text-white hover:bg-emerald-700 text-xs"
                >
                  {submittingBulkAdj ? "Posting..." : "Confirm & Post Bulk Adjustment"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* BULK STOCK TRANSFER MODAL */}
      {showBulkTransferModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs overflow-y-auto">
          <div className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <ArrowRightLeft className="h-5 w-5 text-amber-700" />
                  Bulk Stock Transfer (Multi-Product)
                </h2>
                <p className="text-xs text-slate-500">
                  Transfer multiple paper products between locations or lots in a single synchronized batch.
                </p>
              </div>
              <button
                type="button"
                onClick={closeBulkTransferModal}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={handleBulkTransfer}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "BUTTON") {
                  e.preventDefault();
                }
              }}
              className="mt-4 space-y-4"
            >
              {bulkTrError && (
                <div className="rounded-lg bg-rose-50 border border-rose-200 p-2.5 text-xs text-rose-700 font-medium flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                  <span>{bulkTrError}</span>
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="bulkTrFrom" className="text-xs font-semibold text-rose-800">
                    Source Location (From) <span className="text-rose-500">*</span>
                  </Label>
                  <select
                    id="bulkTrFrom"
                    value={bulkTrFromLocationId}
                    onChange={(e) => {
                      const newFromId = e.target.value;
                      setBulkTrFromLocationId(newFromId);
                      setBulkTrItems((prev) =>
                        prev.map((it) => {
                          const fromLots = allLots.filter((l) => l.locationId === newFromId);
                          let autoLot = "";
                          if (fromLots.length > 0 && it.productId) {
                            const stdStock = getProductStock(it.productId, newFromId, "");
                            if (stdStock === 0) {
                              const firstLotWithStock = fromLots.find(
                                (l) => getProductStock(it.productId, newFromId, l.id) > 0,
                              );
                              if (firstLotWithStock) autoLot = firstLotWithStock.id;
                            }
                          }
                          return { ...it, fromWarehouseLotId: autoLot };
                        }),
                      );
                    }}
                    className="w-full rounded-md border border-rose-200 bg-rose-50/30 px-3 py-2 text-xs font-medium"
                    required
                  >
                    <option value="">Select source</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="bulkTrTo" className="text-xs font-semibold text-emerald-800">
                    Destination Location (To) <span className="text-rose-500">*</span>
                  </Label>
                  <select
                    id="bulkTrTo"
                    value={bulkTrToLocationId}
                    onChange={(e) => {
                      setBulkTrToLocationId(e.target.value);
                      setBulkTrItems((prev) => prev.map((it) => ({ ...it, toWarehouseLotId: "" })));
                    }}
                    className="w-full rounded-md border border-emerald-200 bg-emerald-50/30 px-3 py-2 text-xs font-medium"
                    required
                  >
                    <option value="">Select destination</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="bulkTrNotes" className="text-xs font-semibold">
                    Transfer Note / Batch Ref <span className="text-slate-400 font-normal">(Optional)</span>
                  </Label>
                  <Input
                    id="bulkTrNotes"
                    value={bulkTrNotes}
                    onChange={(e) => setBulkTrNotes(e.target.value)}
                    placeholder="e.g. Truck consignment #04"
                    className="text-xs h-9"
                  />
                </div>
              </div>

              {/* Items List */}
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Transfer Items ({bulkTrItems.length})
                  </Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addBulkTrItem}
                    className="h-7 text-xs"
                  >
                    <Plus className="mr-1 h-3 w-3" /> Add Item
                  </Button>
                </div>

                <div
                  className={cn(
                    "hidden sm:grid gap-2 px-2.5 py-1 text-[11px] font-bold text-slate-500 uppercase tracking-wider",
                    bulkTrFromLots.length > 0 && bulkTrToLots.length > 0
                      ? "sm:grid-cols-[1fr_140px_140px_90px_36px]"
                      : bulkTrFromLots.length > 0 || bulkTrToLots.length > 0
                      ? "sm:grid-cols-[1fr_150px_90px_36px]"
                      : "sm:grid-cols-[1fr_110px_36px]"
                  )}
                >
                  <span>Product * (with stock)</span>
                  {bulkTrFromLots.length > 0 && <span>Source Lot</span>}
                  {bulkTrToLots.length > 0 && <span>Dest Lot</span>}
                  <span className="text-right">Quantity *</span>
                  <span></span>
                </div>

                <div className="space-y-2.5">
                  {bulkTrItems.map((item, idx) => {
                    const rowAvailStock = getProductStock(
                      item.productId,
                      bulkTrFromLocationId,
                      item.fromWarehouseLotId ? item.fromWarehouseLotId : ""
                    );
                    const rowLotsFrom = getLotsForLocation(bulkTrFromLocationId, item.productId);
                    const rowLotsTo = getLotsForLocation(bulkTrToLocationId, item.productId);

                    return (
                      <div
                        key={idx}
                        className={cn(
                          "grid gap-2 items-center rounded-lg border border-slate-100 p-2.5 bg-slate-50/50",
                          bulkTrFromLots.length > 0 && bulkTrToLots.length > 0
                            ? "sm:grid-cols-[1fr_140px_140px_90px_36px]"
                            : bulkTrFromLots.length > 0 || bulkTrToLots.length > 0
                            ? "sm:grid-cols-[1fr_150px_90px_36px]"
                            : "sm:grid-cols-[1fr_110px_36px]"
                        )}
                      >
                        <div>
                          <Label className="text-[10px] text-slate-500 mb-0.5 block sm:hidden">Product</Label>
                          <SearchCombobox
                            options={getProductOptionsForLocation(bulkTrFromLocationId)}
                            value={item.productId}
                            onChange={(val) => {
                              updateBulkTrItem(idx, "productId", val);
                            }}
                            placeholder="Type product no or name..."
                            className="w-full text-xs"
                            required
                          />
                          {item.productId && bulkTrFromLocationId && (
                            <div className="mt-0.5 flex items-center justify-between text-[10px]">
                              <span className="text-slate-500">Available:</span>
                              <span className={cn(
                                "font-mono font-bold px-1.5 py-0.2 rounded",
                                rowAvailStock > 0
                                  ? "bg-emerald-50 text-emerald-800"
                                  : "bg-rose-50 text-rose-800"
                              )}>
                                {rowAvailStock} pkts
                                {item.fromWarehouseLotId ? " (in lot)" : ""}
                              </span>
                            </div>
                          )}
                        </div>

                        {bulkTrFromLots.length > 0 && (
                          <div className="flex items-center gap-1">
                            <SearchCombobox
                              options={rowLotsFrom}
                              value={item.fromWarehouseLotId || ""}
                              onChange={(val) => updateBulkTrItem(idx, "fromWarehouseLotId", val)}
                              placeholder="From Lot"
                              className="w-full text-xs font-mono"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              title="Quick add source lot"
                              onClick={() => {
                                setQuickLotLocationId(bulkTrFromLocationId);
                                setQuickLotTarget({ type: "bulk-from", itemIndex: idx });
                                setShowQuickLotModal(true);
                              }}
                              className="h-7 w-7 shrink-0 p-0 text-amber-700 hover:bg-amber-100"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}

                        {bulkTrToLots.length > 0 && (
                          <div className="flex items-center gap-1">
                            <SearchCombobox
                              options={rowLotsTo}
                              value={item.toWarehouseLotId || ""}
                              onChange={(val) => updateBulkTrItem(idx, "toWarehouseLotId", val)}
                              placeholder="To Lot"
                              className="w-full text-xs font-mono"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              title="Quick add destination lot"
                              onClick={() => {
                                setQuickLotLocationId(bulkTrToLocationId);
                                setQuickLotTarget({ type: "bulk-to", itemIndex: idx });
                                setShowQuickLotModal(true);
                              }}
                              className="h-7 w-7 shrink-0 p-0 text-emerald-700 hover:bg-emerald-100"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}

                        <div>
                          <Label className="text-[10px] text-slate-500 mb-0.5 block sm:hidden">Quantity</Label>
                          <Input
                            type="number"
                            min="0.0001"
                            step="any"
                            value={item.quantity}
                            onChange={(e) => updateBulkTrItem(idx, "quantity", parseFloat(e.target.value) || 0)}
                            className={cn(
                              "h-8 text-xs text-right",
                              item.productId && bulkTrFromLocationId && item.quantity > rowAvailStock
                                ? "border-rose-400 focus-visible:ring-rose-400 text-rose-700 font-bold"
                                : ""
                            )}
                            placeholder="Qty"
                            required
                          />
                          {item.productId && bulkTrFromLocationId && item.quantity > rowAvailStock && (
                            <div className="text-[9px] text-rose-600 font-semibold mt-0.5 text-right">
                              Exceeds avail ({rowAvailStock})
                            </div>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => removeBulkTrItem(idx)}
                          disabled={bulkTrItems.length <= 1}
                          className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:text-rose-600 disabled:opacity-30"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeBulkTransferModal}
                  className="text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={submittingBulkTr}
                  className="bg-amber-800 text-white hover:bg-amber-700 text-xs"
                >
                  {submittingBulkTr ? "Transferring..." : "Confirm & Execute Bulk Transfer"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* QUICK ADD LOT MODAL */}
      {showQuickLotModal && (
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-lg border border-slate-200 shadow-xl max-w-sm w-full p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-blue-600" />
                Quick Add Warehouse Lot
              </h3>
              <button
                onClick={() => setShowQuickLotModal(false)}
                className="text-slate-400 hover:text-slate-700 text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateQuickLot} className="space-y-3">
              <div className="space-y-1">
                <Label className="text-[11px] font-semibold text-slate-700">Lot Number / Code *</Label>
                <Input
                  required
                  placeholder="e.g. Lot 12, Rack B-04"
                  value={quickLotNumber}
                  onChange={(e) => setQuickLotNumber(e.target.value)}
                  className="h-7 text-xs font-mono"
                  autoFocus
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] font-semibold text-slate-700">Description (Optional)</Label>
                <Input
                  placeholder="e.g. Bay 3 pallet"
                  value={quickLotDescription}
                  onChange={(e) => setQuickLotDescription(e.target.value)}
                  className="h-7 text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowQuickLotModal(false)}
                  className="h-7 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={submittingQuickLot || !quickLotNumber.trim()}
                  className="h-7 text-xs bg-blue-700 hover:bg-blue-800 text-white"
                >
                  {submittingQuickLot ? "Creating..." : "Create Lot"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

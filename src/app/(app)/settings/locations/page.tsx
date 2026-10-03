"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { canPerformAction } from "@/lib/auth/permissions";
import {
  MapPin,
  Plus,
  Warehouse,
  Store,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Edit2,
  Trash2,
  Boxes,
  Layers,
  Search,
  ArrowRightLeft,
  Eye,
  EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  listLocationsAction,
  createLocationAction,
  updateLocationAction,
  deactivateLocationAction,
  reactivateLocationAction,
  deleteLocationAction,
} from "@/actions/locations";
import {
  listWarehouseLotsAction,
  createWarehouseLotAction,
  updateWarehouseLotAction,
  deactivateWarehouseLotAction,
  reactivateWarehouseLotAction,
  deleteWarehouseLotAction,
} from "@/actions/warehouse-lots";
import { useRealtimeListener } from "@/hooks/use-realtime";
import { useConfirm } from "@/components/providers/confirm-provider";
import { LocationType } from "@prisma/client";

type LocationItem = {
  id: string;
  name: string;
  type: LocationType;
  address: string | null;
  isActive: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  activeLotsCount: number;
  movementsCount: number;
};

type LotItem = {
  id: string;
  locationId: string;
  locationName: string;
  locationType: LocationType;
  lotNumber: string;
  description: string | null;
  isActive: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  currentStock: number;
};

export default function LocationsSettingsPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const confirm = useConfirm();
  const isOwner = session?.user?.role === "OWNER";
  const isManager = session?.user?.role === "MANAGER";
  const canDeactivateLots = isOwner || isManager;
  const canView = !session?.user ? true : canPerformAction(session.user.role, "settings", "view", (session.user as any).permissions);

  useEffect(() => {
    if (session?.user && !canView) {
      router.replace("/dashboard");
    }
  }, [session, canView, router]);

  const [activeTab, setActiveTab] = useState<"LOCATIONS" | "LOTS">("LOCATIONS");
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [lots, setLots] = useState<LotItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Filter states
  const [locationSearch, setLocationSearch] = useState("");
  const [showInactiveLocations, setShowInactiveLocations] = useState(false);
  const [lotSearch, setLotSearch] = useState("");
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>("ALL");
  const [showInactiveLots, setShowInactiveLots] = useState(false);

  // Modals state
  const [showAddLocationModal, setShowAddLocationModal] = useState(false);
  const [addLocName, setAddLocName] = useState("");
  const [addLocType, setAddLocType] = useState<LocationType>(LocationType.WAREHOUSE);
  const [addLocAddress, setAddLocAddress] = useState("");
  const [submittingLoc, setSubmittingLoc] = useState(false);

  const [editingLocation, setEditingLocation] = useState<LocationItem | null>(null);
  const [editLocName, setEditLocName] = useState("");
  const [editLocAddress, setEditLocAddress] = useState("");
  const [updatingLoc, setUpdatingLoc] = useState(false);

  const [showAddLotModal, setShowAddLotModal] = useState(false);
  const [addLotLocationId, setAddLotLocationId] = useState("");
  const [addLotNumber, setAddLotNumber] = useState("");
  const [addLotDescription, setAddLotDescription] = useState("");
  const [submittingLot, setSubmittingLot] = useState(false);

  const [editingLot, setEditingLot] = useState<LotItem | null>(null);
  const [editLotNumber, setEditLotNumber] = useState("");
  const [editLotDescription, setEditLotDescription] = useState("");
  const [updatingLot, setUpdatingLot] = useState(false);

  const loadData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const [locRes, lotRes] = await Promise.all([
        listLocationsAction(true),
        listWarehouseLotsAction(undefined, true),
      ]);

      if (locRes.success) {
        setLocations(locRes.data);
      }
      if (lotRes.success) {
        setLots(lotRes.data);
      }
    } catch {
      setStatusMessage({ type: "error", text: "Failed to load locations and lots data." });
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useRealtimeListener(["locations", "warehouse-lots", "inventory"], () => {
    void loadData(true);
  });

  // Filtered Locations
  const filteredLocations = useMemo(() => {
    const q = locationSearch.trim().toLowerCase();
    return locations.filter((loc) => {
      if (!showInactiveLocations && !loc.isActive) return false;
      if (!q) return true;
      return (
        loc.name.toLowerCase().includes(q) ||
        (loc.address && loc.address.toLowerCase().includes(q)) ||
        loc.type.toLowerCase().includes(q)
      );
    });
  }, [locations, locationSearch, showInactiveLocations]);

  const activeLocationsCount = useMemo(() => locations.filter((l) => l.isActive).length, [locations]);
  const activeLotsCount = useMemo(() => lots.filter((l) => l.isActive).length, [lots]);

  // Active warehouses for dropdowns
  const activeWarehouses = useMemo(() => {
    return locations.filter((l) => l.isActive && l.type === LocationType.WAREHOUSE);
  }, [locations]);

  // Filtered Lots
  const filteredLots = useMemo(() => {
    const q = lotSearch.trim().toLowerCase();
    return lots.filter((lot) => {
      if (!showInactiveLots && !lot.isActive) return false;
      if (selectedWarehouseId !== "ALL" && lot.locationId !== selectedWarehouseId) return false;
      if (!q) return true;
      return (
        lot.lotNumber.toLowerCase().includes(q) ||
        lot.locationName.toLowerCase().includes(q) ||
        (lot.description && lot.description.toLowerCase().includes(q))
      );
    });
  }, [lots, lotSearch, selectedWarehouseId, showInactiveLots]);

  // Handle Add Location
  async function handleCreateLocation(e: React.FormEvent) {
    e.preventDefault();
    if (!addLocName.trim()) return;
    setSubmittingLoc(true);
    setStatusMessage(null);
    try {
      const res = await createLocationAction({
        name: addLocName.trim(),
        type: addLocType,
        address: addLocAddress.trim() || null,
      });
      if (res.success) {
        setStatusMessage({ type: "success", text: `Location "${res.data.name}" added successfully.` });
        setShowAddLocationModal(false);
        setAddLocName("");
        setAddLocAddress("");
        void loadData(true);
      } else {
        setStatusMessage({ type: "error", text: res.error || "Failed to create location." });
      }
    } finally {
      setSubmittingLoc(false);
    }
  }

  // Handle Edit Location
  async function handleUpdateLocation(e: React.FormEvent) {
    e.preventDefault();
    if (!editingLocation || !editLocName.trim()) return;
    setUpdatingLoc(true);
    setStatusMessage(null);
    try {
      const res = await updateLocationAction({
        id: editingLocation.id,
        name: editLocName.trim(),
        type: editingLocation.type,
        address: editLocAddress.trim() || null,
      });
      if (res.success) {
        setStatusMessage({ type: "success", text: `Location updated successfully.` });
        setEditingLocation(null);
        void loadData(true);
      } else {
        setStatusMessage({ type: "error", text: res.error || "Failed to update location." });
      }
    } finally {
      setUpdatingLoc(false);
    }
  }

  // Handle Toggle Location Status
  async function handleToggleLocationStatus(loc: LocationItem) {
    setStatusMessage(null);
    if (loc.isActive) {
      const ok = await confirm({
        title: "Deactivate Location",
        description: `Are you sure you want to deactivate "${loc.name}"? It will be hidden from new order entries but historical records remain intact.`,
        confirmText: "Deactivate Location",
        variant: "destructive",
      });
      if (!ok) {
        return;
      }
      const res = await deactivateLocationAction({ id: loc.id });
      if (res.success) {
        setStatusMessage({ type: "success", text: `Location "${loc.name}" deactivated.` });
        void loadData(true);
      } else {
        setStatusMessage({ type: "error", text: res.error || "Failed to deactivate location." });
      }
    } else {
      const res = await reactivateLocationAction({ id: loc.id });
      if (res.success) {
        setStatusMessage({ type: "success", text: `Location "${loc.name}" reactivated.` });
        void loadData(true);
      } else {
        setStatusMessage({ type: "error", text: res.error || "Failed to reactivate location." });
      }
    }
  }

  // Handle Delete Location
  async function handleDeleteLocation(loc: LocationItem) {
    setStatusMessage(null);
    const ok = await confirm({
      title: "Delete Location",
      description: `Are you sure you want to delete "${loc.name}"? If it has historical records, it will be deactivated instead.`,
      confirmText: "Delete Location",
      variant: "destructive",
    });
    if (!ok) return;

    const res = await deleteLocationAction({ id: loc.id });
    if (res.success) {
      setStatusMessage({ type: "success", text: (res as any).data?.message || `Location "${loc.name}" deleted.` });
      void loadData(true);
    } else {
      setStatusMessage({ type: "error", text: res.error || "Failed to delete location." });
    }
  }

  // Handle Add Lot
  async function handleCreateLot(e: React.FormEvent) {
    e.preventDefault();
    if (!addLotLocationId || !addLotNumber.trim()) return;
    setSubmittingLot(true);
    setStatusMessage(null);
    try {
      const res = await createWarehouseLotAction({
        locationId: addLotLocationId,
        lotNumber: addLotNumber.trim(),
        description: addLotDescription.trim() || null,
      });
      if (res.success) {
        setStatusMessage({ type: "success", text: `Lot "${res.data.lotNumber}" created successfully.` });
        setShowAddLotModal(false);
        setAddLotNumber("");
        setAddLotDescription("");
        void loadData(true);
      } else {
        setStatusMessage({ type: "error", text: res.error || "Failed to create warehouse lot." });
      }
    } finally {
      setSubmittingLot(false);
    }
  }

  // Handle Edit Lot
  async function handleUpdateLot(e: React.FormEvent) {
    e.preventDefault();
    if (!editingLot || !editLotNumber.trim()) return;
    setUpdatingLot(true);
    setStatusMessage(null);
    try {
      const res = await updateWarehouseLotAction({
        id: editingLot.id,
        lotNumber: editLotNumber.trim(),
        description: editLotDescription.trim() || null,
      });
      if (res.success) {
        setStatusMessage({ type: "success", text: `Lot updated successfully.` });
        setEditingLot(null);
        void loadData(true);
      } else {
        setStatusMessage({ type: "error", text: res.error || "Failed to update warehouse lot." });
      }
    } finally {
      setUpdatingLot(false);
    }
  }

  // Handle Toggle Lot Status
  async function handleToggleLotStatus(lot: LotItem) {
    setStatusMessage(null);
    if (lot.isActive) {
      const ok = await confirm({
        title: "Deactivate Warehouse Lot",
        description: `Are you sure you want to deactivate Lot "${lot.lotNumber}" in ${lot.locationName}?`,
        confirmText: "Deactivate Lot",
        variant: "destructive",
      });
      if (!ok) {
        return;
      }
      const res = await deactivateWarehouseLotAction({ id: lot.id });
      if (res.success) {
        setStatusMessage({ type: "success", text: `Lot "${lot.lotNumber}" deactivated.` });
        void loadData(true);
      } else {
        setStatusMessage({ type: "error", text: res.error || "Failed to deactivate lot." });
      }
    } else {
      const res = await reactivateWarehouseLotAction({ id: lot.id });
      if (res.success) {
        setStatusMessage({ type: "success", text: `Lot "${lot.lotNumber}" reactivated.` });
        void loadData(true);
      } else {
        setStatusMessage({ type: "error", text: res.error || "Failed to reactivate lot." });
      }
    }
  }

  // Handle Delete Lot
  async function handleDeleteLot(lot: LotItem) {
    setStatusMessage(null);
    const ok = await confirm({
      title: "Delete Warehouse Lot",
      description: `Are you sure you want to delete Lot "${lot.lotNumber}"? If it has historical stock movements, it will be deactivated instead.`,
      confirmText: "Delete Lot",
      variant: "destructive",
    });
    if (!ok) return;

    const res = await deleteWarehouseLotAction({ id: lot.id });
    if (res.success) {
      setStatusMessage({ type: "success", text: (res as any).data?.message || `Lot "${lot.lotNumber}" deleted.` });
      void loadData(true);
    } else {
      setStatusMessage({ type: "error", text: res.error || "Failed to delete warehouse lot." });
    }
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-slate-900 text-white rounded-lg">
              <MapPin className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">Locations & Warehouse Lots</h1>
              <p className="text-xs text-slate-500">
                Manage growable storage locations (shops, godowns, rented warehouses) and lot tracking
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadData()}
            disabled={loading}
            className="text-xs h-8 border-slate-300 hover:bg-slate-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          {isOwner && (
            <Button
              size="sm"
              onClick={() => setShowAddLocationModal(true)}
              className="text-xs h-8 bg-slate-900 hover:bg-slate-800 text-white font-medium"
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Location
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => {
              if (activeWarehouses.length > 0) {
                setAddLotLocationId(activeWarehouses[0].id);
              }
              setShowAddLotModal(true);
            }}
            disabled={activeWarehouses.length === 0}
            className="text-xs h-8 bg-blue-700 hover:bg-blue-800 text-white font-medium"
            title={activeWarehouses.length === 0 ? "Create an active warehouse location first" : undefined}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Warehouse Lot
          </Button>
        </div>
      </div>

      {/* Status Alerts */}
      {statusMessage && (
        <div
          className={`flex items-center justify-between p-3 rounded-lg text-xs font-medium border ${
            statusMessage.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-rose-50 border-rose-200 text-rose-800"
          }`}
        >
          <div className="flex items-center gap-2">
            {statusMessage.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            ) : (
              <AlertCircle className="h-4 w-4 text-rose-600" />
            )}
            <span>{statusMessage.text}</span>
          </div>
          <button
            onClick={() => setStatusMessage(null)}
            className="text-slate-400 hover:text-slate-700 font-bold ml-4"
          >
            ✕
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center border-b border-slate-200 gap-6">
        <button
          onClick={() => setActiveTab("LOCATIONS")}
          className={`pb-3 text-xs font-semibold uppercase tracking-wider transition-colors border-b-2 ${
            activeTab === "LOCATIONS"
              ? "border-slate-900 text-slate-900"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <span className="flex items-center gap-2">
            <Store className="h-4 w-4" />
            Locations Directory ({showInactiveLocations ? locations.length : activeLocationsCount})
          </span>
        </button>

        <button
          onClick={() => setActiveTab("LOTS")}
          className={`pb-3 text-xs font-semibold uppercase tracking-wider transition-colors border-b-2 ${
            activeTab === "LOTS"
              ? "border-blue-700 text-blue-700"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <span className="flex items-center gap-2">
            <Layers className="h-4 w-4" />
            Warehouse Lots ({showInactiveLots ? lots.length : activeLotsCount})
          </span>
        </button>
      </div>

      {/* TAB 1: LOCATIONS DIRECTORY */}
      {activeTab === "LOCATIONS" && (
        <div className="space-y-4">
          {/* Controls Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <Input
                placeholder="Search locations..."
                value={locationSearch}
                onChange={(e) => setLocationSearch(e.target.value)}
                className="pl-8 h-8 text-xs bg-white border-slate-300"
              />
            </div>

            <div className="flex items-center gap-3 text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer text-slate-600 select-none">
                <input
                  type="checkbox"
                  checked={showInactiveLocations}
                  onChange={(e) => setShowInactiveLocations(e.target.checked)}
                  className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                />
                <span>Show Deactivated Locations</span>
              </label>
            </div>
          </div>

          {/* Locations Table */}
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                    <th className="py-2.5 px-3">Location Name</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3">Physical Address</th>
                    <th className="py-2.5 px-3 text-center">Active Lots</th>
                    <th className="py-2.5 px-3 text-center">Stock Movements</th>
                    <th className="py-2.5 px-3 text-center">Status</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredLocations.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-400">
                        {loading ? "Loading locations..." : "No storage locations found matching criteria."}
                      </td>
                    </tr>
                  ) : (
                    filteredLocations.map((loc) => {
                      const isWarehouse = loc.type === LocationType.WAREHOUSE;
                      return (
                        <tr
                          key={loc.id}
                          className={`hover:bg-slate-50/80 transition-colors ${
                            !loc.isActive ? "bg-slate-50/50 text-slate-400" : ""
                          }`}
                        >
                          <td className="py-2.5 px-3 font-semibold text-slate-900">
                            <div className="flex items-center gap-2">
                              {isWarehouse ? (
                                <Warehouse className="h-4 w-4 text-blue-600 shrink-0" />
                              ) : (
                                <Store className="h-4 w-4 text-emerald-600 shrink-0" />
                              )}
                              <span>{loc.name}</span>
                            </div>
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                isWarehouse
                                  ? "bg-blue-100 text-blue-800 border border-blue-200"
                                  : "bg-emerald-100 text-emerald-800 border border-emerald-200"
                              }`}
                            >
                              {loc.type}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-600 max-w-xs truncate">
                            {loc.address || <span className="text-slate-300 italic">No address specified</span>}
                          </td>
                          <td className="py-2.5 px-3 text-center font-medium text-slate-700">
                            {isWarehouse ? (
                              loc.activeLotsCount > 0 ? (
                                <button
                                  onClick={() => {
                                    setSelectedWarehouseId(loc.id);
                                    setActiveTab("LOTS");
                                  }}
                                  className="inline-flex items-center gap-1 text-blue-700 hover:text-blue-900 hover:underline font-semibold"
                                >
                                  <span>{loc.activeLotsCount} lots</span>
                                </button>
                              ) : (
                                <span className="text-slate-400">No lots (direct)</span>
                              )
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-center text-slate-600">
                            {loc.movementsCount.toLocaleString()}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                                loc.isActive
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                  : "bg-slate-200 text-slate-600 border border-slate-300"
                              }`}
                            >
                              {loc.isActive ? "ACTIVE" : "DEACTIVATED"}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            {isOwner ? (
                              <div className="inline-flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setEditingLocation(loc);
                                    setEditLocName(loc.name);
                                    setEditLocAddress(loc.address || "");
                                  }}
                                  className="h-7 px-2 text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                                  title="Edit Location"
                                >
                                  <Edit2 className="h-3 w-3 mr-1" />
                                  Edit
                                </Button>

                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => void handleToggleLocationStatus(loc)}
                                  className={`h-7 px-2 text-xs ${
                                    loc.isActive
                                      ? "text-rose-600 hover:text-rose-800 hover:bg-rose-50"
                                      : "text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50"
                                  }`}
                                  title={loc.isActive ? "Deactivate location" : "Reactivate location"}
                                >
                                  {loc.isActive ? (
                                    <>
                                      <EyeOff className="h-3 w-3 mr-1" />
                                      Deactivate
                                    </>
                                  ) : (
                                    <>
                                      <Eye className="h-3 w-3 mr-1" />
                                      Reactivate
                                    </>
                                  )}
                                </Button>

                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => void handleDeleteLocation(loc)}
                                  className="h-7 px-2 text-xs text-rose-700 hover:text-rose-900 hover:bg-rose-50"
                                  title="Delete Location"
                                >
                                  <Trash2 className="h-3 w-3 mr-1" />
                                  Delete
                                </Button>
                              </div>
                            ) : (
                              <span className="text-[11px] text-slate-400 italic">Owner managed</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: WAREHOUSE LOTS DIRECTORY */}
      {activeTab === "LOTS" && (
        <div className="space-y-4">
          {/* Lots Controls Bar */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <Input
                  placeholder="Search lots or descriptions..."
                  value={lotSearch}
                  onChange={(e) => setLotSearch(e.target.value)}
                  className="pl-8 h-8 text-xs bg-white border-slate-300"
                />
              </div>

              <div className="flex items-center gap-2">
                <Label className="text-xs text-slate-600 shrink-0 font-medium">Warehouse:</Label>
                <select
                  value={selectedWarehouseId}
                  onChange={(e) => setSelectedWarehouseId(e.target.value)}
                  className="h-8 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-800 focus:outline-hidden focus:ring-1 focus:ring-slate-900"
                >
                  <option value="ALL">All Warehouses ({activeWarehouses.length})</option>
                  {activeWarehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center gap-3 text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer text-slate-600 select-none">
                <input
                  type="checkbox"
                  checked={showInactiveLots}
                  onChange={(e) => setShowInactiveLots(e.target.checked)}
                  className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                />
                <span>Show Deactivated Lots</span>
              </label>
            </div>
          </div>

          {/* Lots Table */}
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                    <th className="py-2.5 px-3">Lot Number / Code</th>
                    <th className="py-2.5 px-3">Warehouse Location</th>
                    <th className="py-2.5 px-3">Description / Reference</th>
                    <th className="py-2.5 px-3 text-right">Units on Hand</th>
                    <th className="py-2.5 px-3 text-center">Status</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredLots.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400">
                        {loading ? "Loading warehouse lots..." : "No lots found matching criteria."}
                      </td>
                    </tr>
                  ) : (
                    filteredLots.map((lot) => (
                      <tr
                        key={lot.id}
                        className={`hover:bg-slate-50/80 transition-colors ${
                          !lot.isActive ? "bg-slate-50/50 text-slate-400" : ""
                        }`}
                      >
                        <td className="py-2.5 px-3 font-semibold text-slate-900 font-mono">
                          <div className="flex items-center gap-2">
                            <Layers className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                            <span>{lot.lotNumber}</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 font-medium text-slate-700">
                          <div className="flex items-center gap-1.5">
                            <Warehouse className="h-3.5 w-3.5 text-slate-400" />
                            <span>{lot.locationName}</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-600 max-w-xs truncate">
                          {lot.description || <span className="text-slate-300 italic">—</span>}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-900">
                          {lot.currentStock.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                              lot.isActive
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                : "bg-slate-200 text-slate-600 border border-slate-300"
                            }`}
                          >
                            {lot.isActive ? "ACTIVE" : "DEACTIVATED"}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="inline-flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setEditingLot(lot);
                                setEditLotNumber(lot.lotNumber);
                                setEditLotDescription(lot.description || "");
                              }}
                              className="h-7 px-2 text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                              title="Edit Lot Details"
                            >
                              <Edit2 className="h-3 w-3 mr-1" />
                              Edit
                            </Button>

                            {canDeactivateLots && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void handleToggleLotStatus(lot)}
                                className={`h-7 px-2 text-xs ${
                                  lot.isActive
                                    ? "text-rose-600 hover:text-rose-800 hover:bg-rose-50"
                                    : "text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50"
                                }`}
                                title={lot.isActive ? "Deactivate lot" : "Reactivate lot"}
                              >
                                {lot.isActive ? (
                                  <>
                                    <EyeOff className="h-3 w-3 mr-1" />
                                    Deactivate
                                  </>
                                ) : (
                                  <>
                                    <Eye className="h-3 w-3 mr-1" />
                                    Reactivate
                                  </>
                                )}
                              </Button>
                            )}

                            {canDeactivateLots && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void handleDeleteLot(lot)}
                                className="h-7 px-2 text-xs text-rose-700 hover:text-rose-900 hover:bg-rose-50"
                                title="Delete Lot"
                              >
                                <Trash2 className="h-3 w-3 mr-1" />
                                Delete
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Add Location */}
      {showAddLocationModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-lg border border-slate-200 shadow-xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <MapPin className="h-4 w-4 text-slate-700" />
                Add New Storage Location
              </h3>
              <button
                onClick={() => setShowAddLocationModal(false)}
                className="text-slate-400 hover:text-slate-700 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateLocation} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Location Name *</Label>
                <Input
                  required
                  placeholder="e.g. Rented Godown #3, Showroom B, Main Hub"
                  value={addLocName}
                  onChange={(e) => setAddLocName(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Location Type *</Label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setAddLocType(LocationType.WAREHOUSE)}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      addLocType === LocationType.WAREHOUSE
                        ? "border-blue-600 bg-blue-50/50 ring-1 ring-blue-600"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center gap-2 text-xs font-bold text-blue-900">
                      <Warehouse className="h-4 w-4 text-blue-600" />
                      Warehouse / Godown
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Supports optional lot and rack subdivisions
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAddLocType(LocationType.SHOP)}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      addLocType === LocationType.SHOP
                        ? "border-emerald-600 bg-emerald-50/50 ring-1 ring-emerald-600"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center gap-2 text-xs font-bold text-emerald-900">
                      <Store className="h-4 w-4 text-emerald-600" />
                      Shop / Branch
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Direct stock holding without lot subdivision
                    </p>
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Physical Address / Notes</Label>
                <Input
                  placeholder="e.g. Plot 44, Industrial Area, Sector 7"
                  value={addLocAddress}
                  onChange={(e) => setAddLocAddress(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddLocationModal(false)}
                  className="h-8 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={submittingLoc || !addLocName.trim()}
                  className="h-8 text-xs bg-slate-900 hover:bg-slate-800 text-white"
                >
                  {submittingLoc ? "Saving..." : "Create Location"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Edit Location */}
      {editingLocation && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-lg border border-slate-200 shadow-xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Edit2 className="h-4 w-4 text-slate-700" />
                Edit Location Details
              </h3>
              <button
                onClick={() => setEditingLocation(null)}
                className="text-slate-400 hover:text-slate-700 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleUpdateLocation} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Location Name *</Label>
                <Input
                  required
                  value={editLocName}
                  onChange={(e) => setEditLocName(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Physical Address / Notes</Label>
                <Input
                  value={editLocAddress}
                  onChange={(e) => setEditLocAddress(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEditingLocation(null)}
                  className="h-8 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={updatingLoc || !editLocName.trim()}
                  className="h-8 text-xs bg-slate-900 hover:bg-slate-800 text-white"
                >
                  {updatingLoc ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Add Warehouse Lot */}
      {showAddLotModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-lg border border-slate-200 shadow-xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Layers className="h-4 w-4 text-blue-700" />
                Add Warehouse Lot
              </h3>
              <button
                onClick={() => setShowAddLotModal(false)}
                className="text-slate-400 hover:text-slate-700 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateLot} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Target Warehouse *</Label>
                <select
                  required
                  value={addLotLocationId}
                  onChange={(e) => setAddLotLocationId(e.target.value)}
                  className="w-full h-8 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-800 focus:outline-hidden focus:ring-1 focus:ring-slate-900"
                >
                  {activeWarehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.type})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Lot Number / Code *</Label>
                <Input
                  required
                  placeholder="e.g. Lot 12, Rack B-04, Lot 15"
                  value={addLotNumber}
                  onChange={(e) => setAddLotNumber(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Description / Position (Optional)</Label>
                <Input
                  placeholder="e.g. Ground floor aisle 2, imported bond paper stack"
                  value={addLotDescription}
                  onChange={(e) => setAddLotDescription(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddLotModal(false)}
                  className="h-8 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={submittingLot || !addLotNumber.trim() || !addLotLocationId}
                  className="h-8 text-xs bg-blue-700 hover:bg-blue-800 text-white"
                >
                  {submittingLot ? "Creating..." : "Create Lot"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Edit Warehouse Lot */}
      {editingLot && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-lg border border-slate-200 shadow-xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Edit2 className="h-4 w-4 text-blue-700" />
                Edit Lot ({editingLot.locationName})
              </h3>
              <button
                onClick={() => setEditingLot(null)}
                className="text-slate-400 hover:text-slate-700 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleUpdateLot} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Lot Number / Code *</Label>
                <Input
                  required
                  value={editLotNumber}
                  onChange={(e) => setEditLotNumber(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Description / Position</Label>
                <Input
                  value={editLotDescription}
                  onChange={(e) => setEditLotDescription(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEditingLot(null)}
                  className="h-8 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={updatingLot || !editLotNumber.trim()}
                  className="h-8 text-xs bg-blue-700 hover:bg-blue-800 text-white"
                >
                  {updatingLot ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}


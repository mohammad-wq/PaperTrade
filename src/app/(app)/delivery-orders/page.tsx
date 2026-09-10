"use client";

import { useEffect, useState, useMemo } from "react";
import {
  Truck,
  Plus,
  Search,
  FileText,
  Share2,
  AlertCircle,
  Trash2,
  X,
  Send,
  CheckCircle,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  listDeliveryOrdersAction,
  createDeliveryOrderAction,
  updateDeliveryOrderStatusAction,
  listLocationsAction,
} from "@/actions/orders";
import { listPartiesAction } from "@/actions/parties";
import { listProductsAction } from "@/actions/products";
import { DeliveryOrderStatus, Unit } from "@prisma/client";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

type DORow = {
  id: string;
  doNo: string;
  date: Date;
  status: DeliveryOrderStatus;
  vehicleNo: string | null;
  driverName: string | null;
  deliveredTo: string | null;
  notes: string | null;
  customer: { id: string; name: string; phone: string | null } | null;
  location: { id: string; name: string };
  destinationLocation?: { id: string; name: string } | null;
  linkedSaleInvoice?: { id: string; invoiceNo: string } | null;
  items: Array<{
    id: string;
    quantity: number;
    product: { id: string; productNo: string; name: string };
  }>;
};

type LocationOption = {
  id: string;
  name: string;
  address?: string | null;
};

type PartyOption = {
  id: string;
  name: string;
  type: string;
};

type ProductOption = {
  id: string;
  productNo: string;
  name: string;
  unit: string;
};

type LineItem = {
  productId: string;
  quantity: number;
  unit: Unit;
};

export default function DeliveryOrdersPage() {
  const [orders, setOrders] = useState<DORow[]>([]);
  const [customers, setCustomers] = useState<PartyOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [dbLocations, setDbLocations] = useState<LocationOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Form state
  const [orderType, setOrderType] = useState<"CUSTOMER" | "INTERNAL_TRANSFER">("CUSTOMER");
  const [customerId, setCustomerId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [destinationLocationId, setDestinationLocationId] = useState("");
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [vehicleNo, setVehicleNo] = useState("");
  const [driverName, setDriverName] = useState("");
  const [deliveredTo, setDeliveredTo] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItem[]>([
    { productId: "", quantity: 1, unit: Unit.PACKET },
  ]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const [doRes, partyRes, prodRes, locRes] = await Promise.all([
        listDeliveryOrdersAction(),
        listPartiesAction(),
        listProductsAction(),
        listLocationsAction(),
      ]);

      if (doRes.success && doRes.data) {
        setOrders(doRes.data as DORow[]);
      }
      if (partyRes.success && partyRes.data) {
        const custList = (partyRes.data as PartyOption[]).filter((p) => p.type === "CUSTOMER");
        setCustomers(custList);
      }
      if (prodRes.success && prodRes.data) {
        setProducts(prodRes.data as ProductOption[]);
      }
      if (locRes.success && locRes.data) {
        setDbLocations(locRes.data as LocationOption[]);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  const locations = useMemo(() => {
    if (dbLocations.length > 0) return dbLocations;
    const map = new Map<string, string>();
    orders.forEach((o) => map.set(o.location.id, o.location.name));
    if (map.size === 0) {
      map.set("loc-shop", "Shop");
      map.set("loc-warehouse", "Warehouse");
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [dbLocations, orders]);

  const filteredOrders = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((order) => {
      const matchesQuery =
        !q ||
        order.doNo.toLowerCase().includes(q) ||
        (order.customer?.name && order.customer.name.toLowerCase().includes(q)) ||
        (order.destinationLocation?.name && order.destinationLocation.name.toLowerCase().includes(q)) ||
        (order.driverName && order.driverName.toLowerCase().includes(q)) ||
        (order.vehicleNo && order.vehicleNo.toLowerCase().includes(q));
      const matchesStatus = statusFilter === "ALL" || order.status === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [orders, query, statusFilter]);

  function handleProductChange(index: number, pId: string) {
    const prod = products.find((p) => p.id === pId);
    const updated = [...items];
    updated[index].productId = pId;
    if (prod && Object.values(Unit).includes(prod.unit as Unit)) {
      updated[index].unit = prod.unit as Unit;
    }
    setItems(updated);
  }

  function handleQuantityChange(index: number, qty: number) {
    const updated = [...items];
    updated[index].quantity = qty;
    setItems(updated);
  }

  function handleUnitChange(index: number, unit: Unit) {
    const updated = [...items];
    updated[index].unit = unit;
    setItems(updated);
  }

  function addItem() {
    setItems([...items, { productId: "", quantity: 1, unit: Unit.PACKET }]);
  }

  function removeItem(index: number) {
    if (items.length <= 1) return;
    setItems(items.filter((_, idx) => idx !== index));
  }

  async function handleStatusChange(id: string, status: DeliveryOrderStatus) {
    const actionLabel = status === DeliveryOrderStatus.DISPATCHED ? "dispatch goods and update stock" : "update status";
    if (!window.confirm(`Are you sure you want to ${actionLabel}?`)) return;

    const res = await updateDeliveryOrderStatusAction({ id, status });
    if (res.success) {
      await loadData();
    } else {
      alert(res.error || "Failed to update delivery order status.");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (orderType === "CUSTOMER" && !customerId) {
      setFormError("Please select a customer.");
      return;
    }
    if (!locationId) {
      setFormError("Please select a dispatch/source location.");
      return;
    }
    if (orderType === "INTERNAL_TRANSFER") {
      if (!destinationLocationId) {
        setFormError("Please select a destination location for the internal transfer.");
        return;
      }
      if (destinationLocationId === locationId) {
        setFormError("Source and destination locations cannot be the same.");
        return;
      }
    }
    if (items.some((i) => !i.productId || i.quantity <= 0)) {
      setFormError("All line items must have a valid product and quantity > 0.");
      return;
    }

    const confirmMsg =
      orderType === "INTERNAL_TRANSFER"
        ? "Confirm: create internal stock transfer between locations?"
        : "Confirm: create this delivery order?";
    if (!window.confirm(confirmMsg)) return;

    setSubmitting(true);
    try {
      const res = await createDeliveryOrderAction({
        orderType,
        customerId: orderType === "CUSTOMER" ? customerId : null,
        locationId,
        destinationLocationId: orderType === "INTERNAL_TRANSFER" ? destinationLocationId : null,
        date: new Date(orderDate),
        status: DeliveryOrderStatus.DRAFT,
        vehicleNo,
        driverName,
        deliveredTo: orderType === "INTERNAL_TRANSFER"
          ? (locations.find(l => l.id === destinationLocationId)?.name || deliveredTo)
          : deliveredTo,
        notes,
        items: items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          unit: i.unit,
        })),
      });

      if (!res.success) {
        setFormError(res.error || "Failed to create delivery order.");
      } else {
        setIsDialogOpen(false);
        setOrderType("CUSTOMER");
        setCustomerId("");
        setLocationId("");
        setDestinationLocationId("");
        setOrderDate(new Date().toISOString().slice(0, 10));
        setItems([{ productId: "", quantity: 1, unit: Unit.PACKET }]);
        setVehicleNo("");
        setDriverName("");
        setDeliveredTo("");
        setNotes("");
        await loadData();
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleWhatsAppShare(doId: string) {
    try {
      const res = await fetch(`/api/share/whatsapp?type=delivery-order&id=${doId}`);
      const json = await res.json();
      if (json.success && json.url) {
        window.open(json.url, "_blank");
      } else {
        alert("Failed to create WhatsApp share link.");
      }
    } catch {
      alert("Error generating WhatsApp share link.");
    }
  }

  function getStatusBadge(status: DeliveryOrderStatus) {
    switch (status) {
      case DeliveryOrderStatus.DRAFT:
        return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">DRAFT</span>;
      case DeliveryOrderStatus.DISPATCHED:
        return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">DISPATCHED</span>;
      case DeliveryOrderStatus.DELIVERED:
        return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">DELIVERED</span>;
      case DeliveryOrderStatus.CANCELLED:
        return <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800">CANCELLED</span>;
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-amber-800" />
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Delivery Orders</h1>
          </div>
          <p className="text-sm text-slate-600">
            Issue gate passes and delivery slips for paper transport, with vehicle and driver assignment.
          </p>
        </div>

        <Button
          onClick={() => {
            if (!locationId && locations.length > 0) setLocationId(locations[0].id);
            setIsDialogOpen(true);
          }}
          className="bg-amber-800 text-white hover:bg-amber-700 shadow-sm"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Create Delivery Order
        </Button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by DO number, customer, vehicle, or driver..."
            className="pl-9 bg-white"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700"
        >
          <option value="ALL">All Statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="DISPATCHED">Dispatched</option>
          <option value="DELIVERED">Delivered</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>

      {/* DO Cards */}
      {loading ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500 text-sm">
            Loading delivery orders...
          </CardContent>
        </Card>
      ) : filteredOrders.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500 text-sm">
            No delivery orders found.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredOrders.map((order) => (
            <Card key={order.id} className="border-amber-950/10 hover:shadow-md transition-shadow bg-white flex flex-col justify-between">
              <CardHeader className="pb-3 border-b border-slate-100">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base font-bold text-slate-900">{order.doNo}</CardTitle>
                    {order.customer ? (
                      <>
                        <p className="text-xs font-medium text-amber-900">{order.customer.name}</p>
                        {order.customer.phone && (
                          <p className="text-[11px] text-slate-400">{order.customer.phone}</p>
                        )}
                      </>
                    ) : (
                      <span className="mt-1 inline-flex items-center rounded-md bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800 border border-sky-200">
                        Internal: {order.location.name} &rarr; {order.destinationLocation?.name ?? "Transfer"}
                      </span>
                    )}
                  </div>
                  {getStatusBadge(order.status)}
                </div>
              </CardHeader>

              <CardContent className="py-3 space-y-2 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>From Location:</span>
                  <span className="font-semibold text-slate-800">{order.location.name}</span>
                </div>
                {order.destinationLocation && (
                  <div className="flex justify-between text-slate-600">
                    <span>To Location:</span>
                    <span className="font-semibold text-sky-800">{order.destinationLocation.name}</span>
                  </div>
                )}
                <div className="flex justify-between text-slate-600">
                  <span>Date:</span>
                  <span>{format(new Date(order.date), "dd MMM yyyy")}</span>
                </div>
                {order.vehicleNo && (
                  <div className="flex justify-between text-slate-600">
                    <span>Vehicle No:</span>
                    <span className="font-semibold text-slate-800">{order.vehicleNo}</span>
                  </div>
                )}
                {order.driverName && (
                  <div className="flex justify-between text-slate-600">
                    <span>Driver:</span>
                    <span>{order.driverName}</span>
                  </div>
                )}
                {order.deliveredTo && (
                  <div className="flex justify-between text-slate-600">
                    <span>Destination Note:</span>
                    <span className="truncate max-w-[150px]">{order.deliveredTo}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-slate-100 pt-2 text-slate-700 font-semibold">
                  <span>Packages:</span>
                  <span>{order.items.length} item line(s)</span>
                </div>
              </CardContent>

              {/* Actions */}
              <div className="p-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between gap-1.5 rounded-b-xl">
                <div className="flex items-center gap-1">
                  {order.status === DeliveryOrderStatus.DRAFT && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleStatusChange(order.id, DeliveryOrderStatus.DISPATCHED)}
                      className="h-7 text-[11px] border-amber-300 text-amber-900 hover:bg-amber-100 px-2"
                    >
                      <Send className="mr-1 h-3 w-3 text-amber-700" />
                      Dispatch
                    </Button>
                  )}
                  {order.status === DeliveryOrderStatus.DISPATCHED && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleStatusChange(order.id, DeliveryOrderStatus.DELIVERED)}
                      className="h-7 text-[11px] border-emerald-300 text-emerald-900 hover:bg-emerald-100 px-2"
                    >
                      <CheckCircle className="mr-1 h-3 w-3 text-emerald-700" />
                      Delivered
                    </Button>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs border-slate-200 text-slate-700 hover:bg-white"
                  >
                    <a href={`/api/pdf/delivery-order/${order.id}`} target="_blank" rel="noreferrer">
                      <FileText className="mr-1 h-3.5 w-3.5 text-amber-700" />
                      PDF
                    </a>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleWhatsAppShare(order.id)}
                    className="h-8 text-xs border-emerald-200 bg-emerald-50/50 text-emerald-800 hover:bg-emerald-100"
                  >
                    <Share2 className="mr-1 h-3.5 w-3.5 text-emerald-600" />
                    Share
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* New DO Modal */}
      {isDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs overflow-y-auto">
          <div className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-bold text-slate-900">New Delivery Order</h2>
                <p className="text-xs text-slate-500">Dispatch paper consignment with vehicle and driver details</p>
              </div>
              <button
                onClick={() => setIsDialogOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {formError && (
              <div className="mt-4 rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              {/* Transfer Type Selection */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <Label className="text-xs font-semibold text-slate-700 block mb-2">Delivery / Transfer Type</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setOrderType("CUSTOMER");
                      setDestinationLocationId("");
                    }}
                    className={cn(
                      "flex items-center justify-center gap-2 rounded-md py-2 px-3 text-xs font-semibold transition-all",
                      orderType === "CUSTOMER"
                        ? "bg-amber-800 text-white shadow-sm"
                        : "bg-white text-slate-700 hover:bg-slate-100 border border-slate-200",
                    )}
                  >
                    <span>Customer Delivery</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOrderType("INTERNAL_TRANSFER");
                      setCustomerId("");
                      if (!destinationLocationId && locations.length > 1) {
                        const other = locations.find((l) => l.id !== locationId);
                        if (other) setDestinationLocationId(other.id);
                      }
                    }}
                    className={cn(
                      "flex items-center justify-center gap-2 rounded-md py-2 px-3 text-xs font-semibold transition-all",
                      orderType === "INTERNAL_TRANSFER"
                        ? "bg-sky-700 text-white shadow-sm"
                        : "bg-white text-slate-700 hover:bg-slate-100 border border-slate-200",
                    )}
                  >
                    <span>Internal Transfer (Shop &harr; Warehouse)</span>
                  </button>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                {orderType === "CUSTOMER" ? (
                  <>
                    <div className="space-y-1">
                      <Label htmlFor="docustomer" className="text-xs font-semibold">
                        Customer <span className="text-rose-500">*</span>
                      </Label>
                      <select
                        id="docustomer"
                        value={customerId}
                        onChange={(e) => setCustomerId(e.target.value)}
                        className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs"
                        required
                      >
                        <option value="">Select customer</option>
                        {customers.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="dolocation" className="text-xs font-semibold">
                        Dispatch Location <span className="text-rose-500">*</span>
                      </Label>
                      <select
                        id="dolocation"
                        value={locationId}
                        onChange={(e) => setLocationId(e.target.value)}
                        className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs"
                        required
                      >
                        <option value="">Select location</option>
                        {locations.map((loc) => (
                          <option key={loc.id} value={loc.id}>
                            {loc.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="space-y-1">
                      <Label htmlFor="dofromlocation" className="text-xs font-semibold text-rose-800">
                        Source Location (From) <span className="text-rose-500">*</span>
                      </Label>
                      <select
                        id="dofromlocation"
                        value={locationId}
                        onChange={(e) => setLocationId(e.target.value)}
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
                      <Label htmlFor="dotolocation" className="text-xs font-semibold text-emerald-800">
                        Destination Location (To) <span className="text-rose-500">*</span>
                      </Label>
                      <select
                        id="dotolocation"
                        value={destinationLocationId}
                        onChange={(e) => setDestinationLocationId(e.target.value)}
                        className="w-full rounded-md border border-emerald-200 bg-emerald-50/30 px-3 py-2 text-xs font-medium"
                        required
                      >
                        <option value="">Select destination</option>
                        {locations.map((loc) => (
                          <option key={loc.id} value={loc.id} disabled={loc.id === locationId}>
                            {loc.name} {loc.id === locationId ? "(Source)" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                )}

                <div className="space-y-1">
                  <Label htmlFor="dodate" className="text-xs font-semibold">
                    Date <span className="text-rose-500">*</span>
                  </Label>
                  <Input
                    id="dodate"
                    type="date"
                    value={orderDate}
                    onChange={(e) => setOrderDate(e.target.value)}
                    className="text-xs"
                    required
                  />
                </div>
              </div>

              {/* Logistics Details */}
              <div className="grid gap-4 sm:grid-cols-3 border-t border-slate-100 pt-3">
                <div className="space-y-1">
                  <Label htmlFor="vehicleNo" className="text-xs">
                    Vehicle Number <span className="text-slate-400 font-normal text-xs">(Optional)</span>
                  </Label>
                  <Input
                    id="vehicleNo"
                    value={vehicleNo}
                    onChange={(e) => setVehicleNo(e.target.value)}
                    placeholder="e.g. LES-19-4820"
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="driverName" className="text-xs">
                    Driver Name <span className="text-slate-400 font-normal text-xs">(Optional)</span>
                  </Label>
                  <Input
                    id="driverName"
                    value={driverName}
                    onChange={(e) => setDriverName(e.target.value)}
                    placeholder="e.g. Muhammad Rafiq"
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="deliveredTo" className="text-xs">
                    Destination Address / Note <span className="text-slate-400 font-normal text-xs">(Optional)</span>
                  </Label>
                  <Input
                    id="deliveredTo"
                    value={deliveredTo}
                    onChange={(e) => setDeliveredTo(e.target.value)}
                    placeholder="e.g. Printing Press, Urdu Bazar"
                    className="text-xs"
                  />
                </div>
              </div>

              {/* Line items */}
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-bold uppercase tracking-wider text-slate-700">Consignment Items</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addItem} className="h-7 text-xs">
                    <Plus className="mr-1 h-3 w-3" /> Add Item
                  </Button>
                </div>

                <div className="space-y-3">
                  {items.map((item, idx) => (
                    <div
                      key={idx}
                      className="grid gap-2 sm:grid-cols-[1fr_120px_120px_36px] items-center rounded-lg border border-slate-100 p-2.5 bg-slate-50/50"
                    >
                      <div>
                        <select
                          value={item.productId}
                          onChange={(e) => handleProductChange(idx, e.target.value)}
                          className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                          required
                        >
                          <option value="">Select paper item</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.productNo} - {p.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <Input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) => handleQuantityChange(idx, Number(e.target.value) || 1)}
                          className="h-8 text-xs text-right"
                          placeholder="Qty"
                          required
                        />
                      </div>

                      <div>
                        <select
                          value={item.unit}
                          onChange={(e) => handleUnitChange(idx, e.target.value as Unit)}
                          className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                        >
                          <option value={Unit.PACKET}>PACKET (100 Sheets)</option>
                          <option value={Unit.REAM}>REAM (500 Sheets)</option>
                          {Object.values(Unit).filter((u) => u !== Unit.PACKET && u !== Unit.REAM).map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                        </select>
                      </div>

                      <button
                        type="button"
                        onClick={() => removeItem(idx)}
                        disabled={items.length <= 1}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:text-rose-600 disabled:opacity-30"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div className="border-t border-slate-100 pt-3">
                <Label htmlFor="donotes" className="text-xs">
                  Delivery Instructions <span className="text-slate-400 font-normal text-xs">(Optional)</span>
                </Label>
                <Input
                  id="donotes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Unload at warehouse gate #2"
                  className="text-xs mt-1"
                />
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)} className="text-xs">
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting} className="bg-amber-800 text-white hover:bg-amber-700 text-xs">
                  {submitting ? "Saving..." : "Create Delivery Order"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

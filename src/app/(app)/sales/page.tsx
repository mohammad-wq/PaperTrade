"use client";

import { useEffect, useState, useMemo } from "react";
import {
  Receipt,
  Plus,
  Search,
  FileText,
  Share2,
  AlertCircle,
  CheckCircle2,
  Trash2,
  Clock,
  X,
  Building2,
  UserPlus,
  Banknote,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listSaleInvoicesAction, createSaleInvoiceAction } from "@/actions/invoices";
import { listPartiesAction, listInventoryAction } from "@/actions/parties";
import { listProductsAction } from "@/actions/products";
import { format } from "date-fns";

type SaleInvoiceRow = {
  id: string;
  invoiceNo: string;
  date: Date;
  status: string;
  totalAmount: number;
  amountPaid: number;
  balanceDue: number;
  customer: { id: string; name: string; phone: string | null };
  location: { id: string; name: string };
  deliveryOrder?: { id: string; doNo: string } | null;
  items: Array<{
    id: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    product: { id: string; productNo: string; name: string; unit: string };
  }>;
};

type PartyOption = {
  id: string;
  name: string;
  type: string;
  creditLimit: number | null;
  balance: number;
};

type ProductOption = {
  id: string;
  productNo: string;
  name: string;
  unit: string;
  retailPrice: number;
  wholesalePrice: number;
};

type StockInfo = {
  productId: string;
  locationId: string;
  available: number;
};

type LineItem = {
  productId: string;
  quantity: number;
  unitPrice: number;
};

export default function SalesPage() {
  const [invoices, setInvoices] = useState<SaleInvoiceRow[]>([]);
  const [parties, setParties] = useState<PartyOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [inventory, setInventory] = useState<StockInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Form state
  const [customerType, setCustomerType] = useState<"REGISTERED" | "WALK_IN">("REGISTERED");
  const [customerId, setCustomerId] = useState("");
  const [walkInName, setWalkInName] = useState("Walk-in Customer");
  const [walkInPhone, setWalkInPhone] = useState("");
  const [walkInAddress, setWalkInAddress] = useState("");
  const [saveCustomer, setSaveCustomer] = useState(false);
  const [paidImmediately, setPaidImmediately] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "BANK" | "CHEQUE" | "OTHER">("CASH");
  const [customAmountPaid, setCustomAmountPaid] = useState<string>("");

  const [locationId, setLocationId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItem[]>([
    { productId: "", quantity: 1, unitPrice: 0 },
  ]);
  const [formError, setFormError] = useState<string | null>(null);
  const [formWarning, setFormWarning] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const [invRes, partyRes, prodRes, stockRes] = await Promise.all([
        listSaleInvoicesAction(),
        listPartiesAction(),
        listProductsAction(),
        listInventoryAction(),
      ]);

      if (invRes.success && invRes.data) {
        setInvoices(invRes.data as SaleInvoiceRow[]);
      }
      if (partyRes.success && partyRes.data) {
        const partyList = (partyRes.data as PartyOption[]).filter((p) => p.type === "CUSTOMER");
        setParties(partyList);
      }
      if (prodRes.success && prodRes.data) {
        setProducts(prodRes.data as ProductOption[]);
      }
      if (stockRes.success && stockRes.data) {
        const invRows = stockRes.data as Array<{ productId: string; locationId: string; available: number }>;
        setInventory(invRows);
        if (!locationId && invRows.length > 0) {
          setLocationId(invRows[0].locationId);
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

  const locations = useMemo(() => {
    const map = new Map<string, string>();
    invoices.forEach((i) => map.set(i.location.id, i.location.name));
    if (map.size === 0) {
      map.set("loc-shop", "Shop");
      map.set("loc-warehouse", "Warehouse");
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter(
      (inv) =>
        inv.invoiceNo.toLowerCase().includes(q) ||
        inv.customer.name.toLowerCase().includes(q) ||
        inv.location.name.toLowerCase().includes(q),
    );
  }, [invoices, query]);

  const totalFilteredSales = useMemo(
    () => filteredInvoices.reduce((sum, i) => sum + i.totalAmount, 0),
    [filteredInvoices],
  );

  const totalFilteredBalanceDue = useMemo(
    () => filteredInvoices.reduce((sum, i) => sum + i.balanceDue, 0),
    [filteredInvoices],
  );

  function getAvailableStock(prodId: string, locId: string) {
    const found = inventory.find((i) => i.productId === prodId && i.locationId === locId);
    return found ? found.available : 0;
  }

  const selectedCustomer = useMemo(
    () => parties.find((p) => p.id === customerId),
    [parties, customerId],
  );

  const invoiceSubtotal = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0),
    [items],
  );

  // Credit limit check
  useEffect(() => {
    if (selectedCustomer && selectedCustomer.creditLimit !== null) {
      const projected = selectedCustomer.balance + invoiceSubtotal;
      if (projected > selectedCustomer.creditLimit) {
        setFormWarning(
          `Customer credit limit is PKR ${selectedCustomer.creditLimit.toLocaleString()}. Projected balance will be PKR ${projected.toLocaleString()}.`,
        );
      } else {
        setFormWarning(null);
      }
    } else {
      setFormWarning(null);
    }
  }, [selectedCustomer, invoiceSubtotal]);

  function handleProductChange(index: number, pId: string) {
    const product = products.find((p) => p.id === pId);
    const updated = [...items];
    updated[index].productId = pId;
    if (product) {
      updated[index].unitPrice = product.retailPrice || 0;
    }
    setItems(updated);
  }

  function handleQuantityChange(index: number, qty: number) {
    const updated = [...items];
    updated[index].quantity = qty;
    setItems(updated);
  }

  function handlePriceChange(index: number, price: number) {
    const updated = [...items];
    updated[index].unitPrice = price;
    setItems(updated);
  }

  function addItem() {
    setItems([...items, { productId: "", quantity: 1, unitPrice: 0 }]);
  }

  function removeItem(index: number) {
    if (items.length <= 1) return;
    setItems(items.filter((_, idx) => idx !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (customerType === "REGISTERED" && !customerId) {
      setFormError("Please select a registered customer.");
      return;
    }
    if (customerType === "WALK_IN" && !walkInName.trim()) {
      setFormError("Please enter a customer name for the walk-in sale.");
      return;
    }
    if (!locationId) {
      setFormError("Please select a dispatch location.");
      return;
    }
    if (items.some((i) => !i.productId || i.quantity <= 0)) {
      setFormError("All line items must have a valid product and quantity > 0.");
      return;
    }

    if (!window.confirm("Confirm: create this sales invoice?")) return;

    // Check stock
    for (const item of items) {
      const available = getAvailableStock(item.productId, locationId);
      if (available < item.quantity) {
        const prod = products.find((p) => p.id === item.productId);
        setFormError(
          `Insufficient stock for "${prod?.name || item.productId}". Available: ${available} ${prod?.unit || "Packets"}, requested: ${item.quantity}.`,
        );
        return;
      }
    }

    const numericAmountPaid = customAmountPaid !== "" ? Number(customAmountPaid) : invoiceSubtotal;

    setSubmitting(true);
    try {
      const res = await createSaleInvoiceAction({
        customerType,
        customerId: customerType === "REGISTERED" ? customerId : undefined,
        walkInName: customerType === "WALK_IN" ? walkInName : undefined,
        walkInPhone: customerType === "WALK_IN" ? walkInPhone : undefined,
        walkInAddress: customerType === "WALK_IN" ? walkInAddress : undefined,
        saveCustomer,
        paidImmediately,
        paymentMethod,
        amountPaid: paidImmediately ? numericAmountPaid : 0,
        locationId,
        date: new Date(invoiceDate),
        notes,
        items: items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
        })),
      });

      if (!res.success) {
        setFormError(res.error || "Failed to create invoice.");
      } else {
        setIsDialogOpen(false);
        setCustomerType("REGISTERED");
        setCustomerId("");
        setWalkInName("Walk-in Customer");
        setWalkInPhone("");
        setWalkInAddress("");
        setSaveCustomer(false);
        setPaidImmediately(false);
        setPaymentMethod("CASH");
        setCustomAmountPaid("");
        setLocationId("");
        setInvoiceDate(new Date().toISOString().slice(0, 10));
        setItems([{ productId: "", quantity: 1, unitPrice: 0 }]);
        setNotes("");
        await loadData();
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleWhatsAppShare(invoiceId: string) {
    try {
      const res = await fetch(`/api/share/whatsapp?type=sale-invoice&id=${invoiceId}`);
      const json = await res.json();
      if (json.success && json.url) {
        window.open(json.url, "_blank");
      } else {
        alert("Failed to create WhatsApp link.");
      }
    } catch {
      alert("Error generating WhatsApp share link.");
    }
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-emerald-800" />
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Sales Invoices</h1>
          </div>
          <p className="text-sm text-slate-600">
            Generate customer invoices for walk-in counter sales or registered long-term clients, with instant stock deduction and double-entry ledger integration.
          </p>
        </div>

        <Button
          onClick={() => {
            setCustomerType("REGISTERED");
            setPaidImmediately(false);
            setCustomAmountPaid("");
            setFormError(null);
            setFormWarning(null);
            setIsDialogOpen(true);
          }}
          className="bg-emerald-800 text-white hover:bg-emerald-700 shadow-sm"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Create Invoice
        </Button>
      </div>

      {/* Summary Counters */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="border-emerald-900/15 bg-white/80">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Filtered Sales</p>
              <p className="text-xl font-bold text-slate-900 mt-0.5">PKR {totalFilteredSales.toLocaleString()}</p>
            </div>
            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800">
              {filteredInvoices.length} Invoices
            </span>
          </CardContent>
        </Card>

        <Card className="border-amber-900/15 bg-white/80">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Balance Due</p>
              <p className="text-xl font-bold text-amber-900 mt-0.5">PKR {totalFilteredBalanceDue.toLocaleString()}</p>
            </div>
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">
              Receivables
            </span>
          </CardContent>
        </Card>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by invoice number, customer name, or location..."
          className="pl-9 bg-white"
        />
      </div>

      {/* Invoices List / Responsive Cards */}
      {loading ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500 text-sm">
            Loading sales invoices...
          </CardContent>
        </Card>
      ) : filteredInvoices.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500 text-sm">
            No sales invoices match your search.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredInvoices.map((invoice) => {
            const isWalkIn =
              invoice.customer.name.toLowerCase().includes("walk-in") ||
              invoice.customer.name.toLowerCase().includes("walk in");

            return (
              <Card key={invoice.id} className="border-amber-950/10 hover:shadow-md transition-shadow bg-white flex flex-col justify-between">
                <CardHeader className="pb-3 border-b border-slate-100">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base font-bold text-slate-900">{invoice.invoiceNo}</CardTitle>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <p className="text-xs font-semibold text-emerald-800">{invoice.customer.name}</p>
                        {isWalkIn ? (
                          <span className="rounded bg-sky-50 border border-sky-200 px-1.5 py-0.5 text-[9px] font-bold text-sky-800">
                            Walk-in
                          </span>
                        ) : (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-600">
                            Registered
                          </span>
                        )}
                      </div>
                      {invoice.customer.phone && (
                        <p className="text-[11px] text-slate-400">{invoice.customer.phone}</p>
                      )}
                    </div>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                      {invoice.status}
                    </span>
                  </div>
                </CardHeader>

                <CardContent className="py-3 space-y-2 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>Location:</span>
                    <span className="font-semibold text-slate-800">{invoice.location.name}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Date:</span>
                    <span>{format(new Date(invoice.date), "dd MMM yyyy")}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Items:</span>
                    <span>{invoice.items.length} product(s)</span>
                  </div>
                  <div className="flex justify-between border-t border-slate-100 pt-2 font-bold text-sm">
                    <span>Total Amount:</span>
                    <span className="text-slate-900">PKR {invoice.totalAmount.toLocaleString()}</span>
                  </div>
                  {invoice.balanceDue > 0 ? (
                    <div className="flex justify-between text-rose-700 font-semibold text-[11px]">
                      <span>Balance Due:</span>
                      <span>PKR {invoice.balanceDue.toLocaleString()}</span>
                    </div>
                  ) : (
                    <div className="flex justify-between text-emerald-700 font-semibold text-[11px] items-center">
                      <span>Payment Status:</span>
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 flex items-center gap-1">
                        <Check className="h-3 w-3" /> Fully Paid
                      </span>
                    </div>
                  )}
                </CardContent>

                {/* Action Buttons */}
                <div className="p-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-end gap-2 rounded-b-xl">
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs border-slate-200 text-slate-700 hover:bg-white"
                  >
                    <a href={`/api/pdf/sale-invoice/${invoice.id}`} target="_blank" rel="noreferrer">
                      <FileText className="mr-1 h-3.5 w-3.5 text-rose-600" />
                      PDF
                    </a>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleWhatsAppShare(invoice.id)}
                    className="h-8 text-xs border-emerald-200 bg-emerald-50/50 text-emerald-800 hover:bg-emerald-100"
                  >
                    <Share2 className="mr-1 h-3.5 w-3.5 text-emerald-600" />
                    WhatsApp
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* New Invoice Modal */}
      {isDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs overflow-y-auto">
          <div className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-bold text-slate-900">New Sale Invoice</h2>
                <p className="text-xs text-slate-500">Record customer sale, check stock in packets, and post to ledger</p>
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

            {formWarning && (
              <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{formWarning}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              {/* Customer Mode Segmented Selector */}
              <div className="space-y-1.5 rounded-xl border border-slate-200/80 bg-slate-50/60 p-2.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-bold uppercase tracking-wider text-slate-700">Customer Dealing Type</Label>
                  <span className="text-[11px] text-slate-500">Choose registered party or walk-in client</span>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setCustomerType("REGISTERED");
                      setPaidImmediately(false);
                      setCustomAmountPaid("");
                    }}
                    className={`flex items-center justify-center gap-2 rounded-lg py-2.5 px-3 text-xs font-bold transition-all border ${
                      customerType === "REGISTERED"
                        ? "border-emerald-600 bg-white text-emerald-900 shadow-xs"
                        : "border-transparent bg-transparent text-slate-600 hover:bg-white/60"
                    }`}
                  >
                    <Building2 className={`h-4 w-4 ${customerType === "REGISTERED" ? "text-emerald-700" : "text-slate-400"}`} />
                    <span>Registered Party (Long-Term)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setCustomerType("WALK_IN");
                      setPaidImmediately(true);
                      setCustomAmountPaid("");
                    }}
                    className={`flex items-center justify-center gap-2 rounded-lg py-2.5 px-3 text-xs font-bold transition-all border ${
                      customerType === "WALK_IN"
                        ? "border-amber-600 bg-white text-amber-950 shadow-xs"
                        : "border-transparent bg-transparent text-slate-600 hover:bg-white/60"
                    }`}
                  >
                    <UserPlus className={`h-4 w-4 ${customerType === "WALK_IN" ? "text-amber-700" : "text-slate-400"}`} />
                    <span>Walk-in / New Customer</span>
                  </button>
                </div>
              </div>

              {/* Dynamic Customer Input Based on Type */}
              {customerType === "REGISTERED" ? (
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <Label htmlFor="customer" className="text-xs font-semibold">Select Registered Customer *</Label>
                    {selectedCustomer && (
                      <div className="flex items-center gap-2 text-[11px]">
                        <span className="text-slate-500">
                          Balance: <strong className={selectedCustomer.balance > 0 ? "text-amber-800" : "text-slate-700"}>PKR {selectedCustomer.balance.toLocaleString()}</strong>
                        </span>
                        {selectedCustomer.creditLimit !== null && (
                          <span className="text-slate-500 border-l border-slate-200 pl-2">
                            Limit: <strong className="text-slate-700">PKR {selectedCustomer.creditLimit.toLocaleString()}</strong>
                            {" | "}
                            Remaining: <strong className={selectedCustomer.creditLimit - selectedCustomer.balance <= 0 ? "text-rose-600" : "text-emerald-700"}>
                              PKR {(selectedCustomer.creditLimit - selectedCustomer.balance).toLocaleString()}
                            </strong>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <select
                    id="customer"
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs"
                    required
                  >
                    <option value="">Select customer from directory...</option>
                    {parties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.creditLimit ? `(Limit: PKR ${p.creditLimit.toLocaleString()})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="space-y-3 rounded-xl border border-amber-200/80 bg-amber-50/40 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-amber-950">Walk-in Customer Details</p>
                    <span className="text-[11px] text-amber-800">Quick counter sale without separate registration</span>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1">
                      <Label htmlFor="walkInName" className="text-xs font-semibold text-slate-700">Customer Name *</Label>
                      <Input
                        id="walkInName"
                        value={walkInName}
                        onChange={(e) => setWalkInName(e.target.value)}
                        placeholder="e.g. Walk-in Customer or Ahmed Graphics"
                        className="bg-white text-xs"
                        required
                      />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="walkInPhone" className="text-xs font-semibold text-slate-700">Phone (Optional)</Label>
                      <Input
                        id="walkInPhone"
                        value={walkInPhone}
                        onChange={(e) => setWalkInPhone(e.target.value)}
                        placeholder="e.g. 0300-1234567"
                        className="bg-white text-xs"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="walkInAddress" className="text-xs font-semibold text-slate-700">Address / City (Optional)</Label>
                      <Input
                        id="walkInAddress"
                        value={walkInAddress}
                        onChange={(e) => setWalkInAddress(e.target.value)}
                        placeholder="e.g. Urdu Bazaar, Lahore"
                        className="bg-white text-xs"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="checkbox"
                      id="saveCustomer"
                      checked={saveCustomer}
                      onChange={(e) => setSaveCustomer(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-amber-300 text-amber-800 focus:ring-amber-500"
                    />
                    <label htmlFor="saveCustomer" className="text-xs text-slate-700 cursor-pointer">
                      Save as permanent customer in party directory for future billing
                    </label>
                  </div>
                </div>
              )}

              {/* Location & Date */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="location" className="text-xs font-semibold">Dispatch Location *</Label>
                  <select
                    id="location"
                    value={locationId}
                    onChange={(e) => setLocationId(e.target.value)}
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs"
                    required
                  >
                    <option value="">Select dispatch floor...</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="date" className="text-xs font-semibold">Invoice Date *</Label>
                  <Input
                    id="date"
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                    className="text-xs bg-white"
                    required
                  />
                </div>
              </div>

              {/* Line items */}
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs font-bold uppercase tracking-wider text-slate-700">Invoice Items</Label>
                    <span className="text-[10px] text-emerald-800 font-medium bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                      Standard Units: Packets
                    </span>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={addItem} className="h-7 text-xs">
                    <Plus className="mr-1 h-3 w-3" /> Add Item
                  </Button>
                </div>

                <div className="space-y-3">
                  {items.map((item, idx) => {
                    const avail = locationId && item.productId ? getAvailableStock(item.productId, locationId) : null;
                    const prod = products.find((p) => p.id === item.productId);

                    return (
                      <div
                        key={idx}
                        className="grid gap-2 sm:grid-cols-[1fr_110px_120px_110px_36px] items-center rounded-lg border border-slate-100 p-2.5 bg-slate-50/50"
                      >
                        <div>
                          <select
                            value={item.productId}
                            onChange={(e) => handleProductChange(idx, e.target.value)}
                            className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                            required
                          >
                            <option value="">Select paper item (Packets)</option>
                            {products.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.productNo} - {p.name} ({p.unit})
                              </option>
                            ))}
                          </select>
                          {avail !== null && (
                            <p className={`text-[10px] mt-0.5 ${avail < item.quantity ? "text-rose-600 font-bold" : "text-emerald-700"}`}>
                              Available stock: {avail} {prod?.unit || "Packets"}
                            </p>
                          )}
                        </div>

                        <div>
                          <Input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) => handleQuantityChange(idx, Number(e.target.value) || 1)}
                            className="h-8 text-xs text-right bg-white"
                            placeholder="Qty (Pkts)"
                            required
                          />
                        </div>

                        <div>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.unitPrice}
                            onChange={(e) => handlePriceChange(idx, Number(e.target.value) || 0)}
                            className="h-8 text-xs text-right bg-white"
                            placeholder="Rate / Pkt"
                            required
                          />
                        </div>

                        <div className="text-right text-xs font-semibold text-slate-800">
                          PKR {(item.quantity * item.unitPrice).toFixed(2)}
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
                    );
                  })}
                </div>
              </div>

              {/* On-the-spot Payment Settlement Card */}
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Banknote className="h-4 w-4 text-emerald-800" />
                    <Label htmlFor="paidImmediately" className="text-xs font-bold text-emerald-950 cursor-pointer">
                      Settle Payment on the Spot (Immediate Cash Receipt)
                    </Label>
                  </div>
                  <input
                    type="checkbox"
                    id="paidImmediately"
                    checked={paidImmediately}
                    onChange={(e) => setPaidImmediately(e.target.checked)}
                    className="h-4 w-4 rounded border-emerald-300 text-emerald-800 focus:ring-emerald-500"
                  />
                </div>

                {paidImmediately && (
                  <div className="grid gap-3 sm:grid-cols-2 pt-2 border-t border-emerald-200/70">
                    <div className="space-y-1">
                      <Label htmlFor="paymentMethod" className="text-xs font-semibold text-slate-700">Payment Mode</Label>
                      <select
                        id="paymentMethod"
                        value={paymentMethod}
                        onChange={(e) => setPaymentMethod(e.target.value as "CASH" | "BANK" | "CHEQUE" | "OTHER")}
                        className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                      >
                        <option value="CASH">Cash in Hand (Default)</option>
                        <option value="BANK">Bank Transfer / Online</option>
                        <option value="CHEQUE">Bank Cheque</option>
                        <option value="OTHER">Other Mode</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between items-center">
                        <Label htmlFor="amountPaid" className="text-xs font-semibold text-slate-700">Amount Received (PKR)</Label>
                        <span className="text-[10px] text-emerald-800 font-medium">Default: Full (PKR {invoiceSubtotal.toLocaleString()})</span>
                      </div>
                      <Input
                        id="amountPaid"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder={invoiceSubtotal.toString()}
                        value={customAmountPaid}
                        onChange={(e) => setCustomAmountPaid(e.target.value)}
                        className="h-8 text-xs bg-white text-right"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Subtotal & Notes */}
              <div className="border-t border-slate-100 pt-3 flex flex-col sm:flex-row justify-between items-start gap-4">
                <div className="w-full sm:max-w-xs space-y-1">
                  <Label htmlFor="notes" className="text-xs">Notes / Special Instructions</Label>
                  <Input
                    id="notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. Counter sale delivery"
                    className="text-xs bg-white"
                  />
                </div>

                <div className="w-full sm:w-64 rounded-xl bg-slate-50 p-3 border border-slate-100 space-y-1 text-right">
                  <p className="text-xs text-slate-500">Invoice Grand Total</p>
                  <p className="text-xl font-bold text-emerald-900">PKR {invoiceSubtotal.toLocaleString()}</p>
                  {paidImmediately && (
                    <p className="text-[11px] font-semibold text-emerald-700 pt-0.5">
                      Settlement: PKR {(customAmountPaid !== "" ? Number(customAmountPaid) : invoiceSubtotal).toLocaleString()} ({paymentMethod})
                    </p>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)} className="text-xs">
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting} className="bg-emerald-800 text-white hover:bg-emerald-700 text-xs">
                  {submitting ? "Posting..." : "Confirm & Post Invoice"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

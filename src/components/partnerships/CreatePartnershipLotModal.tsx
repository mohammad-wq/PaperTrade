"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createPartnershipLotAction } from "@/actions/partnerships";
import { Plus, Trash2, Layers, ShieldCheck, DollarSign } from "lucide-react";
import { toast } from "@/lib/toast";
import { useRouter } from "next/navigation";

type ProductOption = {
  id: string;
  name: string;
  productNo: string;
  unit: string;
  costPrice: number;
};

type PartyOption = {
  id: string;
  name: string;
};

type LocationOption = {
  id: string;
  name: string;
};

interface CreatePartnershipLotModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partners: PartyOption[];
  warehouses: LocationOption[];
  products: ProductOption[];
  defaultPartnerId?: string;
}

export function CreatePartnershipLotModal({
  open,
  onOpenChange,
  partners,
  warehouses,
  products,
  defaultPartnerId,
}: CreatePartnershipLotModalProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [partnerId, setPartnerId] = useState(defaultPartnerId || partners[0]?.id || "");
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id || "");
  const [lotNumber, setLotNumber] = useState(`LOT-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 900) + 100)}`);
  const [archetype, setArchetype] = useState<"CONSIGNMENT_VMI" | "CO_INVESTED_POOL">("CO_INVESTED_POOL");
  const [partnerMarginRatio, setPartnerMarginRatio] = useState<number>(0.5);
  const [notes, setNotes] = useState("");

  const [items, setItems] = useState<Array<{ productId: string; initialQuantity: number; unitCostRate: number }>>([
    {
      productId: products[0]?.id || "",
      initialQuantity: 100,
      unitCostRate: products[0]?.costPrice || 1000,
    },
  ]);

  const handleAddItem = () => {
    const defaultProd = products[0];
    setItems((prev) => [
      ...prev,
      {
        productId: defaultProd?.id || "",
        initialQuantity: 50,
        unitCostRate: defaultProd?.costPrice || 1000,
      },
    ]);
  };

  const handleRemoveItem = (index: number) => {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleItemChange = (index: number, field: "productId" | "initialQuantity" | "unitCostRate", val: any) => {
    setItems((prev) => {
      const updated = [...prev];
      if (field === "productId") {
        const prod = products.find((p) => p.id === val);
        updated[index] = {
          ...updated[index],
          productId: val,
          unitCostRate: prod?.costPrice || updated[index].unitCostRate,
        };
      } else {
        updated[index] = {
          ...updated[index],
          [field]: Number(val),
        };
      }
      return updated;
    });
  };

  const totalCapitalCost = items.reduce((s, it) => s + it.initialQuantity * it.unitCostRate, 0);
  const partnerCapital = archetype === "CONSIGNMENT_VMI" ? totalCapitalCost : totalCapitalCost * partnerMarginRatio;
  const entityCapital = archetype === "CONSIGNMENT_VMI" ? 0 : totalCapitalCost - partnerCapital;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partnerId) {
      toast.error("Please select a partner.");
      return;
    }
    if (!warehouseId) {
      toast.error("Please select a warehouse location.");
      return;
    }
    if (!lotNumber.trim()) {
      toast.error("Please enter a lot number.");
      return;
    }
    if (items.some((it) => !it.productId || it.initialQuantity <= 0 || it.unitCostRate < 0)) {
      toast.error("Please ensure all items have valid quantities and cost rates.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await createPartnershipLotAction({
        lotNumber: lotNumber.trim(),
        partnerId,
        type: archetype,
        warehouseId,
        partnerMarginRatio,
        entityCapitalShare: entityCapital,
        partnerCapitalShare: partnerCapital,
        notes: notes.trim() || null,
        items,
      });

      if (res.success && res.data) {
        toast.success(`Partnership Lot ${res.data.lotNumber} created successfully!`);
        onOpenChange(false);
        router.push(`/partnerships/${res.data.lotId}`);
        router.refresh();
      } else {
        toast.error((res as any).error || "Failed to create partnership lot.");
      }
    } catch (err: any) {
      toast.error(err.message || "An unexpected error occurred.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-bold">
            <Layers className="h-6 w-6 text-indigo-600" />
            Create Partnership Stock Lot
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Register a new consignment stock intake or co-invested shared stock pool adhering to IFRS/GAAP sub-ledger standards.
          </p>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Archetype Selector */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div
              onClick={() => setArchetype("CO_INVESTED_POOL")}
              className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                archetype === "CO_INVESTED_POOL"
                  ? "border-indigo-600 bg-indigo-50/50 shadow-sm"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <div className="flex items-center gap-2 font-semibold text-gray-900">
                <ShieldCheck className="h-5 w-5 text-indigo-600" />
                Co-Invested Shared Pool
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Both parties pool capital. Pulling to shop retains Lot ID. Profit margin is dynamically split on downstream sales.
              </p>
            </div>

            <div
              onClick={() => setArchetype("CONSIGNMENT_VMI")}
              className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                archetype === "CONSIGNMENT_VMI"
                  ? "border-emerald-600 bg-emerald-50/50 shadow-sm"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <div className="flex items-center gap-2 font-semibold text-gray-900">
                <DollarSign className="h-5 w-5 text-emerald-600" />
                Consignment / VMI
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Partner owns 100% of stock. Zero initial GL entry. Inward pull posts Accounts Payable – Consignor; sales profit retained 100% by shop.
              </p>
            </div>
          </div>

          {/* Primary Details */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label className="text-xs font-semibold">Lot Number / Batch Ref</Label>
              <Input
                value={lotNumber}
                onChange={(e) => setLotNumber(e.target.value)}
                placeholder="e.g. LOT-2026-001"
                required
                className="mt-1"
              />
            </div>

            <div>
              <Label className="text-xs font-semibold">Partner / Consignor</Label>
              <select
                value={partnerId}
                onChange={(e) => setPartnerId(e.target.value)}
                className="w-full mt-1 px-3 py-2 text-sm border rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label className="text-xs font-semibold">
                Existing warehouse <span className="text-slate-500 font-normal">(where this stock already sits)</span>
              </Label>
              <select
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                className="w-full mt-1 px-3 py-2 text-sm border rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Margin Share for Co-Invested */}
          {archetype === "CO_INVESTED_POOL" && (
            <div className="p-3 bg-indigo-50/60 rounded-lg border border-indigo-100 flex items-center justify-between">
              <div>
                <Label className="text-xs font-semibold text-indigo-900">Partner Profit Margin Ratio</Label>
                <p className="text-xs text-indigo-700">Percentage of gross margin allocated to partner on sale</p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  value={partnerMarginRatio}
                  onChange={(e) => setPartnerMarginRatio(Number(e.target.value))}
                  className="w-24 text-right bg-white"
                />
                <span className="text-sm font-semibold text-indigo-900">
                  ({(partnerMarginRatio * 100).toFixed(0)}%)
                </span>
              </div>
            </div>
          )}

          {/* Items Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Lot Inventory Line Items
              </Label>
              <Button type="button" variant="outline" size="sm" onClick={handleAddItem} className="gap-1 h-7 text-xs">
                <Plus className="h-3.5 w-3.5" /> Add Product Line
              </Button>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Product</th>
                    <th className="px-3 py-2 text-right font-semibold w-28">Initial Qty</th>
                    <th className="px-3 py-2 text-right font-semibold w-32">Unit Cost (PKR)</th>
                    <th className="px-3 py-2 text-right font-semibold w-36">Total Cost</th>
                    <th className="px-2 py-2 text-center w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((it, idx) => (
                    <tr key={idx} className="hover:bg-gray-50/50">
                      <td className="px-3 py-2">
                        <select
                          value={it.productId}
                          onChange={(e) => handleItemChange(idx, "productId", e.target.value)}
                          className="w-full px-2 py-1 text-xs border rounded bg-white"
                        >
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.productNo} - {p.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min="1"
                          value={it.initialQuantity}
                          onChange={(e) => handleItemChange(idx, "initialQuantity", e.target.value)}
                          className="h-7 text-right text-xs"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={it.unitCostRate}
                          onChange={(e) => handleItemChange(idx, "unitCostRate", e.target.value)}
                          className="h-7 text-right text-xs"
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-medium">
                        PKR {(it.initialQuantity * it.unitCostRate).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-2 py-2 text-center">
                        <button
                          type="button"
                          disabled={items.length <= 1}
                          onClick={() => handleRemoveItem(idx)}
                          className="text-gray-400 hover:text-red-600 disabled:opacity-30"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Capital Summary */}
          <div className="grid grid-cols-3 gap-3 p-3 bg-gray-50 rounded-lg text-xs">
            <div>
              <span className="text-muted-foreground block">Total Capital Cost:</span>
              <span className="font-bold text-gray-900 text-sm">
                PKR {totalCapitalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block">Partner Contributed Capital:</span>
              <span className="font-bold text-indigo-600 text-sm">
                PKR {partnerCapital.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block">Entity Capital Share:</span>
              <span className="font-bold text-emerald-600 text-sm">
                PKR {entityCapital.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          <div>
            <Label className="text-xs font-semibold">Notes / Operational Memo</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Imported container consignment from mill"
              className="mt-1"
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} className="bg-indigo-600 hover:bg-indigo-700 text-white">
              {isSubmitting ? "Registering Lot..." : "Create Partnership Lot"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

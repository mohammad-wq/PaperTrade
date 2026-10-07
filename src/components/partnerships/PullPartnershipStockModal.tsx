"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { pullPartnershipLotStockAction } from "@/actions/partnerships";
import { Truck, ArrowRight, AlertCircle } from "lucide-react";
import { toast } from "@/lib/toast";
import { useRouter } from "next/navigation";

type LotItem = {
  id: string;
  productId: string;
  productNo: string;
  productName: string;
  unit: string;
  remainingQuantity: number;
  unitCostRate: number;
};

interface PullPartnershipStockModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lotId: string;
  lotNumber: string;
  lotType: "CONSIGNMENT_VMI" | "CO_INVESTED_POOL";
  partnerName: string;
  items: LotItem[];
  destinationLocations: Array<{
    id: string;
    name: string;
    lots?: Array<{ id: string; lotNumber: string; quantity: number }>;
  }>;
  sourceLots?: Array<{ id: string; lotNumber: string; quantity: number }>;
  linkedSourceLotId?: string | null;
}

export function PullPartnershipStockModal({
  open,
  onOpenChange,
  lotId,
  lotNumber,
  lotType,
  partnerName,
  items,
  destinationLocations,
  sourceLots = [],
  linkedSourceLotId = null,
}: PullPartnershipStockModalProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [destinationLocationId, setDestinationLocationId] = useState(destinationLocations[0]?.id || "");
  const [destinationWarehouseLotId, setDestinationWarehouseLotId] = useState("");
  const [sourceWarehouseLotId, setSourceWarehouseLotId] = useState(linkedSourceLotId || "");
  const [notes, setNotes] = useState("");
  const destinationLots =
    destinationLocations.find((location) => location.id === destinationLocationId)?.lots ?? [];

  const [pullQuantities, setPullQuantities] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    for (const it of items) {
      initial[it.productId] = 0;
    }
    return initial;
  });

  const handleQtyChange = (productId: string, val: number, max: number) => {
    setPullQuantities((prev) => ({
      ...prev,
      [productId]: Math.max(0, Math.min(val, max)),
    }));
  };

  const totalPullItems = items
    .filter((it) => (pullQuantities[it.productId] || 0) > 0)
    .map((it) => ({
      productId: it.productId,
      quantity: pullQuantities[it.productId] || 0,
      unitCostRate: it.unitCostRate,
      lineTotal: (pullQuantities[it.productId] || 0) * it.unitCostRate,
    }));

  const totalValuation = totalPullItems.reduce((s, it) => s + it.lineTotal, 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!destinationLocationId) {
      toast.error("Please select a destination shop location.");
      return;
    }
    if (destinationLots.length > 0 && !destinationWarehouseLotId) {
      toast.error("Select a lot at the destination. This location already has lots.");
      return;
    }
    if (!linkedSourceLotId && sourceLots.length > 0 && !sourceWarehouseLotId) {
      toast.error("Select the source lot at the partnership warehouse.");
      return;
    }
    if (totalPullItems.length === 0) {
      toast.error("Please enter a quantity greater than 0 for at least one item.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await pullPartnershipLotStockAction({
        lotId,
        destinationLocationId,
        destinationWarehouseLotId: destinationWarehouseLotId || null,
        sourceWarehouseLotId: sourceWarehouseLotId || linkedSourceLotId || null,
        items: totalPullItems.map((it) => ({
          productId: it.productId,
          quantity: it.quantity,
        })),
        notes: notes.trim() || null,
      });

      if (res.success && res.data) {
        toast.success(
          `Delivery Order ${res.data.doNo} generated! Pulled PKR ${res.data.valuation.toLocaleString()} into shop stock.`
        );
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error((res as any).error || "Failed to pull stock.");
      }
    } catch (err: any) {
      toast.error(err.message || "An unexpected error occurred.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <Truck className="h-5 w-5 text-indigo-600" />
            Transfer lot stock
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Move inventory from lot <strong className="text-gray-900">{lotNumber}</strong> to another location. Stock stays tagged to this lot for margin sharing on sales.
          </p>
        </DialogHeader>

        <div className="p-3 bg-indigo-50 rounded-lg border border-indigo-200 text-xs text-indigo-800 flex gap-2 items-start">
          <AlertCircle className="h-4 w-4 text-indigo-600 mt-0.5 shrink-0" />
          <div>
            <strong>Co-invested transfer:</strong> Destination keeps <strong>{lotNumber}</strong> ownership. No purchase invoice is created; profit is split when you sell from the destination.
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label className="text-xs font-semibold">Destination location</Label>
            <select
              value={destinationLocationId}
              onChange={(e) => {
                setDestinationLocationId(e.target.value);
                setDestinationWarehouseLotId("");
              }}
              className="w-full mt-1 px-3 py-2 text-sm border rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {destinationLocations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {destinationLots.length > 0 && (
            <div>
              <Label className="text-xs font-semibold">Destination lot</Label>
              <select
                value={destinationWarehouseLotId}
                onChange={(e) => setDestinationWarehouseLotId(e.target.value)}
                className="w-full mt-1 px-3 py-2 text-sm border rounded-md bg-white"
              >
                <option value="">Select lot</option>
                {destinationLots.map((lot) => (
                  <option key={lot.id} value={lot.id}>
                    Lot {lot.lotNumber} — {lot.quantity}
                  </option>
                ))}
              </select>
            </div>
          )}

          {!linkedSourceLotId && sourceLots.length > 0 && (
            <div>
              <Label className="text-xs font-semibold">Source lot</Label>
              <select
                value={sourceWarehouseLotId}
                onChange={(e) => setSourceWarehouseLotId(e.target.value)}
                className="w-full mt-1 px-3 py-2 text-sm border rounded-md bg-white"
              >
                <option value="">Select lot</option>
                {sourceLots.map((lot) => (
                  <option key={lot.id} value={lot.id}>
                    Lot {lot.lotNumber} — {lot.quantity}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Product</th>
                  <th className="px-3 py-2 text-right font-semibold">Available in Lot</th>
                  <th className="px-3 py-2 text-right font-semibold">Unit Cost</th>
                  <th className="px-3 py-2 text-right font-semibold w-32">Pull Quantity</th>
                  <th className="px-3 py-2 text-right font-semibold">Valuation</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((it) => {
                  const pullQty = pullQuantities[it.productId] || 0;
                  const lineValuation = pullQty * it.unitCostRate;

                  return (
                    <tr key={it.id} className="hover:bg-gray-50/50">
                      <td className="px-3 py-2">
                        <div className="font-semibold text-gray-900">{it.productName}</div>
                        <div className="text-[10px] text-muted-foreground">{it.productNo}</div>
                      </td>
                      <td className="px-3 py-2 text-right font-medium">
                        {it.remainingQuantity} {it.unit}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-600">
                        PKR {it.unitCostRate.toLocaleString()}
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min="0"
                          max={it.remainingQuantity}
                          value={pullQty === 0 ? "" : pullQty}
                          placeholder="0"
                          onChange={(e) =>
                            handleQtyChange(it.productId, Number(e.target.value), it.remainingQuantity)
                          }
                          className="h-8 text-right text-xs"
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-gray-900">
                        PKR {lineValuation.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg text-xs">
            <span className="font-medium text-gray-700">Total Inward Draw Valuation:</span>
            <span className="font-bold text-gray-900 text-sm">
              PKR {totalValuation.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
          </div>

          <div>
            <Label className="text-xs font-semibold">Delivery Order Notes / Transport Ref</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Counter requisition for immediate fulfillment"
              className="mt-1"
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || totalPullItems.length === 0}
              className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1"
            >
              {isSubmitting ? "Processing..." : "Generate Delivery Order (DO)"}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

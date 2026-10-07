"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { obtainVmiStockFromLotAction } from "@/actions/partnerships";
import { ShoppingCart } from "lucide-react";
import { toast } from "@/lib/toast";
import { useRouter } from "next/navigation";
import { getLocalDateTimeInputValue } from "@/lib/utils";

type LotItem = {
  productId: string;
  productName: string;
  unit: string;
  remainingQuantity: number;
  unitCostRate: number;
};

export function VmiObtainFromLotModal({
  open,
  onOpenChange,
  lotId,
  lotNumber,
  partnerName,
  items,
  destinationLocations,
  sourceLots = [],
  linkedSourceLotId = null,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  lotId: string;
  lotNumber: string;
  partnerName: string;
  items: LotItem[];
  destinationLocations: Array<{
    id: string;
    name: string;
    lots?: Array<{ id: string; lotNumber: string; quantity: number }>;
  }>;
  sourceLots?: Array<{ id: string; lotNumber: string; quantity: number }>;
  linkedSourceLotId?: string | null;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [destinationLocationId, setDestinationLocationId] = useState(destinationLocations[0]?.id || "");
  const [destinationWarehouseLotId, setDestinationWarehouseLotId] = useState("");
  const [sourceWarehouseLotId, setSourceWarehouseLotId] = useState(linkedSourceLotId || "");
  const destinationLots =
    destinationLocations.find((location) => location.id === destinationLocationId)?.lots ?? [];
  const [dateTime, setDateTime] = useState(() => getLocalDateTimeInputValue());
  const [amountPaid, setAmountPaid] = useState(0);
  const [notes, setNotes] = useState("");
  const [qty, setQty] = useState<Record<string, number>>(() =>
    Object.fromEntries(items.map((i) => [i.productId, 0])),
  );

  const lines = items
    .filter((i) => (qty[i.productId] || 0) > 0)
    .map((i) => ({ productId: i.productId, quantity: qty[i.productId]!, unitCost: i.unitCostRate }));
  const total = lines.reduce((s, l) => s + l.quantity * l.unitCost, 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!destinationLocationId) {
      toast.error("Select a destination location.");
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
    if (lines.length === 0) {
      toast.error("Enter quantity for at least one product.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await obtainVmiStockFromLotAction({
        lotId,
        destinationLocationId,
        destinationWarehouseLotId: destinationWarehouseLotId || null,
        sourceWarehouseLotId: sourceWarehouseLotId || linkedSourceLotId || null,
        date: new Date(dateTime),
        amountPaid,
        notes: notes.trim() || null,
        items: lines.map(({ productId, quantity }) => ({ productId, quantity })),
      });
      if (res.success) {
        toast.success(`Purchase ${res.data?.invoiceNo} posted — own stock at destination.`);
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error((res as any).error || "Failed.");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-emerald-600" />
            Purchase from partner (VMI)
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Buy consignment stock from <strong>{partnerName}</strong> on lot <strong>{lotNumber}</strong>. Stock becomes your own inventory at the destination.
          </p>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label className="text-xs">Destination location</Label>
            <select
              className="w-full border rounded-md text-xs px-2 py-2 mt-1"
              value={destinationLocationId}
              onChange={(e) => {
                setDestinationLocationId(e.target.value);
                setDestinationWarehouseLotId("");
              }}
            >
              {destinationLocations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          {destinationLots.length > 0 && (
            <div>
              <Label className="text-xs">Destination lot</Label>
              <select
                className="w-full border rounded-md text-xs px-2 py-2 mt-1"
                value={destinationWarehouseLotId}
                onChange={(e) => setDestinationWarehouseLotId(e.target.value)}
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
              <Label className="text-xs">Source lot</Label>
              <select
                className="w-full border rounded-md text-xs px-2 py-2 mt-1"
                value={sourceWarehouseLotId}
                onChange={(e) => setSourceWarehouseLotId(e.target.value)}
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
          <div>
            <Label className="text-xs">Date & time</Label>
            <Input type="datetime-local" value={dateTime} onChange={(e) => setDateTime(e.target.value)} className="mt-1" />
          </div>
          <div className="space-y-2 border rounded-md p-2">
            {items.map((it) => (
              <div key={it.productId} className="flex items-center justify-between gap-2 text-xs">
                <span>
                  {it.productName} <span className="text-muted-foreground">({it.remainingQuantity} {it.unit})</span>
                </span>
                <Input
                  type="number"
                  min={0}
                  max={it.remainingQuantity}
                  className="h-8 w-24 text-right"
                  value={qty[it.productId] || 0}
                  onChange={(e) => setQty((p) => ({ ...p, [it.productId]: Number(e.target.value) }))}
                />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Amount paid (PKR)</Label>
              <Input type="number" min={0} value={amountPaid} onChange={(e) => setAmountPaid(Number(e.target.value))} className="mt-1" />
            </div>
            <div className="text-xs flex items-end justify-end font-bold">Total: PKR {total.toLocaleString()}</div>
          </div>
          <Input placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} className="bg-emerald-700 hover:bg-emerald-800 text-white">
              {submitting ? "Posting…" : "Post purchase invoice"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

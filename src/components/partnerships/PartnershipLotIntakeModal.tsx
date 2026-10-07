"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { partnershipLotIntakeAction } from "@/actions/partnerships";
import { listProductsAction } from "@/actions/products";
import { Plus, Trash2, Package } from "lucide-react";
import { toast } from "@/lib/toast";
import { useRouter } from "next/navigation";
import { getLocalDateTimeInputValue } from "@/lib/utils";

type Line = { productId: string; quantity: number; unitCostRate: number };

export function PartnershipLotIntakeModal({
  open,
  onOpenChange,
  lotId,
  lotNumber,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  lotId: string;
  lotNumber: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [products, setProducts] = useState<Array<{ id: string; productNo: string; name: string; costPrice: number }>>([]);
  const [dateTime, setDateTime] = useState(() => getLocalDateTimeInputValue());
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ productId: "", quantity: 10, unitCostRate: 0 }]);

  useEffect(() => {
    if (!open) return;
    listProductsAction().then((res) => {
      if (res.success && res.data) {
        setProducts(res.data as any);
        if (res.data[0] && !lines[0]?.productId) {
          setLines([{ productId: res.data[0].id, quantity: 10, unitCostRate: Number(res.data[0].costPrice) || 0 }]);
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const valid = lines.filter((l) => l.productId && l.quantity > 0);
    if (valid.length === 0) {
      toast.error("Add at least one product line.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await partnershipLotIntakeAction({
        lotId,
        date: new Date(dateTime),
        notes: notes.trim() || null,
        items: valid,
      });
      if (res.success) {
        toast.success(`Intake posted to lot ${lotNumber}.`);
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error((res as any).error || "Intake failed.");
      }
    } catch (err: any) {
      toast.error(err.message || "Intake failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-indigo-600" />
            Intake into lot {lotNumber}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">Add partner stock to this lot at the rental warehouse (not a purchase invoice).</p>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label className="text-xs">Date & time</Label>
            <Input type="datetime-local" value={dateTime} onChange={(e) => setDateTime(e.target.value)} className="mt-1" />
          </div>
          {lines.map((line, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-6">
                <Label className="text-[10px]">Product</Label>
                <select
                  className="w-full border rounded-md text-xs px-2 py-2 mt-0.5"
                  value={line.productId}
                  onChange={(e) => {
                    const p = products.find((x) => x.id === e.target.value);
                    setLines((prev) =>
                      prev.map((row, i) =>
                        i === idx
                          ? { ...row, productId: e.target.value, unitCostRate: p ? Number(p.costPrice) : row.unitCostRate }
                          : row,
                      ),
                    );
                  }}
                >
                  <option value="">Select…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.productNo} — {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <Label className="text-[10px]">Qty</Label>
                <Input
                  type="number"
                  min={0.0001}
                  value={line.quantity}
                  onChange={(e) =>
                    setLines((prev) => prev.map((row, i) => (i === idx ? { ...row, quantity: Number(e.target.value) } : row)))
                  }
                  className="h-8 text-xs mt-0.5"
                />
              </div>
              <div className="col-span-3">
                <Label className="text-[10px]">Unit cost</Label>
                <Input
                  type="number"
                  min={0}
                  value={line.unitCostRate}
                  onChange={(e) =>
                    setLines((prev) => prev.map((row, i) => (i === idx ? { ...row, unitCostRate: Number(e.target.value) } : row)))
                  }
                  className="h-8 text-xs mt-0.5"
                />
              </div>
              <div className="col-span-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={lines.length <= 1}
                  onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                  className="h-8 p-0 text-rose-500"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setLines((p) => [...p, { productId: products[0]?.id || "", quantity: 1, unitCostRate: 0 }])} className="text-xs gap-1">
            <Plus className="h-3 w-3" /> Add line
          </Button>
          <div>
            <Label className="text-xs">Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} className="bg-indigo-600 hover:bg-indigo-700 text-white">
              {submitting ? "Posting…" : "Post intake"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

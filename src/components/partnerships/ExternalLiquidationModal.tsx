"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recordExternalPartnerLiquidationAction } from "@/actions/partnerships";
import { ShoppingCart, ArrowRight, Plus, Trash2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { useRouter } from "next/navigation";
import { getLocalDateTimeInputValue } from "@/lib/utils";

type LotItem = {
  id: string;
  productId: string;
  productNo: string;
  productName: string;
  unit: string;
  remainingQuantity: number;
  unitCostRate: number;
};

type LineRow = { productId: string; quantity: number; realizedRate: number };

interface ExternalLiquidationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lotId: string;
  lotNumber: string;
  partnerName: string;
  partnerMarginRatio: number;
  items: LotItem[];
}

export function ExternalLiquidationModal({
  open,
  onOpenChange,
  lotId,
  lotNumber,
  partnerName,
  partnerMarginRatio,
  items,
}: ExternalLiquidationModalProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lines, setLines] = useState<LineRow[]>(() => {
    const first = items[0];
    return first
      ? [{ productId: first.productId, quantity: 10, realizedRate: Math.round(first.unitCostRate * 1.4) }]
      : [];
  });
  const [partnerExpenses, setPartnerExpenses] = useState<number>(0);
  const [expenseDescription, setExpenseDescription] = useState("");
  const [dateTime, setDateTime] = useState(() => getLocalDateTimeInputValue());
  const [notes, setNotes] = useState("");

  const totals = lines.reduce(
    (acc, line) => {
      const it = items.find((i) => i.productId === line.productId);
      const cost = it?.unitCostRate ?? 0;
      const rev = line.quantity * line.realizedRate;
      const cogs = line.quantity * cost;
      const gm = rev - cogs;
      acc.revenue += rev;
      acc.cogs += cogs;
      acc.margin += gm;
      acc.partner += gm * partnerMarginRatio;
      return acc;
    },
    { revenue: 0, cogs: 0, margin: 0, partner: 0 },
  );

  const addLine = () => {
    const first = items[0];
    if (!first) return;
    setLines((prev) => [
      ...prev,
      { productId: first.productId, quantity: 1, realizedRate: Math.round(first.unitCostRate * 1.4) },
    ]);
  };

  const updateLine = (idx: number, patch: Partial<LineRow>) => {
    setLines((prev) => prev.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lines.length === 0) {
      toast.error("Add at least one product line.");
      return;
    }
    for (const line of lines) {
      const it = items.find((i) => i.productId === line.productId);
      if (!it) {
        toast.error("Invalid product on a line.");
        return;
      }
      if (line.quantity <= 0 || line.realizedRate <= 0) {
        toast.error("Each line needs quantity and rate greater than zero.");
        return;
      }
      if (line.quantity > it.remainingQuantity) {
        toast.error(`${it.productName}: max ${it.remainingQuantity} ${it.unit}.`);
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const res = await recordExternalPartnerLiquidationAction({
        lotId,
        items: lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          realizedRate: l.realizedRate,
        })),
        partnerExpenses: partnerExpenses > 0 ? partnerExpenses : undefined,
        expenseDescription: expenseDescription.trim() || undefined,
        date: new Date(dateTime),
        notes: notes.trim() || null,
      });

      if (res.success) {
        toast.success("Partner liquidation recorded.");
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error((res as any).error || "Failed to record liquidation.");
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
            <ShoppingCart className="h-5 w-5 text-indigo-600" />
            Record Partner External Liquidation
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Stock sold by <strong className="text-gray-900">{partnerName}</strong> from lot{" "}
            <strong className="text-gray-900">{lotNumber}</strong> (warehouse).
          </p>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label className="text-xs font-semibold">Liquidation date & time</Label>
            <Input
              type="datetime-local"
              value={dateTime}
              onChange={(e) => setDateTime(e.target.value)}
              required
              className="mt-1"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-bold uppercase tracking-wide">Product lines</Label>
              <Button type="button" variant="outline" size="sm" onClick={addLine} className="h-7 text-xs gap-1">
                <Plus className="h-3 w-3" /> Add line
              </Button>
            </div>
            {lines.map((line, idx) => {
              const it = items.find((i) => i.productId === line.productId);
              return (
                <div key={idx} className="grid grid-cols-12 gap-2 items-end border rounded-md p-2 bg-slate-50/80">
                  <div className="col-span-5">
                    <Label className="text-[10px]">Product</Label>
                    <select
                      value={line.productId}
                      onChange={(e) => {
                        const found = items.find((i) => i.productId === e.target.value);
                        updateLine(idx, {
                          productId: e.target.value,
                          realizedRate: found ? Math.round(found.unitCostRate * 1.4) : line.realizedRate,
                        });
                      }}
                      className="w-full mt-0.5 px-2 py-1.5 text-xs border rounded-md bg-white"
                    >
                      {items.map((i) => (
                        <option key={i.productId} value={i.productId}>
                          {i.productName} ({i.remainingQuantity} {i.unit})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-[10px]">Qty</Label>
                    <Input
                      type="number"
                      min={1}
                      max={it?.remainingQuantity ?? 99999}
                      value={line.quantity}
                      onChange={(e) => updateLine(idx, { quantity: Number(e.target.value) })}
                      className="h-8 text-xs mt-0.5"
                    />
                  </div>
                  <div className="col-span-3">
                    <Label className="text-[10px]">Rate (PKR)</Label>
                    <Input
                      type="number"
                      min={0.01}
                      step="0.01"
                      value={line.realizedRate}
                      onChange={(e) => updateLine(idx, { realizedRate: Number(e.target.value) })}
                      className="h-8 text-xs mt-0.5"
                    />
                  </div>
                  <div className="col-span-2 flex justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={lines.length <= 1}
                      onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                      className="h-8 w-8 p-0 text-rose-500"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-3 bg-gray-50 rounded-lg space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Gross realization:</span>
              <span className="font-semibold">PKR {totals.revenue.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">COGS:</span>
              <span className="font-semibold">PKR {totals.cogs.toLocaleString()}</span>
            </div>
            <div className="flex justify-between border-t pt-1 font-bold">
              <span>Gross margin:</span>
              <span>PKR {totals.margin.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-indigo-700">
              <span>Partner share ({(partnerMarginRatio * 100).toFixed(0)}%):</span>
              <span>PKR {totals.partner.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-emerald-700">
              <span>Shop retained:</span>
              <span>PKR {(totals.margin - totals.partner).toLocaleString()}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 border-t pt-3">
            <div>
              <Label className="text-xs font-semibold">Partner expenses (PKR)</Label>
              <Input
                type="number"
                min={0}
                value={partnerExpenses}
                onChange={(e) => setPartnerExpenses(Number(e.target.value))}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs font-semibold">Expense description</Label>
              <Input
                value={expenseDescription}
                onChange={(e) => setExpenseDescription(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs font-semibold">Buyer / reference notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1" />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || lines.length === 0}
              className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1"
            >
              {isSubmitting ? "Recording..." : "Post liquidation"}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

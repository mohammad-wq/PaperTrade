"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recordExternalPartnerLiquidationAction } from "@/actions/partnerships";
import { ShoppingCart, ArrowRight } from "lucide-react";
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
  const [productId, setProductId] = useState(items[0]?.productId || "");
  const [quantity, setQuantity] = useState<number>(10);
  const [realizedRate, setRealizedRate] = useState<number>(1400);
  const [partnerExpenses, setPartnerExpenses] = useState<number>(0);
  const [expenseDescription, setExpenseDescription] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  const selectedItem = items.find((it) => it.productId === productId) || items[0];
  const unitCost = selectedItem?.unitCostRate || 0;
  const grossMargin = (realizedRate - unitCost) * quantity;
  const partnerMarginShare = grossMargin * partnerMarginRatio;
  const entityMarginShare = grossMargin - partnerMarginShare;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productId) {
      toast.error("Please select a product.");
      return;
    }
    if (quantity <= 0) {
      toast.error("Quantity must be greater than 0.");
      return;
    }
    if (selectedItem && quantity > selectedItem.remainingQuantity) {
      toast.error(`Quantity exceeds available stock (${selectedItem.remainingQuantity} ${selectedItem.unit}).`);
      return;
    }
    if (realizedRate <= 0) {
      toast.error("Realized sale rate must be greater than 0.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await recordExternalPartnerLiquidationAction({
        lotId,
        productId,
        quantity,
        realizedRate,
        partnerExpenses: partnerExpenses > 0 ? partnerExpenses : undefined,
        expenseDescription: expenseDescription.trim() || undefined,
        date: new Date(date),
        notes: notes.trim() || null,
      });

      if (res.success) {
        toast.success(`External liquidation of ${quantity} units recorded successfully!`);
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
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <ShoppingCart className="h-5 w-5 text-indigo-600" />
            Record Partner External Liquidation
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Stock sold directly by <strong className="text-gray-900">{partnerName}</strong> off rental warehouse Lot{" "}
            <strong className="text-gray-900">{lotNumber}</strong>.
          </p>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-semibold">Product</Label>
              <select
                value={productId}
                onChange={(e) => {
                  setProductId(e.target.value);
                  const found = items.find((i) => i.productId === e.target.value);
                  if (found) {
                    setRealizedRate(Math.round(found.unitCostRate * 1.3));
                  }
                }}
                className="w-full mt-1 px-3 py-2 text-sm border rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {items.map((it) => (
                  <option key={it.productId} value={it.productId}>
                    {it.productName} ({it.remainingQuantity} {it.unit} avail)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label className="text-xs font-semibold">Liquidation Date</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className="mt-1"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-semibold">Quantity Sold by Partner</Label>
              <Input
                type="number"
                min="1"
                max={selectedItem?.remainingQuantity || 99999}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                required
                className="mt-1"
              />
              <span className="text-[10px] text-muted-foreground">
                Max available: {selectedItem?.remainingQuantity} {selectedItem?.unit}
              </span>
            </div>

            <div>
              <Label className="text-xs font-semibold">Realized Selling Rate (PKR)</Label>
              <Input
                type="number"
                min="1"
                step="0.01"
                value={realizedRate}
                onChange={(e) => setRealizedRate(Number(e.target.value))}
                required
                className="mt-1"
              />
              <span className="text-[10px] text-muted-foreground">
                Lot unit cost: PKR {unitCost.toLocaleString()}
              </span>
            </div>
          </div>

          {/* Margin Calculation Preview */}
          <div className="p-3 bg-gray-50 rounded-lg space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Gross Realization (Revenue):</span>
              <span className="font-semibold">PKR {(quantity * realizedRate).toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Cost of Goods Sold (COGS):</span>
              <span className="font-semibold">PKR {(quantity * unitCost).toLocaleString()}</span>
            </div>
            <div className="flex justify-between border-t pt-1">
              <span className="font-semibold text-gray-700">Gross Margin Realized:</span>
              <span className="font-bold text-gray-900">PKR {grossMargin.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-indigo-700 font-semibold">
              <span>Partner Margin Share ({(partnerMarginRatio * 100).toFixed(0)}%):</span>
              <span>PKR {partnerMarginShare.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-emerald-700 font-semibold">
              <span>Shop Retained Margin:</span>
              <span>PKR {entityMarginShare.toLocaleString()}</span>
            </div>
          </div>

          {/* Partner Expenses */}
          <div className="border-t pt-3 space-y-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-semibold">Partner Out-of-Pocket Expenses (PKR)</Label>
                <Input
                  type="number"
                  min="0"
                  value={partnerExpenses}
                  onChange={(e) => setPartnerExpenses(Number(e.target.value))}
                  placeholder="0"
                  className="mt-1"
                />
              </div>

              <div>
                <Label className="text-xs font-semibold">Expense Description</Label>
                <Input
                  value={expenseDescription}
                  onChange={(e) => setExpenseDescription(e.target.value)}
                  placeholder="e.g. Loading & transport to buyer"
                  className="mt-1"
                />
              </div>
            </div>
          </div>

          <div>
            <Label className="text-xs font-semibold">Buyer / Reference Notes</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Sold to local packaging mill"
              className="mt-1"
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || quantity <= 0}
              className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1"
            >
              {isSubmitting ? "Recording..." : "Post Liquidation Entry"}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

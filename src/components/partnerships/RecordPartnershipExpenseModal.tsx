"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recordPartnershipExpenseAction } from "@/actions/partnerships";
import { Receipt, ArrowRight } from "lucide-react";
import { toast } from "@/lib/toast";
import { useRouter } from "next/navigation";

interface RecordPartnershipExpenseModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lotId: string;
  lotNumber: string;
  partnerName: string;
}

export function RecordPartnershipExpenseModal({
  open,
  onOpenChange,
  lotId,
  lotNumber,
  partnerName,
}: RecordPartnershipExpenseModalProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [category, setCategory] = useState("Warehouse Rent");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState<number>(0);
  const [paidBy, setPaidBy] = useState<"ENTITY" | "PARTNER">("ENTITY");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) {
      toast.error("Please enter a description.");
      return;
    }
    if (amount <= 0) {
      toast.error("Amount must be greater than 0.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await recordPartnershipExpenseAction({
        lotId,
        category,
        description: description.trim(),
        amount,
        paidBy,
        date: new Date(date),
      });

      if (res.success) {
        toast.success(`Expense of PKR ${amount.toLocaleString()} recorded successfully!`);
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error((res as any).error || "Failed to record expense.");
      }
    } catch (err: any) {
      toast.error(err.message || "An unexpected error occurred.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <Receipt className="h-5 w-5 text-indigo-600" />
            Record Partnership Lot Expense
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Attach carrying or holding costs to Lot <strong className="text-gray-900">{lotNumber}</strong>.
          </p>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-semibold">Expense Category</Label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full mt-1 px-3 py-2 text-sm border rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="Warehouse Rent">Warehouse Rent</option>
                <option value="Handling & Labor">Handling & Labor</option>
                <option value="Freight Inward">Freight Inward</option>
                <option value="Carrying Cost">Carrying Cost</option>
              </select>
            </div>

            <div>
              <Label className="text-xs font-semibold">Expense Date</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className="mt-1"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs font-semibold">Paid By</Label>
            <div className="grid grid-cols-2 gap-3 mt-1">
              <button
                type="button"
                onClick={() => setPaidBy("ENTITY")}
                className={`py-2 px-3 text-xs font-semibold rounded-lg border text-center transition-all ${
                  paidBy === "ENTITY"
                    ? "bg-indigo-50 border-indigo-600 text-indigo-700 shadow-sm"
                    : "border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                Entity / Shop Floor
              </button>
              <button
                type="button"
                onClick={() => setPaidBy("PARTNER")}
                className={`py-2 px-3 text-xs font-semibold rounded-lg border text-center transition-all ${
                  paidBy === "PARTNER"
                    ? "bg-indigo-50 border-indigo-600 text-indigo-700 shadow-sm"
                    : "border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                Partner ({partnerName})
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              {paidBy === "PARTNER"
                ? "Expense will be factored as a reimbursement credit in the net settlement position."
                : "Entity incurred expense on lot upkeep."}
            </p>
          </div>

          <div>
            <Label className="text-xs font-semibold">Amount (PKR)</Label>
            <Input
              type="number"
              min="1"
              step="0.01"
              value={amount === 0 ? "" : amount}
              placeholder="0.00"
              onChange={(e) => setAmount(Number(e.target.value))}
              required
              className="mt-1"
            />
          </div>

          <div>
            <Label className="text-xs font-semibold">Description / Voucher Memo</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Forklift offloading charges at rental warehouse"
              required
              className="mt-1"
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || amount <= 0}
              className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1"
            >
              {isSubmitting ? "Recording..." : "Save Expense"}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

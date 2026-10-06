"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recordPartnerSettlementPayoutAction } from "@/actions/partnerships";
import { Banknote, ArrowRight } from "lucide-react";
import { toast } from "@/lib/toast";
import { useRouter } from "next/navigation";
import { PaymentMethod } from "@prisma/client";

interface SettlementPayoutModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lotId: string;
  lotNumber: string;
  partnerName: string;
  suggestedAmount: number;
}

export function SettlementPayoutModal({
  open,
  onOpenChange,
  lotId,
  lotNumber,
  partnerName,
  suggestedAmount,
}: SettlementPayoutModalProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [amount, setAmount] = useState<number>(suggestedAmount > 0 ? suggestedAmount : 0);
  const [method, setMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (amount <= 0) {
      toast.error("Payout amount must be greater than 0.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await recordPartnerSettlementPayoutAction({
        lotId,
        amount,
        method,
        date: new Date(date),
        notes: notes.trim() || null,
      });

      if (res.success && res.data) {
        toast.success(`Settlement payout receipt ${res.data.receiptNo} created!`);
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error((res as any).error || "Failed to record payout.");
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
            <Banknote className="h-5 w-5 text-emerald-600" />
            Record Partner Settlement Payout
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Disburse profit margin share or consignment payable to <strong className="text-gray-900">{partnerName}</strong> for Lot{" "}
            <strong className="text-gray-900">{lotNumber}</strong>.
          </p>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="p-3 bg-gray-50 rounded-lg text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Outstanding Net Settlement:</span>
              <span className="font-bold text-gray-900">
                PKR {suggestedAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Debit: Accounts Payable (Reduces liability) | Credit: Cash / Bank Account.
            </p>
          </div>

          <div>
            <Label className="text-xs font-semibold">Payout Amount (PKR)</Label>
            <Input
              type="number"
              min="1"
              step="0.01"
              value={amount === 0 ? "" : amount}
              placeholder="0.00"
              onChange={(e) => setAmount(Number(e.target.value))}
              required
              className="mt-1 font-semibold text-base"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-semibold">Payment Method</Label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                className="w-full mt-1 px-3 py-2 text-sm border rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value={PaymentMethod.CASH}>Cash Account</option>
                <option value={PaymentMethod.BANK}>Bank Transfer</option>
                <option value={PaymentMethod.CHEQUE}>Cheque</option>
              </select>
            </div>

            <div>
              <Label className="text-xs font-semibold">Payment Date</Label>
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
            <Label className="text-xs font-semibold">Voucher / Bank Cheque Reference</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Bank slip #98234 / Cash voucher"
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
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
            >
              {isSubmitting ? "Disbursing..." : "Confirm & Post Payout"}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

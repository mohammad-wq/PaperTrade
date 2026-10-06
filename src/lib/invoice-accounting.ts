import { AccountType, LedgerAccountSubtype, PaymentMethod } from "@prisma/client";
import { JournalLineInput } from "@/lib/ledger";
import { getPaymentDestination } from "@/lib/payment-destinations";

export function allocateInwardFreightToLines(
  items: Array<{ quantity: number; unitCost: number }>,
  freight: number,
): number[] {
  if (freight <= 0 || items.length === 0) {
    return items.map((i) => i.unitCost);
  }
  const subtotal = items.reduce((s, i) => s + i.quantity * i.unitCost, 0);
  if (subtotal <= 0) {
    const perLine = freight / items.length;
    return items.map((i) => i.unitCost + perLine / Math.max(i.quantity, 1));
  }
  return items.map((item) => {
    const lineBase = item.quantity * item.unitCost;
    const freightShare = (lineBase / subtotal) * freight;
    return item.unitCost + freightShare / Math.max(item.quantity, 1);
  });
}

export function buildOwnedPurchaseJournalLines(params: {
  items: Array<{ productId: string; quantity: number; unitCost: number; description: string }>;
  freight: number;
  layerUnitCosts: number[];
  paidAmount: number;
  splits: Array<{ method: PaymentMethod; amount: number; reference: string | null }>;
  supplierId: string;
  partnershipId: string | null;
  isPartnership: boolean;
  unpaidBalance: number;
  isPartnerCapitalInjection: boolean;
  invoiceNo: string;
}): JournalLineInput[] {
  const lines: JournalLineInput[] = [];

  params.items.forEach((item, idx) => {
    const layerUnit = params.layerUnitCosts[idx] ?? item.unitCost;
    const lineTotal = item.quantity * layerUnit;
    lines.push({
      accountType: AccountType.INVENTORY,
      debit: lineTotal,
      credit: 0,
      description: `Inventory asset: ${params.invoiceNo} - ${item.description} @ ${layerUnit.toFixed(2)}`,
      isPartnership: params.isPartnership,
      partnershipId: params.partnershipId,
    });
  });

  if (params.paidAmount > 0) {
    for (const split of params.splits) {
      if (split.amount <= 0) continue;
      const dest = getPaymentDestination(split.method);
      lines.push({
        accountType: dest.accountType,
        debit: 0,
        credit: split.amount,
        description: `Cash / Bank disbursed: ${params.invoiceNo} (${dest.accountName})`,
        isPartnership: params.isPartnership,
        partnershipId: params.partnershipId,
      });
    }
  }

  if (params.unpaidBalance > 0.001) {
    lines.push({
      partyId:
        params.isPartnerCapitalInjection && params.partnershipId
          ? params.partnershipId
          : params.supplierId,
      accountType: AccountType.PAYABLE,
      accountSubtype: LedgerAccountSubtype.TRADE_PAYABLE,
      debit: 0,
      credit: params.unpaidBalance,
      description: params.isPartnerCapitalInjection
        ? `Partner capital payable: ${params.invoiceNo}`
        : `Accounts Payable: ${params.invoiceNo}`,
      isPartnership: params.isPartnership,
      partnershipId: params.partnershipId,
    });
  }

  return lines;
}

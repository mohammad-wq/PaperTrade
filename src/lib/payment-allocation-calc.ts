export type InvoiceAllocationItem = {
  invoiceId: string;
  invoiceNo: string;
  sequenceNo?: number | null;
  date: Date | string;
  invType: "SALE" | "PURCHASE";
  totalAmount: number;
  currentPaid: number;
  totalDue: number;
  allocatedNow: number;
  newBalance: number;
  newStatus: "PAID" | "PARTIAL" | "UNPAID";
};

export type AllocationPreviewResult = {
  allocations: InvoiceAllocationItem[];
  totalAllocated: number;
  unallocatedCredit: number;
};

/**
 * Pure calculation engine for payment allocation against open invoices.
 * Supports targeted invoice with overflow, manual override amounts, and FIFO auto-settlement.
 */
export function simulateFifoAllocation(
  openInvoices: InvoiceAllocationItem[],
  paymentAmount: number,
  targetInvoiceId?: string | null,
  manualAllocations?: Array<{ invoiceId: string; amount: number }>,
): AllocationPreviewResult {
  const amountToAllocate = Math.max(0, Number(paymentAmount) || 0);

  // Case 1: Manual Override
  if (manualAllocations && manualAllocations.length > 0) {
    const manualMap = new Map<string, number>();
    for (const m of manualAllocations) {
      if (m.amount > 0) {
        manualMap.set(m.invoiceId, m.amount);
      }
    }

    const results: InvoiceAllocationItem[] = [];
    let totalAllocated = 0;

    for (const inv of openInvoices) {
      if (manualMap.has(inv.invoiceId)) {
        const requestedAmount = manualMap.get(inv.invoiceId)!;
        const allocated = Math.min(inv.totalDue, requestedAmount);
        const newBalance = Math.max(0, inv.totalDue - allocated);
        const newStatus = newBalance <= 0.001 ? "PAID" : "PARTIAL";

        results.push({
          ...inv,
          allocatedNow: allocated,
          newBalance,
          newStatus,
        });
        totalAllocated += allocated;
      }
    }

    const unallocatedCredit = Math.max(0, amountToAllocate - totalAllocated);
    return {
      allocations: results,
      totalAllocated,
      unallocatedCredit,
    };
  }

  // Case 2: FIFO Auto-Settlement (with optional Targeted Invoice First)
  let remainingPayment = amountToAllocate;
  const results: InvoiceAllocationItem[] = [];
  const processedInvoiceIds = new Set<string>();

  // 2A: Targeted Invoice First
  if (targetInvoiceId) {
    const target = openInvoices.find((i) => i.invoiceId === targetInvoiceId);
    if (target && target.totalDue > 0.001 && remainingPayment > 0.001) {
      const allocated = Math.min(remainingPayment, target.totalDue);
      const newBalance = Math.max(0, target.totalDue - allocated);
      const newStatus = newBalance <= 0.001 ? "PAID" : "PARTIAL";

      results.push({
        ...target,
        allocatedNow: allocated,
        newBalance,
        newStatus,
      });

      remainingPayment -= allocated;
      processedInvoiceIds.add(target.invoiceId);
    }
  }

  // 2B: Overflow to remaining open invoices in FIFO order (oldest first)
  for (const inv of openInvoices) {
    if (processedInvoiceIds.has(inv.invoiceId)) continue;
    if (remainingPayment <= 0.001) break;

    const allocated = Math.min(remainingPayment, inv.totalDue);
    if (allocated > 0) {
      const newBalance = Math.max(0, inv.totalDue - allocated);
      const newStatus = newBalance <= 0.001 ? "PAID" : "PARTIAL";

      results.push({
        ...inv,
        allocatedNow: allocated,
        newBalance,
        newStatus,
      });

      remainingPayment -= allocated;
      processedInvoiceIds.add(inv.invoiceId);
    }
  }

  const totalAllocated = results.reduce((sum, r) => sum + r.allocatedNow, 0);
  const unallocatedCredit = Math.max(0, remainingPayment);

  return {
    allocations: results,
    totalAllocated,
    unallocatedCredit,
  };
}

import type { PaymentMethod } from "@prisma/client";

export const WALK_IN_LEDGER_LABEL = "Walk-in Customer";

/** Single ledger filter value: all walk-in sales in one list. */
export const WALK_IN_LEDGER_FILTER_ALL = "__ALL_WALK_INS__";

export function isWalkInSaleInvoiceRow(row: {
  walkInName?: string | null;
  customer?: { name: string } | null;
}): boolean {
  if (row.walkInName?.trim()) return true;
  const cname = row.customer?.name?.trim() || "";
  if (!cname) return false;
  return cname === WALK_IN_LEDGER_LABEL || isGenericWalkInName(cname);
}

export function isGenericWalkInName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return (
    n === "walk-in customer" ||
    n === "walk in" ||
    n === "walk in customer" ||
    n === "cash customer"
  );
}

/** Label shown in ledger party dropdown and used for walk-in filters. */
export function walkInDisplayLabel(walkInName: string | null | undefined): string {
  const raw = walkInName?.trim();
  if (!raw || isGenericWalkInName(raw)) return WALK_IN_LEDGER_LABEL;
  return raw;
}

export function formatLedgerPaymentMethodLabel(method: PaymentMethod | string): string {
  const m = String(method).toUpperCase();
  if (m === "CASH" || m.includes("CASH ON HAND")) return "Cash";
  if (m === "CHEQUE" || m.includes("CHEQUE")) return "Cheque";
  if (m === "JAZZCASH" || m.includes("JAZZ")) return "JazzCash";
  if (m === "EASYPAISA" || m.includes("EASY")) return "Easypaisa";
  if (m === "BANK" || m.includes("BANK")) return "Bank";
  if (m === "OTHER") return "Other";
  return "Bank";
}

function ledgerMoney(amount: number): string {
  return Math.abs(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Second line for one journal row: this product or this payment, not the whole invoice. */
export function specificLedgerLineLabel(description: string, amount: number): string {
  const desc = (description || "").trim();
  const amt = ledgerMoney(amount);
  if (!desc) return amt;

  if (/cash\s*\/\s*bank|disbursed|payment received|received:/i.test(desc) && !/\[/.test(desc.split("(")[0] || "")) {
    const mode = desc.match(/\(([^)]+)\)\s*$/);
    return `${formatLedgerPaymentMethodLabel(mode?.[1] || "CASH")}  ${amt}`;
  }

  if (/remaining balance|accounts payable|accounts receivable|partner capital payable|balance due/i.test(desc)) {
    return `Balance due  ${amt}`;
  }

  if (/freight/i.test(desc)) return `Freight  ${amt}`;

  const product = desc.match(/\[([^\]]+)\]\s*([^(\n]+?)\s*\((?:Qty:\s*)?([\d.,]+)\s+([^)]+)\)/i);
  if (product) {
    const name = product[2].trim();
    const qty = product[3];
    const unit = product[4].trim();
    return `${name}  ${qty} ${unit}  ${amt}`;
  }

  return desc
    .replace(/^(?:Payable to|Receivable from)\s+(?:vendor|supplier|customer)\s+.+?\s+for\s+/i, "")
    .replace(/^Payment (?:to|from)\s+.+?\s+[—–-]\s*/i, "")
    .trim();
}

export type CommercialPaymentLine = {
  method: string;
  label: string;
  amount: number;
};

type InvoicePaymentRow = {
  amount: unknown;
  method: PaymentMethod;
  splits?: Array<{ method: PaymentMethod; amount: unknown }> | null;
};

export function extractCommercialPaymentLines(
  payments: InvoicePaymentRow[] | undefined | null,
  fallbackPaid: number,
): CommercialPaymentLine[] {
  const lines: CommercialPaymentLine[] = [];
  for (const p of payments ?? []) {
    if (p.splits && p.splits.length > 0) {
      for (const s of p.splits) {
        const amount = Number(s.amount);
        if (amount > 0.0001) {
          lines.push({
            method: s.method,
            label: formatLedgerPaymentMethodLabel(s.method),
            amount,
          });
        }
      }
    } else {
      const amount = Number(p.amount);
      if (amount > 0.0001) {
        lines.push({
          method: p.method,
          label: formatLedgerPaymentMethodLabel(p.method),
          amount,
        });
      }
    }
  }
  if (lines.length === 0 && fallbackPaid > 0.0001) {
    lines.push({
      method: "CASH",
      label: formatLedgerPaymentMethodLabel("CASH"),
      amount: fallbackPaid,
    });
  }
  return lines;
}

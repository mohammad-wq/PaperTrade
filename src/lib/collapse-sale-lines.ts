export type CollapsibleSaleLine = {
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  lot?: string | null;
};

/** One printed row per product and unit price. Quantity and amount are summed. */
export function collapseSalePrintLines<T extends CollapsibleSaleLine>(items: T[]): T[] {
  const grouped = new Map<string, T>();
  for (const item of items) {
    const key = `${item.name}|${Number(item.unitPrice).toFixed(4)}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...item, lot: null });
      continue;
    }
    existing.quantity += Number(item.quantity);
    existing.lineTotal += Number(item.lineTotal);
    existing.lot = null;
  }
  return [...grouped.values()];
}

"use client";

import { useEffect, useState } from "react";
import { listSaleOwnershipBucketsAction } from "@/actions/inventory";

type Bucket = {
  ownershipKey: string;
  label: string;
  quantity: number;
};

export function BatchSelect({
  productId,
  locationId,
  value,
  onChange,
  unit,
}: {
  productId: string;
  locationId: string;
  value: string;
  onChange: (ownershipKey: string, quantity: number) => void;
  unit?: string;
}) {
  const [buckets, setBuckets] = useState<Bucket[]>([]);

  useEffect(() => {
    if (!productId || !locationId) {
      setBuckets([]);
      return;
    }
    let cancelled = false;
    void listSaleOwnershipBucketsAction({ productId, locationId }).then((res) => {
      if (cancelled || !res.success) return;
      const next = ((res.data as { buckets?: Bucket[] })?.buckets || []).map((bucket) => ({
        ownershipKey: bucket.ownershipKey,
        label: bucket.label,
        quantity: Number(bucket.quantity),
      }));
      setBuckets(next);
      if (next.length === 1 && value !== next[0].ownershipKey) {
        onChange(next[0].ownershipKey, next[0].quantity);
      }
      if (next.length === 0 && value) onChange("", 0);
    });
    return () => {
      cancelled = true;
    };
  }, [productId, locationId]);

  if (!productId || !locationId || buckets.length <= 1) return null;

  return (
    <select
      value={value}
      onChange={(event) => {
        const bucket = buckets.find((entry) => entry.ownershipKey === event.target.value);
        onChange(event.target.value, bucket?.quantity ?? 0);
      }}
      className="h-7 w-full rounded border border-amber-300 bg-amber-50 px-1.5 text-[10px]"
    >
      <option value="">Batch</option>
      {buckets.map((bucket) => (
        <option key={bucket.ownershipKey} value={bucket.ownershipKey}>
          {bucket.label} ({bucket.quantity}
          {unit ? ` ${unit}` : ""})
        </option>
      ))}
    </select>
  );
}

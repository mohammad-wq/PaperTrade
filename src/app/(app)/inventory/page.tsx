import { listInventoryAction } from "@/actions/parties";
import { getCachedLocations, getCachedWarehouseLots } from "@/lib/cached-lookups";
import InventoryClient from "./inventory-client";
import { Suspense } from "react";
import { assertPageAccess } from "@/lib/auth/session";

import { serializeDecimals } from "@/lib/serialization";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  await assertPageAccess("/inventory");
  const [invRes, lots, locs] = await Promise.all([
    listInventoryAction(),
    getCachedWarehouseLots(),
    getCachedLocations(),
  ]);

  const inventory = invRes.success && invRes.data ? invRes.data : [];

  return (
    <Suspense fallback={<div className="p-8 text-center text-xs text-slate-500 font-mono">Loading Inventory Hub...</div>}>
      <InventoryClient
        initialInventory={serializeDecimals(inventory) as any}
        initialLots={serializeDecimals(lots) as any}
        initialLocations={serializeDecimals(locs) as any}
      />
    </Suspense>
  );
}

import { listInventoryAction } from "@/actions/parties";
import { getCachedLocations, getCachedWarehouseLots } from "@/lib/cached-lookups";
import InventoryClient from "./inventory-client";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const [invRes, lots, locs] = await Promise.all([
    listInventoryAction(),
    getCachedWarehouseLots(),
    getCachedLocations(),
  ]);

  const inventory = invRes.success && invRes.data ? invRes.data : [];

  return (
    <Suspense fallback={<div className="p-8 text-center text-xs text-slate-500 font-mono">Loading Inventory Hub...</div>}>
      <InventoryClient
        initialInventory={inventory as any}
        initialLots={lots as any}
        initialLocations={locs as any}
      />
    </Suspense>
  );
}

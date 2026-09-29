import { listSaleInvoicesAction } from "@/actions/invoices";
import { listPartiesAction, listInventoryAction } from "@/actions/parties";
import { listProductsAction } from "@/actions/products";
import { getCachedLocations, getCachedWarehouseLots } from "@/lib/cached-lookups";
import SalesClient from "./sales-client";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

export default async function SalesPage() {
  const [invRes, partyRes, prodRes, stockRes, locations, lots] = await Promise.all([
    listSaleInvoicesAction(),
    listPartiesAction(),
    listProductsAction(),
    listInventoryAction(),
    getCachedLocations(),
    getCachedWarehouseLots(),
  ]);

  const invoices = invRes.success && invRes.data ? invRes.data : [];
  const parties = partyRes.success && partyRes.data ? partyRes.data : [];
  const products = prodRes.success && prodRes.data ? prodRes.data : [];
  const inventory = stockRes.success && stockRes.data ? stockRes.data : [];

  return (
    <Suspense fallback={<div className="p-8 text-center text-xs text-slate-500 font-mono">Loading Sales Ledger...</div>}>
      <SalesClient
        initialInvoices={invoices as any}
        initialParties={parties as any}
        initialProducts={products as any}
        initialInventory={inventory as any}
        initialLocations={locations as any}
        initialWarehouseLots={lots as any}
      />
    </Suspense>
  );
}

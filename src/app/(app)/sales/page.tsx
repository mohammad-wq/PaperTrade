import { listSaleInvoicesAction } from "@/actions/invoices";
import { listPartiesAction, listInventoryAction } from "@/actions/parties";
import { listProductsAction } from "@/actions/products";
import { getCachedLocations, getCachedWarehouseLots } from "@/lib/cached-lookups";
import SalesClient from "./sales-client";
import { Suspense } from "react";
import { serializeDecimals } from "@/lib/serialization";
import { assertPageAccess } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function SalesPage() {
  await assertPageAccess("/sales");
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
        initialInvoices={serializeDecimals(invoices) as any}
        initialParties={serializeDecimals(parties) as any}
        initialProducts={serializeDecimals(products) as any}
        initialInventory={serializeDecimals(inventory) as any}
        initialLocations={serializeDecimals(locations) as any}
        initialWarehouseLots={serializeDecimals(lots) as any}
      />
    </Suspense>
  );
}

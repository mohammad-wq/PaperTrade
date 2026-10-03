import { listProductsAction } from "@/actions/products";
import { getCachedCategories, getCachedQualities } from "@/lib/cached-lookups";
import ProductsClient from "./products-client";
import { Suspense } from "react";
import { assertPageAccess } from "@/lib/auth/session";

import { serializeDecimals } from "@/lib/serialization";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  await assertPageAccess("/products");
  const [productsRes, categories, qualities] = await Promise.all([
    listProductsAction(),
    getCachedCategories(),
    getCachedQualities(),
  ]);

  const products = productsRes.success && productsRes.data ? productsRes.data : [];

  return (
    <Suspense fallback={<div className="p-8 text-center text-xs text-slate-500 font-mono">Loading Products Catalog...</div>}>
      <ProductsClient
        initialProducts={serializeDecimals(products) as any}
        initialCategories={serializeDecimals(categories) as any}
        initialQualities={serializeDecimals(qualities) as any}
      />
    </Suspense>
  );
}

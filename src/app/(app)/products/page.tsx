"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Plus, Search, Scale, Layers, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listProductsAction, softDeleteProductAction } from "@/actions/products";
import { type ProductInput } from "@/schemas/product";
import { useRealtimeListener } from "@/hooks/use-realtime";

type ProductRecord = {
  id: string;
  productNo: string;
  name: string;
  categoryId: string;
  qualityId: string;
  unit: ProductInput["unit"];
  length: number;
  breadth: number;
  gsm: number;
  packetWeight: number;
  reamWeight: number;
  costPrice: number;
  retailPrice: number;
  wholesalePrice: number;
  labourCharges: number;
  reorderLevel: number | null;
  serialNo: string | null;
  remarks: string | null;
  isActive: boolean;
  category: { id: string; name: string } | null;
  quality: { id: string; name: string } | null;
};

export default function ProductsPage() {
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  const activeProducts = products.filter((product) => product.isActive).length;
  const inactiveProducts = products.filter((product) => !product.isActive).length;

  async function fetchProducts(isBackground = false) {
    if (!isBackground) setLoading(true);
    try {
      const result = await listProductsAction();
      if (result.success) {
        setProducts(result.data as ProductRecord[]);
      }
    } finally {
      if (!isBackground) setLoading(false);
    }
  }

  useEffect(() => {
    void fetchProducts();
  }, []);

  useRealtimeListener(["products"], () => {
    void fetchProducts(true);
  });

  async function handleDeleteProduct(id: string, name: string) {
    if (!window.confirm(`Confirm: delete "${name}"? It will be removed from your catalog and inventory.`)) return;
    const res = await softDeleteProductAction({ id });
    if (res.success) {
      setProducts((prev) => prev.filter((p) => p.id !== id));
    } else {
      alert(res.error || "Failed to delete product.");
    }
  }

  const filteredProducts = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return products;
    return products.filter((product) =>
      [product.productNo, product.name, product.serialNo ?? "", product.category?.name ?? "", product.quality?.name ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(search),
    );
  }, [products, query]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-emerald-700">Catalog</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Product Management</h1>
          <p className="text-sm text-slate-600">
            Dimensions, GSM weights, live packet & ream calculations, and pricing catalog.
          </p>
        </div>
        <Button asChild className="w-full bg-emerald-800 text-white hover:bg-emerald-700 shadow-sm md:w-auto">
          <Link href="/products/new">
            <Plus className="mr-2 h-4 w-4" />
            Add Product
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50/80 to-white p-4 shadow-xs">
          <p className="text-xs uppercase font-semibold tracking-wider text-slate-500">Active Products</p>
          <p className="mt-2 text-3xl font-bold text-emerald-800">{activeProducts}</p>
        </div>
        <div className="rounded-2xl border border-sky-100 bg-gradient-to-br from-sky-50/80 to-white p-4 shadow-xs">
          <p className="text-xs uppercase font-semibold tracking-wider text-slate-500">Inactive Products</p>
          <p className="mt-2 text-3xl font-bold text-sky-800">{inactiveProducts}</p>
        </div>
        <div className="rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50/80 to-white p-4 shadow-xs">
          <p className="text-xs uppercase font-semibold tracking-wider text-slate-500">Standard Measuring Units</p>
          <p className="mt-2 text-lg font-bold text-amber-900">Packet & Ream Weights</p>
        </div>
      </div>

      <Card className="border-emerald-100 bg-white shadow-xs">
        <CardHeader className="border-b border-emerald-100/60 pb-3">
          <CardTitle className="flex items-center justify-between gap-2 text-base font-bold text-slate-900">
            <span>Product Directory</span>
            {query ? (
              <Button variant="ghost" size="sm" onClick={() => setQuery("")} className="h-8 px-2 text-xs text-slate-500 hover:text-slate-700">
                Clear
              </Button>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-700" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="border-slate-200 bg-white pl-9 text-xs focus-visible:ring-emerald-200"
              placeholder="Search by product code, name, category, or quality..."
              aria-label="Search products"
            />
          </div>

          <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
            {loading ? (
              <p className="text-sm text-slate-500 py-8 text-center col-span-full">Loading products…</p>
            ) : filteredProducts.length === 0 ? (
              <p className="text-sm text-slate-500 py-8 text-center col-span-full">No products found.</p>
            ) : (
              filteredProducts.map((product) => (
                <Link
                  key={product.id}
                  className="group w-full rounded-xl border border-slate-200/80 bg-white p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-emerald-50/30 hover:shadow-md flex flex-col justify-between"
                  href={`/products/${product.id}/edit`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-bold text-sm text-slate-900">{product.name}</p>
                        <p className="text-xs font-semibold text-emerald-800">{product.productNo}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                            product.isActive ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"
                          }`}
                        >
                          {product.isActive ? "Active" : "Inactive"}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void handleDeleteProduct(product.id, product.name);
                          }}
                          className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                          title="Delete Product"
                          aria-label={`Delete ${product.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                        <ArrowUpRight className="h-4 w-4 text-emerald-600 opacity-0 transition-opacity group-hover:opacity-100" />
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium">{product.category?.name ?? "General"}</span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium">{product.quality?.name ?? "Standard"}</span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-emerald-800 font-semibold">{product.unit}</span>
                    </div>

                    {/* Dimensions & Specifications */}
                    <div className="mt-2.5 text-[11px] text-slate-500">
                      <span>Dimensions: <strong>{product.length}&quot; × {product.breadth}&quot;</strong></span>
                      <span className="mx-1.5">•</span>
                      <span>GSM: <strong>{product.gsm}</strong></span>
                    </div>

                    {/* Calculated Unit Weights */}
                    <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-2 border border-slate-100 text-[11px]">
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-semibold">Packet Weight</span>
                        <span className="font-bold text-slate-800">{product.packetWeight.toFixed(3)} kg</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-semibold">Ream Weight</span>
                        <span className="font-bold text-slate-800">{product.reamWeight.toFixed(3)} kg</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3.5 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
                    <span className="text-slate-500">Reorder: <strong>{product.reorderLevel ?? 0} Pkts</strong></span>
                    <span className="font-bold text-emerald-900">Retail: PKR {product.retailPrice.toLocaleString()}</span>
                  </div>
                </Link>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

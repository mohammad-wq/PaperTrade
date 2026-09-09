"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { listProductsAction, softDeleteProductAction, upsertProductAction } from "@/actions/products";
import { ProductForm } from "@/components/products/product-form";
import { Button } from "@/components/ui/button";
import { type ProductInput } from "@/schemas/product";

const EMPTY_FORM: ProductInput = {
  productNo: "",
  name: "",
  categoryId: "",
  qualityId: "",
  unit: "PACKET",
  length: 0,
  breadth: 0,
  gsm: 0,
  costPrice: 0,
  retailPrice: 0,
  wholesalePrice: 0,
  labourCharges: 0,
  reorderLevel: 0,
  serialNo: "",
  remarks: "",
  isActive: true,
};

const sampleCategories = [
  { id: "cat-1", name: "Newsprint" },
  { id: "cat-2", name: "Maplitho" },
  { id: "cat-3", name: "Offset" },
];

const sampleQualities = [
  { id: "qual-1", name: "Premium" },
  { id: "qual-2", name: "Standard" },
  { id: "qual-3", name: "Economy" },
];

type ProductRecord = ProductInput & {
  id: string;
  packetWeight: number;
  reamWeight: number;
  category: { id: string; name: string } | null;
  quality: { id: string; name: string } | null;
};

export function ProductEditor({ productId }: { productId?: string }) {
  const router = useRouter();
  const [product, setProduct] = useState<ProductRecord | null>(null);
  const [loading, setLoading] = useState(Boolean(productId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProduct = useCallback(async () => {
    const result = await listProductsAction();
    if (result.success) {
      const found = (result.data as ProductRecord[]).find((item) => item.id === productId);
      if (found) setProduct(found);
      else setError("Product not found.");
    } else {
      setError(result.error);
    }
    setLoading(false);
  }, [productId]);

  useEffect(() => {
    if (productId) void loadProduct();
  }, [loadProduct, productId]);

  async function handleSubmit(values: ProductInput) {
    setSaving(true);
    try {
      const result = await upsertProductAction({ ...values, id: productId });
      if (!result.success) throw new Error(result.error);
      router.push(`/products/${result.data.id}/edit`);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!productId) return;
    const result = await softDeleteProductAction({ id: productId });
    if (!result.success) throw new Error(result.error);
    router.push("/products");
    router.refresh();
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading product…</p>;
  if (error) return <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</p>;

  const initialValues = product
    ? {
        ...product,
        reorderLevel: product.reorderLevel ?? 0,
        serialNo: product.serialNo ?? "",
        remarks: product.remarks ?? "",
      }
    : EMPTY_FORM;

  return (
    <div className="space-y-6">
      <Button variant="ghost" className="-ml-3 text-slate-600" onClick={() => router.push("/products")}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to product directory
      </Button>
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-emerald-600">Catalog</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-800">{productId ? "Edit product" : "Create product"}</h1>
        <p className="text-sm text-slate-600">Keep every item measured in packets or reams.</p>
      </div>
      <ProductForm
        initialValues={initialValues}
        categories={sampleCategories}
        qualities={sampleQualities}
        submitting={saving}
        onSubmit={handleSubmit}
        onDelete={productId ? handleDelete : undefined}
        submitLabel={productId ? "Update product" : "Create product"}
        deleteLabel="Deactivate product"
      />
    </div>
  );
}

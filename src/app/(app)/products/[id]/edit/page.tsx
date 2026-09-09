import { ProductEditor } from "@/components/products/product-editor";

export default async function EditProductPage({ params }: { params: { id: string } }) {
  return <ProductEditor productId={params.id} />;
}

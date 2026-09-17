import { redirect } from "next/navigation";

export default function EditProductPage({ params }: { params: { id: string } }) {
  redirect(`/products?id=${params.id}`);
}

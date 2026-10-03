import { redirect } from "next/navigation";
import { assertPageAccess } from "@/lib/auth/session";

export default async function EditProductPage({ params }: { params: { id: string } }) {
  await assertPageAccess("/products");
  redirect(`/products?id=${params.id}`);
}

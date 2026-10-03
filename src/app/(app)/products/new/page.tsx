import { redirect } from "next/navigation";
import { assertPageAccess } from "@/lib/auth/session";

export default async function NewProductPage() {
  await assertPageAccess("/products");
  redirect("/products?action=new");
}

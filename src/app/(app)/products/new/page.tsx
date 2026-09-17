import { redirect } from "next/navigation";

export default function NewProductPage() {
  redirect("/products?action=new");
}

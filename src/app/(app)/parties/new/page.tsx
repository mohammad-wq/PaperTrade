import { redirect } from "next/navigation";
import { assertPageAccess } from "@/lib/auth/session";

export default async function NewPartyPage() {
  await assertPageAccess("/parties");
  redirect("/parties?action=new");
}

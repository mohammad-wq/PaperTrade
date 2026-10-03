import { redirect } from "next/navigation";
import { assertPageAccess } from "@/lib/auth/session";

export default async function EditPartyPage({ params }: { params: { id: string } }) {
  await assertPageAccess("/parties");
  redirect(`/parties?id=${params.id}`);
}

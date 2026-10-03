import { redirect } from "next/navigation";
import { assertPageAccess } from "@/lib/auth/session";

export default async function NewReceiptRedirectPage(props: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await assertPageAccess("/payments");
  const searchParams = await props.searchParams;
  const q = new URLSearchParams();
  q.set("action", "new");
  q.set("direction", "IN");
  if (searchParams?.partyId && typeof searchParams.partyId === "string") {
    q.set("partyId", searchParams.partyId);
  }
  redirect(`/payments?${q.toString()}`);
}

import { redirect } from "next/navigation";

export default async function NewPaymentRedirectPage(props: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const searchParams = await props.searchParams;
  const q = new URLSearchParams();
  q.set("action", "new");
  q.set("direction", (searchParams?.direction as string) || "OUT");
  if (searchParams?.partyId && typeof searchParams.partyId === "string") {
    q.set("partyId", searchParams.partyId);
  }
  redirect(`/payments?${q.toString()}`);
}

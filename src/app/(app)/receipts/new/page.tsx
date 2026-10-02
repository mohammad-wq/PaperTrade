import { redirect } from "next/navigation";

export default async function NewReceiptRedirectPage(props: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const searchParams = await props.searchParams;
  const q = new URLSearchParams();
  q.set("action", "new");
  q.set("direction", "IN");
  if (searchParams?.partyId && typeof searchParams.partyId === "string") {
    q.set("partyId", searchParams.partyId);
  }
  redirect(`/payments?${q.toString()}`);
}

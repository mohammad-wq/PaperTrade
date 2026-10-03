import { redirect } from "next/navigation";
import { assertPageAccess } from "@/lib/auth/session";

export default async function PartyLedgerRedirectPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await assertPageAccess("/ledger");
  const params = await props.params;
  const searchParams = await props.searchParams;

  const view = (searchParams?.view as string) || "summary";
  const query = new URLSearchParams();
  query.set("partyId", params.id);
  query.set("view", view);

  if (searchParams?.startDate && typeof searchParams.startDate === "string") {
    query.set("startDate", searchParams.startDate);
  }
  if (searchParams?.endDate && typeof searchParams.endDate === "string") {
    query.set("endDate", searchParams.endDate);
  }

  redirect(`/ledger?${query.toString()}`);
}

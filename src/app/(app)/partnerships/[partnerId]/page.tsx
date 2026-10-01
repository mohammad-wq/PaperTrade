import { redirect } from "next/navigation";

export default async function PartnerSubPage({
  params,
}: {
  params: Promise<{ partnerId: string }>;
}) {
  const { partnerId } = await params;
  redirect(`/partnerships?partnerId=${partnerId}`);
}

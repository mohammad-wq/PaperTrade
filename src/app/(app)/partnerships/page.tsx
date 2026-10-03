import { assertPageAccess } from "@/lib/auth/session";
import { listPartnersAction, getPartnershipHubDataAction } from "@/actions/partnerships";
import PartnershipClient from "./partnership-client";

export default async function PartnershipsPage({
  searchParams,
}: {
  searchParams?: Promise<{ partnerId?: string }>;
}) {
  await assertPageAccess("/partnerships");
  const sp = searchParams ? await searchParams : {};

  const partnersRes = await listPartnersAction();
  const partners = partnersRes.success && partnersRes.data ? (partnersRes.data as any) : [];

  const initialPartnerId = sp?.partnerId || partners[0]?.id || "";

  let initialHubData = null;
  if (initialPartnerId) {
    const hubRes = await getPartnershipHubDataAction(initialPartnerId);
    if (hubRes.success && hubRes.data) {
      initialHubData = hubRes.data;
    }
  }

  return (
    <PartnershipClient
      initialPartners={partners}
      initialPartnerId={initialPartnerId}
      initialHubData={initialHubData}
    />
  );
}

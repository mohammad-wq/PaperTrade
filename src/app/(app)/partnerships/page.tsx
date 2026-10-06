import { assertPageAccess } from "@/lib/auth/session";
import { listPartnersAction, getPartnershipHubDataAction, listPartnershipLotsAction } from "@/actions/partnerships";
import { prisma } from "@/lib/db";
import PartnershipClient from "./partnership-client";

export default async function PartnershipsPage({
  searchParams,
}: {
  searchParams?: Promise<{ partnerId?: string }>;
}) {
  await assertPageAccess("/partnerships");
  const sp = searchParams ? await searchParams : {};

  const [partnersRes, lotsRes, warehouses, products] = await Promise.all([
    listPartnersAction(),
    listPartnershipLotsAction(),
    prisma.location.findMany({
      where: { type: "WAREHOUSE", isActive: true, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.product.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, name: true, productNo: true, unit: true, costPrice: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const partners = partnersRes.success && partnersRes.data ? (partnersRes.data as any) : [];
  const lots = lotsRes.success && lotsRes.data ? (lotsRes.data as any) : [];

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
      initialLots={lots}
      warehouses={warehouses}
      products={products.map((p) => ({
        ...p,
        costPrice: Number(p.costPrice),
      }))}
    />
  );
}

import { assertPageAccess } from "@/lib/auth/session";
import { getPartnershipLotDetailsAction } from "@/actions/partnerships";
import { PartnershipLotClient } from "@/components/partnerships/PartnershipLotClient";
import { prisma } from "@/lib/db";
import { notFound, redirect } from "next/navigation";

export default async function PartnershipLotPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await assertPageAccess("/partnerships");
  const { id } = await params;

  // 1. Check if ID belongs to a PartnershipLot
  const lot = await prisma.partnershipLot.findUnique({
    where: { id },
    select: { id: true },
  });

  if (lot) {
    const lotDetailsRes = await getPartnershipLotDetailsAction(id);
    if (!lotDetailsRes.success || !lotDetailsRes.data) {
      notFound();
    }

    const shopLocations = await prisma.location.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        type: "SHOP",
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    return (
      <PartnershipLotClient
        initialData={lotDetailsRes.data}
        shopLocations={shopLocations}
      />
    );
  }

  // 2. Check if ID belongs to a Partner (Party)
  const party = await prisma.party.findUnique({
    where: { id },
    select: { id: true },
  });

  if (party) {
    redirect(`/partnerships?partnerId=${party.id}`);
  }

  notFound();
}

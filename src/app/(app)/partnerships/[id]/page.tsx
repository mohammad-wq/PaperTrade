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

    const allLocations = await prisma.location.findMany({
      where: {
        isActive: true,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        type: true,
        warehouseLots: {
          where: { isActive: true, deletedAt: null },
          select: { id: true, lotNumber: true },
          orderBy: { lotNumber: "asc" },
        },
      },
      orderBy: { name: "asc" },
    });
    const lotIds = allLocations.flatMap((location) => location.warehouseLots.map((lot) => lot.id));
    const stockSums =
      lotIds.length > 0
        ? await prisma.stockMovement.groupBy({
            by: ["warehouseLotId", "type"],
            where: { warehouseLotId: { in: lotIds } },
            _sum: { quantity: true },
          })
        : [];
    const inbound = new Set(["PURCHASE_IN", "TRANSFER_IN", "SALE_RETURN"]);
    const outbound = new Set(["SALE_OUT", "TRANSFER_OUT", "DELIVERY_OUT", "PURCHASE_RETURN"]);
    const qtyByLot = new Map<string, number>();
    for (const row of stockSums) {
      if (!row.warehouseLotId) continue;
      const qty = Number(row._sum.quantity ?? 0);
      const delta = inbound.has(row.type) ? qty : outbound.has(row.type) ? -qty : 0;
      qtyByLot.set(row.warehouseLotId, (qtyByLot.get(row.warehouseLotId) ?? 0) + delta);
    }
    const withLotQty = allLocations.map((location) => ({
      id: location.id,
      name: location.name,
      type: location.type,
      lots: location.warehouseLots.map((lot) => ({
        id: lot.id,
        lotNumber: lot.lotNumber,
        quantity: qtyByLot.get(lot.id) ?? 0,
      })),
    }));
    const sourceLocation = withLotQty.find((location) => location.id === lotDetailsRes.data.lot.warehouseId);

    return (
      <PartnershipLotClient
        initialData={lotDetailsRes.data}
        destinationLocations={withLotQty.filter((l) => l.id !== lotDetailsRes.data.lot.warehouseId)}
        sourceLots={sourceLocation?.lots ?? []}
        linkedSourceLotId={lotDetailsRes.data.lot.warehouseLotId ?? null}
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

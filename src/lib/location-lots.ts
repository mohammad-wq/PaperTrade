import { prisma } from "@/lib/db";

export type PartnershipTagIndex = {
  lotNumbers: Set<string>;
  warehouseLotIds: Set<string>;
};

export async function loadPartnershipTagIndex(): Promise<PartnershipTagIndex> {
  const rows = await prisma.partnershipLot.findMany({
    select: { lotNumber: true, warehouseLotId: true },
  });
  return {
    lotNumbers: new Set(rows.map((row) => row.lotNumber.trim())),
    warehouseLotIds: new Set(
      rows.map((row) => row.warehouseLotId).filter((id): id is string => Boolean(id)),
    ),
  };
}

/** Partnership lot numbers are tags on stock, not rows in the Locations directory. */
export function isPartnershipTagLot(
  lot: { id?: string | null; lotNumber: string; description?: string | null },
  tags: PartnershipTagIndex,
): boolean {
  if (lot.id && tags.warehouseLotIds.has(lot.id)) return true;
  if (tags.lotNumbers.has(lot.lotNumber.trim())) return true;
  const desc = (lot.description || "").trim().toLowerCase();
  return (
    desc.startsWith("partner stock") ||
    desc.startsWith("partner inventory") ||
    desc.startsWith("pulled from") ||
    desc.startsWith("partnership lot") ||
    desc.startsWith("partner lot")
  );
}

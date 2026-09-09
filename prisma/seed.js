const { PrismaClient, Role, LocationType, PartyType, Unit } = require("@prisma/client");
const { hash } = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await hash(process.env.SEED_OWNER_PASSWORD || "ChangeMe123!", 12);

  await prisma.user.upsert({
    where: { email: process.env.SEED_OWNER_EMAIL || "owner@example.com" },
    update: {},
    create: {
      name: "Business Owner",
      email: process.env.SEED_OWNER_EMAIL || "owner@example.com",
      passwordHash,
      role: Role.OWNER,
    },
  });

  await prisma.location.upsert({
    where: { name_type: { name: "Shop", type: LocationType.SHOP } },
    update: {},
    create: {
      name: "Shop",
      type: LocationType.SHOP,
      address: "Shop floor",
    },
  });

  await prisma.location.upsert({
    where: { name_type: { name: "Warehouse", type: LocationType.WAREHOUSE } },
    update: {},
    create: {
      name: "Warehouse",
      type: LocationType.WAREHOUSE,
      address: "Warehouse",
    },
  });

  const categories = ["Writing Paper", "Board", "Newsprint", "Copier"];
  for (const name of categories) {
    await prisma.category.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  const qualities = ["A Grade", "B Grade", "C Grade"];
  for (const name of qualities) {
    await prisma.quality.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  await prisma.appSetting.upsert({
    where: { key: "overdueDays" },
    update: {},
    create: { key: "overdueDays", value: process.env.OVERDUE_DAYS || "14" },
  });

  await prisma.party.upsert({
    where: { email_type: { email: "walkin@internal.local", type: PartyType.CUSTOMER } },
    update: {},
    create: {
      name: "Walk-in Customer",
      type: PartyType.CUSTOMER,
      email: "walkin@internal.local",
    },
  });

  const writing = await prisma.category.findUniqueOrThrow({ where: { name: "Writing Paper" } });
  const aGrade = await prisma.quality.findUniqueOrThrow({ where: { name: "A Grade" } });

  await prisma.product.upsert({
    where: { productNo: "P-0001" },
    update: {},
    create: {
      productNo: "P-0001",
      name: "Sample A4 70 GSM",
      categoryId: writing.id,
      qualityId: aGrade.id,
      unit: Unit.PACKET,
      length: 21,
      breadth: 29.7,
      gsm: 70,
      packetWeight: (21 * 29.7 * 70) / 15499,
      reamWeight: (21 * 29.7 * 70) / 3100,
      costPrice: 100,
      retailPrice: 140,
      wholesalePrice: 120,
      labourCharges: 0,
      reorderLevel: 10,
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error({ scope: "prisma.seed", error });
    await prisma.$disconnect();
    process.exit(1);
  });

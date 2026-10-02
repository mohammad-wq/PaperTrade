const { PrismaClient, Role } = require("@prisma/client");
const { hash } = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  console.log("Starting database clean wipe...");

  // Delete all records in foreign-key safe order
  await prisma.paymentSplit.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.ledgerEntry.deleteMany({});
  await prisma.saleReturnItem.deleteMany({});
  await prisma.saleReturn.deleteMany({});
  await prisma.purchaseReturnItem.deleteMany({});
  await prisma.purchaseReturn.deleteMany({});
  await prisma.saleInvoiceItem.deleteMany({});
  await prisma.saleInvoice.deleteMany({});
  await prisma.deliveryOrderItem.deleteMany({});
  await prisma.deliveryOrder.deleteMany({});
  await prisma.purchaseInvoiceItem.deleteMany({});
  await prisma.purchaseInvoice.deleteMany({});
  await prisma.purchaseOrderItem.deleteMany({});
  await prisma.purchaseOrder.deleteMany({});
  await prisma.stockMovement.deleteMany({});
  await prisma.warehouseStorageCharge.deleteMany({});
  await prisma.expense.deleteMany({});
  await prisma.productPriceHistory.deleteMany({});
  await prisma.warehouseLot.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.category.deleteMany({});
  await prisma.quality.deleteMany({});
  await prisma.party.deleteMany({});
  await prisma.location.deleteMany({});
  await prisma.documentSequence.deleteMany({});
  await prisma.financialYear.deleteMany({});
  await prisma.appSetting.deleteMany({});
  await prisma.user.deleteMany({});

  console.log("All data cleared successfully. Seeding ONLY admin credentials...");

  const adminEmail = process.env.SEED_OWNER_EMAIL || "admin@admin.com";
  const adminPassword = process.env.SEED_OWNER_PASSWORD || "admin123!";
  const passwordHash = await hash(adminPassword, 12);

  const adminUser = await prisma.user.create({
    data: {
      name: "Business Owner",
      email: adminEmail,
      passwordHash,
      role: Role.OWNER,
    },
  });

  console.log(`Admin user created: ${adminUser.email} (Role: ${adminUser.role})`);
  console.log("Database reset complete. System is ready for clean testing from scratch.");
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

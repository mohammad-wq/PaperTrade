process.env.TEST_BYPASS_AUTH = "true";

import { prisma } from "../src/lib/db";
import {
  recordCostLayer,
  getCostLayerBalance,
} from "../src/lib/inventory-costing";
import { createSaleInvoiceAction } from "../src/actions/invoices";
import { AccountType, StockMovementType, PartyType } from "@prisma/client";

async function executeSale(input: any) {
  const res = await createSaleInvoiceAction(input);
  if (!res.success) {
    throw new Error(res.error);
  }
  return res.data;
}

async function runPhase3Tests() {
  console.log("=".repeat(80));
  console.log("PHASE 3: SALES INVOICE & COGS POSTING INTEGRATION TEST SUITE");
  console.log("=".repeat(80));

  const ts = Date.now().toString().slice(-4);

  // 1. Setup shared records: User, Category, Quality, Customer, Locations
  let user = await prisma.user.findFirst({ where: { isActive: true } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        username: `admin_test_${ts}`,
        passwordHash: "dummy",
        fullName: "Test Admin",
        role: "OWNER",
        isActive: true,
      },
    });
  }

  let activeYear = await prisma.financialYear.findFirst({ where: { isClosed: false } });
  if (!activeYear) {
    const yr = new Date().getFullYear();
    activeYear = await prisma.financialYear.create({
      data: {
        name: `FY ${yr}-${yr + 1}`,
        startDate: new Date(`${yr}-01-01`),
        endDate: new Date(`${yr}-12-31`),
        isClosed: false,
      },
    });
  }

  let category = await prisma.category.findFirst();
  if (!category) {
    category = await prisma.category.create({ data: { name: `Test Category ${ts}` } });
  }

  let quality = await prisma.quality.findFirst();
  if (!quality) {
    quality = await prisma.quality.create({ data: { name: `Test Quality ${ts}` } });
  }

  const customer = await prisma.party.create({
    data: {
      name: `Customer Phase3 ${ts}`,
      type: PartyType.CUSTOMER,
      email: `cust_${ts}@test.local`,
      isActive: true,
    },
  });

  const shopLoc = await prisma.location.create({
    data: {
      name: `Main Shop P3-${ts}`,
      type: "SHOP",
    },
  });

  const whLoc = await prisma.location.create({
    data: {
      name: `Central Warehouse P3-${ts}`,
      type: "WAREHOUSE",
    },
  });

  console.log(`✓ Setup complete: Customer [${customer.name}], Shop [${shopLoc.name}], Warehouse [${whLoc.name}]`);

  // -------------------------------------------------------------------------
  // TEST A: Opening stock 100 units @ 1,000, sell 1
  // Expected: COGS = 1,000; Inventory reduction = 1,000; Remaining layer = 99 @ 1,000
  // -------------------------------------------------------------------------
  console.log("\n----------------------------------------------------------------------");
  console.log("TEST A: Opening Stock 100 units @ 1,000, sell 1");
  console.log("----------------------------------------------------------------------");

  const prodA = await prisma.product.create({
    data: {
      productNo: `PRD-A-${ts}`,
      name: `Test Product A ${ts}`,
      categoryId: category.id,
      qualityId: quality.id,
      length: 20, breadth: 30, gsm: 80, packetWeight: 2, reamWeight: 10,
      costPrice: 1000, retailPrice: 1500, wholesalePrice: 1400,
    },
  });

  // Create opening stock via recordCostLayer + StockMovement
  await prisma.$transaction(async (tx) => {
    await recordCostLayer({
      productId: prodA.id,
      locationId: shopLoc.id,
      sourceType: "OPENING_STOCK",
      sourceId: `INIT-A-${ts}`,
      unitCost: 1000,
      quantity: 100,
    }, tx);
    await tx.stockMovement.create({
      data: {
        productId: prodA.id,
        locationId: shopLoc.id,
        type: StockMovementType.PURCHASE_IN,
        quantity: 100,
        referenceType: "OPENING_STOCK",
        referenceId: `INIT-A-${ts}`,
        createdById: user.id,
      },
    });
  });

  // Sell 1 unit @ 1,500
  const saleResA = await executeSale({
    customerId: customer.id,
    locationId: shopLoc.id,
    date: new Date(),
    items: [
      {
        productId: prodA.id,
        locationId: shopLoc.id,
        quantity: 1,
        unitPrice: 1500,
      },
    ],
  });

  const invoiceA = await prisma.saleInvoice.findUnique({
    where: { id: saleResA.invoiceId },
    include: { items: true },
  });

  const balA = await getCostLayerBalance(prodA.id, shopLoc.id);
  const ledgerEntriesA = await prisma.ledgerEntry.findMany({
    where: { referenceType: "SALE_INVOICE", referenceId: saleResA.invoiceId },
  });

  const cogsEntryA = ledgerEntriesA.find(
    (e) => e.accountType === AccountType.EXPENSE && e.description.includes("Cost of Goods Sold")
  );
  const invEntryA = ledgerEntriesA.find(
    (e) => e.accountType === AccountType.INVENTORY && e.description.includes("Inventory Asset Reduction")
  );

  console.log(`✓ Sale Invoice created: ${invoiceA?.invoiceNo}`);
  console.log(`✓ Item COGS Amount: PKR ${invoiceA?.items[0].cogsAmount}`);
  console.log(`✓ Remaining Cost Layer: ${balA.totalQuantity} units (Valuation: PKR ${balA.totalValuation})`);
  console.log(`✓ Dr COGS: PKR ${cogsEntryA?.debit}, Cr Inventory: PKR ${invEntryA?.credit}`);

  if (Number(invoiceA?.items[0].cogsAmount) !== 1000) {
    throw new Error(`Test A Failed: Expected cogsAmount = 1000, got ${invoiceA?.items[0].cogsAmount}`);
  }
  if (balA.totalQuantity !== 99 || balA.totalValuation !== 99000) {
    throw new Error(`Test A Failed: Expected 99 units remaining @ PKR 99,000, got ${balA.totalQuantity} & ${balA.totalValuation}`);
  }
  if (Number(cogsEntryA?.debit) !== 1000 || Number(invEntryA?.credit) !== 1000) {
    throw new Error(`Test A Failed: Ledger entries mismatch for Dr COGS (1000) and Cr Inventory (1000)`);
  }
  console.log("✓ TEST A PASSED: Opening stock 100 @ 1,000, sold 1 -> COGS = 1,000, remaining = 99 @ 1,000.");

  // -------------------------------------------------------------------------
  // TEST B: FIFO: 100 @ 1,000, 100 @ 1,200, sell 150
  // Expected: COGS = 160,000; remaining = 50 @ 1,200
  // -------------------------------------------------------------------------
  console.log("\n----------------------------------------------------------------------");
  console.log("TEST B: FIFO Multi-Layer (100 @ 1,000, 100 @ 1,200, sell 150)");
  console.log("----------------------------------------------------------------------");

  const prodB = await prisma.product.create({
    data: {
      productNo: `PRD-B-${ts}`,
      name: `Test Product B ${ts}`,
      categoryId: category.id,
      qualityId: quality.id,
      length: 20, breadth: 30, gsm: 80, packetWeight: 2, reamWeight: 10,
      costPrice: 1000, retailPrice: 1500, wholesalePrice: 1400,
    },
  });

  const t1 = new Date(Date.now() - 60000);
  const t2 = new Date();

  await prisma.$transaction(async (tx) => {
    // Layer 1: 100 @ 1000
    await recordCostLayer({
      productId: prodB.id,
      locationId: shopLoc.id,
      sourceType: "PURCHASE",
      sourceId: `PUR-B1-${ts}`,
      unitCost: 1000,
      quantity: 100,
      createdAt: t1,
    }, tx);
    // Layer 2: 100 @ 1200
    await recordCostLayer({
      productId: prodB.id,
      locationId: shopLoc.id,
      sourceType: "PURCHASE",
      sourceId: `PUR-B2-${ts}`,
      unitCost: 1200,
      quantity: 100,
      createdAt: t2,
    }, tx);
    // Stock Movement for total 200
    await tx.stockMovement.create({
      data: {
        productId: prodB.id,
        locationId: shopLoc.id,
        type: StockMovementType.PURCHASE_IN,
        quantity: 200,
        referenceType: "PURCHASE_INVOICE",
        referenceId: `PUR-B-${ts}`,
        createdById: user.id,
      },
    });
  });

  // Sell 150 units @ 1,800
  const saleResB = await executeSale({
    customerId: customer.id,
    locationId: shopLoc.id,
    date: new Date(),
    items: [
      {
        productId: prodB.id,
        locationId: shopLoc.id,
        quantity: 150,
        unitPrice: 1800,
      },
    ],
  });

  const invoiceB = await prisma.saleInvoice.findUnique({
    where: { id: saleResB.invoiceId },
    include: { items: true },
  });

  const balB = await getCostLayerBalance(prodB.id, shopLoc.id);
  const ledgerEntriesB = await prisma.ledgerEntry.findMany({
    where: { referenceType: "SALE_INVOICE", referenceId: saleResB.invoiceId },
  });

  const cogsEntryB = ledgerEntriesB.find(
    (e) => e.accountType === AccountType.EXPENSE && e.description.includes("Cost of Goods Sold")
  );
  const invEntryB = ledgerEntriesB.find(
    (e) => e.accountType === AccountType.INVENTORY && e.description.includes("Inventory Asset Reduction")
  );

  console.log(`✓ Sale Invoice created: ${invoiceB?.invoiceNo}`);
  console.log(`✓ Item COGS Amount: PKR ${invoiceB?.items[0].cogsAmount}`);
  console.log(`✓ Remaining Cost Layers: ${balB.totalQuantity} units @ valuation PKR ${balB.totalValuation}`);
  console.log(`✓ Dr COGS: PKR ${cogsEntryB?.debit}, Cr Inventory: PKR ${invEntryB?.credit}`);

  // Expected COGS = 100 * 1000 + 50 * 1200 = 100,000 + 60,000 = 160,000
  if (Number(invoiceB?.items[0].cogsAmount) !== 160000) {
    throw new Error(`Test B Failed: Expected cogsAmount = 160,000, got ${invoiceB?.items[0].cogsAmount}`);
  }
  if (balB.totalQuantity !== 50 || balB.totalValuation !== 60000) {
    throw new Error(`Test B Failed: Expected 50 units remaining @ PKR 60,000 (50 * 1200), got ${balB.totalQuantity} & ${balB.totalValuation}`);
  }
  if (Number(cogsEntryB?.debit) !== 160000 || Number(invEntryB?.credit) !== 160000) {
    throw new Error(`Test B Failed: Ledger entries mismatch for Dr COGS (160000) and Cr Inventory (160000)`);
  }
  console.log("✓ TEST B PASSED: FIFO 100 @ 1,000 + 100 @ 1,200 -> sold 150 -> COGS = 160,000, remaining = 50 @ 1,200.");

  // -------------------------------------------------------------------------
  // TEST C: Sale Accounting Verification
  // Product revenue credited once, COGS debited once, Inventory credited by consumed cost,
  // Total debits and credits balanced.
  // -------------------------------------------------------------------------
  console.log("\n----------------------------------------------------------------------");
  console.log("TEST C: Double-Entry Balanced Accounting Verification");
  console.log("----------------------------------------------------------------------");

  const totalDebitsB = ledgerEntriesB.reduce((sum, e) => sum + Number(e.debit), 0);
  const totalCreditsB = ledgerEntriesB.reduce((sum, e) => sum + Number(e.credit), 0);
  const salesRevenueEntriesB = ledgerEntriesB.filter((e) => e.accountType === AccountType.SALES);

  console.log(`✓ Total Debits:  PKR ${totalDebitsB.toLocaleString()}`);
  console.log(`✓ Total Credits: PKR ${totalCreditsB.toLocaleString()}`);
  console.log(`✓ Sales Revenue Entries Count: ${salesRevenueEntriesB.length} (Amount: PKR ${salesRevenueEntriesB[0]?.credit})`);

  if (Math.abs(totalDebitsB - totalCreditsB) > 0.001) {
    throw new Error(`Test C Failed: Trial balance out of balance! Debits: ${totalDebitsB}, Credits: ${totalCreditsB}`);
  }
  if (salesRevenueEntriesB.length !== 1) {
    throw new Error(`Test C Failed: Product revenue must be credited exactly once! Found ${salesRevenueEntriesB.length} entries.`);
  }
  if (Number(salesRevenueEntriesB[0].credit) !== 150 * 1800) {
    throw new Error(`Test C Failed: Gross Revenue expected ${150 * 1800}, got ${salesRevenueEntriesB[0].credit}`);
  }
  console.log("✓ TEST C PASSED: Revenue credited once, COGS debited once, Inventory credited, Debits == Credits.");

  // -------------------------------------------------------------------------
  // TEST D: Insufficient Inventory Rollback
  // Sale must fail and no partial cost-layer consumption or ledger posting may remain.
  // -------------------------------------------------------------------------
  console.log("\n----------------------------------------------------------------------");
  console.log("TEST D: Insufficient Inventory Transactional Rollback");
  console.log("----------------------------------------------------------------------");

  const prodD = await prisma.product.create({
    data: {
      productNo: `PRD-D-${ts}`,
      name: `Test Product D ${ts}`,
      categoryId: category.id,
      qualityId: quality.id,
      length: 20, breadth: 30, gsm: 80, packetWeight: 2, reamWeight: 10,
      costPrice: 1000, retailPrice: 1500, wholesalePrice: 1400,
    },
  });

  // Provide only 10 units
  await prisma.$transaction(async (tx) => {
    await recordCostLayer({
      productId: prodD.id,
      locationId: shopLoc.id,
      sourceType: "PURCHASE",
      sourceId: `PUR-D-${ts}`,
      unitCost: 1000,
      quantity: 10,
    }, tx);
    await tx.stockMovement.create({
      data: {
        productId: prodD.id,
        locationId: shopLoc.id,
        type: StockMovementType.PURCHASE_IN,
        quantity: 10,
        referenceType: "PURCHASE_INVOICE",
        referenceId: `PUR-D-${ts}`,
        createdById: user.id,
      },
    });
  });

  let failedAsExpected = false;
  try {
    await executeSale({
      customerId: customer.id,
      locationId: shopLoc.id,
      date: new Date(),
      items: [
        {
          productId: prodD.id,
          locationId: shopLoc.id,
          quantity: 25, // Requesting 25 when only 10 exist
          unitPrice: 1500,
        },
      ],
    });
  } catch (err: any) {
    failedAsExpected = true;
    console.log(`✓ Caught expected error on insufficient stock: "${err.message}"`);
  }

  if (!failedAsExpected) {
    throw new Error("Test D Failed: Sale should have thrown an error for insufficient stock!");
  }

  const balDAfter = await getCostLayerBalance(prodD.id, shopLoc.id);
  const movementsD = await prisma.stockMovement.findMany({
    where: { productId: prodD.id, type: StockMovementType.SALE_OUT },
  });

  if (balDAfter.totalQuantity !== 10) {
    throw new Error(`Test D Failed: Partial layer consumption occurred! Remaining: ${balDAfter.totalQuantity}, expected: 10.`);
  }
  if (movementsD.length > 0) {
    throw new Error(`Test D Failed: StockMovement SALE_OUT was not rolled back!`);
  }
  console.log("✓ TEST D PASSED: Insufficient stock triggered complete transactional rollback with zero side-effects.");

  // -------------------------------------------------------------------------
  // TEST E: Multiple Locations Isolation
  // A sale from Shop must consume only Shop cost layers.
  // -------------------------------------------------------------------------
  console.log("\n----------------------------------------------------------------------");
  console.log("TEST E: Multiple Locations Isolation");
  console.log("----------------------------------------------------------------------");

  const prodE = await prisma.product.create({
    data: {
      productNo: `PRD-E-${ts}`,
      name: `Test Product E ${ts}`,
      categoryId: category.id,
      qualityId: quality.id,
      length: 20, breadth: 30, gsm: 80, packetWeight: 2, reamWeight: 10,
      costPrice: 1000, retailPrice: 1500, wholesalePrice: 1400,
    },
  });

  // Shop: 50 units @ 1,000
  // Warehouse: 50 units @ 1,500
  await prisma.$transaction(async (tx) => {
    await recordCostLayer({
      productId: prodE.id,
      locationId: shopLoc.id,
      sourceType: "PURCHASE",
      sourceId: `PUR-E-SHOP-${ts}`,
      unitCost: 1000,
      quantity: 50,
    }, tx);
    await tx.stockMovement.create({
      data: {
        productId: prodE.id,
        locationId: shopLoc.id,
        type: StockMovementType.PURCHASE_IN,
        quantity: 50,
        referenceType: "PURCHASE_INVOICE",
        referenceId: `PUR-E-SHOP-${ts}`,
        createdById: user.id,
      },
    });

    await recordCostLayer({
      productId: prodE.id,
      locationId: whLoc.id,
      sourceType: "PURCHASE",
      sourceId: `PUR-E-WH-${ts}`,
      unitCost: 1500,
      quantity: 50,
    }, tx);
    await tx.stockMovement.create({
      data: {
        productId: prodE.id,
        locationId: whLoc.id,
        type: StockMovementType.PURCHASE_IN,
        quantity: 50,
        referenceType: "PURCHASE_INVOICE",
        referenceId: `PUR-E-WH-${ts}`,
        createdById: user.id,
      },
    });
  });

  // Sell 20 units from Shop
  const saleResE = await executeSale({
    customerId: customer.id,
    locationId: shopLoc.id,
    date: new Date(),
    items: [
      {
        productId: prodE.id,
        locationId: shopLoc.id,
        quantity: 20,
        unitPrice: 1800,
      },
    ],
  });

  const invoiceE = await prisma.saleInvoice.findUnique({
    where: { id: saleResE.invoiceId },
    include: { items: true },
  });

  const balEShop = await getCostLayerBalance(prodE.id, shopLoc.id);
  const balEWh = await getCostLayerBalance(prodE.id, whLoc.id);

  console.log(`✓ Sold 20 units from Shop: COGS = PKR ${invoiceE?.items[0].cogsAmount}`);
  console.log(`✓ Shop remaining: ${balEShop.totalQuantity} units @ valuation PKR ${balEShop.totalValuation}`);
  console.log(`✓ Warehouse remaining: ${balEWh.totalQuantity} units @ valuation PKR ${balEWh.totalValuation}`);

  if (Number(invoiceE?.items[0].cogsAmount) !== 20000) {
    throw new Error(`Test E Failed: Expected COGS = 20,000 (20 * 1,000), got ${invoiceE?.items[0].cogsAmount}`);
  }
  if (balEShop.totalQuantity !== 30 || balEShop.totalValuation !== 30000) {
    throw new Error(`Test E Failed: Shop should have 30 units @ 30,000, got ${balEShop.totalQuantity} & ${balEShop.totalValuation}`);
  }
  if (balEWh.totalQuantity !== 50 || balEWh.totalValuation !== 75000) {
    throw new Error(`Test E Failed: Warehouse layers were touched! Expected 50 units @ 75,000, got ${balEWh.totalQuantity} & ${balEWh.totalValuation}`);
  }
  console.log("✓ TEST E PASSED: Sale from Shop consumed strictly Shop cost layers; Warehouse cost layers untouched.");

  // -------------------------------------------------------------------------
  // TEST F: Multiple Warehouse Lots Isolation
  // A sale constrained to a specific warehouse lot must consume only that lot's cost layers.
  // -------------------------------------------------------------------------
  console.log("\n----------------------------------------------------------------------");
  console.log("TEST F: Multiple Warehouse Lots Isolation");
  console.log("----------------------------------------------------------------------");

  const prodF = await prisma.product.create({
    data: {
      productNo: `PRD-F-${ts}`,
      name: `Test Product F ${ts}`,
      categoryId: category.id,
      qualityId: quality.id,
      length: 20, breadth: 30, gsm: 80, packetWeight: 2, reamWeight: 10,
      costPrice: 1000, retailPrice: 1500, wholesalePrice: 1400,
    },
  });

  const lotF1 = await prisma.warehouseLot.create({
    data: {
      locationId: whLoc.id,
      lotNumber: `LOT-F1-${ts}`,
      unitCost: 1100,
    },
  });

  const lotF2 = await prisma.warehouseLot.create({
    data: {
      locationId: whLoc.id,
      lotNumber: `LOT-F2-${ts}`,
      unitCost: 1400,
    },
  });

  await prisma.$transaction(async (tx) => {
    // Lot F1: 20 @ 1100
    await recordCostLayer({
      productId: prodF.id,
      locationId: whLoc.id,
      warehouseLotId: lotF1.id,
      sourceType: "PURCHASE",
      sourceId: `PUR-F1-${ts}`,
      unitCost: 1100,
      quantity: 20,
    }, tx);
    await tx.stockMovement.create({
      data: {
        productId: prodF.id,
        locationId: whLoc.id,
        warehouseLotId: lotF1.id,
        type: StockMovementType.PURCHASE_IN,
        quantity: 20,
        referenceType: "PURCHASE_INVOICE",
        referenceId: `PUR-F1-${ts}`,
        createdById: user.id,
      },
    });

    // Lot F2: 20 @ 1400
    await recordCostLayer({
      productId: prodF.id,
      locationId: whLoc.id,
      warehouseLotId: lotF2.id,
      sourceType: "PURCHASE",
      sourceId: `PUR-F2-${ts}`,
      unitCost: 1400,
      quantity: 20,
    }, tx);
    await tx.stockMovement.create({
      data: {
        productId: prodF.id,
        locationId: whLoc.id,
        warehouseLotId: lotF2.id,
        type: StockMovementType.PURCHASE_IN,
        quantity: 20,
        referenceType: "PURCHASE_INVOICE",
        referenceId: `PUR-F2-${ts}`,
        createdById: user.id,
      },
    });
  });

  // Sell 10 units specifically from Lot F2
  const saleResF = await executeSale({
    customerId: customer.id,
    locationId: whLoc.id,
    date: new Date(),
    items: [
      {
        productId: prodF.id,
        locationId: whLoc.id,
        warehouseLotId: lotF2.id,
        quantity: 10,
        unitPrice: 2000,
      },
    ],
  });

  const invoiceF = await prisma.saleInvoice.findUnique({
    where: { id: saleResF.invoiceId },
    include: { items: true },
  });

  const balFLot1 = await getCostLayerBalance(prodF.id, whLoc.id, lotF1.id);
  const balFLot2 = await getCostLayerBalance(prodF.id, whLoc.id, lotF2.id);

  console.log(`✓ Sold 10 units from Lot F2: COGS = PKR ${invoiceF?.items[0].cogsAmount}`);
  console.log(`✓ Lot F1 remaining: ${balFLot1.totalQuantity} units @ valuation PKR ${balFLot1.totalValuation}`);
  console.log(`✓ Lot F2 remaining: ${balFLot2.totalQuantity} units @ valuation PKR ${balFLot2.totalValuation}`);

  if (Number(invoiceF?.items[0].cogsAmount) !== 14000) {
    throw new Error(`Test F Failed: Expected COGS = 14,000 (10 * 1,400), got ${invoiceF?.items[0].cogsAmount}`);
  }
  if (balFLot1.totalQuantity !== 20 || balFLot1.totalValuation !== 22000) {
    throw new Error(`Test F Failed: Lot F1 was modified! Expected 20 @ 22,000, got ${balFLot1.totalQuantity} & ${balFLot1.totalValuation}`);
  }
  if (balFLot2.totalQuantity !== 10 || balFLot2.totalValuation !== 14000) {
    throw new Error(`Test F Failed: Lot F2 expected 10 @ 14,000, got ${balFLot2.totalQuantity} & ${balFLot2.totalValuation}`);
  }
  console.log("✓ TEST F PASSED: Sale constrained to specific warehouse lot consumed strictly that lot's cost layers.");

  // -------------------------------------------------------------------------
  // TEST G: Concurrent Sales Concurrency Protection
  // Simultaneous sales cannot consume the same cost-layer quantity twice.
  // -------------------------------------------------------------------------
  console.log("\n----------------------------------------------------------------------");
  console.log("TEST G: Concurrent Sales Row-Locking & Concurrency Protection");
  console.log("----------------------------------------------------------------------");

  const prodG = await prisma.product.create({
    data: {
      productNo: `PRD-G-${ts}`,
      name: `Test Product G ${ts}`,
      categoryId: category.id,
      qualityId: quality.id,
      length: 20, breadth: 30, gsm: 80, packetWeight: 2, reamWeight: 10,
      costPrice: 1000, retailPrice: 1500, wholesalePrice: 1400,
    },
  });

  // Layer of exactly 10 units @ 1,000
  await prisma.$transaction(async (tx) => {
    await recordCostLayer({
      productId: prodG.id,
      locationId: shopLoc.id,
      sourceType: "PURCHASE",
      sourceId: `PUR-G-${ts}`,
      unitCost: 1000,
      quantity: 10,
    }, tx);
    await tx.stockMovement.create({
      data: {
        productId: prodG.id,
        locationId: shopLoc.id,
        type: StockMovementType.PURCHASE_IN,
        quantity: 10,
        referenceType: "PURCHASE_INVOICE",
        referenceId: `PUR-G-${ts}`,
        createdById: user.id,
      },
    });
  });

  // Fire two concurrent sales requesting 7 units each (total 14 > 10)
  const results = await Promise.allSettled([
    executeSale({
      customerId: customer.id,
      locationId: shopLoc.id,
      date: new Date(),
      items: [{ productId: prodG.id, locationId: shopLoc.id, quantity: 7, unitPrice: 1500 }],
    }),
    executeSale({
      customerId: customer.id,
      locationId: shopLoc.id,
      date: new Date(),
      items: [{ productId: prodG.id, locationId: shopLoc.id, quantity: 7, unitPrice: 1500 }],
    }),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");

  console.log(`✓ Concurrent sales results: Fulfilled: ${fulfilled.length}, Rejected: ${rejected.length}`);
  const balG = await getCostLayerBalance(prodG.id, shopLoc.id);
  console.log(`✓ Layer remaining after concurrent race: ${balG.totalQuantity} units @ valuation PKR ${balG.totalValuation}`);

  if (fulfilled.length !== 1 || rejected.length !== 1) {
    throw new Error(`Test G Failed: Expected exactly 1 success and 1 failure, got ${fulfilled.length} fulfilled and ${rejected.length} rejected!`);
  }
  if (balG.totalQuantity !== 3 || balG.totalValuation !== 3000) {
    throw new Error(`Test G Failed: Expected exactly 3 units remaining @ PKR 3,000, got ${balG.totalQuantity} & ${balG.totalValuation}`);
  }
  console.log("✓ TEST G PASSED: Row-locking prevented double consumption. 1 sale succeeded (7 units), 1 failed cleanly, remaining = 3 units.");

  // -------------------------------------------------------------------------
  // TEST H: Partnership Sale
  // Verify existing PartnershipSaleAllocation works without duplicate revenue or incorrect inventory costing.
  // -------------------------------------------------------------------------
  console.log("\n----------------------------------------------------------------------");
  console.log("TEST H: Partnership Sale Allocation & Costing");
  console.log("----------------------------------------------------------------------");

  const partner = await prisma.party.create({
    data: {
      name: `Partner Phase3 ${ts}`,
      type: PartyType.CUSTOMER,
      isPartner: true,
      phone: `0300${ts}`,
      isActive: true,
    },
  });

  const pLot = await prisma.partnershipLot.create({
    data: {
      partnerId: partner.id,
      lotNumber: `PLOT-${ts}`,
      type: "CO_INVESTED_POOL",
      warehouseId: shopLoc.id,
      totalCapitalCost: 50000,
      entityCapitalShare: 25000,
      partnerCapitalShare: 25000,
      partnerMarginRatio: 0.5,
    },
  });

  const prodH = await prisma.product.create({
    data: {
      productNo: `PRD-H-${ts}`,
      name: `Test Product H ${ts}`,
      categoryId: category.id,
      qualityId: quality.id,
      length: 20, breadth: 30, gsm: 80, packetWeight: 2, reamWeight: 10,
      costPrice: 1000, retailPrice: 1600, wholesalePrice: 1500,
    },
  });

  await prisma.partnershipLotItem.create({
    data: {
      lotId: pLot.id,
      productId: prodH.id,
      initialQuantity: 50,
      remainingQuantity: 50,
      unitCostRate: 1000,
    },
  });

  // Stock movement for shop stock
  await prisma.stockMovement.create({
    data: {
      productId: prodH.id,
      locationId: shopLoc.id,
      type: StockMovementType.PURCHASE_IN,
      quantity: 50,
      referenceType: "PARTNERSHIP_LOT",
      referenceId: pLot.id,
      createdById: user.id,
    },
  });

  // Sell 10 units using lotId: pLot.id @ PKR 1,600
  const saleResH = await executeSale({
    customerId: customer.id,
    locationId: shopLoc.id,
    isPartnership: true,
    partnershipId: pLot.id,
    date: new Date(),
    items: [
      {
        productId: prodH.id,
        locationId: shopLoc.id,
        lotId: pLot.id,
        quantity: 10,
        unitPrice: 1600,
      },
    ],
  });

  const invoiceH = await prisma.saleInvoice.findUnique({
    where: { id: saleResH.invoiceId },
    include: { items: true },
  });

  const pAllocation = await prisma.partnershipSaleAllocation.findFirst({
    where: { invoiceId: saleResH.invoiceId, lotId: pLot.id },
  });

  const ledgerEntriesH = await prisma.ledgerEntry.findMany({
    where: { referenceType: "SALE_INVOICE", referenceId: saleResH.invoiceId },
  });

  const cogsEntryH = ledgerEntriesH.find(
    (e) => e.accountType === AccountType.EXPENSE && e.description.includes("Cost of Goods Sold")
  );
  const invEntryH = ledgerEntriesH.find(
    (e) => e.accountType === AccountType.INVENTORY && e.description.includes("Inventory Asset Reduction")
  );
  const partnerShareEntryH = ledgerEntriesH.find(
    (e) => e.accountType === AccountType.EXPENSE && e.description.includes("Partner Profit Allocation")
  );
  const partnerPayableEntryH = ledgerEntriesH.find(
    (e) => e.accountType === AccountType.PAYABLE && e.description.includes("Accrued Profit Share Payable")
  );

  const totalDebitsH = ledgerEntriesH.reduce((sum, e) => sum + Number(e.debit), 0);
  const totalCreditsH = ledgerEntriesH.reduce((sum, e) => sum + Number(e.credit), 0);
  const revEntriesH = ledgerEntriesH.filter((e) => e.accountType === AccountType.SALES);

  console.log(`✓ Partnership Sale Invoice: ${invoiceH?.invoiceNo}`);
  console.log(`✓ Item COGS Amount: PKR ${invoiceH?.items[0].cogsAmount}`);
  console.log(`✓ PartnershipSaleAllocation: Qty ${pAllocation?.quantity}, Gross Margin: PKR ${pAllocation?.grossMargin}, Partner Share: PKR ${pAllocation?.partnerMarginShare}`);
  console.log(`✓ Dr COGS: PKR ${cogsEntryH?.debit}, Cr Inventory: PKR ${invEntryH?.credit}`);
  console.log(`✓ Dr Partner Share: PKR ${partnerShareEntryH?.debit}, Cr Partner Payable: PKR ${partnerPayableEntryH?.credit}`);
  console.log(`✓ Total Debits: PKR ${totalDebitsH.toLocaleString()}, Total Credits: PKR ${totalCreditsH.toLocaleString()}`);

  // Checks:
  // Gross Margin = (1600 - 1000) * 10 = 6,000. Partner share = 50% = 3,000.
  if (Number(invoiceH?.items[0].cogsAmount) !== 10000) {
    throw new Error(`Test H Failed: Expected COGS = 10,000 (10 * 1,000), got ${invoiceH?.items[0].cogsAmount}`);
  }
  if (!pAllocation || Number(pAllocation.partnerMarginShare) !== 3000) {
    throw new Error(`Test H Failed: Expected partnerMarginShare = 3,000, got ${pAllocation?.partnerMarginShare}`);
  }
  if (revEntriesH.length !== 1 || Number(revEntriesH[0].credit) !== 16000) {
    throw new Error(`Test H Failed: Product revenue must be credited exactly once at 16,000! Found ${revEntriesH.length}`);
  }
  if (Math.abs(totalDebitsH - totalCreditsH) > 0.001) {
    throw new Error(`Test H Failed: Ledger trial balance mismatch! Debits: ${totalDebitsH}, Credits: ${totalCreditsH}`);
  }
  console.log("✓ TEST H PASSED: Partnership sale allocation, COGS calculation, and double-entry postings are balanced and verified.");

  console.log("\n" + "=".repeat(80));
  console.log("ALL 8 VERIFICATION TESTS (A through H) PASSED PERFECTLY!");
  console.log("=".repeat(80));
}

runPhase3Tests()
  .catch((e) => {
    console.error("TEST FAILED:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

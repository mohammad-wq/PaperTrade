import { prisma } from "../src/lib/db";
import {
  recordCostLayer,
  consumeCostLayersFIFO,
  transferCostLayersFIFO,
  getCostLayerBalance,
} from "../src/lib/inventory-costing";
import { getStockOnHand } from "../src/lib/stock";
import { adjustStockAction } from "../src/actions/inventory";

async function runPhase2Tests() {
  console.log("=".repeat(80));
  console.log("PHASE 2: INVENTORY FOUNDATION & FIFO COST LAYERS VERIFICATION SUITE");
  console.log("=".repeat(80));

  const ts = Date.now().toString().slice(-4);

  // Setup test category, quality, product, locations
  let category = await prisma.category.findFirst();
  if (!category) {
    category = await prisma.category.create({ data: { name: `Test Category ${ts}` } });
  }

  let quality = await prisma.quality.findFirst();
  if (!quality) {
    quality = await prisma.quality.create({ data: { name: `Test Quality ${ts}` } });
  }

  const product = await prisma.product.create({
    data: {
      productNo: `PRD-FIFO-${ts}`,
      name: `FIFO Offset Paper ${ts}`,
      categoryId: category.id,
      qualityId: quality.id,
      length: 23,
      breadth: 36,
      gsm: 70,
      packetWeight: 2.1,
      reamWeight: 10.5,
      costPrice: 1000,
      retailPrice: 1500,
      wholesalePrice: 1400,
    },
  });

  const locA = await prisma.location.create({
    data: {
      name: `Main Shop FIFO-${ts}`,
      type: "SHOP",
    },
  });

  const locB = await prisma.location.create({
    data: {
      name: `Central Warehouse FIFO-${ts}`,
      type: "WAREHOUSE",
    },
  });

  console.log(`\n✓ Test product created: ${product.productNo} (${product.name})`);
  console.log(`✓ Test locations created: ${locA.name}, ${locB.name}`);

  // -------------------------------------------------------------------------
  // TEST 1: Opening stock: 100 @ 1,000
  // -------------------------------------------------------------------------
  console.log("\n----------------------------------------------------------------------");
  console.log("TEST 1: Opening Stock Cost Layer Creation (100 units @ PKR 1,000)");
  console.log("----------------------------------------------------------------------");

  const openLayer = await prisma.$transaction(async (tx) => {
    return recordCostLayer({
      productId: product.id,
      locationId: locA.id,
      sourceType: "OPENING_STOCK",
      sourceId: `OPN-${ts}`,
      unitCost: 1000,
      quantity: 100,
    }, tx);
  });

  const bal1 = await getCostLayerBalance(product.id, locA.id);
  console.log(`✓ Cost layer created: ID=${openLayer?.id}, Source=OPENING_STOCK, Qty=100 @ PKR 1,000`);
  console.log(`✓ Balance after opening stock: ${bal1.totalQuantity} units | Valuation: PKR ${bal1.totalValuation.toLocaleString()}`);
  if (bal1.totalQuantity !== 100 || bal1.totalValuation !== 100000) {
    throw new Error(`Test 1 Failed: Expected 100 units & PKR 100,000, got ${bal1.totalQuantity} units & PKR ${bal1.totalValuation}`);
  }

  // -------------------------------------------------------------------------
  // TEST 2: Purchase Cost Layer: 100 @ 1,200
  // -------------------------------------------------------------------------
  console.log("\n----------------------------------------------------------------------");
  console.log("TEST 2: Purchase Cost Layer Creation (100 units @ PKR 1,200)");
  console.log("----------------------------------------------------------------------");

  const purchaseLayer = await prisma.$transaction(async (tx) => {
    return recordCostLayer({
      productId: product.id,
      locationId: locA.id,
      sourceType: "PURCHASE",
      sourceId: `PUR-${ts}`,
      unitCost: 1200,
      quantity: 100,
    }, tx);
  });

  const bal2 = await getCostLayerBalance(product.id, locA.id);
  console.log(`✓ Cost layer created: ID=${purchaseLayer?.id}, Source=PURCHASE, Qty=100 @ PKR 1,200`);
  console.log(`✓ Balance after purchase: ${bal2.totalQuantity} units | Total Valuation: PKR ${bal2.totalValuation.toLocaleString()}`);
  console.log(`  - Layer 1 (Opening): 100 units @ PKR 1,000 = PKR 100,000`);
  console.log(`  - Layer 2 (Purchase): 100 units @ PKR 1,200 = PKR 120,000`);
  if (bal2.totalQuantity !== 200 || bal2.totalValuation !== 220000) {
    throw new Error(`Test 2 Failed: Expected 200 units & PKR 220,000, got ${bal2.totalQuantity} units & PKR ${bal2.totalValuation}`);
  }

  // -------------------------------------------------------------------------
  // TEST 3: FIFO Sale Consumption: 150 units
  // Expected: 100 from Layer 1 (@ 1,000) + 50 from Layer 2 (@ 1,200) = 160,000 COGS
  // Remaining: 50 from Layer 2 (@ 1,200) = 60,000 Valuation
  // -------------------------------------------------------------------------
  console.log("\n----------------------------------------------------------------------");
  console.log("TEST 3: FIFO Consumption of 150 units across two distinct cost layers");
  console.log("----------------------------------------------------------------------");

  const consumption = await prisma.$transaction(async (tx) => {
    return consumeCostLayersFIFO({
      productId: product.id,
      locationId: locA.id,
      quantity: 150,
    }, tx);
  });

  console.log(`✓ Total COGS Realized: PKR ${consumption.totalCOGS.toLocaleString()}`);
  console.log(`✓ Average Unit Cost: PKR ${consumption.averageUnitCost.toFixed(2)}`);
  console.log(`✓ Consumed Allocations (${consumption.allocations.length} layers):`);
  consumption.allocations.forEach((a, idx) => {
    console.log(`    Chunk ${idx + 1}: ${a.quantity} units @ PKR ${a.unitCost} (${a.sourceType} - Ref: ${a.sourceId}) = PKR ${a.totalCost.toLocaleString()}`);
  });

  const bal3 = await getCostLayerBalance(product.id, locA.id);
  console.log(`✓ Remaining Cost-Layer Stock: ${bal3.totalQuantity} units | Remaining Valuation: PKR ${bal3.totalValuation.toLocaleString()}`);

  if (consumption.totalCOGS !== 160000) {
    throw new Error(`Test 3 Failed: Expected COGS PKR 160,000, got PKR ${consumption.totalCOGS}`);
  }
  if (bal3.totalQuantity !== 50 || bal3.totalValuation !== 60000) {
    throw new Error(`Test 3 Failed: Expected 50 units remaining & PKR 60,000 valuation, got ${bal3.totalQuantity} units & PKR ${bal3.totalValuation}`);
  }

  // -------------------------------------------------------------------------
  // TEST 4: Insufficient Stock Validation
  // Attempt to consume 60 units when only 50 units remain without fallback
  // -------------------------------------------------------------------------
  console.log("\n----------------------------------------------------------------------");
  console.log("TEST 4: Insufficient Stock Rejection Check");
  console.log("----------------------------------------------------------------------");

  let caughtError = false;
  try {
    await prisma.$transaction(async (tx) => {
      return consumeCostLayersFIFO({
        productId: product.id,
        locationId: locA.id,
        quantity: 60,
        allowFallback: false,
      }, tx);
    });
  } catch (err: any) {
    caughtError = true;
    console.log(`✓ Successfully rejected over-consumption: "${err.message}"`);
  }

  if (!caughtError) {
    throw new Error("Test 4 Failed: Expected over-consumption to throw error, but succeeded!");
  }

  // Verify remaining balance remained intact
  const bal4 = await getCostLayerBalance(product.id, locA.id);
  if (bal4.totalQuantity !== 50) {
    throw new Error(`Test 4 Failed: Expected balance to stay at 50, but got ${bal4.totalQuantity}`);
  }
  console.log(`✓ Invariant Verified: Balance stayed intact at ${bal4.totalQuantity} units.`);

  // -------------------------------------------------------------------------
  // TEST 5: Multiple Locations Isolation
  // -------------------------------------------------------------------------
  console.log("\n----------------------------------------------------------------------");
  console.log("TEST 5: Multi-Location Cost Layer Isolation");
  console.log("----------------------------------------------------------------------");

  // Ingest 80 units @ 1,500 at locB
  await prisma.$transaction(async (tx) => {
    return recordCostLayer({
      productId: product.id,
      locationId: locB.id,
      sourceType: "PURCHASE",
      sourceId: `PUR-WH-${ts}`,
      unitCost: 1500,
      quantity: 80,
    }, tx);
  });

  const balLocA = await getCostLayerBalance(product.id, locA.id);
  const balLocB = await getCostLayerBalance(product.id, locB.id);

  console.log(`✓ Location A (Shop): ${balLocA.totalQuantity} units @ PKR 1,200 = PKR ${balLocA.totalValuation.toLocaleString()}`);
  console.log(`✓ Location B (Warehouse): ${balLocB.totalQuantity} units @ PKR 1,500 = PKR ${balLocB.totalValuation.toLocaleString()}`);

  // Consume 30 units from Location B
  const consumeB = await prisma.$transaction(async (tx) => {
    return consumeCostLayersFIFO({
      productId: product.id,
      locationId: locB.id,
      quantity: 30,
    }, tx);
  });

  console.log(`✓ Consumed from Location B: 30 units @ PKR ${consumeB.averageUnitCost} = PKR ${consumeB.totalCOGS.toLocaleString()}`);
  const balLocAAfter = await getCostLayerBalance(product.id, locA.id);
  const balLocBAfter = await getCostLayerBalance(product.id, locB.id);

  if (balLocAAfter.totalQuantity !== 50 || balLocAAfter.totalValuation !== 60000) {
    throw new Error("Test 5 Failed: Location A stock was corrupted by Location B consumption!");
  }
  if (balLocBAfter.totalQuantity !== 50 || balLocBAfter.totalValuation !== 75000) {
    throw new Error(`Test 5 Failed: Location B expected 50 units @ PKR 75,000, got ${balLocBAfter.totalQuantity} & ${balLocBAfter.totalValuation}`);
  }
  console.log(`✓ Verified: Location A remains 50 units @ PKR 1,200; Location B remains 50 units @ PKR 1,500.`);

  // -------------------------------------------------------------------------
  // TEST 6: Multiple Warehouse Lots Isolation
  // -------------------------------------------------------------------------
  console.log("\n----------------------------------------------------------------------");
  console.log("TEST 6: Multi-Lot Cost Layer Isolation");
  console.log("----------------------------------------------------------------------");

  const lot1 = await prisma.warehouseLot.create({
    data: {
      locationId: locB.id,
      lotNumber: `LOT-ALPHA-${ts}`,
      unitCost: 1100,
    },
  });

  const lot2 = await prisma.warehouseLot.create({
    data: {
      locationId: locB.id,
      lotNumber: `LOT-BETA-${ts}`,
      unitCost: 1400,
    },
  });

  await prisma.$transaction(async (tx) => {
    await recordCostLayer({
      productId: product.id,
      locationId: locB.id,
      warehouseLotId: lot1.id,
      sourceType: "PURCHASE",
      sourceId: `PUR-LOT1-${ts}`,
      unitCost: 1100,
      quantity: 30,
    }, tx);

    await recordCostLayer({
      productId: product.id,
      locationId: locB.id,
      warehouseLotId: lot2.id,
      sourceType: "PURCHASE",
      sourceId: `PUR-LOT2-${ts}`,
      unitCost: 1400,
      quantity: 40,
    }, tx);
  });

  // Consume 20 units specifically targeting lot2
  const consumeLot2 = await prisma.$transaction(async (tx) => {
    return consumeCostLayersFIFO({
      productId: product.id,
      locationId: locB.id,
      warehouseLotId: lot2.id,
      quantity: 20,
    }, tx);
  });

  console.log(`✓ Consumed from Lot 2 (${lot2.lotNumber}): 20 units @ PKR ${consumeLot2.averageUnitCost} = PKR ${consumeLot2.totalCOGS.toLocaleString()}`);
  if (consumeLot2.totalCOGS !== 28000) {
    throw new Error(`Test 6 Failed: Expected COGS 28,000 for Lot 2, got ${consumeLot2.totalCOGS}`);
  }

  const balLot1 = await getCostLayerBalance(product.id, locB.id, lot1.id);
  const balLot2 = await getCostLayerBalance(product.id, locB.id, lot2.id);

  if (balLot1.totalQuantity !== 30 || balLot1.totalValuation !== 33000) {
    throw new Error(`Test 6 Failed: Lot 1 expected 30 units @ PKR 33,000, got ${balLot1.totalQuantity} & ${balLot1.totalValuation}`);
  }
  if (balLot2.totalQuantity !== 20 || balLot2.totalValuation !== 28000) {
    throw new Error(`Test 6 Failed: Lot 2 expected 20 units @ PKR 28,000, got ${balLot2.totalQuantity} & ${balLot2.totalValuation}`);
  }
  console.log(`✓ Verified: Lot 1 untouched (30 @ PKR 1,100); Lot 2 decremented to 20 @ PKR 1,400.`);

  // -------------------------------------------------------------------------
  // TEST 7: Inter-Location Transfer FIFO Propagation
  // Transfer 20 units from locA (@ 1,200) to locB
  // -------------------------------------------------------------------------
  console.log("\n----------------------------------------------------------------------");
  console.log("TEST 7: Inter-Location Transfer Cost Layer Propagation");
  console.log("----------------------------------------------------------------------");

  const trf = await prisma.$transaction(async (tx) => {
    return transferCostLayersFIFO({
      productId: product.id,
      fromLocationId: locA.id,
      toLocationId: locB.id,
      quantity: 20,
      referenceId: `TRF-${ts}`,
    }, tx);
  });

  console.log(`✓ Transferred 20 units from Location A to Location B.`);
  console.log(`✓ Consumed at Location A: 20 units @ PKR ${trf.consumption.averageUnitCost} (Total: PKR ${trf.consumption.totalCOGS.toLocaleString()})`);
  console.log(`✓ New Layer Created at Location B: Qty=${trf.createdLayers[0].initialQty} @ PKR ${trf.createdLayers[0].unitCost}`);

  const balLocAAfterTrf = await getCostLayerBalance(product.id, locA.id);
  if (balLocAAfterTrf.totalQuantity !== 30 || balLocAAfterTrf.totalValuation !== 36000) {
    throw new Error(`Test 7 Failed: Expected Location A to have 30 units @ PKR 36,000, got ${balLocAAfterTrf.totalQuantity} & ${balLocAAfterTrf.totalValuation}`);
  }
  console.log(`✓ Verified: Location A decremented from 50 to 30 units @ PKR 1,200.`);

  // -------------------------------------------------------------------------
  // TEST 8: Concurrent / Transactional Race Protection
  // Simulate 2 parallel consumers attempting to consume simultaneously
  // -------------------------------------------------------------------------
  console.log("\n----------------------------------------------------------------------");
  console.log("TEST 8: Concurrent Transactional Locking & Non-Negative Invariants");
  console.log("----------------------------------------------------------------------");

  // Location A currently has 30 units.
  // Run two concurrent promises each asking for 20 units.
  // Exactly one should succeed with 20 units, and the other should either take the remaining 10 or reject on insufficient stock!
  const results = await Promise.allSettled([
    prisma.$transaction(async (tx) => {
      return consumeCostLayersFIFO({
        productId: product.id,
        locationId: locA.id,
        quantity: 20,
        allowFallback: false,
      }, tx);
    }),
    prisma.$transaction(async (tx) => {
      return consumeCostLayersFIFO({
        productId: product.id,
        locationId: locA.id,
        quantity: 20,
        allowFallback: false,
      }, tx);
    }),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");

  console.log(`✓ Parallel Execution Result: ${fulfilled.length} fulfilled, ${rejected.length} rejected on insufficient capacity.`);
  if (fulfilled.length !== 1 || rejected.length !== 1) {
    throw new Error(`Test 8 Failed: Expected exactly 1 to fulfill and 1 to reject without over-spending stock!`);
  }

  const balFinal = await getCostLayerBalance(product.id, locA.id);
  console.log(`✓ Final Location A Balance: ${balFinal.totalQuantity} units (Expected: 10 units) | Valuation: PKR ${balFinal.totalValuation.toLocaleString()}`);
  if (balFinal.totalQuantity !== 10 || balFinal.totalValuation !== 12000) {
    throw new Error(`Test 8 Failed: Expected exactly 10 units remaining, got ${balFinal.totalQuantity}`);
  }

  console.log("\n" + "=".repeat(80));
  console.log("ALL PHASE 2 FIFO & INVENTORY FOUNDATION TESTS PASSED WITH 100% CPA COMPLIANCE!");
  console.log("=".repeat(80));
}

runPhase2Tests()
  .catch((err) => {
    console.error("FATAL TEST FAILURE:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

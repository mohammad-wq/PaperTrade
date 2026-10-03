const { PrismaClient, StockMovementType } = require("@prisma/client");
const fs = require("fs");
const path = require("path");

const envPath = path.resolve(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined) {
      let value = match[2];
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[match[1]] = value;
    }
  }
}

const prisma = new PrismaClient();

function getArg(name) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

async function getLotOnHand(productId, locationId, warehouseLotId, db = prisma) {
  const movements = await db.stockMovement.groupBy({
    by: ["type"],
    where: { productId, locationId, warehouseLotId },
    _sum: { quantity: true },
  });
  const inbound = new Set([
    StockMovementType.PURCHASE_IN,
    StockMovementType.TRANSFER_IN,
    StockMovementType.SALE_RETURN,
  ]);
  const outbound = new Set([
    StockMovementType.SALE_OUT,
    StockMovementType.TRANSFER_OUT,
    StockMovementType.DELIVERY_OUT,
    StockMovementType.PURCHASE_RETURN,
  ]);

  return movements.reduce((total, movement) => {
    const quantity = Number(movement._sum.quantity || 0);
    if (movement.type === StockMovementType.ADJUSTMENT || inbound.has(movement.type)) {
      return total + quantity;
    }
    if (outbound.has(movement.type)) return total - quantity;
    return total;
  }, 0);
}

async function main() {
  const invoiceNo = getArg("invoice-no");
  const sourceLotId = getArg("source-lot-id");
  const shopLotNumber = getArg("shop-lot-number") || "TESTPA-SHOP";
  const apply = process.argv.includes("--apply");

  if (!invoiceNo || !sourceLotId) {
    throw new Error(
      "Specify --invoice-no=<purchase-invoice-number> and --source-lot-id=<verified-source-lot-id>. The script is dry-run unless --apply is supplied.",
    );
  }

  const invoice = await prisma.purchaseInvoice.findUnique({
    where: { invoiceNo },
    include: {
      location: { select: { id: true, name: true, type: true } },
      items: true,
    },
  });
  if (!invoice) throw new Error(`Purchase invoice ${invoiceNo} was not found.`);
  if (!invoice.isPartnership) throw new Error(`${invoiceNo} is not flagged as a partnership invoice.`);
  if (
    invoice.location.type !== "SHOP" ||
    !invoice.location.name.toLowerCase().includes("shop")
  ) {
    throw new Error(`${invoiceNo} does not receive stock at a shop location.`);
  }

  const sourceLot = await prisma.warehouseLot.findUnique({
    where: { id: sourceLotId },
    include: { location: { select: { id: true, name: true, type: true } } },
  });
  const partnerId = invoice.partnershipId || invoice.supplierId;
  if (
    !sourceLot ||
    !sourceLot.isActive ||
    sourceLot.deletedAt ||
    sourceLot.location.type !== "WAREHOUSE" ||
    !sourceLot.location.name.toLowerCase().includes("partnership") ||
    sourceLot.partnerId !== partnerId
  ) {
    throw new Error("The source lot must be an active lot owned by this partner in Partnership Warehouse.");
  }

  const shopLot = await prisma.warehouseLot.findUnique({
    where: {
      locationId_lotNumber: {
        locationId: invoice.locationId,
        lotNumber: shopLotNumber,
      },
    },
  });
  if (
    !shopLot ||
    !shopLot.isActive ||
    shopLot.deletedAt ||
    shopLot.partnerId !== partnerId
  ) {
    throw new Error(
      `Partner lot ${shopLotNumber} was not found or is not assigned to this partnership at ${invoice.location.name}.`,
    );
  }

  const plans = [];
  const seenProductIds = new Set();
  for (const item of invoice.items) {
    if (seenProductIds.has(item.productId)) {
      throw new Error(
        `Invoice ${invoiceNo} has multiple lines for product ${item.productId}; repair those lines individually after review.`,
      );
    }
    seenProductIds.add(item.productId);
    if (item.locationId && item.locationId !== invoice.locationId) {
      throw new Error(`Invoice line ${item.id} does not use the invoice receiving location.`);
    }
    if (item.warehouseLotId && item.warehouseLotId !== shopLot.id && item.warehouseLotId !== sourceLot.id) {
      throw new Error(`Invoice line ${item.id} already references a different lot.`);
    }

    const inbound = await prisma.stockMovement.findMany({
      where: {
        referenceType: "PURCHASE_INVOICE",
        referenceId: invoice.id,
        type: StockMovementType.PURCHASE_IN,
        productId: item.productId,
        locationId: invoice.locationId,
        quantity: item.quantity,
      },
    });
    if (inbound.length !== 1) {
      throw new Error(`Expected one matching shop PURCHASE_IN movement for line ${item.id}; found ${inbound.length}.`);
    }
    if (inbound[0].warehouseLotId && inbound[0].warehouseLotId !== shopLot.id) {
      throw new Error(`Shop movement ${inbound[0].id} already references a different lot.`);
    }

    const sourceOut = await prisma.stockMovement.findMany({
      where: {
        referenceType: "PARTNERSHIP_PULL",
        referenceId: invoice.invoiceNo,
        type: StockMovementType.TRANSFER_OUT,
        productId: item.productId,
        locationId: sourceLot.locationId,
        warehouseLotId: sourceLot.id,
      },
    });
    if (sourceOut.length > 1 || (sourceOut.length === 1 && Number(sourceOut[0].quantity) !== Number(item.quantity))) {
      throw new Error(`Source transfer for invoice line ${item.id} is ambiguous or has a different quantity.`);
    }

    plans.push({
      item,
      inboundMovement: inbound[0],
      addSourceTransfer: sourceOut.length === 0,
    });
  }

  for (const { item, addSourceTransfer } of plans.filter((plan) => plan.addSourceTransfer)) {
    const available = await getLotOnHand(
      item.productId,
      sourceLot.locationId,
      sourceLot.id,
    );
    if (available < Number(item.quantity)) {
      throw new Error(
        `Cannot add source transfer for ${item.productId}: ${available} available, ${item.quantity} requested.`,
      );
    }
  }

  console.log(
    `${invoice.invoiceNo}: ${plans.length} line(s), shop lot #${shopLot.lotNumber}; source lot #${sourceLot.lotNumber} at ${sourceLot.location.name}.`,
  );
  for (const { item, inboundMovement, addSourceTransfer } of plans) {
    console.log(
      `${item.productId}: ${item.quantity.toString()} ${addSourceTransfer ? "add source TRANSFER_OUT" : "source TRANSFER_OUT already present"}, ${inboundMovement.warehouseLotId ? "shop lot already linked" : "link shop PURCHASE_IN to destination lot"}.`,
    );
  }
  if (!apply) {
    console.log("Dry run only; pass --apply after verifying the invoice and both lots.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const { item, inboundMovement, addSourceTransfer } of plans) {
      if (!item.warehouseLotId || item.warehouseLotId !== shopLot.id) {
        await tx.purchaseInvoiceItem.update({
          where: { id: item.id },
          data: { warehouseLotId: shopLot.id },
        });
      }
      if (!inboundMovement.warehouseLotId) {
        await tx.stockMovement.update({
          where: { id: inboundMovement.id },
          data: { warehouseLotId: shopLot.id },
        });
      }
      if (addSourceTransfer) {
        const available = await getLotOnHand(
          item.productId,
          sourceLot.locationId,
          sourceLot.id,
          tx,
        );
        if (available < Number(item.quantity)) {
          throw new Error(
            `Cannot add source transfer for ${item.productId}: ${available} available, ${item.quantity} requested.`,
          );
        }
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            locationId: sourceLot.locationId,
            warehouseLotId: sourceLot.id,
            type: StockMovementType.TRANSFER_OUT,
            quantity: item.quantity,
            referenceType: "PARTNERSHIP_PULL",
            referenceId: invoice.invoiceNo,
            createdById: invoice.createdById,
            createdAt: invoice.date,
            notes: `Repaired source deduction for partnership pull ${invoice.invoiceNo}`,
          },
        });
      }
    }
  });
  console.log("Repair applied successfully.");
}

main()
  .catch((error) => {
    console.error("Partnership pull repair failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

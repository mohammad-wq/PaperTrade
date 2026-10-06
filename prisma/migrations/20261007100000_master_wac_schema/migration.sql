-- Master WAC schema: ProductCostState, CostMovement, ownership + ledger idempotency

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "ownershipType" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "ownershipKey" TEXT;

-- AlterTable
ALTER TABLE "PurchaseInvoiceItem" ADD COLUMN IF NOT EXISTS "landedUnitCost" DECIMAL(14,4);

-- AlterTable
ALTER TABLE "DeliveryOrderItem" ADD COLUMN IF NOT EXISTS "destinationLocationId" TEXT;
ALTER TABLE "DeliveryOrderItem" ADD COLUMN IF NOT EXISTS "partnershipLotId" TEXT;
ALTER TABLE "DeliveryOrderItem" ADD COLUMN IF NOT EXISTS "ownershipType" TEXT;
ALTER TABLE "DeliveryOrderItem" ADD COLUMN IF NOT EXISTS "ownershipKey" TEXT;

-- AlterTable
ALTER TABLE "SaleInvoiceItem" ADD COLUMN IF NOT EXISTS "ownershipType" TEXT;
ALTER TABLE "SaleInvoiceItem" ADD COLUMN IF NOT EXISTS "ownershipKey" TEXT;

-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN IF NOT EXISTS "lineType" TEXT;
ALTER TABLE "LedgerEntry" ADD COLUMN IF NOT EXISTS "lineNo" INTEGER;
ALTER TABLE "LedgerEntry" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
ALTER TABLE "LedgerEntry" ADD COLUMN IF NOT EXISTS "ownershipType" TEXT;
ALTER TABLE "LedgerEntry" ADD COLUMN IF NOT EXISTS "ownershipKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "LedgerEntry_idempotencyKey_key" ON "LedgerEntry"("idempotencyKey");

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "partnershipLotId" TEXT;
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "categoryLabel" TEXT;
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "isOperatingExpense" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS "Expense_partnershipLotId_idx" ON "Expense"("partnershipLotId");

ALTER TABLE "Expense" ADD CONSTRAINT "Expense_partnershipLotId_fkey"
  FOREIGN KEY ("partnershipLotId") REFERENCES "PartnershipLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "PartnershipLot" ADD COLUMN IF NOT EXISTS "archetype" TEXT;
CREATE INDEX IF NOT EXISTS "PartnershipLot_archetype_idx" ON "PartnershipLot"("archetype");

UPDATE "PartnershipLot"
SET "archetype" = CASE
  WHEN "type" = 'CONSIGNMENT_VMI' THEN 'CONSIGNMENT'
  ELSE 'CO_INVESTED'
END
WHERE "archetype" IS NULL;

-- AlterTable
ALTER TABLE "PartnershipSaleAllocation" ADD COLUMN IF NOT EXISTS "soldBy" TEXT NOT NULL DEFAULT 'OWNER';
CREATE INDEX IF NOT EXISTS "PartnershipSaleAllocation_soldBy_idx" ON "PartnershipSaleAllocation"("soldBy");

-- CreateTable
CREATE TABLE IF NOT EXISTS "ProductCostState" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "ownershipType" TEXT NOT NULL,
    "partnershipLotId" TEXT,
    "ownershipKey" TEXT NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "avgCost" DECIMAL(14,4) NOT NULL,
    "totalValue" DECIMAL(14,4) NOT NULL,
    "hasNegativeStock" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCostState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CostMovement" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "ownershipKey" TEXT NOT NULL,
    "movementType" TEXT NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "qtyBefore" DECIMAL(14,4) NOT NULL,
    "avgBefore" DECIMAL(14,4) NOT NULL,
    "qtyDelta" DECIMAL(14,4) NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,
    "totalCost" DECIMAL(14,4) NOT NULL,
    "qtyAfter" DECIMAL(14,4) NOT NULL,
    "avgAfter" DECIMAL(14,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostMovement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductCostState_productId_locationId_ownershipKey_key"
  ON "ProductCostState"("productId", "locationId", "ownershipKey");

CREATE INDEX IF NOT EXISTS "ProductCostState_partnershipLotId_idx" ON "ProductCostState"("partnershipLotId");
CREATE INDEX IF NOT EXISTS "ProductCostState_ownershipKey_idx" ON "ProductCostState"("ownershipKey");

CREATE INDEX IF NOT EXISTS "CostMovement_productId_locationId_ownershipKey_createdAt_idx"
  ON "CostMovement"("productId", "locationId", "ownershipKey", "createdAt");

CREATE INDEX IF NOT EXISTS "CostMovement_referenceType_referenceId_idx"
  ON "CostMovement"("referenceType", "referenceId");

ALTER TABLE "ProductCostState" ADD CONSTRAINT "ProductCostState_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductCostState" ADD CONSTRAINT "ProductCostState_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductCostState" ADD CONSTRAINT "ProductCostState_partnershipLotId_fkey"
  FOREIGN KEY ("partnershipLotId") REFERENCES "PartnershipLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CostMovement" ADD CONSTRAINT "CostMovement_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CostMovement" ADD CONSTRAINT "CostMovement_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

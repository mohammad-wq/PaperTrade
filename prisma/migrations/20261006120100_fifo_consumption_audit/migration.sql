-- AlterTable
ALTER TABLE "InventoryCostLayer" ADD COLUMN IF NOT EXISTS "partnershipLotId" TEXT;

CREATE INDEX IF NOT EXISTS "InventoryCostLayer_partnershipLotId_idx" ON "InventoryCostLayer"("partnershipLotId");

-- CreateTable
CREATE TABLE IF NOT EXISTS "InventoryCostLayerConsumption" (
    "id" TEXT NOT NULL,
    "layerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "warehouseLotId" TEXT,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryCostLayerConsumption_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "InventoryCostLayerConsumption_referenceType_referenceId_idx" ON "InventoryCostLayerConsumption"("referenceType", "referenceId");
CREATE INDEX IF NOT EXISTS "InventoryCostLayerConsumption_layerId_idx" ON "InventoryCostLayerConsumption"("layerId");

ALTER TABLE "InventoryCostLayerConsumption" DROP CONSTRAINT IF EXISTS "InventoryCostLayerConsumption_layerId_fkey";
ALTER TABLE "InventoryCostLayerConsumption" ADD CONSTRAINT "InventoryCostLayerConsumption_layerId_fkey" FOREIGN KEY ("layerId") REFERENCES "InventoryCostLayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

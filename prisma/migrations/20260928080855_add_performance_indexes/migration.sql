-- CreateIndex
CREATE INDEX "LedgerEntry_partyId_idx" ON "LedgerEntry"("partyId");

-- CreateIndex
CREATE INDEX "LedgerEntry_accountType_idx" ON "LedgerEntry"("accountType");

-- CreateIndex
CREATE INDEX "Party_deletedAt_idx" ON "Party"("deletedAt");

-- CreateIndex
CREATE INDEX "Party_isActive_deletedAt_idx" ON "Party"("isActive", "deletedAt");

-- CreateIndex
CREATE INDEX "Product_deletedAt_idx" ON "Product"("deletedAt");

-- CreateIndex
CREATE INDEX "Product_isActive_deletedAt_idx" ON "Product"("isActive", "deletedAt");

-- CreateIndex
CREATE INDEX "StockMovement_productId_locationId_warehouseLotId_type_idx" ON "StockMovement"("productId", "locationId", "warehouseLotId", "type");

-- CreateIndex
CREATE INDEX "StockMovement_locationId_idx" ON "StockMovement"("locationId");

-- CreateIndex
CREATE INDEX "WarehouseLot_deletedAt_idx" ON "WarehouseLot"("deletedAt");

-- CreateIndex
CREATE INDEX "WarehouseLot_isActive_deletedAt_idx" ON "WarehouseLot"("isActive", "deletedAt");

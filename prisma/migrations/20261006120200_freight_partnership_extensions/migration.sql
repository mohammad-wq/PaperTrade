ALTER TABLE "SaleInvoice" ADD COLUMN IF NOT EXISTS "actualFreightCost" DECIMAL(14,4);
ALTER TABLE "SaleReturnItem" ADD COLUMN IF NOT EXISTS "costRestoredAmount" DECIMAL(14,4) NOT NULL DEFAULT 0;
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "saleInvoiceId" TEXT;
ALTER TABLE "PartnershipLot" ADD COLUMN IF NOT EXISTS "warehouseLotId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "PartnershipLot_warehouseLotId_key" ON "PartnershipLot"("warehouseLotId");
ALTER TABLE "PartnershipExpense" ADD COLUMN IF NOT EXISTS "entityShare" DECIMAL(12,2);
ALTER TABLE "PartnershipExpense" ADD COLUMN IF NOT EXISTS "partnerShare" DECIMAL(12,2);

CREATE TYPE "PartnershipSettlementKind" AS ENUM ('CAPITAL', 'PROFIT', 'EXPENSE_REIMBURSEMENT');

CREATE TABLE IF NOT EXISTS "PartnershipSettlementAllocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "kind" "PartnershipSettlementKind" NOT NULL,
    "amount" DECIMAL(14,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PartnershipSettlementAllocation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PartnershipSettlementAllocation_paymentId_idx" ON "PartnershipSettlementAllocation"("paymentId");
CREATE INDEX IF NOT EXISTS "PartnershipSettlementAllocation_lotId_idx" ON "PartnershipSettlementAllocation"("lotId");

-- AlterEnum: AccountType
ALTER TYPE "AccountType" ADD VALUE IF NOT EXISTS 'COGS';
ALTER TYPE "AccountType" ADD VALUE IF NOT EXISTS 'DIRECT_COST';
ALTER TYPE "AccountType" ADD VALUE IF NOT EXISTS 'EQUITY';

-- CreateEnum
CREATE TYPE "LedgerAccountSubtype" AS ENUM (
  'PRODUCT_SALES',
  'FREIGHT_REVENUE',
  'TRADE_PAYABLE',
  'PARTNER_CAPITAL',
  'PARTNER_PROFIT',
  'PARTNER_EXPENSE_DUE',
  'OPEX',
  'CASH_DRAWER',
  'BANK',
  'JAZZCASH',
  'EASYPAISA',
  'OPENING_STOCK_EQUITY'
);

-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN IF NOT EXISTS "accountSubtype" "LedgerAccountSubtype";

CREATE INDEX IF NOT EXISTS "LedgerEntry_accountSubtype_idx" ON "LedgerEntry"("accountSubtype");

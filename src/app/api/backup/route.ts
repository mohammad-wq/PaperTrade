import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { prisma } from "@/lib/db";
import { Role } from "@prisma/client";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export const dynamic = "force-dynamic";

/**
 * Programmatic fallback exporter if pg_dump is not available.
 * Generates valid, transactional SQL statements for all tables.
 */
async function generateProgrammaticSqlDump(): Promise<string> {
  const timestamp = new Date().toISOString();
  const lines: string[] = [
    `-- ==========================================================`,
    `-- Paper Trade Database Backup (Automated Export)`,
    `-- Generated At: ${timestamp}`,
    `-- Format: PostgreSQL Compatible SQL Dump`,
    `-- ==========================================================`,
    `BEGIN;`,
    `SET statement_timeout = 0;`,
    `SET client_encoding = 'UTF8';`,
    `SET standard_conforming_strings = on;`,
    ``,
    `-- Disable foreign key checks during import`,
    `SET session_replication_role = 'replica';`,
    ``,
  ];

  // Helper to escape SQL values
  const sqlVal = (val: unknown): string => {
    if (val === null || val === undefined) return "NULL";
    if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
    if (typeof val === "number") return String(val);
    if (val instanceof Date) return `'${val.toISOString()}'`;
    if (typeof val === "object") {
      // Decimal or JSON
      return `'${String(val).replace(/'/g, "''")}'`;
    }
    return `'${String(val).replace(/'/g, "''")}'`;
  };

  const dumpTable = async (tableName: string, fetchFn: () => Promise<any[]>) => {
    const rows = await fetchFn();
    lines.push(`-- Table: ${tableName} (${rows.length} records)`);
    lines.push(`TRUNCATE TABLE "${tableName}" CASCADE;`);
    if (rows.length > 0) {
      const cols = Object.keys(rows[0]);
      const colList = cols.map((c) => `"${c}"`).join(", ");
      for (const row of rows) {
        const valList = cols.map((c) => sqlVal(row[c])).join(", ");
        lines.push(`INSERT INTO "${tableName}" (${colList}) VALUES (${valList});`);
      }
    }
    lines.push(``);
  };

  await dumpTable("User", () => prisma.user.findMany());
  await dumpTable("Location", () => prisma.location.findMany());
  await dumpTable("Category", () => prisma.category.findMany());
  await dumpTable("Quality", () => prisma.quality.findMany());
  await dumpTable("Product", () => prisma.product.findMany());
  await dumpTable("ProductPriceHistory", () => prisma.productPriceHistory.findMany());
  await dumpTable("Party", () => prisma.party.findMany());
  await dumpTable("PurchaseOrder", () => prisma.purchaseOrder.findMany());
  await dumpTable("PurchaseOrderItem", () => prisma.purchaseOrderItem.findMany());
  await dumpTable("PurchaseInvoice", () => prisma.purchaseInvoice.findMany());
  await dumpTable("PurchaseInvoiceItem", () => prisma.purchaseInvoiceItem.findMany());
  await dumpTable("DeliveryOrder", () => prisma.deliveryOrder.findMany());
  await dumpTable("DeliveryOrderItem", () => prisma.deliveryOrderItem.findMany());
  await dumpTable("SaleInvoice", () => prisma.saleInvoice.findMany());
  await dumpTable("SaleInvoiceItem", () => prisma.saleInvoiceItem.findMany());
  await dumpTable("SaleReturn", () => prisma.saleReturn.findMany());
  await dumpTable("SaleReturnItem", () => prisma.saleReturnItem.findMany());
  await dumpTable("PurchaseReturn", () => prisma.purchaseReturn.findMany());
  await dumpTable("PurchaseReturnItem", () => prisma.purchaseReturnItem.findMany());
  await dumpTable("StockMovement", () => prisma.stockMovement.findMany());
  await dumpTable("LedgerEntry", () => prisma.ledgerEntry.findMany());
  await dumpTable("Payment", () => prisma.payment.findMany());
  await dumpTable("WarehouseStorageCharge", () => prisma.warehouseStorageCharge.findMany());
  await dumpTable("AppSetting", () => prisma.appSetting.findMany());

  lines.push(`-- Re-enable foreign key checks`);
  lines.push(`SET session_replication_role = 'origin';`);
  lines.push(`COMMIT;`);
  lines.push(`-- Backup completed successfully`);

  return lines.join("\n");
}

export async function GET(request: NextRequest) {
  // 1. Enforce Authentication and OWNER role
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== Role.OWNER) {
    return NextResponse.json({ success: false, error: "Unauthorized. Admin privileges required." }, { status: 403 });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `papertrade-backup-${timestamp}.sql`;

  try {
    let sqlContent: string | null = null;
    const dbUrl = process.env.DATABASE_URL;

    // 2. Try native pg_dump if available
    if (dbUrl) {
      try {
        const { stdout } = await execAsync(`pg_dump "${dbUrl}" --no-owner --no-acl --clean --if-exists`, {
          timeout: 30000,
          maxBuffer: 50 * 1024 * 1024,
        });
        if (stdout && stdout.length > 50) {
          sqlContent = stdout;
        }
      } catch {
        // pg_dump not installed or failed, fallback to programmatic export
      }
    }

    // 3. Fallback to programmatic dump
    if (!sqlContent) {
      sqlContent = await generateProgrammaticSqlDump();
    }

    // 4. Record last backup timestamp
    try {
      await prisma.appSetting.upsert({
        where: { key: "last_backup_at" },
        update: { value: new Date().toISOString() },
        create: { key: "last_backup_at", value: new Date().toISOString() },
      });
    } catch (e) {
      console.warn("Could not save backup timestamp:", e);
    }

    return new Response(sqlContent, {
      status: 200,
      headers: {
        "Content-Type": "application/sql",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error) {
    console.error("[Backup Error]:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to generate database backup." },
      { status: 500 },
    );
  }
}


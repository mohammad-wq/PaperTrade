"use server";

import { runAction } from "@/actions/_helpers";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { Role } from "@prisma/client";
import { executeBackup, readRecentBackupLogs } from "@/lib/backup-runner";

export async function getDatabaseStatsAction() {
  return runAction("backup.stats", async () => {
    await requireRole([Role.OWNER]);

    const [
      productsCount,
      partiesCount,
      salesCount,
      purchasesCount,
      ledgerCount,
      lastBackupSetting,
    ] = await Promise.all([
      prisma.product.count({ where: { isActive: true } }),
      prisma.party.count({ where: { isActive: true } }),
      prisma.saleInvoice.count(),
      prisma.purchaseInvoice.count(),
      prisma.ledgerEntry.count(),
      prisma.appSetting.findUnique({ where: { key: "last_backup_at" } }),
    ]);

    return {
      productsCount,
      partiesCount,
      salesCount,
      purchasesCount,
      ledgerCount,
      lastBackupAt: lastBackupSetting?.value || null,
    };
  });
}

export async function recordBackupAction() {
  return runAction("backup.record", async () => {
    await requireRole([Role.OWNER]);
    const now = new Date().toISOString();

    await prisma.appSetting.upsert({
      where: { key: "last_backup_at" },
      update: { value: now },
      create: { key: "last_backup_at", value: now },
    });

    return { success: true, timestamp: now };
  });
}

/**
 * Trigger immediate manual backup (runs local dump + cloud sync)
 * Restricted to Role.OWNER
 */
export async function triggerManualBackupAction() {
  return runAction("backup.triggerManual", async () => {
    await requireRole([Role.OWNER]);

    const result = await executeBackup("manual");

    if (result.success && result.local?.success) {
      const now = new Date().toISOString();
      await prisma.appSetting.upsert({
        where: { key: "last_backup_at" },
        update: { value: now },
        create: { key: "last_backup_at", value: now },
      });
    }

    return result;
  });
}

/**
 * Fetch recent entries from backup-log.txt
 * Restricted to Role.OWNER
 */
export async function getBackupLogsAction(limit = 30) {
  return runAction("backup.getLogs", async () => {
    await requireRole([Role.OWNER]);
    return await readRecentBackupLogs(limit);
  });
}

"use server";

import { parseInput, runAction } from "@/actions/_helpers";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { settingsSchema } from "@/schemas/settings";
import { Role } from "@prisma/client";

export async function getSettingsAction() {
  return runAction("settings.get", async () => {
    await requireRole([Role.OWNER]);
    const settings = await prisma.appSetting.findMany();
    const map = Object.fromEntries(settings.map((s) => [s.key, s.value]));

    return {
      overdueDays: parseInt(map.overdueDays || process.env.OVERDUE_DAYS || "14", 10),
      businessName: map.businessName || process.env.BUSINESS_NAME || "Paper Trade Co.",
      businessAddress: map.businessAddress || process.env.BUSINESS_ADDRESS || "Shop floor & Main Warehouse",
      businessPhone: map.businessPhone || process.env.BUSINESS_PHONE || "+92 300 1234567",
      businessEmail: map.businessEmail || process.env.BUSINESS_EMAIL || "owner@example.com",
    };
  });
}

export async function updateSettingsAction(raw: unknown) {
  return runAction("settings.update", async () => {
    await requireRole([Role.OWNER]);
    const input = parseInput(settingsSchema, raw);

    await prisma.$transaction([
      prisma.appSetting.upsert({
        where: { key: "overdueDays" },
        update: { value: String(input.overdueDays) },
        create: { key: "overdueDays", value: String(input.overdueDays) },
      }),
      prisma.appSetting.upsert({
        where: { key: "businessName" },
        update: { value: input.businessName },
        create: { key: "businessName", value: input.businessName },
      }),
      prisma.appSetting.upsert({
        where: { key: "businessAddress" },
        update: { value: input.businessAddress || "" },
        create: { key: "businessAddress", value: input.businessAddress || "" },
      }),
      prisma.appSetting.upsert({
        where: { key: "businessPhone" },
        update: { value: input.businessPhone || "" },
        create: { key: "businessPhone", value: input.businessPhone || "" },
      }),
      prisma.appSetting.upsert({
        where: { key: "businessEmail" },
        update: { value: input.businessEmail || "" },
        create: { key: "businessEmail", value: input.businessEmail || "" },
      }),
    ]);

    return { success: true };
  });
}

export async function getBusinessInfoAction() {
  return runAction("settings.getBusinessInfo", async () => {
    await requireSession();
    const settings = await prisma.appSetting.findMany({
      where: {
        key: { in: ["businessName", "businessAddress", "businessPhone", "businessEmail"] },
      },
    });
    const map = Object.fromEntries(settings.map((s) => [s.key, s.value]));

    return {
      businessName: map.businessName || process.env.BUSINESS_NAME || "Sughra Trader",
      businessAddress: map.businessAddress || process.env.BUSINESS_ADDRESS || "",
      businessPhone: map.businessPhone || process.env.BUSINESS_PHONE || "",
      businessEmail: map.businessEmail || process.env.BUSINESS_EMAIL || "",
    };
  });
}

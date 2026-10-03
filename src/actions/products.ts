"use server";

import { z } from "zod";
import { productUpsertSchema } from "@/schemas/product";
import { parseInput, runAction } from "@/actions/_helpers";
import { calculateWeights } from "@/lib/weights";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { userError } from "@/lib/errors";
import { canPerformAction } from "@/lib/auth/permissions";
import { emitRealtimeEvent } from "@/lib/realtime";
import { revalidatePath } from "next/cache";
import { Unit, StockMovementType } from "@prisma/client";

const deleteProductSchema = z.object({ id: z.string().min(1, "Product is required") });

export async function listProductsAction() {
  return runAction("products.list", async () => {
    const session = await requireSession();
    if (
      !canPerformAction(session.user.role, "products", "view", (session.user as any).permissions) &&
      !canPerformAction(session.user.role, "sales", "view", (session.user as any).permissions) &&
      !canPerformAction(session.user.role, "purchases", "view", (session.user as any).permissions) &&
      !canPerformAction(session.user.role, "inventory", "view", (session.user as any).permissions)
    ) {
      throw userError("You do not have permission to view products.");
    }
    const [products, stockSums] = await Promise.all([
      prisma.product.findMany({
        where: { deletedAt: null },
        orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
        include: {
          category: { select: { id: true, name: true } },
          quality: { select: { id: true, name: true } },
        },
      }),
      prisma.stockMovement.groupBy({
        by: ["productId", "type"],
        _sum: { quantity: true },
      }),
    ]);

    const INBOUND_TYPES = new Set<StockMovementType>([
      StockMovementType.PURCHASE_IN,
      StockMovementType.TRANSFER_IN,
      StockMovementType.SALE_RETURN,
    ]);
    const OUTBOUND_TYPES = new Set<StockMovementType>([
      StockMovementType.SALE_OUT,
      StockMovementType.TRANSFER_OUT,
      StockMovementType.DELIVERY_OUT,
      StockMovementType.PURCHASE_RETURN,
    ]);

    const stockMap = new Map<string, number>();
    for (const row of stockSums) {
      const current = stockMap.get(row.productId) ?? 0;
      const qty = Number(row._sum.quantity || 0);
      let delta = 0;
      if (row.type === StockMovementType.ADJUSTMENT || INBOUND_TYPES.has(row.type)) {
        delta = qty;
      } else if (OUTBOUND_TYPES.has(row.type)) {
        delta = -qty;
      }
      stockMap.set(row.productId, current + delta);
    }

    return products.map((product) => ({
      ...product,
      length: Number(product.length),
      breadth: Number(product.breadth),
      gsm: Number(product.gsm),
      packetWeight: Number(product.packetWeight),
      reamWeight: Number(product.reamWeight),
      costPrice: Number(product.costPrice),
      retailPrice: Number(product.retailPrice),
      wholesalePrice: Number(product.wholesalePrice),
      labourCharges: Number(product.labourCharges),
      reorderLevel: product.reorderLevel ? Number(product.reorderLevel) : null,
      currentStock: stockMap.get(product.id) ?? 0,
    }));
  });
}

import {
  getCachedCategories,
  getCachedQualities,
  revalidateCategories,
  revalidateQualities,
} from "@/lib/cached-lookups";

export async function listCategoriesAction() {
  return runAction("categories.list", async () => {
    await requireSession();
    return getCachedCategories();
  });
}

export async function listQualitiesAction() {
  return runAction("qualities.list", async () => {
    await requireSession();
    return getCachedQualities();
  });
}

export async function createCategoryAction(rawName: string) {
  return runAction("categories.create", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "products", "create", (session.user as any).permissions)) {
      throw userError("You do not have permission to create categories.");
    }
    const name = (rawName || "").trim();
    if (!name || name.length < 2) {
      throw userError("Category name must be at least 2 characters.");
    }
    const category = await prisma.category.upsert({
      where: { name },
      update: { isActive: true },
      create: { name, isActive: true },
      select: { id: true, name: true },
    });
    revalidateCategories();
    return category;
  });
}

export async function createQualityAction(rawName: string) {
  return runAction("qualities.create", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "products", "create", (session.user as any).permissions)) {
      throw userError("You do not have permission to create qualities.");
    }
    const name = (rawName || "").trim();
    if (!name || name.length < 2) {
      throw userError("Quality name must be at least 2 characters.");
    }
    const quality = await prisma.quality.upsert({
      where: { name },
      update: { isActive: true },
      create: { name, isActive: true },
      select: { id: true, name: true },
    });
    revalidateQualities();
    return quality;
  });
}

export async function upsertProductAction(raw: unknown) {
  return runAction("products.upsert", async () => {
    const session = await requireSession();
    const input = parseInput(productUpsertSchema, raw);

    const actionType = input.id ? "update" : "create";
    if (!canPerformAction(session.user.role, "products", actionType, (session.user as any).permissions)) {
      throw userError(`You do not have permission to ${actionType} products.`);
    }
    const normalizedInput = {
      ...input,
      isActive: input.isActive === true || input.isActive === "true",
    };
    const weights = calculateWeights(normalizedInput.length, normalizedInput.breadth, normalizedInput.gsm);

    const res = await prisma.$transaction(async (tx) => {
      const existing = await tx.product.findFirst({
        where: {
          productNo: normalizedInput.productNo,
          ...(normalizedInput.id ? { id: { not: normalizedInput.id } } : {}),
        },
      });

      if (existing) {
        throw userError("A product with this Product No already exists.");
      }

      // Defensively resolve categoryId
      let resolvedCategoryId = normalizedInput.categoryId;
      const cat = await tx.category.findUnique({ where: { id: resolvedCategoryId } });
      if (!cat) {
        const fallbackCat = await tx.category.findFirst({ where: { isActive: true } }) ??
          await tx.category.create({ data: { name: "Standard Paper" } });
        resolvedCategoryId = fallbackCat.id;
      }

      // Defensively resolve qualityId
      let resolvedQualityId = normalizedInput.qualityId;
      const qual = await tx.quality.findUnique({ where: { id: resolvedQualityId } });
      if (!qual) {
        const fallbackQual = await tx.quality.findFirst({ where: { isActive: true } }) ??
          await tx.quality.create({ data: { name: "Standard" } });
        resolvedQualityId = fallbackQual.id;
      }

      const productData = {
        productNo: normalizedInput.productNo.trim(),
        name: normalizedInput.name.trim(),
        categoryId: resolvedCategoryId,
        qualityId: resolvedQualityId,
        unit: normalizedInput.unit,
        length: normalizedInput.length,
        breadth: normalizedInput.breadth,
        gsm: normalizedInput.gsm,
        packetWeight: weights.packetWeight,
        reamWeight: weights.reamWeight,
        costPrice: normalizedInput.costPrice,
        retailPrice: normalizedInput.retailPrice,
        wholesalePrice: normalizedInput.wholesalePrice,
        labourCharges: normalizedInput.labourCharges ?? 0,
        reorderLevel: normalizedInput.reorderLevel ?? null,
        serialNo: normalizedInput.serialNo?.trim() || null,
        remarks: normalizedInput.remarks?.trim() || null,
        isActive: Boolean(normalizedInput.isActive),
        deletedAt: null,
      };

      const product = normalizedInput.id
        ? await tx.product.update({ where: { id: normalizedInput.id }, data: productData })
        : await tx.product.create({ data: productData });

      const latestPriceHistory = await tx.productPriceHistory.findFirst({
        where: { productId: product.id },
        orderBy: { effectiveFrom: "desc" },
      });

      const hasPriceChanged =
        !latestPriceHistory ||
        Number(latestPriceHistory.costPrice) !== normalizedInput.costPrice ||
        Number(latestPriceHistory.retailPrice) !== normalizedInput.retailPrice ||
        Number(latestPriceHistory.wholesalePrice) !== normalizedInput.wholesalePrice;

      if (hasPriceChanged) {
        await tx.productPriceHistory.create({
          data: {
            productId: product.id,
            costPrice: normalizedInput.costPrice,
            retailPrice: normalizedInput.retailPrice,
            wholesalePrice: normalizedInput.wholesalePrice,
            createdById: session.user.id,
          },
        });
      }

      return { ...product, packetWeight: Number(product.packetWeight), reamWeight: Number(product.reamWeight) };
    });

    emitRealtimeEvent(["products", "inventory", "sales", "purchases"], normalizedInput.id ? "update" : "create", "Product", {
      id: res.id,
      productNo: res.productNo,
      name: res.name,
    });

    revalidatePath("/products");
    revalidatePath("/inventory");
    revalidatePath("/dashboard");

    return res;
  });
}

export async function softDeleteProductAction(raw: unknown) {
  return runAction("products.delete", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "products", "delete", (session.user as any).permissions)) {
      throw userError("You do not have permission to delete products.");
    }
    const input = parseInput(deleteProductSchema, raw);

    const res = await prisma.$transaction(async (tx) => {
      const product = await tx.product.update({
        where: { id: input.id },
        data: {
          isActive: false,
          deletedAt: new Date(),
        },
      });

      return { id: product.id, success: true };
    });

    emitRealtimeEvent(["products", "inventory", "sales", "purchases"], "delete", "Product", {
      id: input.id,
    });

    revalidatePath("/products");
    revalidatePath("/inventory");
    revalidatePath("/dashboard");

    return res;
  });
}

const productSeriesSchema = z
  .object({
    prefix: z.string().trim().default("P-"),
    startNumber: z.coerce.number().int().min(1),
    endNumber: z.coerce.number().int().min(1),
    padLength: z.coerce.number().int().min(1).max(8).default(4),
    nameTemplate: z.string().trim().min(2, "Product name is required"),
    categoryId: z.string().min(1, "Category is required"),
    qualityId: z.string().min(1, "Quality is required"),
    unit: z.nativeEnum(Unit).default(Unit.PACKET),
    length: z.coerce.number().positive(),
    breadth: z.coerce.number().positive(),
    gsm: z.coerce.number().positive(),
    costPrice: z.coerce.number().min(0),
    retailPrice: z.coerce.number().min(0),
    wholesalePrice: z.coerce.number().min(0),
    labourCharges: z.coerce.number().min(0).default(0),
    reorderLevel: z.coerce.number().min(0).optional().nullable(),
    remarks: z.string().trim().max(500).optional().nullable(),
  })
  .refine((data) => data.endNumber >= data.startNumber, {
    message: "End number must be greater than or equal to start number",
    path: ["endNumber"],
  })
  .refine((data) => data.endNumber - data.startNumber <= 200, {
    message: "Cannot create more than 200 products in a single series",
    path: ["endNumber"],
  });

export async function bulkCreateProductSeriesAction(raw: unknown) {
  return runAction("products.series.create", async () => {
    const session = await requireSession();
    if (!canPerformAction(session.user.role, "products", "create", (session.user as any).permissions)) {
      throw userError("You do not have permission to create products.");
    }
    const input = parseInput(productSeriesSchema, raw);
    const weights = calculateWeights(input.length, input.breadth, input.gsm);

    const generatedProducts: any[] = [];
    const padLength = input.padLength ?? 4;
    for (let n = input.startNumber; n <= input.endNumber; n++) {
      const numStr = String(n).padStart(padLength, "0");
      const productNo = `${input.prefix}${numStr}`;
      const name = input.nameTemplate.includes("{num}")
        ? input.nameTemplate.replace(/\{num\}/g, numStr)
        : `${input.nameTemplate} #${numStr}`;

      generatedProducts.push({
        productNo,
        name,
        categoryId: input.categoryId,
        qualityId: input.qualityId,
        unit: input.unit,
        length: input.length,
        breadth: input.breadth,
        gsm: input.gsm,
        packetWeight: weights.packetWeight,
        reamWeight: weights.reamWeight,
        costPrice: input.costPrice,
        retailPrice: input.retailPrice,
        wholesalePrice: input.wholesalePrice,
        labourCharges: input.labourCharges,
        reorderLevel: input.reorderLevel ?? null,
        remarks: input.remarks || null,
        isActive: true,
      });
    }

    const created = await prisma.$transaction(async (tx) => {
      const existing = await tx.product.findMany({
        where: { productNo: { in: generatedProducts.map((p) => p.productNo) } },
        select: { productNo: true },
      });

      if (existing.length > 0) {
        throw userError(`The following Product No(s) already exist: ${existing.map((e) => e.productNo).join(", ")}`);
      }

      await tx.product.createMany({
        data: generatedProducts,
      });

      return generatedProducts.length;
    });

    emitRealtimeEvent(["products", "inventory", "sales", "purchases"], "create", "Product", {
      count: created,
    });

    revalidatePath("/products");
    revalidatePath("/inventory");
    revalidatePath("/dashboard");

    return { createdCount: created };
  });
}


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

const deleteProductSchema = z.object({ id: z.string().min(1, "Product is required") });

export async function listProductsAction() {
  return runAction("products.list", async () => {
    await requireSession();
    const products = await prisma.product.findMany({
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
      include: {
        category: { select: { id: true, name: true } },
        quality: { select: { id: true, name: true } },
      },
    });

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
    }));
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

      const productData = {
        productNo: normalizedInput.productNo.trim(),
        name: normalizedInput.name.trim(),
        categoryId: normalizedInput.categoryId,
        qualityId: normalizedInput.qualityId,
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

    return res;
  });
}

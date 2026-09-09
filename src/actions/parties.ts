"use server";

import { z } from "zod";
import { PartyType } from "@prisma/client";
import { parseInput, runAction } from "@/actions/_helpers";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getPartyBalance } from "@/lib/ledger";
import { partySchema } from "@/schemas/party";
import { stockAdjustmentSchema, stockTransferSchema } from "@/schemas/inventory";
import { getStockOnHand } from "@/lib/stock";
import { userError } from "@/lib/errors";

const deletePartySchema = z.object({ id: z.string().min(1, "Party is required") });

export async function listPartiesAction() {
  return runAction("parties.list", async () => {
    await requireSession();
    const parties = await prisma.party.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    });

    const result = await Promise.all(
      parties.map(async (party) => ({
        ...party,
        creditLimit: party.creditLimit ? Number(party.creditLimit) : null,
        balance: await getPartyBalance(party.id),
      })),
    );

    return result;
  });
}

export async function listInventoryAction() {
  return runAction("inventory.list", async () => {
    await requireSession();
    const [products, locations] = await Promise.all([
      prisma.product.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
      }),
      prisma.location.findMany({ orderBy: { name: "asc" } }),
    ]);

    const rows = await Promise.all(
      locations.flatMap((location) =>
        products.map(async (product) => ({
          productId: product.id,
          productNo: product.productNo,
          productName: product.name,
          locationId: location.id,
          locationName: location.name,
          available: await getStockOnHand(product.id, location.id),
          unit: product.unit,
          reorderLevel: product.reorderLevel ? Number(product.reorderLevel) : null,
          gsm: Number(product.gsm),
          length: Number(product.length),
          breadth: Number(product.breadth),
          packetWeight: Number(product.packetWeight),
          reamWeight: Number(product.reamWeight),
        })),
      ),
    );

    return rows.flat();
  });
}

export async function upsertPartyAction(raw: unknown) {
  return runAction("parties.upsert", async () => {
    await requireSession();
    const input = parseInput(partySchema, raw);
    const normalized = {
      ...input,
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
      address: input.address?.trim() || null,
      creditLimit: input.type === PartyType.CUSTOMER ? input.creditLimit ?? null : null,
      isActive: Boolean(input.isActive),
    };

    if (normalized.id) {
      return prisma.party.update({
        where: { id: normalized.id },
        data: {
          name: normalized.name.trim(),
          type: normalized.type,
          phone: normalized.phone,
          email: normalized.email,
          address: normalized.address,
          creditLimit: normalized.creditLimit,
          isActive: normalized.isActive,
        },
      });
    }

    return prisma.party.create({
      data: {
        name: normalized.name.trim(),
        type: normalized.type,
        phone: normalized.phone,
        email: normalized.email,
        address: normalized.address,
        creditLimit: normalized.creditLimit,
        isActive: normalized.isActive,
      },
    });
  });
}

export async function softDeletePartyAction(raw: unknown) {
  return runAction("parties.delete", async () => {
    await requireSession();
    const input = parseInput(deletePartySchema, raw);

    return prisma.$transaction(async (tx) => {
      const party = await tx.party.update({
        where: { id: input.id },
        data: {
          isActive: false,
          deletedAt: new Date(),
        },
      });

      return { id: party.id, success: true };
    });
  });
}

export async function adjustStockAction(raw: unknown) {
  return runAction("inventory.adjust", async () => {
    const session = await requireSession();
    const input = parseInput(stockAdjustmentSchema, raw);

    const currentStock = await getStockOnHand(input.productId, input.locationId);
    const desired = input.direction === "OUT" ? currentStock - input.quantity : currentStock + input.quantity;

    if (input.direction === "OUT" && currentStock < input.quantity) {
      throw userError("Insufficient stock for this adjustment. Available stock is lower than the requested quantity.");
    }

    return prisma.$transaction(async (tx) => {
      const movementType = input.direction === "IN" ? "ADJUSTMENT" : "ADJUSTMENT";
      await tx.stockMovement.create({
        data: {
          productId: input.productId,
          locationId: input.locationId,
          type: movementType,
          quantity: input.direction === "IN" ? input.quantity : -input.quantity,
          referenceType: "ADJUSTMENT",
          referenceId: `adjustment-${Date.now()}`,
          createdById: session.user.id,
          notes: input.reason,
        },
      });

      return { availableStock: desired };
    });
  });
}

export async function transferStockAction(raw: unknown) {
  return runAction("inventory.transfer", async () => {
    const session = await requireSession();
    const input = parseInput(stockTransferSchema, raw);

    const fromStock = await getStockOnHand(input.productId, input.fromLocationId);
    if (fromStock < input.quantity) {
      throw userError("Not enough stock available to transfer from the selected source location.");
    }

    return prisma.$transaction(async (tx) => {
      await tx.stockMovement.createMany({
        data: [
          {
            productId: input.productId,
            locationId: input.fromLocationId,
            type: "TRANSFER_OUT",
            quantity: input.quantity,
            referenceType: "TRANSFER",
            referenceId: `transfer-${Date.now()}`,
            createdById: session.user.id,
            notes: input.notes || "Stock transfer",
          },
          {
            productId: input.productId,
            locationId: input.toLocationId,
            type: "TRANSFER_IN",
            quantity: input.quantity,
            referenceType: "TRANSFER",
            referenceId: `transfer-${Date.now()}`,
            createdById: session.user.id,
            notes: input.notes || "Stock transfer",
          },
        ],
      });

      return { success: true };
    });
  });
}

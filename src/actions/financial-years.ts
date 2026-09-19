"use server";

import { z } from "zod";
import { parseInput, runAction } from "@/actions/_helpers";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { userError } from "@/lib/errors";
import { Role } from "@prisma/client";
import { getPartyBalance } from "@/lib/ledger";
import { withResourceQueue } from "@/lib/concurrency";
import { emitRealtimeEvent } from "@/lib/realtime";
import { revalidatePath } from "next/cache";
import { getActiveFinancialYear } from "@/lib/financial-year";

const createFinancialYearSchema = z.object({
  label: z.string().trim().min(2, "Year label must be at least 2 characters").max(30),
  startDate: z.string().min(10, "Start date is required"),
  endDate: z.string().min(10, "End date is required"),
  makeActive: z.boolean().optional().default(false),
});

const closeFinancialYearSchema = z.object({
  closingYearId: z.string().min(1, "Closing year ID is required"),
  targetYearId: z.string().optional(),
  targetYearLabel: z.string().optional(),
  targetYearStartDate: z.string().optional(),
  targetYearEndDate: z.string().optional(),
});

const resetSequenceSchema = z.object({
  financialYearId: z.string().min(1, "Financial Year ID is required"),
  documentType: z.string().min(1, "Document Type is required"),
  nextSequenceNo: z.coerce.number().min(1).default(1),
});

export async function getCurrentFinancialYearAction() {
  return runAction("financialYears.getCurrent", async () => {
    await requireSession();
    const fy = await getActiveFinancialYear();
    return {
      id: fy.id,
      label: fy.label,
      startDate: fy.startDate.toISOString(),
      endDate: fy.endDate.toISOString(),
      isActive: fy.isActive,
      isClosed: fy.isClosed,
    };
  });
}

export async function listFinancialYearsAction() {
  return runAction("financialYears.list", async () => {
    const session = await requireSession();
    // Ensure active year is provisioned if none exists
    await getActiveFinancialYear();

    const years = await prisma.financialYear.findMany({
      orderBy: { startDate: "desc" },
      include: {
        sequences: { select: { documentType: true, lastSequence: true } },
        _count: {
          select: {
            saleInvoices: true,
            purchaseInvoices: true,
            purchaseOrders: true,
            deliveryOrders: true,
            saleReturns: true,
            purchaseReturns: true,
            openingBalances: true,
          },
        },
      },
    });

    return years.map((y) => ({
      id: y.id,
      label: y.label,
      startDate: y.startDate.toISOString(),
      endDate: y.endDate.toISOString(),
      isActive: y.isActive,
      isClosed: y.isClosed,
      createdAt: y.createdAt.toISOString(),
      sequences: y.sequences,
      documentCounts: {
        sales: y._count.saleInvoices,
        purchases: y._count.purchaseInvoices,
        purchaseOrders: y._count.purchaseOrders,
        deliveryOrders: y._count.deliveryOrders,
        saleReturns: y._count.saleReturns,
        purchaseReturns: y._count.purchaseReturns,
        openingBalances: y._count.openingBalances,
      },
    }));
  });
}

export async function createFinancialYearAction(raw: unknown) {
  return runAction("financialYears.create", async () => {
    const session = await requireSession();
    if (session.user.role !== Role.OWNER) {
      throw userError("Only company owners can create new financial years.");
    }

    const input = parseInput(createFinancialYearSchema, raw);
    const start = new Date(input.startDate);
    const end = new Date(input.endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw userError("Invalid start or end date.");
    }
    if (end <= start) {
      throw userError("End date must be after start date.");
    }

    const existing = await prisma.financialYear.findUnique({
      where: { label: input.label },
    });
    if (existing) {
      throw userError(`A financial year with label "${input.label}" already exists.`);
    }

    const created = await prisma.$transaction(async (tx) => {
      if (input.makeActive) {
        await tx.financialYear.updateMany({
          where: { isActive: true },
          data: { isActive: false },
        });
      }
      return tx.financialYear.create({
        data: {
          label: input.label,
          startDate: start,
          endDate: end,
          isActive: input.makeActive ?? false,
          isClosed: false,
        },
      });
    });

    emitRealtimeEvent(["financial-years"], "create", "FinancialYear", { id: created.id });
    revalidatePath("/settings/financial-years");

    return created;
  });
}

export async function activateFinancialYearAction(id: string) {
  return runAction("financialYears.activate", async () => {
    const session = await requireSession();
    if (session.user.role !== Role.OWNER) {
      throw userError("Only company owners can activate accounting periods.");
    }

    const fy = await prisma.financialYear.findUnique({ where: { id } });
    if (!fy) throw userError("Accounting period not found.");
    if (fy.isClosed) throw userError(`Accounting period "${fy.label}" is closed and cannot be re-activated.`);

    await prisma.$transaction(async (tx) => {
      await tx.financialYear.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });
      await tx.financialYear.update({
        where: { id },
        data: { isActive: true },
      });
    });

    emitRealtimeEvent(["financial-years"], "update", "FinancialYear", { id });
    revalidatePath("/settings/financial-years");
    return { success: true, activeYearLabel: fy.label };
  });
}

export async function resetDocumentSequenceAction(raw: unknown) {
  return runAction("financialYears.resetSequence", async () => {
    const session = await requireSession();
    if (session.user.role !== Role.OWNER) {
      throw userError("Only company owners can reset document sequences.");
    }

    const input = parseInput(resetSequenceSchema, raw);
    const nextSeq = input.nextSequenceNo ?? 1;
    const lastSeq = Math.max(0, nextSeq - 1);

    await prisma.documentSequence.upsert({
      where: {
        financialYearId_documentType: {
          financialYearId: input.financialYearId,
          documentType: input.documentType,
        },
      },
      create: {
        financialYearId: input.financialYearId,
        documentType: input.documentType,
        lastSequence: lastSeq,
      },
      update: {
        lastSequence: lastSeq,
      },
    });

    emitRealtimeEvent(["financial-years"], "update", "DocumentSequence", { financialYearId: input.financialYearId });
    revalidatePath("/settings/financial-years");
    return { success: true, nextSequenceNo: input.nextSequenceNo };
  });
}

export async function closeFinancialYearAction(raw: unknown) {
  return runAction("financialYears.close", async () => {
    const session = await requireSession();
    if (session.user.role !== Role.OWNER) {
      throw userError("Only company owners can close financial years.");
    }

    const input = parseInput(closeFinancialYearSchema, raw);

    const lockKeys = ["financial_year:close", `fy:${input.closingYearId}`];

    return await withResourceQueue(lockKeys, async (tx) => {
      const closingYear = await tx.financialYear.findUnique({
        where: { id: input.closingYearId },
      });

      if (!closingYear) {
        throw userError("Closing financial year not found.");
      }
      if (closingYear.isClosed) {
        throw userError(`Financial year "${closingYear.label}" is already closed.`);
      }

      // Resolve or create target new year
      let targetYear;
      if (input.targetYearId) {
        targetYear = await tx.financialYear.findUnique({
          where: { id: input.targetYearId },
        });
        if (!targetYear) {
          throw userError("Target new financial year not found.");
        }
        if (targetYear.isClosed) {
          throw userError("Target financial year is already closed.");
        }
      } else if (input.targetYearLabel && input.targetYearStartDate && input.targetYearEndDate) {
        targetYear = await tx.financialYear.create({
          data: {
            label: input.targetYearLabel.trim(),
            startDate: new Date(input.targetYearStartDate),
            endDate: new Date(input.targetYearEndDate),
            isActive: false,
            isClosed: false,
          },
        });
      } else {
        // Look for next unclosed year
        targetYear = await tx.financialYear.findFirst({
          where: {
            id: { not: closingYear.id },
            isClosed: false,
            startDate: { gte: closingYear.endDate },
          },
          orderBy: { startDate: "asc" },
        });

        if (!targetYear) {
          // Automatically provision next sequential year
          const nextStart = new Date(closingYear.endDate.getTime() + 1000);
          const nextYear = nextStart.getFullYear();
          const autoLabel = `${nextYear}-${nextYear + 1}`;
          const nextEnd = new Date(nextYear + 1, 11, 31, 23, 59, 59);

          targetYear = await tx.financialYear.create({
            data: {
              label: autoLabel,
              startDate: nextStart,
              endDate: nextEnd,
              isActive: false,
              isClosed: false,
            },
          });
        }
      }

      // Query all parties
      const parties = await tx.party.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true, type: true },
      });

      let carriedCount = 0;

      // Calculate closing ledger balance for each party and create Opening Balance in target year
      for (const party of parties) {
        const balance = await getPartyBalance(party.id, tx, closingYear.endDate);

        if (balance !== 0) {
          const isCustomer = party.type === "CUSTOMER";
          // If balance > 0 (debit > credit): party owes money (receivable for company)
          // If balance < 0 (credit > debit): company owes party (payable)
          const debit = balance > 0 ? balance : 0;
          const credit = balance < 0 ? Math.abs(balance) : 0;
          const accountType = isCustomer ? "RECEIVABLE" : "PAYABLE";

          await tx.ledgerEntry.create({
            data: {
              partyId: party.id,
              accountType,
              debit,
              credit,
              referenceType: "OPENING_BALANCE",
              referenceId: closingYear.id,
              sourceFinancialYearId: closingYear.id,
              date: targetYear.startDate,
              description: `Opening Balance carried forward from Financial Year ${closingYear.label}`,
              createdById: session.user.id,
            },
          });

          carriedCount++;
        }
      }

      // Lock closing year
      await tx.financialYear.update({
        where: { id: closingYear.id },
        data: {
          isClosed: true,
          isActive: false,
        },
      });

      // Activate new target year
      await tx.financialYear.update({
        where: { id: targetYear.id },
        data: {
          isActive: true,
          isClosed: false,
        },
      });

      emitRealtimeEvent(["financial-years", "ledger", "parties", "sales", "purchases"], "update", "FinancialYear", {
        closedYearId: closingYear.id,
        newYearId: targetYear.id,
      });

      revalidatePath("/settings/financial-years");
      revalidatePath("/ledger");
      revalidatePath("/parties");
      revalidatePath("/sales");
      revalidatePath("/purchases");

      return {
        closedYearLabel: closingYear.label,
        activeYearLabel: targetYear.label,
        carriedBalancesCount: carriedCount,
      };
    });
  });
}


"use server";

import { parseInput, runAction } from "@/actions/_helpers";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { createUserSchema, updateUserSchema } from "@/schemas/user";
import { Role } from "@prisma/client";
import { hash } from "bcryptjs";
import { z } from "zod";

export async function listUsersAction() {
  return runAction("users.list", async () => {
    await requireRole([Role.OWNER]);
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });
    return users;
  });
}

export async function createUserAction(raw: unknown) {
  return runAction("users.create", async () => {
    await requireRole([Role.OWNER]);
    const input = parseInput(createUserSchema, raw);

    const passwordHash = await hash(input.password, 12);

    const user = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email.toLowerCase(),
        passwordHash,
        role: input.role,
        isActive: input.isActive,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
      },
    });

    return user;
  });
}

export async function toggleUserActiveAction(raw: unknown) {
  return runAction("users.toggleActive", async () => {
    const session = await requireRole([Role.OWNER]);
    const schema = z.object({ id: z.string().min(1) });
    const { id } = parseInput(schema, raw);

    if (id === session.user.id) {
      throw new Error("USER: You cannot deactivate your own account.");
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { id } });
    const updated = await prisma.user.update({
      where: { id },
      data: { isActive: !user.isActive },
    });

    return { id: updated.id, isActive: updated.isActive };
  });
}

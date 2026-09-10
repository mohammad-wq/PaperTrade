import { z } from "zod";
import { Role } from "@prisma/client";

export const userPermissionsSchema = z
  .record(
    z.string(),
    z.object({
      view: z.boolean().default(true),
      create: z.boolean().default(true),
      update: z.boolean().default(true),
      delete: z.boolean().default(true),
    }),
  )
  .default({});

export const createUserSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters"),
  email: z.string().trim().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  role: z.nativeEnum(Role).default(Role.STAFF),
  isActive: z.boolean().default(true),
  permissions: userPermissionsSchema.optional(),
});

export const updateUserSchema = z.object({
  id: z.string().min(1, "User ID is required"),
  name: z.string().trim().min(2, "Name must be at least 2 characters"),
  email: z.string().trim().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters").optional().or(z.literal("")),
  role: z.nativeEnum(Role),
  isActive: z.boolean(),
  permissions: userPermissionsSchema.optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

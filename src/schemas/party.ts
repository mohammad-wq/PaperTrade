import { z } from "zod";
import { PartyType } from "@prisma/client";

export const partySchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Name is required").max(200),
  type: z.nativeEnum(PartyType),
  phone: z.string().trim().max(50).optional().nullable().or(z.literal("")),
  email: z
    .string()
    .trim()
    .email("Enter a valid email")
    .optional()
    .nullable()
    .or(z.literal("")),
  address: z.string().trim().max(500).optional().nullable().or(z.literal("")),
  creditLimit: z.coerce.number().min(0).optional().nullable(),
  isBeneficiary: z.boolean().default(false),
  partnerWarehouseId: z.string().trim().optional().nullable().or(z.literal("")),
  isActive: z.boolean().default(true),
});

export type PartyInput = z.infer<typeof partySchema>;

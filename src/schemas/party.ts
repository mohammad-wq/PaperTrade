import { z } from "zod";
import { PartyType } from "@prisma/client";

export const partySchema = z
  .object({
    id: z.string().optional(),
    name: z.string().trim().min(1, "Name is required").max(200),
    type: z.nativeEnum(PartyType),
    phone: z.string().trim().max(30).optional().or(z.literal("")),
    email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")),
    address: z.string().trim().max(500).optional().or(z.literal("")),
    creditLimit: z.coerce.number().min(0).nullable().optional(),
    isActive: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.type === PartyType.SUPPLIER && value.creditLimit != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["creditLimit"],
        message: "Credit limit applies to customers only",
      });
    }
  });

export type PartyInput = z.infer<typeof partySchema>;

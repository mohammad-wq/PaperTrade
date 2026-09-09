import { z } from "zod";
import { Unit } from "@prisma/client";

const money = z.coerce.number().min(0, "Must be 0 or greater");
const positiveDim = z.coerce.number().gt(0, "Must be greater than 0");

export const productSchema = z.object({
  id: z.string().optional(),
  productNo: z.string().trim().min(1, "Product No is required").max(50),
  name: z.string().trim().min(1, "Product name is required").max(200),
  categoryId: z.string().min(1, "Category is required"),
  qualityId: z.string().min(1, "Quality is required"),
  unit: z
    .enum([Unit.PACKET, Unit.REAM], {
      errorMap: () => ({ message: "Unit must be Packet or Ream" }),
    })
    .default(Unit.PACKET),
  length: positiveDim,
  breadth: positiveDim,
  gsm: positiveDim,
  costPrice: money,
  retailPrice: money,
  wholesalePrice: money,
  labourCharges: money.default(0),
  reorderLevel: z.coerce.number().min(0).nullable().optional(),
  serialNo: z.string().trim().max(100).optional().or(z.literal("")),
  remarks: z.string().trim().max(1000).optional().or(z.literal("")),
  isActive: z
    .union([z.boolean(), z.string()])
    .transform((value) => {
      if (typeof value === "string") {
        return value === "true";
      }
      return value;
    })
    .default(true),
});

export const productUpsertSchema = productSchema;

export type ProductInput = z.infer<typeof productSchema>;
export type ProductUpsertInput = z.infer<typeof productUpsertSchema>;

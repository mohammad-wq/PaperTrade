import { z } from "zod";

export const settingsSchema = z.object({
  overdueDays: z.coerce.number().int().min(1, "Must be at least 1 day").max(365, "Must be 365 or fewer"),
  businessName: z.string().trim().min(2, "Business name is required"),
  businessAddress: z.string().trim().optional().or(z.literal("")),
  businessPhone: z.string().trim().optional().or(z.literal("")),
  businessEmail: z.string().trim().email().optional().or(z.literal("")),
});

export type SettingsInput = z.infer<typeof settingsSchema>;

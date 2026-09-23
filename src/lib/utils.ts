import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { format as dateFnsFormat } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const DATE_FORMAT = "dd-MM-yyyy";
export const DATE_TIME_FORMAT = "dd-MM-yyyy h:mm a";

export function formatDate(
  date: Date | string | number | null | undefined,
  formatStr: string = DATE_FORMAT
): string {
  if (!date) return "";
  const d = typeof date === "string" || typeof date === "number" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "";
  return dateFnsFormat(d, formatStr);
}

export function formatDateTime(
  date: Date | string | number | null | undefined
): string {
  return formatDate(date, DATE_TIME_FORMAT);
}

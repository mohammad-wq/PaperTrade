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

/**
 * Returns YYYY-MM-DDTHH:mm string in client local time (for <input type="datetime-local">)
 * Avoids .toISOString() which converts local time to UTC and shifts hours backwards!
 */
export function getLocalDateTimeInputValue(date: Date | string | number = new Date()): string {
  const d = typeof date === "object" && date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Returns YYYY-MM-DD string in client local time (for <input type="date">)
 */
export function getLocalDateInputValue(date: Date | string | number = new Date()): string {
  const d = typeof date === "object" && date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  return `${year}-${month}-${day}`;
}

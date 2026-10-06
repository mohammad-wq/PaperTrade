"use client";

import React from "react";
import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  parseISO,
} from "date-fns";
import { cn } from "@/lib/utils";
import { Calendar } from "lucide-react";
import { Input } from "@/components/ui/input";

export type DateFilterPreset = "ALL" | "TODAY" | "THIS_WEEK" | "THIS_MONTH" | "CUSTOM";

export function isDateInRange(
  dateValue: Date | string | null | undefined,
  preset: DateFilterPreset,
  startDate?: string,
  endDate?: string
): boolean {
  if (!dateValue || preset === "ALL") return true;

  const d = typeof dateValue === "string" ? new Date(dateValue) : dateValue;
  if (isNaN(d.getTime())) return true;

  const now = new Date();

  switch (preset) {
    case "TODAY":
      return d >= startOfDay(now) && d <= endOfDay(now);
    case "THIS_WEEK":
      return (
        d >= startOfWeek(now, { weekStartsOn: 1 }) &&
        d <= endOfWeek(now, { weekStartsOn: 1 })
      );
    case "THIS_MONTH":
      return d >= startOfMonth(now) && d <= endOfMonth(now);
    case "CUSTOM": {
      if (startDate) {
        const start = startOfDay(parseISO(startDate));
        if (d < start) return false;
      }
      if (endDate) {
        const end = endOfDay(parseISO(endDate));
        if (d > end) return false;
      }
      return true;
    }
    default:
      return true;
  }
}

interface DateRangeFilterProps {
  preset: DateFilterPreset;
  onPresetChange: (preset: DateFilterPreset) => void;
  startDate?: string;
  onStartDateChange?: (date: string) => void;
  endDate?: string;
  onEndDateChange?: (date: string) => void;
  className?: string;
}

export function DateRangeFilter({
  preset,
  onPresetChange,
  startDate = "",
  onStartDateChange,
  endDate = "",
  onEndDateChange,
  className,
}: DateRangeFilterProps) {
  const presets: Array<{ id: DateFilterPreset; label: string }> = [
    { id: "ALL", label: "All Dates" },
    { id: "TODAY", label: "Today" },
    { id: "THIS_WEEK", label: "This Week" },
    { id: "THIS_MONTH", label: "This Month" },
    { id: "CUSTOM", label: "Custom" },
  ];

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5 text-xs", className)}>
      <div className="inline-flex rounded-md border border-slate-300 dark:border-slate-700 p-0.5 bg-slate-100 dark:bg-slate-800">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPresetChange(p.id)}
            className={cn(
              "px-2 py-1 rounded text-[11px] font-semibold transition-all",
              preset === p.id
                ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {preset === "CUSTOM" && (
        <div className="flex items-center gap-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded-md">
          <Calendar className="h-3.5 w-3.5 text-slate-400" />
          <Input
            type="date"
            value={startDate}
            onChange={(e) => onStartDateChange?.(e.target.value)}
            className="h-6 w-32 text-[11px] p-1 bg-transparent border-0"
            placeholder="From"
          />
          <span className="text-slate-400 text-[10px]">to</span>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => onEndDateChange?.(e.target.value)}
            className="h-6 w-32 text-[11px] p-1 bg-transparent border-0"
            placeholder="To"
          />
        </div>
      )}
    </div>
  );
}

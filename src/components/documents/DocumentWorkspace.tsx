"use client";

import type { ReactNode, RefObject } from "react";
import { Minimize2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DocumentWorkspaceProps = {
  open: boolean;
  title: string;
  icon?: ReactNode;
  onClose: () => void;
  onDetach?: () => void;
  toolbar?: ReactNode;
  error?: string | null;
  /** Pinned top: party, date, location */
  header?: ReactNode;
  /** Only this region scrolls (line grid) */
  children: ReactNode;
  /** Optional right column: notes, freight, payment */
  aside?: ReactNode;
  /** Pinned bottom: totals + primary actions */
  footer: ReactNode;
  dialogRef?: RefObject<HTMLDivElement>;
  className?: string;
};

export function DocumentWorkspace({
  open,
  title,
  icon,
  onClose,
  onDetach,
  toolbar,
  error,
  header,
  children,
  aside,
  footer,
  dialogRef,
  className,
}: DocumentWorkspaceProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/50 backdrop-blur-[2px] print:hidden">
      <div
        ref={dialogRef}
        className={cn(
          "flex flex-col w-full h-[100dvh] max-h-[100dvh] bg-white dark:bg-slate-900 border-0 shadow-2xl overflow-hidden",
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 bg-slate-900 text-slate-100 px-4 py-2 flex items-center justify-between border-b border-slate-800 select-none">
          <div className="flex items-center gap-2 min-w-0">
            {icon}
            <span className="font-bold text-xs truncate">{title}</span>
          </div>
          <div className="flex items-center gap-1">
            {onDetach ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onDetach}
                className="h-7 text-[11px] text-slate-300 hover:text-white hover:bg-slate-800 gap-1"
                title="Detach to dock (keep draft, use list behind)"
              >
                <Minimize2 className="h-3.5 w-3.5" />
                Detach
              </Button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded text-slate-400 hover:text-white hover:bg-slate-800 p-1 transition-colors"
              title="Close (Esc)"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {toolbar ? (
          <div className="shrink-0 bg-slate-100 dark:bg-slate-800 px-4 py-1.5 border-b border-slate-200 dark:border-slate-700 text-[11px]">
            {toolbar}
          </div>
        ) : null}

        {error ? (
          <div className="shrink-0 bg-rose-50 dark:bg-rose-950/50 border-b border-rose-200 dark:border-rose-800 px-4 py-2 text-xs text-rose-700 dark:text-rose-300">
            {error}
          </div>
        ) : null}

        <div className="flex flex-1 min-h-0 flex-col lg:flex-row bg-slate-50/50 dark:bg-slate-950/40">
          <div className="flex flex-1 min-h-0 flex-col min-w-0">
            {header ? (
              <div className="shrink-0 p-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                {header}
              </div>
            ) : null}
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto p-3 text-xs">{children}</div>
          </div>
          {aside ? (
            <aside className="shrink-0 lg:w-80 lg:border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 overflow-y-auto max-h-[40vh] lg:max-h-none text-xs">
              {aside}
            </aside>
          ) : null}
        </div>

        <div className="shrink-0 border-t border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
          {footer}
        </div>
      </div>
    </div>
  );
}

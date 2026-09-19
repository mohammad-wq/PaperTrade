"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AlertTriangle, AlertCircle, CheckCircle2, HelpCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ConfirmVariant = "default" | "destructive" | "warning" | "primary";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string | null; // null to hide cancel button (alert mode)
  variant?: ConfirmVariant;
  onConfirm: () => void;
  onCancel?: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "default",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const isAlertMode = cancelText === null;

  const handleConfirm = () => {
    onOpenChange(false);
    onConfirm();
  };

  const handleCancel = () => {
    onOpenChange(false);
    onCancel?.();
  };

  const getVariantStyles = () => {
    switch (variant) {
      case "destructive":
        return {
          icon: <AlertTriangle className="h-5 w-5 text-red-600" />,
          iconBg: "bg-red-50 border-red-100",
          buttonClass: "bg-red-600 hover:bg-red-700 text-white focus:ring-red-500",
        };
      case "warning":
        return {
          icon: <AlertCircle className="h-5 w-5 text-amber-600" />,
          iconBg: "bg-amber-50 border-amber-200",
          buttonClass: "bg-amber-600 hover:bg-amber-700 text-white focus:ring-amber-500",
        };
      case "primary":
        return {
          icon: <CheckCircle2 className="h-5 w-5 text-emerald-700" />,
          iconBg: "bg-emerald-50 border-emerald-200",
          buttonClass: "bg-emerald-800 hover:bg-emerald-900 text-white focus:ring-emerald-700",
        };
      default:
        return {
          icon: <HelpCircle className="h-5 w-5 text-slate-700" />,
          iconBg: "bg-slate-100 border-slate-200",
          buttonClass: "bg-slate-900 hover:bg-slate-800 text-white focus:ring-slate-700",
        };
    }
  };

  const styles = getVariantStyles();

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          onEscapeKeyDown={handleCancel}
          onPointerDownOutside={(e) => {
            // If alert mode, don't dismiss accidentally on outside click
            if (isAlertMode) {
              e.preventDefault();
            } else {
              handleCancel();
            }
          }}
          className={cn(
            "fixed left-[50%] top-[50%] z-50 w-[92vw] max-w-md translate-x-[-50%] translate-y-[-50%]",
            "rounded-xl border border-amber-950/15 bg-[#faf8f5] p-6 shadow-2xl duration-200",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "focus:outline-none",
          )}
        >
          <div className="flex items-start gap-4">
            <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border", styles.iconBg)}>
              {styles.icon}
            </div>

            <div className="flex-1 min-w-0">
              <DialogPrimitive.Title className="text-base font-semibold text-slate-900 tracking-tight">
                {title}
              </DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="mt-2 text-xs sm:text-sm text-slate-600 leading-relaxed break-words whitespace-pre-line">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>

            {!isAlertMode && (
              <DialogPrimitive.Close
                onClick={handleCancel}
                className="rounded-md p-1 text-slate-400 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-400"
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </DialogPrimitive.Close>
            )}
          </div>

          <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5">
            {!isAlertMode && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCancel}
                className="w-full sm:w-auto border-amber-950/15 text-slate-700 hover:bg-slate-100"
              >
                {cancelText}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              autoFocus
              onClick={handleConfirm}
              className={cn("w-full sm:w-auto shadow-xs", styles.buttonClass)}
            >
              {confirmText}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}


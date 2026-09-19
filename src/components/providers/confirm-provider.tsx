"use client";

import React, { createContext, useContext, useState, useCallback, useRef } from "react";
import { ConfirmDialog, ConfirmVariant } from "@/components/ui/confirm-dialog";

export interface ConfirmOptions {
  title?: string;
  description?: string;
  confirmText?: string;
  cancelText?: string | null;
  variant?: ConfirmVariant;
}

export interface AlertOptions {
  title?: string;
  confirmText?: string;
  variant?: ConfirmVariant;
}

export interface ConfirmContextType {
  (options: string | ConfirmOptions): Promise<boolean>;
  confirm: (options: string | ConfirmOptions) => Promise<boolean>;
  alert: (message: string, options?: AlertOptions) => Promise<void>;
}

const ConfirmContext = createContext<ConfirmContextType | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [dialogConfig, setDialogConfig] = useState<{
    title: string;
    description?: string;
    confirmText?: string;
    cancelText?: string | null;
    variant?: ConfirmVariant;
  }>({
    title: "",
    description: "",
    confirmText: "Confirm",
    cancelText: "Cancel",
    variant: "default",
  });

  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((options: string | ConfirmOptions): Promise<boolean> => {
    // If a dialog was already pending, cancel it
    if (resolverRef.current) {
      resolverRef.current(false);
      resolverRef.current = null;
    }

    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;

      if (typeof options === "string") {
        setDialogConfig({
          title: "Confirmation",
          description: options,
          confirmText: "Confirm",
          cancelText: "Cancel",
          variant: "default",
        });
      } else {
        setDialogConfig({
          title: options.title || "Confirmation",
          description: options.description || "",
          confirmText: options.confirmText ?? "Confirm",
          cancelText: options.cancelText !== undefined ? options.cancelText : "Cancel",
          variant: options.variant ?? "default",
        });
      }

      setOpen(true);
    });
  }, []);

  const alert = useCallback(
    async (message: string, options?: AlertOptions): Promise<void> => {
      await confirm({
        title: options?.title || "Notice",
        description: message,
        confirmText: options?.confirmText ?? "OK",
        cancelText: null, // hides Cancel button
        variant: options?.variant ?? "default",
      });
    },
    [confirm],
  );

  const handleConfirm = useCallback(() => {
    setOpen(false);
    if (resolverRef.current) {
      resolverRef.current(true);
      resolverRef.current = null;
    }
  }, []);

  const handleCancel = useCallback(() => {
    setOpen(false);
    if (resolverRef.current) {
      resolverRef.current(false);
      resolverRef.current = null;
    }
  }, []);

  const handleOpenChange = useCallback((isOpen: boolean) => {
    if (!isOpen) {
      handleCancel();
    }
  }, [handleCancel]);

  // Construct callable confirm function with attached methods
  const contextValue = Object.assign(
    (options: string | ConfirmOptions) => confirm(options),
    {
      confirm,
      alert,
    },
  ) as ConfirmContextType;

  return (
    <ConfirmContext.Provider value={contextValue}>
      {children}
      <ConfirmDialog
        open={open}
        onOpenChange={handleOpenChange}
        title={dialogConfig.title}
        description={dialogConfig.description}
        confirmText={dialogConfig.confirmText}
        cancelText={dialogConfig.cancelText}
        variant={dialogConfig.variant}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmContextType {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error("useConfirm must be used within a ConfirmProvider");
  }
  return context;
}


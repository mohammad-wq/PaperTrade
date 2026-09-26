"use client";

import React, { createContext, useContext, useState, useCallback, useRef } from "react";
import { ConfirmDialog, ConfirmVariant } from "@/components/ui/confirm-dialog";

export interface ConfirmOptions {
  title?: string;
  description?: React.ReactNode;
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
  alert: (message: any, options?: AlertOptions) => Promise<void>;
}

const ConfirmContext = createContext<ConfirmContextType | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [dialogConfig, setDialogConfig] = useState<{
    title: string;
    description?: React.ReactNode;
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

      if (typeof options === "string" || React.isValidElement(options)) {
        setDialogConfig({
          title: "Confirmation",
          description: options,
          confirmText: "Confirm",
          cancelText: "Cancel",
          variant: "default",
        });
      } else {
        let desc: React.ReactNode = options.description;
        if (typeof desc === "object" && desc !== null && !React.isValidElement(desc)) {
          if (desc instanceof Error) {
            desc = desc.message;
          } else {
            try {
              desc = JSON.stringify(desc);
            } catch {
              desc = String(desc);
            }
          }
        }
        setDialogConfig({
          title: options.title || "Confirmation",
          description: desc,
          confirmText: options.confirmText ?? "Confirm",
          cancelText: options.cancelText !== undefined ? options.cancelText : "Cancel",
          variant: options.variant ?? "default",
        });
      }

      setOpen(true);
    });
  }, []);

  const alert = useCallback(
    async (message: any, options?: AlertOptions): Promise<void> => {
      let desc: React.ReactNode = message;
      if (typeof desc === "object" && desc !== null && !React.isValidElement(desc)) {
        if (desc instanceof Error) {
          desc = desc.message;
        } else {
          try {
            desc = JSON.stringify(desc);
          } catch {
            desc = String(desc);
          }
        }
      }
      await confirm({
        title: options?.title || "Notice",
        description: desc,
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
      const resolve = resolverRef.current;
      resolverRef.current = null;
      resolve(true);
    }
  }, []);

  const handleCancel = useCallback(() => {
    setOpen(false);
    if (resolverRef.current) {
      const resolve = resolverRef.current;
      resolverRef.current = null;
      resolve(false);
    }
  }, []);

  const handleOpenChange = useCallback((isOpen: boolean) => {
    if (!isOpen) {
      if (resolverRef.current) {
        const resolve = resolverRef.current;
        resolverRef.current = null;
        resolve(false);
      }
      setOpen(false);
    }
  }, []);

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


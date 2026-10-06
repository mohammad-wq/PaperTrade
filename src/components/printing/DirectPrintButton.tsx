"use client";

import React, { useState } from "react";
import { Printer, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface DirectPrintButtonProps {
  documentType: "invoice" | "delivery-order";
  documentId: string;
  format?: "A4" | "A5";
  label?: string;
  className?: string;
  variant?: "default" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
  onPrintStart?: () => void;
  onPrintEnd?: () => void;
}

export function DirectPrintButton({
  documentType,
  documentId,
  format = "A4",
  label,
  className,
  variant = "outline",
  size = "sm",
  onPrintStart,
  onPrintEnd,
}: DirectPrintButtonProps) {
  const [isPrinting, setIsPrinting] = useState(false);

  const handleDirectPrint = () => {
    if (isPrinting || !documentId) return;

    setIsPrinting(true);
    onPrintStart?.();

    const basePath = documentType === "invoice" ? "invoices" : "delivery-orders";
    const printUrl = `/${basePath}/${documentId}/print?format=${format}&direct=true`;

    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.visibility = "hidden";
    iframe.setAttribute("aria-hidden", "true");

    const cleanup = () => {
      try {
        if (iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
      } catch (err) {
        console.error("Error removing print iframe:", err);
      }
      setIsPrinting(false);
      onPrintEnd?.();
    };

    iframe.onload = () => {
      try {
        const cw = iframe.contentWindow;
        if (cw) {
          cw.focus();
          // Short delay allows all fonts, SVG charts and stylesheets to paint
          setTimeout(() => {
            cw.print();
            // Allow time for print dialog before DOM cleanup
            setTimeout(cleanup, 2000);
          }, 350);
        } else {
          cleanup();
        }
      } catch (err) {
        console.error("Direct print iframe execution failed:", err);
        cleanup();
      }
    };

    iframe.onerror = () => {
      console.error("Failed to load printable document in iframe");
      cleanup();
    };

    iframe.src = printUrl;
    document.body.appendChild(iframe);
  };

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={handleDirectPrint}
      disabled={isPrinting}
      className={cn("gap-1.5 font-medium", className)}
      title={`Direct Print (${format})`}
    >
      {isPrinting ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />
      ) : (
        <Printer className="h-3.5 w-3.5" />
      )}
      {label || (isPrinting ? "Printing..." : `Print (${format})`)}
    </Button>
  );
}

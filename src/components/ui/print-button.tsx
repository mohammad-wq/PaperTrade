"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";
import { printDocumentPdf } from "@/lib/print-pdf";

interface PrintButtonProps {
  url: string;
  label?: string;
  className?: string;
  paperSize?: "A4" | "A5";
}

export function PrintButton({ url, label = "Print / PDF", className, paperSize = "A4" }: PrintButtonProps) {
  const [printing, setPrinting] = useState(false);

  async function handlePrint() {
    setPrinting(true);
    try {
      const sep = url.includes("?") ? "&" : "?";
      await printDocumentPdf(`${url}${sep}paperSize=${paperSize}`);
    } catch (err: any) {
      alert(err?.message || "Failed to print document.");
    } finally {
      setPrinting(false);
    }
  }

  return (
    <Button
      size="sm"
      className={className ?? "h-8 gap-1.5 text-xs bg-slate-900 hover:bg-slate-800 text-white"}
      onClick={handlePrint}
      disabled={printing}
    >
      <Printer className="h-3.5 w-3.5" />
      {printing ? "Loading..." : label}
    </Button>
  );
}

"use client";

import { useState } from "react";
import { PrintButton } from "@/components/ui/print-button";
import {
  PrintPaperSizeControl,
  type PrintPaperSize,
} from "@/components/print/PrintPaperSizeControl";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";
import { printDocumentPdf } from "@/lib/print-pdf";

type Props = {
  url: string;
  label?: string;
  className?: string;
  /** Inline row with paper size + print button (default). */
  layout?: "inline" | "buttonOnly";
  defaultPaperSize?: PrintPaperSize;
};

export function PrintWithPaperSize({
  url,
  label = "Print / PDF",
  className,
  layout = "inline",
  defaultPaperSize = "A4",
}: Props) {
  const [paperSize, setPaperSize] = useState<PrintPaperSize>(defaultPaperSize);
  const [printing, setPrinting] = useState(false);

  if (layout === "buttonOnly") {
    return <PrintButton url={url} label={label} className={className} paperSize={paperSize} />;
  }

  async function handlePrint() {
    setPrinting(true);
    try {
      const sep = url.includes("?") ? "&" : "?";
      await printDocumentPdf(`${url}${sep}paperSize=${paperSize}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to print document.";
      alert(message);
    } finally {
      setPrinting(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <PrintPaperSizeControl value={paperSize} onChange={setPaperSize} />
      <Button
        size="sm"
        className={className ?? "h-8 gap-1.5 text-xs bg-slate-900 hover:bg-slate-800 text-white"}
        onClick={handlePrint}
        disabled={printing}
      >
        <Printer className="h-3.5 w-3.5" />
        {printing ? "Loading..." : label}
      </Button>
    </div>
  );
}

/** Append paperSize to a URL for report PDF downloads. */
export function withPaperSizeQuery(url: string, paperSize: PrintPaperSize) {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}paperSize=${paperSize}`;
}

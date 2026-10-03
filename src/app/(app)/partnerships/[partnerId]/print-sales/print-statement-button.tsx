"use client";

import { useEffect } from "react";
import { Printer } from "lucide-react";

export function PrintStatementButton({ autoPrint = false }: { autoPrint?: boolean }) {
  useEffect(() => {
    if (!autoPrint) return;
    const timeout = window.setTimeout(() => window.print(), 500);
    return () => window.clearTimeout(timeout);
  }, [autoPrint]);

  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-1.5 text-xs font-bold text-white shadow-xs transition hover:bg-emerald-800"
    >
      <Printer className="h-4 w-4" />
      Print Statement (A4 Landscape)
    </button>
  );
}

"use client";

export type PrintPaperSize = "A4" | "A5";

export function PrintPaperSizeControl({
  value,
  onChange,
  className = "",
}: {
  value: PrintPaperSize;
  onChange: (size: PrintPaperSize) => void;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as PrintPaperSize)}
      className={`h-8 text-xs border border-slate-300 rounded-md px-2 bg-white print:hidden ${className}`}
      title="Paper size for print"
    >
      <option value="A4">Print A4</option>
      <option value="A5">Print A5</option>
    </select>
  );
}

export function PrintPaperSizeStyle({ paperSize }: { paperSize: PrintPaperSize }) {
  return (
    <style>{`
      @media print {
        @page { size: ${paperSize}; margin: 10mm; }
      }
    `}</style>
  );
}

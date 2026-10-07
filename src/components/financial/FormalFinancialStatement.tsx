"use client";

type StatementRow = {
  label: string;
  amount: number;
  indent?: number;
  bold?: boolean;
  ruleAbove?: boolean;
  doubleRuleAbove?: boolean;
};

export function FormalFinancialStatement({
  businessName,
  title,
  periodLabel,
  rows,
  footerNote,
}: {
  businessName: string;
  title: string;
  periodLabel: string;
  rows: StatementRow[];
  footerNote?: string;
}) {
  const fmt = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="bg-white border border-slate-300 rounded-md shadow-sm print:shadow-none print:border-black max-w-3xl mx-auto">
      <div className="px-6 pt-6 pb-4 border-b-2 border-slate-900 print:border-black text-center">
        <p className="text-lg font-bold uppercase tracking-tight text-slate-900">{businessName}</p>
        <p className="text-sm font-bold uppercase text-slate-800 mt-1">{title}</p>
        <p className="text-xs text-slate-600 mt-1 font-mono">{periodLabel}</p>
      </div>
      <table className="w-full text-sm font-mono">
        <tbody>
          {rows.map((row, idx) => (
            <tr
              key={`${row.label}-${idx}`}
              className={`${
                row.doubleRuleAbove ? "border-t-4 border-double border-slate-900" : row.ruleAbove ? "border-t border-slate-400" : ""
              } ${row.bold ? "font-bold" : ""}`}
            >
              <td
                className="py-2 pl-6 pr-4 text-slate-800 font-sans"
                style={{ paddingLeft: `${24 + (row.indent ?? 0) * 16}px` }}
              >
                {row.label}
              </td>
              <td className="py-2 pr-6 text-right tabular-nums whitespace-nowrap text-slate-900 w-40">
                {row.amount === 0 && row.bold && !row.doubleRuleAbove && !row.ruleAbove ? "" : fmt(row.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {footerNote ? (
        <p className="text-[10px] text-slate-500 px-6 py-3 border-t border-slate-200 font-sans">{footerNote}</p>
      ) : null}
    </div>
  );
}

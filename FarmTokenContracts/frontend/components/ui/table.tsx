import * as React from "react";

export function Table({ className = "", ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={["w-full border-collapse text-sm", className].join(" ")} {...props} />;
}

export function TableHeader({ className = "", ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={["border-b border-slate-800 text-slate-400", className].join(" ")} {...props} />;
}

export function TableBody({ className = "", ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={["divide-y divide-slate-800", className].join(" ")} {...props} />;
}

export function TableRow({ className = "", ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={["hover:bg-slate-900/50", className].join(" ")} {...props} />;
}

export function TableHead({ className = "", ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={["px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400", className].join(" ")} {...props} />;
}

export function TableCell({ className = "", ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={["px-3 py-4 align-middle text-slate-100", className].join(" ")} {...props} />;
}

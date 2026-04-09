import * as React from "react";

export function Card({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={["rounded-2xl border border-slate-800 bg-slate-950/70 shadow-[0_24px_80px_rgba(0,0,0,0.25)]", className].join(" ")} {...props} />;
}

export function CardHeader({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={["border-b border-slate-800/70 p-5", className].join(" ")} {...props} />;
}

export function CardTitle({ className = "", ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={["text-lg font-semibold text-slate-50", className].join(" ")} {...props} />;
}

export function CardDescription({ className = "", ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={["mt-1 text-sm text-slate-400", className].join(" ")} {...props} />;
}

export function CardContent({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={["p-5", className].join(" ")} {...props} />;
}

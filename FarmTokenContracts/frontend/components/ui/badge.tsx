import * as React from "react";

type BadgeVariant = "default" | "secondary" | "warning" | "danger" | "success";

function variantClasses(variant: BadgeVariant) {
  switch (variant) {
    case "secondary":
      return "border-slate-700 bg-slate-800 text-slate-200";
    case "warning":
      return "border-amber-500/30 bg-amber-500/10 text-amber-200";
    case "danger":
      return "border-rose-500/30 bg-rose-500/10 text-rose-200";
    case "success":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
    default:
      return "border-cyan-500/30 bg-cyan-500/10 text-cyan-100";
  }
}

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({ className = "", variant = "default", ...props }: BadgeProps) {
  return <span className={["inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium", variantClasses(variant), className].join(" ")} {...props} />;
}

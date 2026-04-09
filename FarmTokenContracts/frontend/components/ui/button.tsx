import * as React from "react";

type ButtonVariant = "default" | "secondary" | "outline" | "ghost" | "destructive";
type ButtonSize = "sm" | "md" | "lg";

function variantClasses(variant: ButtonVariant) {
  switch (variant) {
    case "secondary":
      return "border-slate-700 bg-slate-800 text-slate-100 hover:bg-slate-700";
    case "outline":
      return "border-slate-700 bg-transparent text-slate-100 hover:bg-slate-900";
    case "ghost":
      return "border-transparent bg-transparent text-slate-100 hover:bg-slate-900";
    case "destructive":
      return "border-rose-900 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20";
    default:
      return "border-cyan-500/40 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20";
  }
}

function sizeClasses(size: ButtonSize) {
  switch (size) {
    case "sm":
      return "px-3 py-1.5 text-xs";
    case "lg":
      return "px-5 py-3 text-base";
    default:
      return "px-4 py-2 text-sm";
  }
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ className = "", variant = "default", size = "md", ...props }: ButtonProps) {
  return (
    <button
      className={[
        "inline-flex items-center justify-center rounded-xl border font-medium transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50",
        variantClasses(variant),
        sizeClasses(size),
        className,
      ].join(" ")}
      {...props}
    />
  );
}

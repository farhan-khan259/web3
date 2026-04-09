"use client";

import * as React from "react";

type TabsContextValue = {
  value: string;
  setValue: (value: string) => void;
};

const TabsContext = React.createContext<TabsContextValue | null>(null);

export function Tabs({
  defaultValue,
  value,
  onValueChange,
  className = "",
  children,
}: {
  defaultValue: string;
  value?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const [internalValue, setInternalValue] = React.useState(defaultValue);
  const currentValue = value ?? internalValue;
  const setValue = React.useCallback(
    (nextValue: string) => {
      if (value === undefined) {
        setInternalValue(nextValue);
      }
      onValueChange?.(nextValue);
    },
    [onValueChange, value]
  );

  return <TabsContext.Provider value={{ value: currentValue, setValue }}><div className={className}>{children}</div></TabsContext.Provider>;
}

export function TabsList({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={["inline-flex rounded-2xl border border-slate-800 bg-slate-950 p-1", className].join(" ")} {...props} />;
}

export function TabsTrigger({ value, className = "", children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }) {
  const context = React.useContext(TabsContext);
  const active = context?.value === value;
  return (
    <button
      type="button"
      className={[
        "rounded-xl px-4 py-2 text-sm font-medium transition-colors",
        active ? "bg-cyan-500/15 text-cyan-100" : "text-slate-400 hover:text-slate-100",
        className,
      ].join(" ")}
      onClick={() => context?.setValue(value)}
      {...props}
    >
      {children}
    </button>
  );
}

export function TabsContent({ value, className = "", children, ...props }: React.HTMLAttributes<HTMLDivElement> & { value: string }) {
  const context = React.useContext(TabsContext);
  if (context?.value !== value) return null;
  return (
    <div className={className} {...props}>
      {children}
    </div>
  );
}

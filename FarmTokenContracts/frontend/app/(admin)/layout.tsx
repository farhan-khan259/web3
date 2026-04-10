"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect } from "react";
import { useAccount } from "wagmi";
import { isAdmin } from "../../lib/auth";

const adminLinks = [
  { href: "/admin/overview", label: "Overview" },
  { href: "/admin/oracle", label: "Oracle" },
  { href: "/admin/vault", label: "Vault" },
  { href: "/admin/loan-engine", label: "Loan Engine" },
  { href: "/admin/panic-monitor", label: "Panic Monitor" },
  { href: "/admin/revenue-waterfall", label: "Revenue Waterfall" },
  { href: "/admin/license-admin", label: "License Admin" },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { address, isConnected } = useAccount();

  const onAdminLoginPage = pathname === "/admin-login";
  const isAllowed = Boolean(isConnected && address && isAdmin(address));

  useEffect(() => {
    if (onAdminLoginPage) {
      return;
    }

    if (!isAllowed) {
      router.replace("/admin-login");
    }
  }, [isAllowed, onAdminLoginPage, router]);

  if (onAdminLoginPage) {
    return <>{children}</>;
  }

  if (!isAllowed) {
    return null;
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl gap-6 p-6">
      <aside className="w-64 shrink-0 rounded-xl border border-slate-800 bg-slate-950/70 p-4">
        <h2 className="mb-4 text-lg font-semibold">Admin Panel</h2>
        <nav className="space-y-2">
          {adminLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`block rounded px-3 py-2 text-sm transition ${pathname === link.href ? "bg-cyan-600/20 text-cyan-200" : "hover:bg-slate-800"}`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}

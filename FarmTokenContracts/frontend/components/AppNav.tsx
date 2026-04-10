"use client";

import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/nft-gallery", label: "NFT Gallery" },
  { href: "/vault-deposit", label: "Vault Deposit" },
  { href: "/borrow", label: "Borrow" },
  { href: "/loans", label: "Loans" },
  { href: "/repay", label: "Repay" },
  { href: "/license-marketplace", label: "License Market" },
  { href: "/revenue", label: "Revenue" },
  { href: "/transactions", label: "Transactions" },
  { href: "/settings", label: "Settings" },
  { href: "/admin/overview", label: "Admin" },
];

export default function AppNav() {
  return (
    <nav className="mirror-nav">
      <div className="mirror-nav-inner">
        <div className="flex flex-wrap gap-2">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="mirror-nav-link"
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="ml-auto">
          <ConnectButton showBalance chainStatus="icon" accountStatus="avatar" />
        </div>
      </div>
    </nav>
  );
}

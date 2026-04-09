"use client";

import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/vault", label: "Vault" },
  { href: "/borrow", label: "Borrow" },
  { href: "/revenue", label: "Revenue" },
  { href: "/oracle-admin", label: "Oracle Admin" },
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

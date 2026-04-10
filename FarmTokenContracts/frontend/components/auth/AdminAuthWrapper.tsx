"use client";

import { ReactNode } from "react";
import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useUserAuth } from "../../lib/auth";

export default function AdminAuthWrapper({ children }: { children: ReactNode }) {
  const { isConnected, address, isAdmin } = useUserAuth();

  if (!isConnected) {
    return (
      <section className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-semibold">Admin access requires wallet connection</h1>
        <p className="mt-2 text-sm opacity-80">Connect a multisig owner wallet to continue.</p>
        <div className="mt-4">
          <ConnectButton />
        </div>
      </section>
    );
  }

  if (!isAdmin) {
    return (
      <section className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-semibold">Unauthorized</h1>
        <p className="mt-2 text-sm opacity-80">Wallet {address} is not in the configured MULTISIG_OWNERS list.</p>
        <p className="mt-4 text-sm">
          Go back to <Link className="underline" href="/dashboard">dashboard</Link>.
        </p>
      </section>
    );
  }

  return <>{children}</>;
}

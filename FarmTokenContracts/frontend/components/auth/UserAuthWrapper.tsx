"use client";

import { ReactNode } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useUserAuth } from "../../lib/auth";

export default function UserAuthWrapper({ children }: { children: ReactNode }) {
  const { isConnected } = useUserAuth();

  if (!isConnected) {
    return (
      <section className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-semibold">Connect your wallet</h1>
        <p className="mt-2 text-sm opacity-80">You need a connected wallet to access user routes.</p>
        <div className="mt-4">
          <ConnectButton />
        </div>
      </section>
    );
  }

  return <>{children}</>;
}

"use client";

"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { useAccount } from "wagmi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { isAdmin } from "../../../lib/auth";

export default function AdminLoginPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();

  const admin = useMemo(() => {
    if (!address) {
      return false;
    }
    return isAdmin(address);
  }, [address]);

  useEffect(() => {
    if (isConnected && admin) {
      router.replace("/admin/overview");
    }
  }, [admin, isConnected, router]);

  return (
    <section className="mx-auto max-w-2xl p-6">
      <Card>
        <CardHeader>
          <CardTitle>Admin Login</CardTitle>
          <CardDescription>Connect your admin wallet (must be multisig signer).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ConnectButton />
          {isConnected && !admin ? (
            <p className="text-sm text-rose-300">Connected wallet is not in the MULTISIG_OWNERS list.</p>
          ) : (
            <p className="text-sm opacity-80">After successful verification, you will be redirected to admin overview.</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
